/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Resolver un canal SIN sesión — el único lugar del carril que lo necesita.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Un webhook no trae usuario ni empresa. Llega de Evolution, de Meta o de
 *  Twilio con un id de canal en la URL y un token, y hasta que no se lee la
 *  fila de ese canal no se sabe de qué tenant es. Por definición no se puede
 *  usar `tenantDb(ctx)`: el `ctx` es justamente lo que se está resolviendo.
 *
 *  Por eso `adminDb()` está aquí y no en otro lado, y por eso este archivo no
 *  vive en `routes/` ni en `services/` — ESLint prohíbe `adminDb` ahí dentro, y
 *  con razón: en el resto del paquete no hay ni una consulta sin filtrar.
 *
 *  Las tres reglas de este archivo:
 *
 *    1. Se lee UNA fila por su `id`, nunca un listado.
 *    2. El token se compara en tiempo constante. Un `===` sobre un secreto
 *       filtra su longitud y su prefijo a quien mida.
 *    3. Lo que sale de aquí alimenta un `TenantContext` sintético
 *       (`contextoDeCanal`). Ese contexto es la frontera: de ahí en adelante
 *       todo vuelve a pasar por `tenantDb(ctx)`.
 */
import { timingSafeEqual } from 'node:crypto';
// adminDb: el webhook llega sin sesión y la fila del canal ES lo que dice a qué
// tenant pertenece. No hay `ctx` con el que filtrar todavía — se construye
// después, a partir de esta fila.
import { adminDb, PlatformError } from '@abraxa/db';
import type { ChannelRow } from '../types';

/** La fila cruda del canal, con su `config` y sus secretos. Nunca sale al navegador. */
export async function cargarCanalPorId(channelId: string): Promise<ChannelRow> {
  if (!channelId || typeof channelId !== 'string') {
    throw new PlatformError('VALIDATION', 'Falta el id del canal.');
  }

  const { data, error } = await adminDb()
    .from('channels')
    .select('*')
    .eq('id', channelId)
    .maybeSingle();

  if (error) {
    throw new PlatformError('INTERNAL', `No se pudo leer el canal: ${error.message}`);
  }
  if (!data) {
    // 404 y no 401: el id de un canal no es un secreto, el token sí.
    throw new PlatformError('NOT_FOUND', 'Canal desconocido.');
  }
  return normalizarFila(data as Record<string, unknown>);
}

/**
 * El canal del webhook, con su token ya verificado.
 *
 * Un canal sin `webhook_token` en su config se RECHAZA. Es fail-closed a
 * propósito: la alternativa —"si no tiene token, déjalo pasar"— convierte una
 * fila mal creada en un endpoint público por el que cualquiera inyecta mensajes
 * a la bandeja de un cliente.
 */
export async function resolverCanalDeWebhook(channelId: string, token: string): Promise<ChannelRow> {
  const canal = await cargarCanalPorId(channelId);
  const esperado = (canal.config as { webhook_token?: unknown })?.webhook_token;

  if (typeof esperado !== 'string' || esperado.length === 0) {
    throw new PlatformError('UNAUTHENTICATED', 'Token inválido.');
  }
  if (!igualSeguro(String(token ?? ''), esperado)) {
    throw new PlatformError('UNAUTHENTICATED', 'Token inválido.');
  }
  return canal;
}

/** Comparación en tiempo constante, a prueba de longitudes distintas. */
export function igualSeguro(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  if (x.length !== y.length) {
    // Se compara igual contra sí mismo para no acortar el camino cuando las
    // longitudes difieren: el resultado ya se sabe, el tiempo no debe decirlo.
    timingSafeEqual(x, x);
    return false;
  }
  return timingSafeEqual(x, y);
}

/** Rellena los defaults de la fila para que el resto del código no lleve `??`. */
export function normalizarFila(fila: Record<string, unknown>): ChannelRow {
  return {
    ...(fila as unknown as ChannelRow),
    config: (fila.config as Record<string, unknown>) ?? {},
    business_hours: (fila.business_hours as ChannelRow['business_hours']) ?? {},
    ai_enabled: fila.ai_enabled !== false,
    ai_outside_hours: fila.ai_outside_hours !== false,
    agent_role: (fila.agent_role as ChannelRow['agent_role']) ?? 'sales',
  };
}
