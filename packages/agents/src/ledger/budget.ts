/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El presupuesto que SÍ se aplica.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  GARDEN declara `MONTHLY_BUDGET_USD` en src/config.ts:122. Es su única
 *  aparición en todo el repo: se declara, se valida con zod, y nunca se lee.
 *
 *  Aquí se consulta ANTES de cada llamada al modelo, y al rebasarlo se lanza
 *  `BUDGET_EXCEEDED`. No se degrada a un modelo más barato en silencio, y ésa
 *  es una decisión, no un olvido: un cliente cuyo agente empeora sin aviso vive
 *  el producto como "esto ya no sirve" y no tiene forma de saber por qué. Un
 *  error explícito se atiende en una llamada.
 */
// `adminDb` aquí y no `tenantDb` porque las dos tablas que lee son de la
// plataforma, no de un cliente: `app.agent_plan_limits` está declarada
// `-- tenantless:` en la migración 024, y `app.tenants` se filtra por `id`,
// que ES su llave de aislamiento.
import { adminDb, budgetExceeded, PlatformError, tenantDb } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import { LIMITES_POR_DEFECTO, TTL_CACHE_PRESUPUESTO_MS } from '../config';
import type { LimitesTenant } from '../types';
import { corridasDesde, gastoDelMes, gastoDesde } from './usage-ledger';
import { log } from '../logger';

/** Primer instante del mes en curso, en UTC. La ventana del presupuesto. */
export function inicioDeMes(ahora = new Date()): Date {
  return new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), 1));
}

interface EntradaCache {
  valor: number;
  expira: number;
}

const cacheGasto = new Map<string, EntradaCache>();

/** Para pruebas y para forzar una relectura tras un cambio de plan. */
export function invalidarCachePresupuesto(tenantId?: string): void {
  if (tenantId) cacheGasto.delete(tenantId);
  else cacheGasto.clear();
}

/**
 * Los límites del tenant, del más específico al más general:
 *
 *   app.agent_budget_overrides  →  app.agent_plan_limits  →  LIMITES_POR_DEFECTO
 *
 * Si la consulta falla, NO se abre la puerta: se cae a los límites por defecto,
 * que son los más tacaños. Fail-closed, igual que `canSignIn` de H2.
 */
export async function resolverLimites(ctx: TenantContext): Promise<LimitesTenant> {
  let plan = 'free';

  try {
    const { data: filaTenant } = await adminDb()
      .from('tenants')
      .select('plan')
      .eq('id', ctx.tenantId)
      .maybeSingle();
    const p = (filaTenant as { plan?: string } | null)?.plan;
    if (typeof p === 'string' && p.length > 0) plan = p;
  } catch (err) {
    log.warn(`no se pudo leer el plan del tenant, se asume 'free': ${String(err)}`);
  }

  // 1. ¿Trato especial para este cliente?
  try {
    const { data } = await tenantDb(ctx)
      .from('agent_budget_overrides')
      .select('monthly_budget_usd, requests_per_minute')
      .limit(1);

    const o = (data as Array<{
      monthly_budget_usd: string | number | null;
      requests_per_minute: number | null;
    }> | null)?.[0];

    if (o && (o.monthly_budget_usd !== null || o.requests_per_minute !== null)) {
      const base = await limitesDePlan(plan);
      return {
        monthlyBudgetUsd: aNumero(o.monthly_budget_usd) ?? base.monthlyBudgetUsd,
        requestsPerMinute: o.requests_per_minute ?? base.requestsPerMinute,
        maxOutputTokens: base.maxOutputTokens,
        origen: 'override',
        plan,
      };
    }
  } catch (err) {
    log.warn(`no se pudieron leer los overrides de presupuesto: ${String(err)}`);
  }

  // 2. Lo que le toca por su plan.
  const base = await limitesDePlan(plan);
  return { ...base, plan };
}

async function limitesDePlan(
  plan: string,
): Promise<Omit<LimitesTenant, 'plan'>> {
  try {
    const { data } = await adminDb()
      .from('agent_plan_limits')
      .select('monthly_budget_usd, requests_per_minute, max_output_tokens')
      .eq('plan', plan)
      .maybeSingle();

    const f = data as {
      monthly_budget_usd: string | number;
      requests_per_minute: number;
      max_output_tokens: number;
    } | null;

    if (f) {
      return {
        monthlyBudgetUsd: aNumero(f.monthly_budget_usd) ?? LIMITES_POR_DEFECTO.monthlyBudgetUsd,
        requestsPerMinute: f.requests_per_minute,
        maxOutputTokens: f.max_output_tokens,
        origen: 'plan',
      };
    }
  } catch (err) {
    log.warn(`no se pudieron leer los límites del plan '${plan}': ${String(err)}`);
  }

  // 3. Último recurso, tacaño a propósito.
  return { ...LIMITES_POR_DEFECTO, origen: 'default' };
}

