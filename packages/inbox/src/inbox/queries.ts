/**
 * Lo que lee la bandeja. Consultas y nada más: ningún efecto, salvo marcar
 * leído al abrir un hilo, que es lo que espera cualquiera que abre un hilo.
 */
import { PlatformError, tenantDb } from '@abraxa/db';
import type { ChannelType, TenantContext } from '@abraxa/db';
import { HILOS_MAXIMO, HILOS_POR_PAGINA, MENSAJES_POR_HILO } from '../config';
import { mostrarDireccion } from '../drivers/registry';
import type {
  ConversacionVista,
  MessageRow,
  ThreadResumen,
  ThreadRow,
  ThreadStatus,
} from '../types';

export interface FiltroHilos {
  status?: ThreadStatus;
  channelId?: string;
  /** `true` = sólo los que tienen la IA apagada o tomados por alguien. */
  soloAtendidos?: boolean;
  limit?: number;
}

export async function listarHilos(
  ctx: TenantContext,
  filtro: FiltroHilos = {},
): Promise<ThreadResumen[]> {
  const db = tenantDb(ctx);

  let q = db
    .from('threads')
    .select('*')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(Math.min(filtro.limit ?? HILOS_POR_PAGINA, HILOS_MAXIMO));

  if (filtro.status) q = q.eq('status', filtro.status);
  if (filtro.channelId) q = q.eq('channel_id', filtro.channelId);

  const { data, error } = await q;
  if (error) throw new PlatformError('INTERNAL', `No se pudieron leer los hilos: ${error.message}`);

  const hilos = (data as ThreadRow[] | null) ?? [];
  const nombres = await nombresDeCanal(ctx, hilos.map((h) => h.channel_id));

  const resumenes = hilos.map((h) => aResumen(h, nombres.get(h.channel_id) ?? null));
  return filtro.soloAtendidos
    ? resumenes.filter((r) => r.assignedTo !== null || !r.aiEnabled)
    : resumenes;
}

/**
 * Un hilo con sus mensajes.
 *
 * Marcar leído es "dispara y olvida" a propósito: si ese UPDATE falla, la
 * conversación se muestra igual. Un contador de no leídos que se quedó en 3 es
 * un detalle; una conversación que no abre es un producto roto.
 */
export async function verHilo(ctx: TenantContext, threadId: string): Promise<ConversacionVista> {
  const db = tenantDb(ctx);

  const { data: hilo, error } = await db
    .from('threads')
    .select('*')
    .eq('id', threadId)
    .maybeSingle();
  if (error) throw new PlatformError('INTERNAL', `No se pudo leer el hilo: ${error.message}`);
  if (!hilo) throw new PlatformError('NOT_FOUND', 'Hilo no encontrado.');

  const { data: mensajes, error: errMsgs } = await db
    .from('messages')
    .select('*')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })
    .limit(MENSAJES_POR_HILO);
  if (errMsgs) {
    throw new PlatformError('INTERNAL', `No se pudieron leer los mensajes: ${errMsgs.message}`);
  }

  const fila = hilo as ThreadRow;
  if ((fila.unread ?? 0) > 0) {
    void db
      .from('threads')
      .update({ unread: 0 })
      .eq('id', threadId)
      .then(() => undefined);
    fila.unread = 0;
  }

  const nombres = await nombresDeCanal(ctx, [fila.channel_id]);
  return {
    thread: aResumen(fila, nombres.get(fila.channel_id) ?? null),
    messages: (mensajes as MessageRow[] | null) ?? [],
  };
}

/** Cuántos hilos esperan a alguien. Lo pinta el badge del sidebar. */
export async function contarNoLeidos(ctx: TenantContext): Promise<number> {
  const { data, error } = await tenantDb(ctx).from('threads').select('unread').eq('status', 'open');
  if (error) return 0;
  return ((data as Array<{ unread?: number }> | null) ?? []).reduce(
    (t, f) => t + (f.unread ?? 0),
    0,
  );
}

function aResumen(h: ThreadRow, channelName: string | null): ThreadResumen {
  const tipo = h.channel_type as ChannelType;
  return {
    id: h.id,
    channelId: h.channel_id,
    channelType: tipo,
    channelName,
    address: h.external_address,
    display: h.contact_name?.trim() || mostrarDireccion(tipo, h.external_address),
    status: h.status,
    assignedTo: h.assigned_to,
    aiEnabled: h.ai_enabled,
    aiPausedUntil: h.ai_paused_until,
    unread: h.unread ?? 0,
    lastMessageAt: h.last_message_at,
    lastMessage: h.last_message,
    lastDirection: h.last_direction,
  };
}

/**
 * Los nombres de los canales de un lote de hilos, en UNA consulta.
 *
 * Sin esto la lista de la bandeja haría un SELECT por hilo. Con 100 hilos son
 * 100 viajes a la base para pintar una etiqueta.
 */
async function nombresDeCanal(
  ctx: TenantContext,
  ids: string[],
): Promise<Map<string, string | null>> {
  const mapa = new Map<string, string | null>();
  if (ids.length === 0) return mapa;

  const { data } = await tenantDb(ctx).from('channels').select('id, name');
  for (const c of (data as Array<{ id: string; name: string }> | null) ?? []) {
    mapa.set(c.id, c.name);
  }
  return mapa;
}
