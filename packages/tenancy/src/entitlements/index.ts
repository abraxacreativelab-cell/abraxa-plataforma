/**
 * ════════════════════════════════════════════════════════════════════════════
 *  @abraxa/tenancy — entitlements y ciclo de vida del plan (H16)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * El producto ya sabía CUÁNTO puede hacer una empresa. No sabía QUÉ, ni qué
 * pasa cuando deja de pagar. Éste es ese eje.
 *
 * Vive DENTRO de `packages/tenancy` pero en un subárbol propio: es la capa que
 * quedó entre el alcance de H2 ("planes y cuotas — el modelo, no el cobro") y
 * el de H10 ("el cobro"). No corrige nada de H2; escribe lo que nadie tenía
 * asignado.
 *
 * ── Lo que expone ───────────────────────────────────────────────────────────
 *
 *   can / assertEntitled      ¿tiene contratada esta función? (deny por defecto)
 *   entitlementsFor           todas, para la pantalla
 *   tenantIsLive              la puerta del camino SIN sesión — webhook, worker
 *   withEntitlement           verificar AL EJECUTAR, no sólo al encolar
 *   applyPlanChange           bajar y subir de plan: pausar, nunca borrar
 *   setOverride               el trato especial, con su razón escrita
 *   usageFor                  qué estás usando, con hueco honesto donde no hay
 *
 * ── Quién lo consume ────────────────────────────────────────────────────────
 *
 *   H6   la puerta del webhook antes de correr al agente
 *   H8   envolver la cola de flujos
 *   H10  aplicar el resultado de un cambio de suscripción
 *   H12  y H13 — ¿este plan incluye este canal?
 *   H14  el botón de override
 *
 * Ninguno de esos enganches vive aquí: son una línea cada uno en el árbol de su
 * dueño, y están anotados en el PR. La regla 5 del contrato existe justo para
 * esto — se programa contra la interfaz y se encuentran en el merge.
 *
 * ── Por qué NO se registra un port ──────────────────────────────────────────
 *
 * `PortRegistry` es de H1 (`packages/db/ports.ts`) y no tiene entrada para
 * entitlements. Agregarla es suya. Mientras tanto los consumidores importan
 * estas funciones directamente desde `@abraxa/tenancy`, que ya es una
 * dependencia de todos: no hay nada que esperar y no hay ningún archivo ajeno
 * que tocar.
 */

// ─── El eje booleano ────────────────────────────────────────────────────────
export {
  can,
  assertEntitled,
  entitlementsFor,
  entitlementDetailsFor,
  entitlementFor,
  invalidarEntitlements,
} from './can';

// ─── La puerta del camino sin sesión ────────────────────────────────────────
export {
  tenantIsLive,
  assertTenantLive,
  contextoDeSistema,
  contextoDeSistemaAunSuspendida,
} from './gate';

// ─── Verificar al ejecutar ──────────────────────────────────────────────────
export { withEntitlement, withLiveTenant, type WithEntitlementOptions } from './queue';

// ─── Ciclo de vida del plan ─────────────────────────────────────────────────
export {
  applyPlanChange,
  pausesFor,
  isPaused,
  setUserPause,
  planHistoryFor,
  type ApplyPlanChangeInput,
  type ApplyPlanChangeResult,
  type PlanChangeEntry,
} from './lifecycle';

// ─── El trato especial ──────────────────────────────────────────────────────
export {
  setOverride,
  clearOverride,
  overridesFor,
  MINIMO_NOTA,
  type OverrideRow,
  type SetOverrideInput,
} from './overrides';

// ─── Consumo contra el plan ─────────────────────────────────────────────────
export { usageFor, type ConsumosConocidos, type RenglonUso } from './uso';

// ─── 402 ≠ 403 ──────────────────────────────────────────────────────────────
export {
  noContratado,
  empresaNoActiva,
  esNoContratado,
  CODIGO_NO_CONTRATADO,
  RAZON_NO_CONTRATADO,
  RAZON_PRESUPUESTO,
  type DetalleNoContratado,
} from './errores';

// ─── Vocabulario ────────────────────────────────────────────────────────────
export {
  FEATURE_KEYS,
  DENY_POR_DEFECTO,
  esFeatureKey,
  type EntitlementRow,
  type EntitlementSource,
  type EntitlementState,
  type FeatureKey,
  type FeaturePause,
  type FeatureRow,
  type OnDowngrade,
  type PlanChangeEffect,
  type PlanChangeReason,
  type PlanChangeStatus,
  type SkipReason,
  type TenantLiveness,
} from './catalogo';

export { TTL_CACHE_ENTITLEMENTS_MS, LIMITE_HISTORIAL_PLAN } from './config';

// ─── Rutas ──────────────────────────────────────────────────────────────────
//
// Todavía sin montar: `apps/api/src/packages.ts` es de H1 y
// `packages/tenancy/src/index.ts` es de H2. Es una línea, anotada en el PR.
export { entitlementsRouter } from './routes';
