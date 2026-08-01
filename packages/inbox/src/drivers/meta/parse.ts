/**
 * ════════════════════════════════════════════════════════════════════════════
 *  De un webhook de Meta a lo que entiende la bandeja.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Instagram y Messenger mandan **la misma forma** por el mismo tubo, y se
 *  distinguen por una sola llave de primer nivel:
 *
 *      { "object": "instagram" | "page",
 *        "entry": [ { "id": "…", "time": …, "messaging": [ … ] } ] }
 *
 *  Dentro de `messaging` caben cinco cosas distintas y sólo dos son mensajes:
 *
 *      message   → un DM (o el ECO de uno nuestro, con `is_echo`)
 *      postback  → el usuario tocó un botón. Cuenta como mensaje: es lo que
 *                  dijo, aunque lo dijera tocando.
 *      delivery  → acuse de entrega     ─┐
 *      read      → acuse de lectura      ├→ `parsearEventos`, no son mensajes
 *      reaction  → un corazón a un DM   ─┘
 *
 *  ── Las tres trampas de este archivo ───────────────────────────────────────
 *
 *  **1. En un eco, quien manda es la página.** `sender.id` y `recipient.id` se
 *  INVIERTEN: en un mensaje del cliente el `sender` es el cliente; en el eco de
 *  uno nuestro el `sender` es la página y el cliente está en `recipient`. Leer
 *  siempre `sender.id` abre un hilo cuya dirección es el id de la propia
 *  página, y el emprendedor ve una conversación consigo mismo.
 *
 *  **2. `entry[].id` decide de quién es el mensaje.** Ver `guardiaDeEntrada()`.
 *
 *  **3. Sin `mid` no hay idempotencia.** Mismo criterio que el driver de
 *  WhatsApp: mejor perder un evento raro que duplicarlo. Un duplicado dispara
 *  al agente dos veces y el cliente recibe dos respuestas.
 */
import type { InboundMessage } from '@abraxa/db';
import type { EventoCanal } from '../types';
import type { MessageStatus } from '../../types';
import { log } from '../../logger';
import type { ConfigMeta } from './ajustes';
import { normalizarDireccionMeta } from './direccion';

// ════════════════════════════════════════════════════════════════════════════
// La forma de lo que manda Meta
// ════════════════════════════════════════════════════════════════════════════

export interface AdjuntoCrudo {
  type?: string;
  payload?: { url?: string; title?: string; sticker_id?: number };
}

export interface MensajeCrudo {
  mid?: string;
  text?: string;
  is_echo?: boolean;
  is_deleted?: boolean;
  is_unsupported?: boolean;
  attachments?: AdjuntoCrudo[];
  quick_reply?: { payload?: string };
}

export interface EventoMessaging {
  sender?: { id?: string; username?: string };
  recipient?: { id?: string };
  timestamp?: number | string;
  message?: MensajeCrudo;
  postback?: { mid?: string; title?: string; payload?: string };
  delivery?: { mids?: string[]; watermark?: number };
  /** `mids` sólo viene a veces; `watermark` siempre. Ver `parsearEventos`. */
  read?: { mids?: string[]; watermark?: number };
  reaction?: { mid?: string; action?: string; emoji?: string };
}

export interface EntradaWebhook {
  id?: string;
  time?: number;
  messaging?: EventoMessaging[];
  /** Protocolo de traspaso: el hilo lo tiene OTRA app. No es nuestro. */
  standby?: EventoMessaging[];
  /** Comentarios, menciones y demás. Este driver es SÓLO mensajería. */
  changes?: unknown[];
}

export interface CuerpoWebhook {
  object?: string;
  entry?: EntradaWebhook[];
}

function comoLista<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

// ════════════════════════════════════════════════════════════════════════════
// El guardia que impide que un cliente lea los mensajes de otro
// ════════════════════════════════════════════════════════════════════════════

