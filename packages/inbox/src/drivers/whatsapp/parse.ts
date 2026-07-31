/**
 * De lo que manda Evolution a lo que entiende la bandeja.
 *
 * Un webhook de Evolution trae tres cosas distintas por el mismo tubo:
 * mensajes (`messages.upsert`), acuses (`messages.update`) y estado de la línea
 * (`connection.update`). `parseWebhook` del port sólo devuelve mensajes; lo
 * demás sale por `parseEvents`.
 */
import type { InboundMessage } from '@abraxa/db';
import type { EventoCanal } from '../types';
import type { MediaItem, MessageStatus } from '../../types';
import { esJidIgnorable, jidATelefono } from './phone';

interface ClaveMensaje {
  id?: string;
  remoteJid?: string;
  fromMe?: boolean;
}

interface MensajeCrudo {
  key?: ClaveMensaje;
  pushName?: string;
  messageTimestamp?: number | string;
  message?: Record<string, unknown>;
}

/** El nombre normalizado del evento: `MESSAGES_UPSERT` → `messages.upsert`. */
export function nombreEvento(body: unknown): string {
  const e = (body as { event?: unknown } | null)?.event;
  return String(e ?? '')
    .toLowerCase()
    .replace(/_/g, '.');
}

function comoLista(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  return data ? [data] : [];
}

export function extraerTexto(msg: MensajeCrudo): string | null {
  const m = (msg?.message ?? {}) as Record<string, { text?: string; caption?: string } | string>;
  const conversation = typeof m.conversation === 'string' ? m.conversation : null;
  const extendido = (m.extendedTextMessage as { text?: string } | undefined)?.text ?? null;
  const imagen = (m.imageMessage as { caption?: string } | undefined)?.caption ?? null;
  const video = (m.videoMessage as { caption?: string } | undefined)?.caption ?? null;
  const documento = (m.documentMessage as { caption?: string } | undefined)?.caption ?? null;
  return conversation ?? extendido ?? imagen ?? video ?? documento ?? null;
}

const TIPOS_MEDIA = [
  ['imageMessage', 'image'],
  ['videoMessage', 'video'],
  ['audioMessage', 'audio'],
  ['documentMessage', 'document'],
] as const;

export function extraerMedia(msg: MensajeCrudo): MediaItem[] {
  const m = (msg?.message ?? {}) as Record<string, { url?: string; mimetype?: string; fileName?: string }>;
  const media: MediaItem[] = [];
  for (const [clave, tipo] of TIPOS_MEDIA) {
    const item = m[clave];
    if (item?.url) {
      media.push({
        type: tipo,
        url: item.url,
        ...(item.mimetype ? { mime: item.mimetype } : {}),
        ...(item.fileName ? { name: item.fileName } : {}),
      });
    }
  }
  return media;
}

/**
 * Mensajes entrantes (y ecos salientes) de un cuerpo de Evolution.
 *
 * Se ignoran en silencio, y cada uno por su razón:
 *   · grupos y estados      → no son conversaciones uno a uno
 *   · sin texto ni media    → reacciones, acuses de protocolo, ediciones
 *   · sin id del proveedor  → sin llave de idempotencia no hay forma de evitar
 *                             que un reintento lo duplique. Mejor perderlo que
 *                             duplicarlo: un duplicado dispara al agente dos
 *                             veces y el cliente recibe dos respuestas.
 */
export function parsearMensajes(channelId: string, body: unknown): InboundMessage[] {
  if (nombreEvento(body) !== 'messages.upsert') return [];

  const salida: InboundMessage[] = [];
  for (const crudo of comoLista((body as { data?: unknown })?.data)) {
    const msg = crudo as MensajeCrudo;
    const jid = msg?.key?.remoteJid ?? '';
    if (esJidIgnorable(jid)) continue;

    const externalId = msg?.key?.id;
    if (!externalId) continue;

    const body_ = extraerTexto(msg);
    const media = extraerMedia(msg);
    if (!body_ && media.length === 0) continue;

    salida.push({
      channelType: 'whatsapp',
      channelId,
      address: jidATelefono(jid),
      body: body_ ?? '',
      media: media.map((m) => m.url),
      externalId,
      fromMe: Boolean(msg?.key?.fromMe),
      ...(msg?.pushName ? { contactName: msg.pushName } : {}),
      ...(fechaDe(msg) ? { receivedAt: fechaDe(msg) as string } : {}),
    });
  }
  return salida;
}

function fechaDe(msg: MensajeCrudo): string | null {
  const t = Number(msg?.messageTimestamp);
  if (!Number.isFinite(t) || t <= 0) return null;
  // Evolution manda segundos; algunos despliegues mandan milisegundos.
  const ms = t > 1e12 ? t : t * 1000;
  return new Date(ms).toISOString();
}

const ACUSES: Record<string, MessageStatus> = {
  delivery_ack: 'delivered',
  server_ack: 'sent',
  read: 'read',
  played: 'read',
  error: 'failed',
};

/** Acuses de entrega y cambios de conexión. */
export function parsearEventos(body: unknown): EventoCanal[] {
  const evento = nombreEvento(body);
  const data = (body as { data?: unknown })?.data;

  if (evento === 'connection.update') {
    const estado = (data as { state?: string } | null)?.state;
    if (estado === 'open') {
      const numero = (data as { number?: string } | null)?.number;
      return [{ kind: 'conexion', status: 'active', ...(numero ? { externalId: numero } : {}) }];
    }
    if (estado === 'close') return [{ kind: 'conexion', status: 'disconnected' }];
    return [];
  }

  if (evento !== 'messages.update') return [];

  const salida: EventoCanal[] = [];
  for (const crudo of comoLista(data)) {
    const u = crudo as { keyId?: string; key?: { id?: string }; status?: string };
    const externalId = u?.keyId ?? u?.key?.id;
    const mapeado = ACUSES[String(u?.status ?? '').toLowerCase()];
    if (externalId && mapeado) salida.push({ kind: 'acuse', externalId, status: mapeado });
  }
  return salida;
}
