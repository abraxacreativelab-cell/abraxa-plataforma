/**
 * ════════════════════════════════════════════════════════════════════════════
 *  InboxPort — encolar, mandar, callar a la IA y tomar el hilo.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  El anti-duplicado está portado de GARDEN (src/crm/inbox/service.ts:134-177),
 *  que lo tiene muy bien resuelto, y vale la pena decir por qué funciona:
 *
 *    1. El mensaje se registra como `queued` ANTES de entregarlo al canal. Si
 *       el INSERT falla, no se envió nada — no hay duplicado. Si la conexión se
 *       corta DESPUÉS de enviar, el mensaje ya está en el historial y no se
 *       pierde.
 *    2. Al confirmar, un 23505 sobre `(tenant_id, external_id)` significa que
 *       el eco `fromMe` del webhook ya registró este mismo mensaje. Eso es
 *       ÉXITO, no error: se quita el marcador y se devuelve el eco. Responder
 *       500 haría que quien llamó reintentara y ahí sí habría un duplicado real
 *       en el teléfono del cliente.
 *    3. Cualquier otro error del UPDATE final tampoco es 500. El mensaje YA
 *       salió; devolver error provocaría el reenvío.
 */
import { PlatformError, notFound, tenantDb } from '@abraxa/db';
import type { ChannelType, InboxPort, OutboundMessage, TenantContext } from '@abraxa/db';
import { LARGO_VISTA_PREVIA } from '../config';
import { driverFor, normalizarDireccion } from '../drivers/registry';
import { log } from '../logger';
import type { ChannelRow, MessageRow, ThreadRow } from '../types';
import { normalizarFila } from '../channels/lookup';

