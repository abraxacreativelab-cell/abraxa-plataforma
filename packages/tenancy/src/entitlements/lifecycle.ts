/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Degradación: PAUSAR, NUNCA BORRAR.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Es la regla que define el carril, y la que más fácil se rompe con buena
 * intención — "total, si ya no lo puede usar, ¿para qué guardarlo?".
 *
 * | on_downgrade | Qué pasa                             | Qué NO pasa                    |
 * |--------------|--------------------------------------|--------------------------------|
 * | pause        | se detiene y queda marcado           | no se borra ni se archiva      |
 * | readonly     | se lee y se exporta; no se edita     | no se oculta ni se vacía       |
 * | keep         | nada                                 | —                              |
 *
 * ── Por qué importa tanto ───────────────────────────────────────────────────
 *
 * El emprendedor que se atrasó un mes VUELVE. Si al volver sus automatizaciones
 * ya no existen, sus documentos desaparecieron y sus contactos se fueron, no
 * vuelve: se va, y con razón. Guardar sus filas tres meses más cuesta
 * aproximadamente cero; perderlo como cliente no.
 *
 * Y hay un segundo motivo, menos sentimental: **borrar es irreversible y una
 * baja puede ser un error.** Un webhook de Stripe mal interpretado, una tarjeta
 * que rebotó y se cobró al segundo intento, un staff que le picó al plan
 * equivocado en el panel de H14. Pausar se deshace en un segundo. Borrar no se
 * deshace nunca.
 *
 * Por eso en este archivo no hay un solo DELETE, y por eso
 * `app.features.on_downgrade` no tiene el valor 'delete'.
 *
 * ── El detalle que separa una reactivación buena de una mala ────────────────
 *
 * Reactivar despausa lo que la BAJA pausó —lo sabe porque cada pausa lleva
 * `paused_by`— y **no toca** lo que el emprendedor había pausado él. Encenderle
 * de vuelta el flujo que apagó a propósito es peor que no reactivar nada: es el
 * producto actuando a su nombre.
 *
 * ── Dónde vive la lógica ────────────────────────────────────────────────────
 *
 * En `app.apply_plan_change()` (migración 131), no aquí. Toca cuatro tablas y a
 * medias deja a una empresa con el plan nuevo y las pausas del viejo — el peor
 * estado posible: pagó y no recuperó nada. Es el mismo razonamiento con el que
 * H2 puso `provision_tenant` y `accept_invitation` en SQL (011 y 012).
 *
 * Este archivo es la traducción: llamar, mapear el error, invalidar el caché.
 */
// `adminDb` con su razón escrita, igual que en `gate.ts`: un cambio de plan lo
// dispara un webhook de Stripe o el panel de agencia de H14 — caminos que
// actúan SOBRE una empresa sin actuar POR CUENTA de ella, y que por lo tanto no
// tienen un contexto de tenant del cual colgarse. `app.plans` y `app.tenants`
// son tablas globales (declaradas `-- tenantless:` en la 010).
import { adminDb, tenantDb } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import { mapPgError } from '../errors';
import { invalidarEntitlements } from './can';
import type {
  FeaturePause,
  PlanChangeEffect,
  PlanChangeReason,
  PlanChangeStatus,
} from './catalogo';

export interface ApplyPlanChangeInput {
  tenantId: string;
  toPlan: string;
  toStatus: PlanChangeStatus;
  reason: PlanChangeReason;
  actor?: string;
}

export interface ApplyPlanChangeResult {
  /** Id de la fila de bitácora, o `null` si no había nada que aplicar. */
  changeId: number | null;
  /**
   * `false` cuando la empresa YA estaba en ese plan y estado.
   *
   * Es la señal de idempotencia, y H10 la necesita: un webhook de Stripe
   * reentregado tiene que poder distinguir "ya estaba hecho" de "lo hice yo" sin
   * comparar estados a mano.
   */
  applied: boolean;
  effects: PlanChangeEffect[];
}

/**
 * Aplica un cambio de plan o de estado. Todo o nada, e **idempotente**.
 *
 * H10 puede reintentar el mismo webhook de Stripe y aplicar el mismo cambio dos
 * veces sin pausar dos veces ni escribir dos filas de bitácora. La segunda
 * llamada devuelve `applied: false` y los efectos de la primera.
 *
 * Lo llama H10 (enganche #4 de §11) y el panel de agencia de H14 (#5).
 */
export async function applyPlanChange(
  i: ApplyPlanChangeInput,
): Promise<ApplyPlanChangeResult> {
  const { data, error } = await adminDb().rpc('apply_plan_change', {
    p_tenant_id: i.tenantId,
    p_to_plan: i.toPlan,
    p_to_status: i.toStatus,
    p_reason: i.reason,
    p_actor: i.actor ?? null,
  });

  if (error) throw mapPgError(error, 'No se pudo aplicar el cambio de plan');

  const fila = (Array.isArray(data) ? data[0] : data) as
    | { change_id?: number | string | null; applied?: boolean; effects?: unknown }
    | null
    | undefined;

  /*
   * El caché se tira SIEMPRE, incluso cuando `applied` es false.
   *
   * Cuesta una consulta y evita el peor final posible de este camino: un
   * cliente que pagó, que la base ya reconoce como `pro`, y al que el producto
   * le sigue diciendo que no durante un minuto porque el proceso que atendió el
   * webhook no era el mismo que atiende su pantalla. Ese minuto es la primera
   * impresión de haber pagado.
   */
  invalidarEntitlements(i.tenantId);

  const effects = Array.isArray(fila?.effects) ? (fila.effects as PlanChangeEffect[]) : [];
  const changeId = fila?.change_id == null ? null : Number(fila.change_id);

  return {
    changeId: Number.isFinite(changeId as number) ? (changeId as number) : null,
    applied: fila?.applied === true,
    effects,
  };
}

