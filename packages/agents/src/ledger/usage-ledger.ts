/**
 * Escritura del libro de consumo.
 *
 * Dos decisiones que valen la pena explicar:
 *
 * 1. UNA FILA POR CORRIDA, no por iteración. Una corrida del agent loop puede
 *    dar diez vueltas llamando tools; lo que el cliente pidió fue una respuesta.
 *    Las iteraciones van en su columna para poder detectar un agente que se
 *    está dando de topes, sin inflar el número de filas.
 *
 * 2. SE ESCRIBE AUNQUE LA LLAMADA FALLE. Un error del proveedor a media
 *    generación ya consumió tokens y ya se va a facturar. Un ledger que sólo
 *    anota los éxitos subestima el gasto justo cuando algo anda mal — que es
 *    cuando más importa saberlo.
 */
import { tenantDb } from '@abraxa/db';
import type { AgentRole, ProviderName, TenantContext } from '@abraxa/db';
import type { CostoCalculado, RawUsage } from '../types';
import { log } from '../logger';

export interface EntradaLedger {
  role: AgentRole;
  agentDefinitionId: string | null;
  provider: ProviderName;
  model: string;
  usage: RawUsage;
  costo: CostoCalculado;
  threadId?: string | undefined;
  workspaceId?: string | undefined;
  iterations: number;
  latencyMs: number;
  status: 'ok' | 'error' | 'partial';
}

/**
 * Registra una corrida.
 *
 * Nunca lanza. Es deliberado: si la escritura del ledger tumbara la respuesta,
 * un problema de contabilidad se convertiría en una caída de cara al cliente
 * final. El fallo se registra en el log y la respuesta sigue su camino.
 *
 * El riesgo aceptado —perder una fila de consumo— está acotado por el otro
 * lado: el presupuesto se consulta ANTES de llamar al modelo, así que una fila
 * perdida atrasa el corte, no lo elimina.
 */
export async function registrarConsumo(ctx: TenantContext, e: EntradaLedger): Promise<void> {
  try {
    const { error } = await tenantDb(ctx)
      .from('usage_ledger')
      .insert({
        agent_role: e.role,
        agent_definition_id: e.agentDefinitionId,
        provider: e.provider,
        model: e.model,
        input_tokens: e.usage.inputTokens,
        output_tokens: e.usage.outputTokens,
        cache_read_tokens: e.usage.cacheReadTokens,
        cache_write_5m_tokens: e.usage.cacheWrite5mTokens,
        cache_write_1h_tokens: e.usage.cacheWrite1hTokens,
        cost_usd: e.costo.costUsd,
        cost_source: e.costo.source,
        pricing_id: e.costo.pricingId,
        request_id: e.usage.requestId,
        thread_id: e.threadId ?? null,
        workspace_id: e.workspaceId ?? null,
        iterations: e.iterations,
        latency_ms: e.latencyMs,
        status: e.status,
      });

    if (error) {
      // 23505 = unique_violation. Es el índice de idempotencia haciendo su
      // trabajo: el mismo request_id ya estaba anotado, o sea que esto es un
      // reintento. No cobrar dos veces es exactamente lo que queríamos.
      if (error.code === '23505') {
        log.debug(`consumo ya registrado para request_id=${e.usage.requestId ?? '?'}; se ignora`);
        return;
      }
      log.error(`no se pudo registrar el consumo: ${error.message}`);
      return;
    }

    if (e.costo.source === 'unpriced') {
      // Ruidoso a propósito. Es la señal de que falta capturar un precio, y es
      // justo la que GARDEN no tenía: su fallback silencioso inventaba uno.
      log.warn(
        `consumo SIN PRECIO: ${e.provider}/${e.model} — registrado en 0 USD. ` +
          `Captura la fila en app.model_pricing y recalcula.`,
      );
    }
  } catch (err) {
    log.error(`fallo inesperado al registrar consumo: ${String(err)}`);
  }
}

/** Gasto acumulado del tenant desde una fecha. Lo usa el presupuesto. */
export async function gastoDesde(ctx: TenantContext, desde: Date): Promise<number> {
  const { data, error } = await tenantDb(ctx)
    .from('usage_ledger')
    .select('cost_usd')
    .gte('created_at', desde.toISOString());

  if (error) throw error;

  const filas = (data ?? []) as Array<{ cost_usd: string | number }>;
  return filas.reduce((suma, f) => {
    const v = typeof f.cost_usd === 'number' ? f.cost_usd : Number.parseFloat(f.cost_usd);
    return suma + (Number.isFinite(v) ? v : 0);
  }, 0);
}

/** Cuántas corridas lleva el tenant desde un instante. Lo usa el rate limit. */
export async function corridasDesde(ctx: TenantContext, desde: Date): Promise<number> {
  const { count, error } = await tenantDb(ctx)
    .from('usage_ledger')
    .select('id', { head: true, count: 'exact' })
    .gte('created_at', desde.toISOString());

  if (error) throw error;
  return count ?? 0;
}
