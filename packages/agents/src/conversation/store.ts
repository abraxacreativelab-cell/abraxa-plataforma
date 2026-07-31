/**
 * Historial de conversación del agente.
 *
 * `AgentPort.run()` trae `history?` opcional. Cuando el llamador lo manda —H7
 * durante la entrevista, que lleva su propio estado— esto no se usa. Cuando no
 * lo manda —H6 recibiendo un WhatsApp— alguien tiene que recordar de qué venían
 * hablando, y ese alguien es H3.
 *
 * AVISO A H6: esto no duplica su hilo. El de ustedes es el hilo de la BANDEJA,
 * mensajes de humanos por un canal. Éste es el del agente: incluye respuestas
 * que se generaron y no se mandaron, y excluye lo que escribió un humano que
 * tomó el hilo. Si prefieren pasármelo ya resuelto, manden `history` y esta
 * tabla ni se toca.
 */
import { tenantDb } from '@abraxa/db';
import type { AgentRole, TenantContext } from '@abraxa/db';
import { HISTORIAL_MAX_MENSAJES } from '../config';
import { log } from '../logger';
import type { ChatMessage } from '../types';

interface FilaCruda {
  role: string;
  content: string;
}

/**
 * Los últimos mensajes de un hilo, en orden cronológico.
 *
 * Nunca lanza: si el historial no se puede leer, el agente contesta sin
 * contexto previo. Peor que una respuesta sin memoria es no responder.
 */
export async function cargarHistorial(
  ctx: TenantContext,
  role: AgentRole,
  threadId: string,
  limite = HISTORIAL_MAX_MENSAJES,
): Promise<ChatMessage[]> {
  try {
    const { data, error } = await tenantDb(ctx)
      .from('agent_messages')
      .select('role, content')
      .eq('agent_role', role)
      .eq('thread_id', threadId)
      // Los N MÁS RECIENTES: se pide descendente y se voltea. Pedirlos
      // ascendente con `limit` daría los N más viejos, que es justo el contexto
      // que ya no importa.
      .order('id', { ascending: false })
      .limit(limite);

    if (error) throw error;

    const filas = ((data as FilaCruda[] | null) ?? []).reverse();
    return filas.map((f) => ({
      role: f.role === 'assistant' ? 'assistant' : 'user',
      content: f.content,
    }));
  } catch (err) {
    log.warn(`no se pudo cargar el historial del hilo ${threadId}: ${String(err)}`);
    return [];
  }
}

/**
 * Guarda el turno: lo que dijo la persona y lo que contestó el agente.
 *
 * Los dos juntos y después de responder, no antes. Si algo falla a media
 * corrida, el hilo no queda con una pregunta sin respuesta que confundiría al
 * modelo en el siguiente mensaje.
 *
 * Tampoco lanza: perder una línea de historial no puede tumbar una respuesta
 * que ya se generó y ya se pagó.
 */
export async function guardarTurno(
  ctx: TenantContext,
  role: AgentRole,
  threadId: string,
  turno: { entrada: string; respuesta: string },
): Promise<void> {
  if (!turno.respuesta.trim()) return;

  try {
    const { error } = await tenantDb(ctx)
      .from('agent_messages')
      .insert([
        { agent_role: role, thread_id: threadId, role: 'user', content: turno.entrada },
        { agent_role: role, thread_id: threadId, role: 'assistant', content: turno.respuesta },
      ]);
    if (error) throw error;
  } catch (err) {
    log.warn(`no se pudo guardar el turno del hilo ${threadId}: ${String(err)}`);
  }
}
