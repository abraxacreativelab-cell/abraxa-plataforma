/**
 * ════════════════════════════════════════════════════════════════════════════
 *  H12 · El driver de Instagram Direct y Messenger.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Para muchos negocios mexicanos Instagram **es** el canal de ventas: el DM es
 *  donde preguntan precio, donde se cierra y donde se pierde el cliente si nadie
 *  contesta a tiempo. Esto es lo que hace que el agente conteste ahí igual que
 *  en WhatsApp.
 *
 *  Son dos canales y **un solo driver parametrizado**, no dos copias. Instagram
 *  y Messenger comparten la Graph API, la firma, el formato del webhook y la
 *  ventana de 24 horas; se diferencian en tres cosas y las tres están en
 *  `ajustes.ts`: el `object` del webhook, a qué id se le cuelga `/messages` y el
 *  tope de caracteres. Dos archivos casi idénticos habrían divergido en la
 *  primera corrección que sólo se aplicara a uno.
 *
 *  ── Lo que este driver NO hace, y por qué ──────────────────────────────────
 *
 *  · **No edita el registro de drivers.** Se auto-registra con `registerDriver`
 *    desde aquí. Falta una línea en `packages/inbox/src/index.ts` que importe
 *    esta carpeta — es de H6 y está en el README.
 *  · **No publica contenido ni gestiona anuncios.** Sólo mensajería.
 *  · **No fusiona contactos.** Ver `direccion.ts`.
 *  · **No escribe fuera de `drivers/meta/`.**
 *
 *  ── El recorrido ───────────────────────────────────────────────────────────
 *
 *      POST /inbox/webhooks/:channelId?token=…      (H6)
 *        → parseEvents()   → firma → acuses
 *        → parseWebhook()  → firma → guardia de entrada → mensajes
 *                          → ventana de 24 h + nombre del contacto
 *        → …núcleo de H6…  → agente → send()
 *                          → ventana de 24 h → Graph API → mids anotados
 */
import { randomBytes } from 'node:crypto';
import { PlatformError } from '@abraxa/db';
import type { InboundMessage } from '@abraxa/db';
import { log } from '../../logger';
import { cargarCanalPorId } from '../../channels/lookup';
import { contextoDeCanal } from '../../context';
import type { ChannelRow } from '../../types';
import type { DriverCompleto, EventoCanal } from '../types';
import { leerSobre } from '../types';
import { registerDriver } from '../registry';
import {
  LARGO_MAXIMO,
  exigirToken,
  idDeEnvio,
  guardarSecretos,
  leerConfigMeta,
  type CanalMeta,
  type ConfigMeta,
} from './ajustes';
import { mostrarDireccionMeta, normalizarDireccionMeta } from './direccion';
import { barrerViejos, midsPropios, recordarMids } from './ecos';
import { CABECERA_FIRMA, cuerpoCrudoDelSobre, verificarChallenge, verificarFirma } from './firma';
import { createClienteMeta, type ClienteMeta, type EtiquetaMensaje } from './graph';
import { entrantesParaVentana, midsDeEcos, parsearEventos, parsearMensajes } from './parse';
import { decidirEnvio, estadoDeVentana, registrarEntrante, etiquetaValida } from './ventana';

export interface OpcionesDriverMeta {
  cliente?: ClienteMeta;
  /** Para pruebas: resuelve la fila del canal sin base. */
  cargarCanal?: (channelId: string) => Promise<ChannelRow>;
}

/**
 * El driver, más lo que el port todavía no sabe pedir.
 *
 * `verificarWebhook` no está en `ChannelDriver` (de H1) ni en `ExtrasDriver` (de
 * H6) porque ninguno de los dos archivos es de este carril. Se declara aquí, y
 * el parche de seis líneas que hace que la ruta lo llame está en el README.
 */
