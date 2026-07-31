/**
 * Planes y cuotas — el MODELO, no el cobro.
 *
 * Cobrar es H10. Aquí sólo vive qué puede hacer una empresa según su plan, en
 * una forma que los demás paquetes puedan consultar sin conocer nada de
 * Stripe.
 *
 * ── La regla que evita el peor bug de cuotas ──────────────────────────────
 *
 * Un límite AUSENTE es ilimitado, no cero. Suena obvio hasta que alguien
 * agrega `maxProyectos` al plan `pro` y se le olvida en `free`: con la
 * interpretación contraria, todos los clientes del plan gratis se quedan sin
 * poder crear un solo proyecto, y el síntoma es un 409 que nadie sabe de dónde
 * sale. Los límites se declaran; su ausencia no decide.
 */
import { PlatformError, tenantDb } from '@abraxa/db';
import { findPlan, findTenantById, listPlans } from '../db/queries';
import { mapPgError } from '../errors';
import type {
  FullTenantContext,
  PlanLimits,
  PlanRow,
  QuotaKey,
  QuotaState,
  TenantContext,
} from '../types';

/** Cuotas cuyo exceso es un problema de presupuesto y no de estructura. */
const CUOTAS_DE_GASTO: ReadonlySet<QuotaKey> = new Set<QuotaKey>(['monthlyAiUsd']);

export async function planFor(planId: string): Promise<PlanRow> {
  const plan = await findPlan(planId);
  if (!plan) {
    // La FK `tenants_plan_fkey` lo hace casi imposible; si pasa, es que alguien
    // borró una fila del catálogo con clientes encima.
    throw new PlatformError('INTERNAL', `El plan "${planId}" no existe en el catálogo.`);
  }
  return plan;
}

/**
 * El plan de la empresa del contexto.
 *
 * `contextFor()` ya lo trae, pero otros paquetes programan contra
 * `TenantContext` de ports.ts, que no lo incluye. Cuando no viene, se busca:
 * es una consulta más, y es mejor que obligar a nueve handoffs a cargar un
 * campo que no les importa sólo para poder preguntar por una cuota.
 */
async function planIdFor(ctx: TenantContext): Promise<string> {
  const conPlan = ctx as Partial<FullTenantContext>;
  if (typeof conPlan.plan === 'string' && conPlan.plan.length > 0) return conPlan.plan;
  const tenant = await findTenantById(ctx.tenantId);
  return tenant?.plan ?? 'free';
}

export async function limitsFor(ctx: TenantContext): Promise<PlanLimits> {
  const plan = await planFor(await planIdFor(ctx));
  return (plan.limits ?? {}) as PlanLimits;
}

/** El estado de una cuota dado el consumo actual. */
export function quotaFor(limits: PlanLimits, key: QuotaKey, used: number): QuotaState {
  const limite = limits[key];
  const hayLimite = typeof limite === 'number' && Number.isFinite(limite);

  return {
    key,
    limit: hayLimite ? limite : null,
    used,
    remaining: hayLimite ? Math.max(0, limite - used) : null,
    exceeded: hayLimite ? used >= limite : false,
  };
}

/**
 * Lanza si la empresa ya llegó a su límite.
 *
 * El consumo lo trae quien llama, y tiene que ser así: H2 no es dueño de
 * `contacts` ni de `flows`, así que no puede contarlos sin invadir el carril
 * de otro handoff. La excepción es `maxSeats`, que sí cuenta H2 porque las
 * membresías son suyas — ver `seatsFor()`.
 */
export async function assertQuota(
  ctx: TenantContext,
  key: QuotaKey,
  used: number,
): Promise<QuotaState> {
  const estado = quotaFor(await limitsFor(ctx), key, used);
  if (!estado.exceeded) return estado;

  throw new PlatformError(
    CUOTAS_DE_GASTO.has(key) ? 'BUDGET_EXCEEDED' : 'CONFLICT',
    `El plan de esta empresa llegó a su límite de ${key} (${estado.limit}).`,
    { details: { key, limit: estado.limit, used } },
  );
}

/** Asientos ocupados y libres. Los cuenta H2 porque las membresías son suyas. */
export async function seatsFor(ctx: TenantContext): Promise<QuotaState> {
  const { count, error } = await tenantDb(ctx)
    .from('memberships')
    .select('user_email', { head: true, count: 'exact' });
  if (error) throw mapPgError(error, 'No se pudieron contar los miembros');

  return quotaFor(await limitsFor(ctx), 'maxSeats', count ?? 0);
}

/**
 * Lanza si ya no queda asiento.
 *
 * Ojo: esta verificación es informativa y sirve para dar un mensaje claro
 * ANTES de invitar. La verificación que de verdad protege está dentro de
 * `app.accept_invitation()`, porque es la única que ocurre en la misma
 * transacción que consume el asiento — dos invitados aceptando a la vez con un
 * asiento libre pasarían los dos si la cuenta se hiciera sólo aquí.
 */
export async function assertSeatAvailable(ctx: TenantContext): Promise<void> {
  const asientos = await seatsFor(ctx);
  if (!asientos.exceeded) return;

  throw new PlatformError(
    'CONFLICT',
    `El plan de esta empresa incluye ${asientos.limit} asientos y ya están ocupados.`,
    { details: { limit: asientos.limit, used: asientos.used } },
  );
}

export const availablePlans = (): Promise<PlanRow[]> => listPlans();
