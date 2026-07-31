/**
 * ════════════════════════════════════════════════════════════════════════════
 *  La recepción. De un webhook a un mensaje en la bandeja (y a una respuesta).
 * ════════════════════════════════════════════════════════════════════════════
 *
 *      webhook validado
 *         ↓
 *      driver.parseEvents()   → acuses y estado de la línea
 *      driver.parseWebhook()  → InboundMessage[] normalizados
 *         ↓  por cada mensaje
 *      hilo (se crea si no existe, tolerando la carrera)
 *         ↓
 *      INSERT del mensaje  ← aquí vive la idempotencia
 *         ↓ si de verdad se insertó
 *      el puente
 *
 *  ── Por qué la idempotencia es el INSERT y no un SELECT previo ─────────────
 *
 *  Lo intuitivo es "¿ya existe este external_id? entonces salte". GARDEN lo
 *  hace así (src/crm/channels/webhook.ts:104-108) y funciona el 99% de las
 *  veces. El 1% es cuando Evolution reintenta ANTES de que termine la primera
 *  entrega: los dos SELECT no ven nada, los dos INSERT pasan, y el cliente
 *  recibe dos respuestas del agente.
 *
 *  Aquí la unicidad vive en la base —el índice parcial de la migración 040— y
 *  el 23505 es la señal de "otro llegó primero". Es atómico: exactamente una
 *  de las dos entregas concurrentes gana y sólo esa corre el agente.
 *
 *  Un mensaje sin `external_id` no se puede deduplicar, y por eso el parser lo
 *  descarta antes de llegar hasta aquí.
 */
import { tenantDb } from '@abraxa/db';
import type { InboundMessage, TenantContext } from '@abraxa/db';
import {
  responderConAgente,
  type CorredorDeAgentes,
  type ResultadoPuente,
} from './bridge/responder';
import { contextoDeCanal } from './context';
import { driverFor } from './drivers/registry';
import type { EventoCanal, SobreWebhook } from './drivers/types';
import { asegurarHilo, cargarHilo, tocarHilo } from './inbox/service';
import { log } from './logger';
import type { AiOutcome, ChannelRow, MediaItem, MessageRow } from './types';

export interface ResultadoMensaje {
  externalId: string;
  /** `true` si este webhook ya se había procesado. Ni se guarda ni se contesta. */
  duplicado: boolean;
  threadId?: string;
  messageId?: string;
  ai?: ResultadoPuente;
}

export interface ResultadoIngesta {
  mensajes: ResultadoMensaje[];
  eventos: number;
}

export interface OpcionesIngesta {
  ahora?: Date;
  /** Para pruebas: doble del port de agentes. */
  agents?: CorredorDeAgentes;
  /** `false` apaga el puente. Sirve para reprocesar un webhook sin volver a
   *  cobrarle al cliente. */
  responder?: boolean;
}

/**
 * Procesa un webhook completo de un canal.
 *
 * Nunca lanza por un mensaje suelto: si uno falla, los demás del mismo lote se
 * siguen procesando. Un webhook que responde 500 porque un mensaje venía raro
 * hace que el proveedor reintregue el LOTE ENTERO, y con él los mensajes que sí
 * habían entrado bien.
 */
export async function ingerirWebhook(
  canal: ChannelRow,
  sobre: SobreWebhook,
  opts: OpcionesIngesta = {},
): Promise<ResultadoIngesta> {
  const driver = driverFor(canal.type);
  const ctx = contextoDeCanal(canal);

  // ── 1. Acuses y estado de la línea ────────────────────────────────────────
  let eventos: EventoCanal[] = [];
  if (driver.parseEvents) {
    try {
      eventos = await driver.parseEvents(sobre);
    } catch (err) {
      log.warn(`no se pudieron leer los eventos del canal ${canal.id}: ${String(err)}`);
    }
  }
  for (const e of eventos) {
    try {
      await aplicarEvento(ctx, canal, e);
    } catch (err) {
      log.warn(`evento ${e.kind} del canal ${canal.id} no aplicado: ${String(err)}`);
    }
  }

  // ── 2. Los mensajes ───────────────────────────────────────────────────────
  let entrantes: InboundMessage[] = [];
  try {
    entrantes = await driver.parseWebhook(sobre);
  } catch (err) {
    log.warn(`el driver ${canal.type} no pudo leer el webhook: ${String(err)}`);
  }

  const mensajes: ResultadoMensaje[] = [];
  for (const m of entrantes) {
    try {
      mensajes.push(await ingerirMensaje(ctx, canal, m, opts));
    } catch (err) {
      log.error(`falló la ingesta de ${m.externalId} en ${canal.id}: ${String(err)}`);
    }
  }

  return { mensajes, eventos: eventos.length };
}

/**
 * Un mensaje entrante: hilo, guardado idempotente y —si toca— respuesta.
 */
