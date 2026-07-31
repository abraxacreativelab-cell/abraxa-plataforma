/**
 * El driver de WhatsApp. El único que trae H6.
 *
 * Es también la prueba de que la interfaz sirve: si algo de aquí tuviera que
 * estar en el núcleo para que WhatsApp funcione, entonces el enchufe de H12 y
 * H13 estaría mal hecho. Todo lo que sabe qué es un JID, qué es una instancia
 * de Evolution y cómo se ve un `messages.upsert` vive dentro de esta carpeta.
 */
import { PlatformError } from '@abraxa/db';
import type { InboundMessage } from '@abraxa/db';
import { randomBytes } from 'node:crypto';
import { log } from '../../logger';
import { cargarCanalPorId } from '../../channels/lookup';
import type { DriverCompleto, EventoCanal } from '../types';
import { leerSobre } from '../types';
import { createEvolutionClient, type ClienteEvolution } from './evolution';
import { parsearEventos, parsearMensajes } from './parse';
import { normalizarTelefono } from './phone';

export interface OpcionesDriverWhatsApp {
  cliente?: ClienteEvolution;
  /** De dónde cuelga la URL pública del webhook. */
  baseUrlPublica?: string;
  /** Para pruebas: resuelve la fila del canal sin base. */
  cargarCanal?: (channelId: string) => Promise<{ config: Record<string, unknown> }>;
}

export function createWhatsAppDriver(opts: OpcionesDriverWhatsApp = {}): DriverCompleto {
  const cliente = opts.cliente ?? createEvolutionClient();
  const cargarCanal = opts.cargarCanal ?? ((id: string) => cargarCanalPorId(id));

  const instanciaDe = async (channelId: string): Promise<string> => {
    const canal = await cargarCanal(channelId);
    const instancia = (canal.config as { instance?: unknown })?.instance;
    if (typeof instancia !== 'string' || instancia.length === 0) {
      throw new PlatformError(
        'CHANNEL_ERROR',
        'El canal de WhatsApp no tiene instancia de Evolution en su config. ' +
          'Se crea con `crearCanal()`; una fila insertada a mano no sirve.',
        { retryable: false, details: { channelId } },
      );
    }
    return instancia;
  };

  return {
    type: 'whatsapp',

    // ── Dirección canónica: E.164, no JID ────────────────────────────────
    //
    // Que el hilo del cliente que escribe y el del saliente que le manda la
    // bandeja sean EL MISMO depende enteramente de esta línea.
    normalizeAddress: (raw) => normalizarTelefono(raw),

    displayAddress: (address) => address,

    async send({ channelId, address, body, media }) {
      // El teléfono primero: si no lo es, no hay por qué ir a la base a leer el
      // canal ni abrir una conexión con Evolution.
      const destino = normalizarTelefono(address);
      if (!destino) {
        throw new PlatformError('VALIDATION', `Teléfono inválido: "${address}"`);
      }
      const instancia = await instanciaDe(channelId);

      const primeraMedia = media?.[0];
      const r = primeraMedia
        ? await cliente.enviarMedia(instancia, destino, {
            url: primeraMedia,
            type: tipoDeMedia(primeraMedia),
            caption: body ?? '',
          })
        : await cliente.enviarTexto(instancia, destino, body);

      if (!r.externalId) {
        // Evolution aceptó el envío pero no devolvió id. Se sigue adelante: el
        // mensaje salió. Lo que se pierde es el acuse y la deduplicación del
        // eco `fromMe`, así que queda anotado en vez de fingir que todo bien.
        log.warn(`Evolution no devolvió id para el saliente de ${instancia} → ${destino}`);
      }
      return { externalId: r.externalId ?? '' };
    },

    async parseWebhook(raw: unknown): Promise<InboundMessage[]> {
      const sobre = leerSobre(raw);
      if (!sobre) return [];
      return parsearMensajes(sobre.channelId, sobre.payload);
    },

    async parseEvents(raw: unknown): Promise<EventoCanal[]> {
      const sobre = leerSobre(raw);
      if (!sobre) return [];
      return parsearEventos(sobre.payload);
    },

    /**
     * Alta de la línea: instancia dedicada + webhook con token propio.
     *
     * El token se genera aquí y viaja en la URL del webhook. Es lo que hace que
     * el endpoint público de un cliente no sirva para inyectarle mensajes a
     * otro.
     */
    async provisionChannel({ tenantId, name, config }) {
      const instancia =
        typeof config.instance === 'string' && config.instance.length > 0
          ? config.instance
          : `abx-${String(tenantId).slice(0, 8)}-${randomBytes(3).toString('hex')}`;
      const token =
        typeof config.webhook_token === 'string' && config.webhook_token.length > 0
          ? config.webhook_token
          : randomBytes(24).toString('hex');

      config.instance = instancia;
      config.webhook_token = token;

      const url = urlDelWebhook(opts.baseUrlPublica, config.channelId, token);
      await cliente.crearInstancia(instancia, url);
      log.info(`canal de WhatsApp aprovisionado: ${name} (instancia ${instancia})`);

      // `externalId` vacío a propósito: esa columna guarda la DIRECCIÓN de la
      // línea —el número conectado—, y todavía no hay número: nadie ha
      // escaneado el QR. La instancia vive en `config.instance`, que es donde
      // le corresponde. Lo llena `channelStatus()` al vincular.
      return { externalId: '', status: 'pending' };
    },

    async channelStatus({ config }) {
      const instancia = String(config.instance ?? '');
      if (!instancia) return { status: 'error', externalId: null, qr: null };

      const estado = await cliente.estado(instancia);
      let qr: string | null = null;
      if (estado.state !== 'open') {
        // Todavía sin QR es normal mientras Evolution levanta la instancia:
        // no es un error que deba tumbar la pantalla de conexión.
        try {
          qr = (await cliente.qr(instancia)).base64;
        } catch {
          qr = null;
        }
      }
      return {
        status: estado.state === 'open' ? 'active' : 'disconnected',
        externalId: estado.number,
        qr,
      };
    },

    async teardownChannel({ config }) {
      const instancia = String(config.instance ?? '');
      if (instancia) await cliente.borrarInstancia(instancia);
    },
  };
}