export interface DriverMeta extends DriverCompleto {
  /**
   * El challenge del GET de alta de Meta, o `null`.
   *
   * Lo que hay que responder es el challenge **crudo, como texto plano**. Ver
   * `firma.ts`.
   */
  verificarWebhook(i: { query: unknown; config: Record<string, unknown> }): string | null;
}

export function createMetaDriver(canal: CanalMeta, opts: OpcionesDriverMeta = {}): DriverMeta {
  const cliente = opts.cliente ?? createClienteMeta();
  const cargarCanal = opts.cargarCanal ?? ((id: string) => cargarCanalPorId(id));

  /** La fila del canal y su config ya resuelta. */
  const abrir = async (channelId: string): Promise<{ fila: ChannelRow; cfg: ConfigMeta }> => {
    const fila = await cargarCanal(channelId);
    return { fila, cfg: leerConfigMeta(canal, fila.config) };
  };

  /**
   * La puerta de todo webhook: la firma.
   *
   * Se llama desde `parseEvents` y desde `parseWebhook`, que es una lectura de
   * más del canal por webhook — una fila por su llave primaria. Se prefiere a
   * cachear el veredicto entre dos llamadas: un caché de «este cuerpo ya venía
   * firmado» es exactamente la clase de estado que un día devuelve `true` por
   * el motivo equivocado.
   *
   * Devuelve `null` si hay que descartar el webhook.
   */
  const verificar = async (
    raw: unknown,
    ruidoso: boolean,
  ): Promise<{ fila: ChannelRow; cfg: ConfigMeta; payload: unknown } | null> => {
    const sobre = leerSobre(raw);
    if (!sobre) return null;

    const { fila, cfg } = await abrir(sobre.channelId);
    const firma = sobre.headers?.[CABECERA_FIRMA];
    const cuerpo = cuerpoCrudoDelSobre(raw);

    if (!firma) {
      // Sin firma. Sólo se deja pasar si el canal lo pidió explícitamente, y se
      // avisa CADA vez: un canal que dejó de verificar firmas tiene que doler a
      // la vista en el log.
      if (cfg.firmaOpcional) {
        if (ruidoso) {
          log.warn(
            `meta: webhook SIN firma aceptado en el canal ${fila.id} porque tiene ` +
              '`meta_firma_opcional`. Eso es sólo para desarrollo — quítalo antes de ' +
              'conectar una cuenta real.',
          );
        }
        return { fila, cfg, payload: sobre.payload };
      }
      if (ruidoso) {
        log.error(
          `meta: webhook RECHAZADO en el canal ${fila.id}: no trae ${CABECERA_FIRMA}.`,
        );
      }
      return null;
    }

    if (!cuerpo) {
      // La firma viene, pero el cuerpo crudo no llegó hasta aquí. NO se
      // re-serializa `payload` para comprobarla: el HMAC saldría sobre bytes
      // distintos y se caerían TODOS los eventos legítimos, con un síntoma que
      // parece de secretos mal puestos. Ver `firma.ts` y el README.
      if (ruidoso) {
        log.error(
          `meta: webhook RECHAZADO en el canal ${fila.id}: llegó firmado pero sin el ` +
            'cuerpo crudo. `apps/api` lo guarda en `req.rawBody` (app.ts:14-16) y la ruta ' +
            'de H6 todavía no lo pasa en el sobre. Es una línea: ver ' +
            'packages/inbox/src/drivers/meta/README.md.',
        );
      }
      return null;
    }

    if (!verificarFirma({ cuerpo, firma, appSecret: cfg.appSecret })) {
      // Criterio #8: firma inválida → rechazado y registrado. Sin el secreto ni
      // la firma en el mensaje: un log no es sitio para ninguno de los dos.
      if (ruidoso) {
        log.error(
          `meta: webhook RECHAZADO en el canal ${fila.id}: ${CABECERA_FIRMA} no coincide` +
            (cfg.appSecret ? '.' : ' (el canal no tiene App Secret configurado).'),
        );
      }
      return null;
    }

    return { fila, cfg, payload: sobre.payload };
  };

  return {
    type: canal,

    normalizeAddress: (raw) => normalizarDireccionMeta(raw),
    displayAddress: (address) => mostrarDireccionMeta(address),

    // ── Entrada ──────────────────────────────────────────────────────────────

    async parseWebhook(raw: unknown): Promise<InboundMessage[]> {
      const abierto = await verificar(raw, true);
      if (!abierto) return [];

      const { fila, cfg, payload } = abierto;
      const ctx = contextoDeCanal(fila);

      // ¿Cuáles de estos ecos son nuestros? Una consulta, no una por mensaje.
      const ecos = midsDeEcos(payload);
      const propios =
        ecos.length > 0 ? await midsPropios(ctx, { channelId: fila.id, mids: ecos }) : new Set<string>();

      const mensajes = parsearMensajes({
        channelId: fila.id,
        cfg,
        payload,
        midsPropios: propios,
      });

      // La ventana de 24 h se abre con lo que escribe el CLIENTE. Va aquí y no
      // en el núcleo porque es una regla de Meta, no de la bandeja.
      for (const e of entrantesParaVentana({ channelId: fila.id, cfg, payload })) {
        await registrarEntrante(ctx, { channelId: fila.id, address: e.address, cuando: e.cuando });
      }

      return cfg.resolverPerfil ? await conNombres(cliente, cfg, mensajes) : mensajes;
    },

    async parseEvents(raw: unknown): Promise<EventoCanal[]> {
      const abierto = await verificar(raw, false);
      if (!abierto) return [];
      return parsearEventos(abierto.payload, abierto.cfg);
    },

    // ── Salida ───────────────────────────────────────────────────────────────

    /**
     * Manda un mensaje, si la ventana lo permite.
     *
     * El orden es deliberado: **primero la ventana, después la red**. Un envío
     * fuera de la ventana se rechaza aquí, sin gastar la llamada —cada intento
     * fallido cuenta contra el límite de la app— y con un texto que explica qué
     * pasó, en vez del código 10/2018278 de Meta, que no le dice nada a nadie.
     */
    async send({ channelId, address, body, media }) {
      const destino = normalizarDireccionMeta(address);
      if (!destino) {
        throw new PlatformError('VALIDATION', `Dirección de ${canal} inválida: "${address}"`);
      }

      const { fila, cfg } = await abrir(channelId);
      exigirToken(cfg);
      idDeEnvio(cfg);

      const ctx = contextoDeCanal(fila);
      const estado = await estadoDeVentana(ctx, { channelId: fila.id, address: destino });
      const { etiqueta } = decidirEnvio({
        estado,
        etiquetaConfigurada: etiquetaDe(fila.config),
        canal,
      });

      if (estado.porCerrar) {
        log.info(
          `meta: la ventana de 24 h de ${destino} se cierra en ${estado.minutosRestantes} min`,
        );
      }

      const mids = await mandarPartes(cliente, cfg, {
        destino,
        body: body ?? '',
        media: media ?? [],
        ...(etiqueta ? { etiqueta } : {}),
      });

      // Los mids se anotan SIEMPRE, incluso el primero que H6 va a guardar como
      // `external_id`: anotar de más cuesta una fila que se consume al primer
      // eco; anotar de menos deja al agente pausándose a sí mismo. Ver `ecos.ts`.
      await recordarMids(ctx, { channelId: fila.id, mids });

      const primero = mids.find((m): m is string => typeof m === 'string' && m.length > 0);
      if (!primero) {
        // Meta aceptó el envío pero no devolvió id. Se sigue adelante —el
        // mensaje salió— y queda anotado: lo que se pierde es el acuse y la
        // deduplicación del eco. Mismo criterio que el driver de WhatsApp.
        log.warn(`meta: envío a ${destino} aceptado sin message_id`);
      }
      return { externalId: primero ?? '' };
    },

    // ── Alta y estado del canal ──────────────────────────────────────────────

    /**
     * Deja el canal listo para que el emprendedor lo vincule.
     *
     * NO conecta nada: la cuenta se elige desde Ajustes con el flujo de
     * `conexion.ts`, que necesita al emprendedor delante de un diálogo de
     * Facebook. Lo que sí se hace aquí es generar los dos secretos que la
     * pantalla va a necesitar —el token de la URL y el `verify_token` del
     * challenge—, porque tienen que existir ANTES de que nadie pegue la URL en
     * el panel de Meta.
     *
     * `externalId` vacío y `status: 'pending'` a propósito, igual que en el
     * driver de WhatsApp: esa columna guarda la dirección de la línea y todavía
     * no hay ninguna.
     */
    async provisionChannel({ name, config }) {
      // Los dos se generan SÓLO si no existen. Regenerarlos al reaprovisionar
      // invalidaría la URL que el emprendedor ya pegó en el panel de Meta —el
      // `webhook_token` viaja en ella— y tumbaría la verificación del webhook,
      // que es justo lo más caro de volver a hacer.
      const previo = (config.secret as Record<string, unknown> | undefined)?.verify_token;
      if (typeof previo !== 'string' || previo.length === 0) {
        const conSecretos = guardarSecretos(config, {
          verify_token: randomBytes(24).toString('hex'),
        });
        for (const [k, v] of Object.entries(conSecretos)) config[k] = v;
      }
      if (typeof config.webhook_token !== 'string' || config.webhook_token.length === 0) {
        config.webhook_token = randomBytes(24).toString('hex');
      }

      log.info(
        `meta: canal de ${canal} preparado (${name}). Falta vincular la cuenta desde Ajustes.`,
      );
      return { externalId: '', status: 'pending' };
    },

    /**
     * El estado vivo de la línea.
     *
     * A diferencia de WhatsApp no hay QR: la vinculación es un OAuth en el
     * navegador. Lo que se devuelve es si el token de página sigue sirviendo,
     * que es lo que de verdad se rompe con el tiempo.
     */
    async channelStatus({ channelId, config }) {
      const cfg = leerConfigMeta(canal, config);
      if (!cfg.pageAccessToken || !cfg.idDeEntrada) {
        return { status: 'pending', externalId: null, qr: null };
      }

      try {
        const info = await cliente.infoPagina(cfg);
        const externalId = canal === 'instagram' ? (info.igUserId ?? cfg.igUserId) : info.id;

        // La pantalla de Ajustes es un buen sitio para barrer: se abre de vez en
        // cuando y no está en el camino de ningún mensaje.
        if (channelId) {
          void cargarCanal(channelId)
            .then((fila) => barrerViejos(contextoDeCanal(fila)))
            .catch(() => 0);
        }

        return { status: 'active', externalId: externalId || null, qr: null };
      } catch (err) {
        log.warn(`meta: el canal ${channelId} no respondió: ${String(err)}`);
        return { status: 'disconnected', externalId: cfg.idDeEntrada || null, qr: null };
      }
    },

    /** Baja: se desuscribe la página para que Meta deje de mandar eventos. */
    async teardownChannel({ config }) {
      const cfg = leerConfigMeta(canal, config);
      if (!cfg.pageAccessToken || !cfg.pageId) return;
      await cliente.desuscribirPagina(cfg);
    },

    // ── El GET de alta ───────────────────────────────────────────────────────

    verificarWebhook({ query, config }) {
      const cfg = leerConfigMeta(canal, config);
      const challenge = verificarChallenge(query, cfg.verifyToken);
      if (!challenge) {
        log.warn(
          'meta: verificación de webhook rechazada (`hub.verify_token` no coincide, o falta ' +
            '`verify_token` en la config del canal).',
        );
      }
      return challenge;
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Detalles del envío
// ════════════════════════════════════════════════════════════════════════════

function etiquetaDe(config: Record<string, unknown>): string | undefined {
  const v = etiquetaValida(config?.meta_etiqueta_fuera_de_ventana);
  return v ?? undefined;
}

/**
 * Manda el mensaje, que puede ser varias llamadas.
 *
 * Meta no acepta pie de foto —texto y adjunto son mensajes distintos— y corta
 * el texto a 1000 caracteres en Instagram y 2000 en Messenger. Así que un solo
 * `send()` de la bandeja puede ser tres llamadas, y por eso se devuelven todos
 * los `mid`: ver `ecos.ts`.
 *
 * Si una parte falla, se deja de mandar el resto. Seguir dejaría al cliente con
 * la foto sin el texto que la explica, y el error diría que no se envió nada.
 */
async function mandarPartes(
  cliente: ClienteMeta,
  cfg: ConfigMeta,
  i: { destino: string; body: string; media: string[]; etiqueta?: EtiquetaMensaje },
): Promise<Array<string | null>> {
  const mids: Array<string | null> = [];

  for (const trozo of partirTexto(i.body, LARGO_MAXIMO[cfg.canal])) {
    const r = await cliente.enviarTexto(cfg, {
      destino: i.destino,
      texto: trozo,
      ...(i.etiqueta ? { etiqueta: i.etiqueta } : {}),
    });
    mids.push(r.externalId);
  }

  for (const url of i.media) {
    const r = await cliente.enviarAdjunto(cfg, {
      destino: i.destino,
      url,
      tipo: tipoDeAdjunto(url),
      ...(i.etiqueta ? { etiqueta: i.etiqueta } : {}),
    });
    mids.push(r.externalId);
  }

  return mids;
}

/**
 * Parte un texto largo sin cortar palabras a la mitad.
 *
 * Se corta por el último espacio del trozo, no por el carácter exacto: «…el
 * precio es de 1,2» seguido de «50 pesos» es peor que no haber contestado.
 */
export function partirTexto(texto: string, maximo: number): string[] {
  const limpio = String(texto ?? '');
  if (!limpio) return [];
  if (limpio.length <= maximo) return [limpio];

  const trozos: string[] = [];
  let resto = limpio;

  while (resto.length > maximo) {
    const ventana = resto.slice(0, maximo);
    const corte = ventana.lastIndexOf(' ');
    // Sin espacios en todo el trozo (una URL larguísima) se corta a lo bruto:
    // es lo único que se puede hacer, y es mejor que no mandarlo.
    const fin = corte > maximo * 0.5 ? corte : maximo;
    trozos.push(resto.slice(0, fin).trim());
    resto = resto.slice(fin).trim();
  }

  if (resto) trozos.push(resto);
  return trozos;
}

function tipoDeAdjunto(url: string): 'image' | 'video' | 'audio' | 'file' {
  const limpia = (url.split('?')[0] ?? '').toLowerCase();
  const ext = limpia.slice(limpia.lastIndexOf('.') + 1);
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'webm'].includes(ext)) return 'video';
  if (['mp3', 'ogg', 'oga', 'wav', 'm4a', 'aac'].includes(ext)) return 'audio';
  return 'file';
}

// ════════════════════════════════════════════════════════════════════════════
// El nombre del contacto
// ════════════════════════════════════════════════════════════════════════════

/**
 * Cuántas direcciones se recuerdan para no volver a preguntar por su nombre.
 *
 * El caché es del PROCESO y a propósito no es una tabla: el nombre ya se guarda
 * donde tiene que guardarse —`threads.contact_name`, que llena H6 con el
 * `contactName` de aquí— y una tabla más sería una segunda copia del mismo dato
 * que un día diría otra cosa.
 */
const TOPE_CACHE = 5_000;
const nombres = new Map<string, string | null>();

/**
 * Rellena `contactName` preguntándole a la Graph API.
 *
 * El webhook de Meta **no trae el nombre** —Messenger nunca, Instagram sólo a
 * veces— y sin él la bandeja enseña «id:17841400000000000», que no le dice nada
 * a quien vende. Se pregunta UNA vez por persona y se recuerda.
 *
 * Best-effort de principio a fin: si falla, entra el mensaje sin nombre. Los
 * permisos de perfil son de los últimos que aprueba Meta, así que hasta que
 * termine la App Review esto va a devolver `null` a menudo — y eso está bien.
 */
async function conNombres(
  cliente: ClienteMeta,
  cfg: ConfigMeta,
  mensajes: InboundMessage[],
): Promise<InboundMessage[]> {
  const salida: InboundMessage[] = [];

  for (const m of mensajes) {
    if (m.contactName || m.fromMe) {
      salida.push(m);
      continue;
    }

    const llave = `${cfg.canal}:${m.address}`;
    if (!nombres.has(llave)) {
      const p = await cliente.perfil(cfg, m.address);
      if (nombres.size >= TOPE_CACHE) nombres.clear();
      nombres.set(llave, p?.username ?? p?.name ?? null);
    }

    const nombre = nombres.get(llave);
    salida.push(nombre ? { ...m, contactName: nombre } : m);
  }

  return salida;
}

// ════════════════════════════════════════════════════════════════════════════
// El enchufe
// ════════════════════════════════════════════════════════════════════════════

/** Los dos drivers de Meta, listos para `registerDriver()`. */
export function crearDriversMeta(opts: OpcionesDriverMeta = {}): DriverMeta[] {
  return [createMetaDriver('instagram', opts), createMetaDriver('messenger', opts)];
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El auto-registro.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Importar esta carpeta deja los dos canales listos. Es lo que el registro de
 *  H6 promete —«cada driver vive en `src/drivers/<canal>/` y se auto-registra al
 *  importarse» (`drivers/registry.ts:6-7`)— y lo que hace que enchufar H12 sea
 *  **una línea** en `packages/inbox/src/index.ts`:
 *
 *      import './drivers/meta';
 *
 *  Ese archivo es de H6 y hoy no la tiene, así que los canales no se registran
 *  todavía. Está en el README, es la primera de las tres cosas que necesito de
 *  H6, y es la única que no tiene ningún matiz.
 *
 *  Registrar aquí y no allí es a propósito: el registro es idempotente
 *  (`registry.ts:47`) y así el día que H6 prefiera llamar a `registerDriver()`
 *  explícitamente, las dos formas funcionan y ninguna rompe a la otra.
 */
for (const d of crearDriversMeta()) registerDriver(d);

export { leerConfigMeta, type CanalMeta, type ConfigMeta } from './ajustes';
export { normalizarDireccionMeta, mostrarDireccionMeta, esIdOpaco } from './direccion';
export {
  CABECERA_FIRMA,
  cuerpoCrudoDelSobre,
  firmaDe,
  verificarChallenge,
  verificarFirma,
} from './firma';
export {
  createClienteMeta,
  errorDeMeta,
  type ClienteMeta,
  type EtiquetaMensaje,
  type PaginaDeUsuario,
} from './graph';
export { guardiaDeEntrada, midsDeEcos, parsearEventos, parsearMensajes } from './parse';
export {
  AVISO_MS,
  VENTANA_MS,
  calcularVentana,
  decidirEnvio,
  estadoDeVentana,
  explicarCierre,
  registrarEntrante,
  ultimoEntranteDe,
  type EstadoVentana,
} from './ventana';
export { barrerViejos, midsPropios, recordarMids } from './ecos';
export { idYaConectado, resolverCanalPorEntrada } from './enrutado';
export {
  EVENTOS,
  PERMISOS,
  conectarCuenta,
  configDeCanal,
  cuentasVinculables,
  urlDeAutorizacion,
  type CuentaVinculable,
} from './conexion';