export async function ingerirMensaje(
  ctx: TenantContext,
  canal: ChannelRow,
  m: InboundMessage,
  opts: OpcionesIngesta = {},
): Promise<ResultadoMensaje> {
  const db = tenantDb(ctx);

  const hilo = await asegurarHilo(ctx, canal, {
    address: m.address,
    ...(m.contactName ? { contactName: m.contactName } : {}),
  });

  const texto = (m.body ?? '').trim() || null;
  const media: MediaItem[] = (m.media ?? []).map((url) => ({ type: 'file', url }));
  const vistaPrevia = texto ?? (media.length > 0 ? `[${media[0]?.type ?? 'adjunto'}]` : '');

  // ── El INSERT que decide todo ────────────────────────────────────────────
  const { data: guardado, error } = await db
    .from('messages')
    .insert({
      thread_id: hilo.id,
      // El eco de un saliente nuestro es un mensaje de SALIDA, aunque llegue
      // por el webhook de entrada.
      direction: m.fromMe ? 'out' : 'in',
      body: texto,
      media,
      ai_generated: false,
      author: m.fromMe ? 'phone' : 'contact',
      external_id: m.externalId,
      status: m.fromMe ? 'sent' : 'delivered',
      ...(m.receivedAt ? { created_at: m.receivedAt } : {}),
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      // Otra entrega llegó primero. Ni se guarda ni se contesta: es exactamente
      // el criterio #4.
      log.debug(`webhook repetido: ${m.externalId} ya estaba en la bandeja`);
      return { externalId: m.externalId, duplicado: true, threadId: hilo.id };
    }
    throw error;
  }

  const mensaje = guardado as MessageRow;

  await tocarHilo(ctx, hilo, {
    preview: vistaPrevia,
    direction: m.fromMe ? 'out' : 'in',
    ...(m.fromMe ? { resetUnread: true } : {}),
    ...(m.receivedAt ? { cuando: m.receivedAt } : {}),
  });

  // ── El puente ─────────────────────────────────────────────────────────────
  if (opts.responder === false) {
    return { externalId: m.externalId, duplicado: false, threadId: hilo.id, messageId: mensaje.id };
  }

  // Se relee el hilo: entre `asegurarHilo` y aquí, un humano pudo haberlo
  // tomado desde la bandeja. La ventana es de milisegundos y aun así vale la
  // pena — es exactamente el caso que el criterio #3 no perdona.
  const hiloFresco = await cargarHilo(ctx, hilo.id).catch(() => hilo);

  const ai = await responderConAgente(
    ctx,
    canal,
    hiloFresco,
    { id: mensaje.id, body: texto, ...(m.fromMe ? { fromMe: true } : {}) },
    {
      ...(opts.ahora ? { ahora: opts.ahora } : {}),
      ...(opts.agents ? { agents: opts.agents } : {}),
    },
  );

  await marcarResultadoIA(ctx, mensaje.id, ai.outcome, ai.reason);

  return {
    externalId: m.externalId,
    duplicado: false,
    threadId: hilo.id,
    messageId: mensaje.id,
    ai,
  };
}

/**
 * Deja escrito en el mensaje entrante qué hizo la IA con él.
 *
 * Es el criterio #5 hecho columna: si el agente falló, el mensaje queda marcado
 * sin responder — no sale un texto de disculpa, pero tampoco se pierde el
 * rastro. Best-effort: si esto falla, la respuesta ya salió y no se va a
 * deshacer por no poder anotarla.
 */
export async function marcarResultadoIA(
  ctx: TenantContext,
  messageId: string,
  outcome: AiOutcome,
  reason: string | null,
): Promise<void> {
  try {
    const { error } = await tenantDb(ctx)
      .from('messages')
      .update({ ai_outcome: outcome, ai_reason: reason ? reason.slice(0, 500) : null })
      .eq('id', messageId);
    if (error) throw error;
  } catch (err) {
    log.warn(`no se pudo marcar el resultado de la IA en ${messageId}: ${String(err)}`);
  }
}

/** Acuses de entrega y cambios de conexión de la línea. */
export async function aplicarEvento(
  ctx: TenantContext,
  canal: ChannelRow,
  e: EventoCanal,
): Promise<void> {
  const db = tenantDb(ctx);

  if (e.kind === 'acuse') {
    // Sólo los salientes: el acuse de un entrante no existe, y filtrarlo evita
    // pisar el estado de un mensaje que el cliente nos mandó.
    const { error } = await db
      .from('messages')
      .update({ status: e.status, ...(e.error ? { error: e.error.slice(0, 500) } : {}) })
      .eq('external_id', e.externalId)
      .eq('direction', 'out');
    if (error) throw error;
    return;
  }

  const patch: Record<string, unknown> = { status: e.status, updated_at: new Date().toISOString() };
  if (e.externalId) patch.external_id = e.externalId;
  const { error } = await db.from('channels').update(patch).eq('id', canal.id);
  if (error) throw error;
  log.info(`canal ${canal.name}: ${e.status}`);
}