/**
 * ¿Esta `entry` es de ESTE canal?
 *
 * ── Por qué esto existe, y por qué importa tanto ────────────────────────────
 *
 * El webhook de Meta **no es por canal: es por APP**. En el panel se configura
 * UNA sola URL de callback para todo el producto, y por ahí entran las páginas
 * de TODOS los clientes. Eso choca de frente con el modelo de H6, donde la URL
 * lleva el `channelId` y el tenant sale de la fila de ese canal
 * (`routes/webhooks.ts` → `contextoDeCanal(canal)`).
 *
 * La consecuencia es exacta y hay que decirla sin adornos: si llega una `entry`
 * de la página del cliente B por la URL del canal del cliente A, el núcleo la
 * escribiría **con el contexto de A**. Los DMs de B aparecerían en la bandeja
 * de A. Es la fuga entre clientes que este repositorio entero existe para
 * impedir.
 *
 * No se puede arreglar desde aquí —`parseWebhook` recibe el canal ya resuelto y
 * el `TenantContext` se construyó antes— así que este driver hace lo único
 * correcto que está a su alcance: **descartar lo que no es suyo y dejarlo
 * anotado**. Se pierde un mensaje; no se filtra a nadie. Entre las dos, no hay
 * duda.
 *
 * El arreglo de verdad es una ruta de nivel de app que resuelva el canal por
 * `entry[].id` ANTES de construir el contexto. Está escrito, con el parche
 * exacto, en el README — y `resolverCanalPorPagina()` de `enrutado.ts` es la
 * pieza que le falta, ya construida y probada.
 */
export function guardiaDeEntrada(cfg: ConfigMeta, entrada: EntradaWebhook): boolean {
  const esperado = cfg.idDeEntrada;
  const llego = String(entrada?.id ?? '');

  // Un canal a medio conectar todavía no sabe su id. Se deja pasar porque el
  // token de la URL ya probó que quien llama tiene derecho a ESTE canal, y
  // porque bloquearlo dejaría un canal recién creado sin poder recibir nada.
  if (!esperado) return true;

  if (llego && llego !== esperado) {
    log.warn(
      `meta: se descarta una entrada de ${llego} que llegó por el webhook del canal ` +
        `de ${esperado}. El webhook de Meta es por APP, no por canal: hace falta la ` +
        'ruta de nivel de app (ver packages/inbox/src/drivers/meta/README.md). ' +
        'Se descarta a propósito — escribirla aquí la metería en la bandeja de otra empresa.',
    );
    return false;
  }
  return true;
}

// ════════════════════════════════════════════════════════════════════════════
// Mensajes
// ════════════════════════════════════════════════════════════════════════════

export interface EntradaParseo {
  channelId: string;
  cfg: ConfigMeta;
  payload: unknown;
  /** Mids que mandamos nosotros: sus ecos no vuelven a entrar. Ver `ecos.ts`. */
  midsPropios?: ReadonlySet<string>;
}

/**
 * Los mensajes de un cuerpo de Meta.
 *
 * Se ignoran en silencio, cada uno por su razón:
 *   · `object` que no es el nuestro  → un canal de IG no procesa una página
 *   · `standby`                      → el hilo lo tiene otra app (traspaso)
 *   · `changes`                      → comentarios y menciones: no es mensajería
 *   · sin `mid`                      → sin llave de idempotencia
 *   · borrado o no soportado         → no hay nada que enseñar
 *   · sin texto ni adjuntos          → reacciones y acuses de protocolo
 */
export function parsearMensajes(i: EntradaParseo): InboundMessage[] {
  const cuerpo = (i.payload ?? {}) as CuerpoWebhook;
  if (String(cuerpo.object ?? '') !== i.cfg.objeto) return [];

  const salida: InboundMessage[] = [];

  for (const entrada of comoLista<EntradaWebhook>(cuerpo.entry)) {
    if (!guardiaDeEntrada(i.cfg, entrada)) continue;

    for (const ev of comoLista<EventoMessaging>(entrada.messaging)) {
      const m = leerMensaje(i, ev);
      if (m) salida.push(m);
    }
  }

  return salida;
}