function aNumero(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

export interface EstadoPresupuesto {
  limites: LimitesTenant;
  /** Lo que de verdad costó el mes. Es el número conciliable con la factura. */
  gastadoUsd: number;
  /**
   * Lo que se cuenta contra el tope: el costo real más el PISO de las corridas
   * sin precio. Igual a `gastadoUsd` mientras todo tenga precio, que es el caso
   * normal.
   */
  computadoUsd: number;
  /** Lo que queda antes del corte. Se calcula sobre `computadoUsd`. */
  restanteUsd: number;
}

/**
 * Foto del presupuesto del mes. Lo sirve `GET /agents/budget`.
 *
 * Devuelve DOS números por la misma razón por la que el ledger guarda dos
 * columnas. Si esta pantalla reportara sólo el aplicado, un cliente con un
 * modelo sin precio vería un "gastado" calculado al precio de Fable 5 que no
 * corresponde a ninguna factura y que no puede conciliar con nada; si
 * reportara sólo el real, vería $0 gastados y un corte que no se explica.
 *
 * Los dos coinciden salvo que haya consumo `unpriced` — y que difieran es
 * exactamente la señal de que falta capturar un precio.
 */
export async function estadoPresupuesto(ctx: TenantContext): Promise<EstadoPresupuesto> {
  const limites = await resolverLimites(ctx);
  // Una sola lectura para los dos números: pedirlos por separado paginaba el
  // ledger dos veces por cada `GET /agents/budget`, y los dos totales podían
  // venir de instantes distintos y no cuadrar entre sí.
  const { computadoUsd: computado, realUsd: real } = await gastoDelMes(ctx, inicioDeMes());

  const redondear = (n: number): number => Math.round(n * 1e6) / 1e6;

  return {
    limites,
    gastadoUsd: redondear(real),
    computadoUsd: redondear(computado),
    // Sobre el computado: es el que de verdad corta el servicio, y prometer un
    // restante mayor del que se va a respetar es peor que un número feo.
    restanteUsd: Math.max(0, redondear(limites.monthlyBudgetUsd - computado)),
  };
}

/**
 * Puerta de entrada. Se llama ANTES de hablarle al proveedor.
 *
 * @throws PlatformError('BUDGET_EXCEEDED') si el tenant ya se pasó del mes.
 * @throws PlatformError('RATE_LIMITED')    si va demasiado rápido.
 */
export async function verificarPresupuesto(ctx: TenantContext): Promise<LimitesTenant> {
  const limites = await resolverLimites(ctx);

  // ── Gasto del mes ────────────────────────────────────────────────────────
  // Con caché corto: sin él, cada mensaje entrante haría un SUM sobre el ledger
  // antes de siquiera llamar al modelo. El desfase máximo es de 30 s, que en el
  // peor caso deja pasar unas pocas llamadas de más — muy por debajo del ±5%
  // que pide el criterio #3.
  const cacheado = cacheGasto.get(ctx.tenantId);
  let gastado: number;

  if (cacheado && cacheado.expira > Date.now()) {
    gastado = cacheado.valor;
  } else {
    gastado = await gastoDesde(ctx, inicioDeMes());
    cacheGasto.set(ctx.tenantId, { valor: gastado, expira: Date.now() + TTL_CACHE_PRESUPUESTO_MS });
  }

  if (gastado >= limites.monthlyBudgetUsd) {
    throw budgetExceeded(
      `El presupuesto mensual de agentes se agotó: ` +
        `$${gastado.toFixed(2)} de $${limites.monthlyBudgetUsd.toFixed(2)} USD ` +
        `(plan '${limites.plan}', límite por ${limites.origen}). ` +
        `No se degrada el modelo en silencio: sube el plan o el tope para seguir.`,
      {
        gastadoUsd: gastado,
        limiteUsd: limites.monthlyBudgetUsd,
        plan: limites.plan,
        origen: limites.origen,
      },
    );
  }

  // ── Ritmo, por tenant ────────────────────────────────────────────────────
  // GARDEN limita en un Map del proceso: se borra al reiniciar y no sirve con
  // más de un proceso. Aquí se cuenta sobre el propio ledger, que ya está
  // indexado por (tenant_id, created_at) — sin tabla nueva y consistente entre
  // instancias.
  const haceUnMinuto = new Date(Date.now() - 60_000);
  let corridas = 0;
  try {
    corridas = await corridasDesde(ctx, haceUnMinuto);
  } catch (err) {
    // Fail-OPEN aquí, y a propósito: el rate limit protege del abuso, pero el
    // presupuesto —que ya se verificó arriba— es el que protege el dinero. Si
    // la cuenta de ritmo falla, callar al agente de un cliente que sí tiene
    // saldo es peor que dejar pasar una llamada de más.
    log.warn(`no se pudo verificar el ritmo, se deja pasar: ${String(err)}`);
    return limites;
  }

  if (corridas >= limites.requestsPerMinute) {
    throw new PlatformError(
      'RATE_LIMITED',
      `Se alcanzó el límite de ${limites.requestsPerMinute} llamadas por minuto ` +
        `del plan '${limites.plan}'. Reintenta en unos segundos.`,
      { details: { corridas, limite: limites.requestsPerMinute, plan: limites.plan } },
    );
  }

  return limites;
}