// ─── Las pausas, como las ve el producto ────────────────────────────────────

interface FilaPausa {
  id: number;
  feature_key: string;
  resource_ref: string;
  paused_by: 'plan' | 'user';
  note: string | null;
  created_at: string;
}

/**
 * Las pausas VIVAS de una empresa.
 *
 * Lo consume `/ajustes/plan` para el tercer bloque de la pantalla ("si algo
 * está pausado por plan, dilo aquí y dilo claro"). Un flujo apagado sin
 * explicación visible es una llamada a soporte garantizada.
 */
export async function pausesFor(ctx: TenantContext): Promise<FeaturePause[]> {
  const { data, error } = await tenantDb(ctx)
    .from('feature_pauses')
    .select('id, feature_key, resource_ref, paused_by, note, created_at')
    .is('released_at', null);

  if (error) throw mapPgError(error, 'No se pudieron leer las pausas');

  return ((data as FilaPausa[] | null) ?? []).map((f) => ({
    id: f.id,
    featureKey: f.feature_key,
    resourceRef: f.resource_ref,
    pausedBy: f.paused_by,
    note: f.note,
    createdAt: f.created_at,
  }));
}

/** `true` si el recurso está pausado por CUALQUIER motivo (plan o usuario). */
export async function isPaused(
  ctx: TenantContext,
  feature: string,
  resourceRef = '*',
): Promise<boolean> {
  const vivas = await pausesFor(ctx);
  return vivas.some(
    (p) => p.featureKey === feature && (p.resourceRef === resourceRef || p.resourceRef === '*'),
  );
}

/**
 * Pausar o despausar a petición del emprendedor.
 *
 * Escribe en la MISMA tabla que la pausa por plan, con `paused_by='user'`. Que
 * compartan tabla es lo que hace que el criterio #9 sea cierto por construcción
 * en vez de por disciplina: si el usuario pausara en otro lado,
 * `apply_plan_change` tendría que conocer dos modelos para no pisarlo, y algún
 * día conocería sólo uno.
 */
export async function setUserPause(
  ctx: TenantContext,
  i: { feature: string; resourceRef?: string; paused: boolean; note?: string },
): Promise<boolean> {
  const { data, error } = await adminDb().rpc('set_user_pause', {
    p_tenant_id: ctx.tenantId,
    p_feature_key: i.feature,
    p_resource_ref: i.resourceRef ?? '*',
    p_paused: i.paused,
    p_note: i.note ?? null,
  });

  if (error) throw mapPgError(error, 'No se pudo cambiar la pausa');
  return data === true;
}

// ─── La bitácora ────────────────────────────────────────────────────────────

export interface PlanChangeEntry {
  id: number;
  fromPlan: string | null;
  toPlan: string;
  fromStatus: string | null;
  toStatus: string;
  reason: PlanChangeReason;
  actor: string | null;
  effects: PlanChangeEffect[];
  createdAt: string;
}

interface FilaCambio {
  id: number;
  from_plan: string | null;
  to_plan: string;
  from_status: string | null;
  to_status: string;
  reason: PlanChangeReason;
  actor: string | null;
  effects: PlanChangeEffect[] | null;
  created_at: string;
}

/**
 * El historial de cambios de plan de una empresa, del más reciente al más
 * viejo. Contesta "¿por qué este cliente perdió su función?" sin adivinar.
 */
export async function planHistoryFor(
  ctx: TenantContext,
  limite = 20,
): Promise<PlanChangeEntry[]> {
  /*
   * El `.order()` va ANTES del `.limit()`, y no es estilo: sin él PostgREST
   * devuelve las filas en el orden que le dé la gana y el `limit` recorta un
   * conjunto arbitrario. En una bitácora eso significa perder justo el cambio
   * más reciente, que es el único que casi siempre se está buscando.
   */
  const { data, error } = await tenantDb(ctx)
    .from('plan_changes')
    .select('id, from_plan, to_plan, from_status, to_status, reason, actor, effects, created_at')
    .order('created_at', { ascending: false })
    .limit(limite);

  if (error) throw mapPgError(error, 'No se pudo leer el historial de plan');

  return ((data as FilaCambio[] | null) ?? [])
    .map((f) => ({
      id: f.id,
      fromPlan: f.from_plan,
      toPlan: f.to_plan,
      fromStatus: f.from_status,
      toStatus: f.to_status,
      reason: f.reason,
      actor: f.actor,
      effects: f.effects ?? [],
      createdAt: f.created_at,
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : b.id - a.id));
}