function leerMensaje(i: EntradaParseo, ev: EventoMessaging): InboundMessage | null {
  const postback = ev.postback;
  const msg = ev.message;
  if (!msg && !postback) return null;

  const eco = msg?.is_echo === true;
  if (msg?.is_deleted === true) return null;

  const externalId = String(msg?.mid ?? postback?.mid ?? '');
  if (!externalId) return null;

  // Nuestro propio eco. Ver `ecos.ts`: el índice único de H6 sólo cubre el
  // PRIMER mid de un envío, y un envío puede ser varias llamadas.
  if (eco && i.midsPropios?.has(externalId)) {
    log.debug(`meta: eco de un envío nuestro (${externalId}); no vuelve a entrar`);
    return null;
  }

  // TRAMPA #1: en un eco, el cliente está en `recipient`, no en `sender`.
  const direccionCruda = eco ? (ev.recipient?.id ?? '') : (ev.sender?.id ?? '');
  const address = normalizarDireccionMeta(String(direccionCruda));
  if (!address) return null;

  const texto = textoDe(msg, postback);
  const media = mediaDe(msg);
  if (!texto && media.length === 0) return null;

  const recibido = fechaDe(ev.timestamp);
  const nombre = ev.sender?.username;

  return {
    channelType: i.cfg.canal,
    channelId: i.channelId,
    address,
    body: texto,
    ...(media.length > 0 ? { media } : {}),
    externalId,
    ...(eco ? { fromMe: true } : {}),
    ...(recibido ? { receivedAt: recibido } : {}),
    // Instagram manda el `username` en algunos eventos; Messenger nunca. Cuando
    // no viene, el nombre se busca en la Graph API una sola vez (`index.ts`).
    ...(!eco && nombre ? { contactName: String(nombre) } : {}),
  };
}

/**
 * El texto del mensaje.
 *
 * Un `postback` es lo que el usuario dijo tocando un botón. Se usa el `title`
 * —lo que él VIO— y no el `payload`, que es una constante interna del tipo
 * `MENU_PRECIOS`: mandarle eso al agente le da al cliente una respuesta sobre
 * una cadena que nunca escribió.
 */
function textoDe(msg: MensajeCrudo | undefined, postback: EventoMessaging['postback']): string {
  const texto = typeof msg?.text === 'string' ? msg.text : '';
  if (texto) return texto;
  const titulo = typeof postback?.title === 'string' ? postback.title : '';
  return titulo;
}

const TIPOS_CONOCIDOS = new Set(['image', 'video', 'audio', 'file', 'story_mention', 'share']);

/**
 * Las URLs de los adjuntos.
 *
 * Se descartan los `template` y los `fallback` (una previsualización de enlace,
 * un sticker sin URL): no traen nada descargable y meterlos en `media` deja
 * burbujas rotas en la bandeja.
 *
 * OJO con lo que NO se resuelve aquí: las URLs de adjuntos de Meta **caducan**.
 * Guardar la URL es lo que hace hoy el driver de WhatsApp y es coherente con el
 * resto del sistema; que se archiven los binarios es una decisión de producto
 * que no le toca a un driver tomar por su cuenta. Queda anotado en el README.
 */
function mediaDe(msg: MensajeCrudo | undefined): string[] {
  const urls: string[] = [];
  for (const a of comoLista<AdjuntoCrudo>(msg?.attachments)) {
    const tipo = String(a?.type ?? '');
    const url = a?.payload?.url;
    if (typeof url === 'string' && url.length > 0 && TIPOS_CONOCIDOS.has(tipo)) {
      urls.push(url);
    }
  }
  return urls;
}