export function createInboxService(): InboxPort {
  return {
    async send(ctx, i) {
      const { message } = await enviarEnHilo(ctx, i);
      return { messageId: message.id };
    },

    async startThread(ctx, i) {
      const canal = await canalParaTipo(ctx, i.channelType);
      const hilo = await asegurarHilo(ctx, canal, {
        address: i.address,
        ...(i.contactId ? { contactId: i.contactId } : {}),
      });
      return { threadId: hilo.id };
    },

    async setAiEnabled(ctx, i) {
      await parchearHilo(ctx, i.threadId, {
        ai_enabled: i.enabled,
        // Encender la IA limpia la pausa. Si no, "activar" dejaría al agente
        // igual de callado y el emprendedor pensaría que el interruptor miente.
        ...(i.enabled ? { ai_paused_until: null } : {}),
      });
    },

    async assign(ctx, i) {
      await parchearHilo(ctx, i.threadId, { assigned_to: i.userEmail });
      log.info(
        i.userEmail
          ? `hilo ${i.threadId} tomado por ${i.userEmail}: la IA se calla`
          : `hilo ${i.threadId} liberado: la IA puede volver a contestar`,
      );
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// El envío, con su anti-duplicado
// ════════════════════════════════════════════════════════════════════════════

export interface ResultadoEnvio {
  message: MessageRow;
  thread: ThreadRow;
}

export async function enviarEnHilo(
  ctx: TenantContext,
  i: OutboundMessage,
): Promise<ResultadoEnvio> {
  const db = tenantDb(ctx);

  const texto = (i.body ?? '').trim();
  const media = i.media ?? [];
  if (!texto && media.length === 0) {
    throw new PlatformError('VALIDATION', 'No se puede mandar un mensaje vacío.');
  }

  const hilo = await cargarHilo(ctx, i.threadId);
  const canal = await cargarCanal(ctx, hilo.channel_id);

  // ── Un humano escribió → toma el hilo y la IA se calla ────────────────────
  //
  // Está en el contrato del port: «`author`: quién manda. `null` = la IA.
  // Llenar apaga la IA del hilo». Se hace ANTES de mandar y no después: si el
  // envío falla, el hilo ya quedó tomado, que es exactamente lo que quiere
  // alguien que acaba de escribir. Al revés —callar a la IA sólo si el envío
  // sale bien— deja la ventana en la que el agente contesta encima del dueño.
  const autorHumano = typeof i.author === 'string' && i.author.trim().length > 0;
  if (autorHumano && hilo.assigned_to !== i.author) {
    await parchearHilo(ctx, hilo.id, { assigned_to: i.author as string });
    hilo.assigned_to = i.author as string;
  }

  // ── 1. Registrar como `queued` ANTES de salir al canal ────────────────────
  const { data: encolado, error: errEncolar } = await db
    .from('messages')
    .insert({
      thread_id: hilo.id,
      direction: 'out',
      body: texto || null,
      media: media.map((url) => ({ type: 'file', url })),
      ai_generated: Boolean(i.aiGenerated),
      author: autorHumano ? i.author : null,
      status: 'queued',
    })
    .select()
    .single();

  if (errEncolar || !encolado) {
    throw new PlatformError(
      'INTERNAL',
      `No se pudo registrar el mensaje: ${errEncolar?.message ?? 'sin fila'}`,
    );
  }
  const marcador = encolado as MessageRow;

  // ── 2. Al canal ───────────────────────────────────────────────────────────
  let externalId: string | null = null;
  try {
    const driver = driverFor(canal.type);
    const r = await driver.send({
      channelId: canal.id,
      address: hilo.external_address,
      body: texto,
      ...(media.length > 0 ? { media } : {}),
    });
    externalId = r.externalId || null;
  } catch (err) {
    // El intento queda VISIBLE en el historial como fallido, con su motivo. Un
    // mensaje que desaparece sin dejar rastro es peor que uno que falló.
    await db
      .from('messages')
      .update({ status: 'failed', error: mensajeDe(err).slice(0, 500) })
      .eq('id', marcador.id);
    throw err;
  }

  // ── 3. Confirmar. El 23505 es éxito idempotente, no error ────────────────
  let mensaje: MessageRow = { ...marcador, status: 'sent', external_id: externalId };

  const { data: confirmado, error: errConfirmar } = await db
    .from('messages')
    .update({ status: 'sent', external_id: externalId })
    .eq('id', marcador.id)
    .select()
    .single();

  if (errConfirmar) {
    if (errConfirmar.code === '23505' && externalId) {
      // El eco `fromMe` del webhook llegó primero y ya guardó este mensaje.
      await db.from('messages').delete().eq('id', marcador.id);
      const { data: eco } = await db
        .from('messages')
        .select('*')
        .eq('external_id', externalId)
        .maybeSingle();
      if (eco) mensaje = eco as MessageRow;
      log.debug(`el eco del webhook se adelantó al acuse de ${externalId}: se conserva el eco`);
    } else {
      // El mensaje YA salió al cliente. Devolver error provocaría un reintento
      // y ahí sí un duplicado real.
      log.warn(`no se pudo confirmar el saliente ${marcador.id}: ${errConfirmar.message}`);
    }
  } else if (confirmado) {
    mensaje = confirmado as MessageRow;
  }

  const hiloActualizado = await tocarHilo(ctx, hilo, {
    preview: texto || `[${media.length} adjunto${media.length === 1 ? '' : 's'}]`,
    direction: 'out',
    resetUnread: true,
  });

  return { message: mensaje, thread: hiloActualizado };
}

// ════════════════════════════════════════════════════════════════════════════
// Hilos y canales
// ════════════════════════════════════════════════════════════════════════════

export async function cargarHilo(ctx: TenantContext, threadId: string): Promise<ThreadRow> {
  const { data, error } = await tenantDb(ctx)
    .from('threads')
    .select('*')
    .eq('id', threadId)
    .maybeSingle();
  if (error) throw new PlatformError('INTERNAL', `No se pudo leer el hilo: ${error.message}`);
  if (!data) throw notFound('Hilo no encontrado.');
  return data as ThreadRow;
}

export async function cargarCanal(ctx: TenantContext, channelId: string): Promise<ChannelRow> {
  const { data, error } = await tenantDb(ctx)
    .from('channels')
    .select('*')
    .eq('id', channelId)
    .maybeSingle();
  if (error) throw new PlatformError('INTERNAL', `No se pudo leer el canal: ${error.message}`);
  if (!data) throw notFound('Canal no encontrado.');
  return normalizarFila(data as Record<string, unknown>);
}

/** El canal activo de un tipo, o el primero que haya. */
export async function canalParaTipo(ctx: TenantContext, type: ChannelType): Promise<ChannelRow> {
  const db = tenantDb(ctx);
  const { data: activos } = await db
    .from('channels')
    .select('*')
    .eq('type', type)
    .eq('status', 'active')
    .order('created_at')
    .limit(1);

  const fila = (activos as Record<string, unknown>[] | null)?.[0];
  if (fila) return normalizarFila(fila);

  // Sin ninguno activo, se devuelve el primero aunque esté caído: el envío
  // fallará con el error del canal, que dice mucho más que "no hay canal".
  const { data: cualquiera } = await db
    .from('channels')
    .select('*')
    .eq('type', type)
    .order('created_at')
    .limit(1);

  const alterno = (cualquiera as Record<string, unknown>[] | null)?.[0];
  if (!alterno) {
    throw new PlatformError(
      'CONFLICT',
      `Esta empresa no tiene ningún canal de ${type}. Conéctalo en Ajustes → Canales.`,
      { retryable: false },
    );
  }
  return normalizarFila(alterno);
}

export interface DatosHilo {
  address: string;
  contactId?: string;
  contactName?: string;
}

/**
 * El hilo de una dirección en un canal, creándolo si hace falta.
 *
 * La carrera importa de verdad: dos mensajes que llegan juntos del mismo
 * número intentan crear el mismo hilo. El UNIQUE `(tenant_id, channel_id,
 * external_address)` deja pasar uno solo, y el que choca vuelve a leer en vez
 * de reventar la ingesta.
 */
export async function asegurarHilo(
  ctx: TenantContext,
  canal: ChannelRow,
  datos: DatosHilo,
): Promise<ThreadRow> {
  const db = tenantDb(ctx);
  const address = normalizarDireccion(canal.type, datos.address);
  if (!address) {
    throw new PlatformError('VALIDATION', `Dirección vacía para el canal ${canal.type}.`);
  }

  const buscar = async (): Promise<ThreadRow | null> => {
    const { data } = await db
      .from('threads')
      .select('*')
      .eq('channel_id', canal.id)
      .eq('external_address', address)
      .maybeSingle();
    return (data as ThreadRow | null) ?? null;
  };

  const existente = await buscar();
  if (existente) {
    // El nombre se completa cuando llega, sin pisar uno que ya se tenía.
    if (datos.contactName && !existente.contact_name) {
      await parchearHilo(ctx, existente.id, { contact_name: datos.contactName });
      existente.contact_name = datos.contactName;
    }
    return existente;
  }

  const { data: creado, error } = await db
    .from('threads')
    .insert({
      channel_id: canal.id,
      channel_type: canal.type,
      external_address: address,
      contact_id: datos.contactId ?? null,
      contact_name: datos.contactName ?? null,
      status: 'open',
      ai_enabled: true,
    })
    .select()
    .single();

  if (error) {
    const reintento = await buscar();
    if (reintento) return reintento;
    throw new PlatformError('INTERNAL', `No se pudo crear el hilo: ${error.message}`);
  }
  return creado as ThreadRow;
}

export async function parchearHilo(
  ctx: TenantContext,
  threadId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await tenantDb(ctx)
    .from('threads')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', threadId);
  if (error) throw new PlatformError('INTERNAL', `No se pudo actualizar el hilo: ${error.message}`);
}

export interface ToqueHilo {
  preview: string;
  direction: 'in' | 'out';
  /** `true` en los salientes: escribir es leer. */
  resetUnread?: boolean;
  cuando?: string;
}

/** Actualiza los contadores del hilo tras un mensaje. */
export async function tocarHilo(
  ctx: TenantContext,
  hilo: ThreadRow,
  t: ToqueHilo,
): Promise<ThreadRow> {
  const unread = t.resetUnread ? 0 : (hilo.unread ?? 0) + 1;
  const patch = {
    last_message_at: t.cuando ?? new Date().toISOString(),
    last_message: t.preview.slice(0, LARGO_VISTA_PREVIA),
    last_direction: t.direction,
    unread,
    status: 'open' as const,
  };
  await parchearHilo(ctx, hilo.id, patch);
  return { ...hilo, ...patch };
}

function mensajeDe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