/**
 * ¿Es una dirección a la que Evolution NO puede llegar desde fuera?
 *
 * Deliberadamente conservador: sólo se marca lo que es imposible por
 * definición —loopback y los rangos privados de la RFC 1918— y `.local`. Una
 * URL pública rara no se toca; el objetivo es cazar el default de desarrollo
 * que se quedó puesto, no adivinar topologías de red ajenas.
 */
export function esInalcanzableDesdeFuera(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
  return /^172\.(1[6-9]|2\d|3[01])\./.test(host);
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  La URL a la que Evolution manda los eventos. PÚBLICA, y por eso su propia
 *  variable.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * `channelId` puede faltar cuando el canal aún no tiene fila (es el orden que
 * impone `provisionChannel`, que corre antes del INSERT en algunos caminos): en
 * ese caso `crearCanal()` vuelve a fijar el webhook con el id real.
 *
 * ── Por qué ya NO se lee `API_BASE_URL` (2026-07-31) ───────────────────────
 *
 * `API_BASE_URL` significaba dos cosas incompatibles a la vez:
 *
 *   · Aquí, la URL PÚBLICA por la que los servidores de Evolution —que están en
 *     internet— alcanzan `/inbox/webhooks/:id`.
 *   · En `apps/web/app/(app)/bandeja/api/bff.ts`, la base INTERNA con la que el
 *     BFF de Next llama a `apps/api`: `http://localhost:3100`, o el nombre del
 *     servicio dentro de la red de contenedores.
 *
 * Un solo valor no puede ser las dos. Con el valor interno —que es el que trae
 * `.env.example`— la instancia de WhatsApp se aprovisiona sin error, la línea
 * aparece conectada, el QR se escanea… y no entra ni un solo mensaje, porque
 * Evolution está haciendo POST a su propio `localhost`. Con el valor público,
 * el BFF sale a internet y vuelve para hablar con un proceso que tiene al lado.
 *
 * Ahora la URL pública es `PUBLIC_WEBHOOK_BASE_URL`. Se mantiene el respaldo a
 * `API_BASE_URL` para no romper un despliegue que hoy funcione porque le puso
 * el valor público — pero si de ese respaldo sale una dirección a la que nadie
 * puede llegar desde internet, se AVISA en vez de callar. Ese aviso es la única
 * pista que separa «no llega ningún WhatsApp» de una tarde revisando Evolution.
 */
export function urlDelWebhook(base: string | undefined, channelId: unknown, token: string): string {
  const publica = process.env.PUBLIC_WEBHOOK_BASE_URL;
  const respaldo = process.env.API_BASE_URL;
  const raiz = (base ?? publica ?? respaldo ?? 'http://localhost:3100').replace(/\/+$/, '');

  if (!base && !publica && esInalcanzableDesdeFuera(raiz)) {
    log.warn(
      `el webhook de WhatsApp quedaría en ${raiz}, una dirección a la que Evolution NO puede ` +
        'llegar desde internet: la línea se conectará pero no entrará ningún mensaje. ' +
        'Configura PUBLIC_WEBHOOK_BASE_URL con la URL pública de la API ' +
        '(p. ej. https://api.abraxa.club). API_BASE_URL es la base INTERNA que usa el BFF ' +
        'y no sirve para esto.',
    );
  }

  const id = typeof channelId === 'string' ? channelId : 'sin-id';
  return `${raiz}/inbox/webhooks/${id}?token=${encodeURIComponent(token)}`;
}

function tipoDeMedia(url: string): string {
  const limpia = url.split('?')[0] ?? '';
  const ext = limpia.slice(limpia.lastIndexOf('.') + 1).toLowerCase();
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'webm', '3gp'].includes(ext)) return 'video';
  if (['mp3', 'ogg', 'oga', 'wav', 'm4a'].includes(ext)) return 'audio';
  return 'document';
}