/** El `timestamp` de Meta viene en MILISEGUNDOS. En segundos daría 1970. */
export function fechaDe(t: unknown): string | null {
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = n > 1e12 ? n : n * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ════════════════════════════════════════════════════════════════════════════
// Acuses
// ════════════════════════════════════════════════════════════════════════════

/**
 * Acuses de entrega y de lectura.
 *
 * Meta no manda un acuse por mensaje: manda una **marca de agua**. `delivery`
 * trae a veces la lista de `mids` y siempre un `watermark`, que significa «todo
 * lo anterior a este instante ya se entregó».
 *
 * Aquí sólo se traducen los que traen `mids`, porque `EventoAcuse` es por
 * `externalId` y una marca de agua no lo es. Aplicar la marca de agua pediría
 * un UPDATE por rango sobre `messages` —«todos los salientes de este hilo
 * anteriores a T»— y eso es del núcleo, no de un driver: `aplicarEvento()`
 * (H6, `ingest.ts:341`) filtra por `external_id` exacto. Queda en el README
 * como lo que es: una mejora con dueño, no un olvido.
 *
 * `read` sin mids no se pierde del todo — se registra el `watermark` en el log
 * para poder depurar «dice entregado y el cliente jura que no le llegó».
 */
export function parsearEventos(payload: unknown, cfg?: ConfigMeta): EventoCanal[] {
  const cuerpo = (payload ?? {}) as CuerpoWebhook;
  if (cfg && String(cuerpo.object ?? '') !== cfg.objeto) return [];

  const salida: EventoCanal[] = [];

  for (const entrada of comoLista<EntradaWebhook>(cuerpo.entry)) {
    if (cfg && !guardiaDeEntrada(cfg, entrada)) continue;

    for (const ev of comoLista<EventoMessaging>(entrada.messaging)) {
      empujarAcuses(salida, ev.delivery?.mids, 'delivered');
      empujarAcuses(salida, ev.read?.mids, 'read');

      if (ev.read?.watermark && !ev.read.mids) {
        log.debug(`meta: marca de lectura hasta ${fechaDe(ev.read.watermark) ?? ev.read.watermark}`);
      }
    }
  }

  return salida;
}

function empujarAcuses(
  salida: EventoCanal[],
  mids: string[] | undefined,
  status: MessageStatus,
): void {
  for (const mid of comoLista<string>(mids)) {
    if (typeof mid === 'string' && mid.length > 0) {
      salida.push({ kind: 'acuse', externalId: mid, status });
    }
  }
}

/**
 * Los `mid` de los ecos que trae este cuerpo, sin construir nada más.
 *
 * Se necesita ANTES de parsear, porque decidir si un eco es nuestro exige una
 * consulta a la base (`ecos.ts`) y no tiene sentido hacerla por cada mensaje.
 * Un recorrido barato primero, una consulta después, y el parseo ya sabe.
 */
export function midsDeEcos(payload: unknown): string[] {
  const cuerpo = (payload ?? {}) as CuerpoWebhook;
  const mids: string[] = [];

  for (const entrada of comoLista<EntradaWebhook>(cuerpo.entry)) {
    for (const ev of comoLista<EventoMessaging>(entrada.messaging)) {
      if (ev.message?.is_echo !== true) continue;
      const mid = ev.message?.mid;
      if (typeof mid === 'string' && mid.length > 0) mids.push(mid);
    }
  }

  return mids;
}

/**
 * Las direcciones que ESCRIBIERON en este webhook, con cuándo lo hicieron.
 *
 * Es lo que alimenta la ventana de 24 horas. Se saca del mismo recorrido que
 * los mensajes pero se devuelve aparte porque no es un mensaje: un `postback`
 * también reabre la ventana, y un eco NO la reabre —la ventana la abre el
 * cliente al escribir, no nosotros al contestarle—.
 */
export function entrantesParaVentana(i: EntradaParseo): Array<{ address: string; cuando: string }> {
  const cuerpo = (i.payload ?? {}) as CuerpoWebhook;
  if (String(cuerpo.object ?? '') !== i.cfg.objeto) return [];

  const salida: Array<{ address: string; cuando: string }> = [];

  for (const entrada of comoLista<EntradaWebhook>(cuerpo.entry)) {
    if (!guardiaDeEntrada(i.cfg, entrada)) continue;

    for (const ev of comoLista<EventoMessaging>(entrada.messaging)) {
      if (!ev.message && !ev.postback) continue;
      if (ev.message?.is_echo === true) continue;

      const address = normalizarDireccionMeta(String(ev.sender?.id ?? ''));
      if (!address) continue;

      salida.push({ address, cuando: fechaDe(ev.timestamp) ?? new Date().toISOString() });
    }
  }

  return salida;
}
