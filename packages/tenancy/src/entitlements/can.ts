/**
 * ════════════════════════════════════════════════════════════════════════════
 *  `can()` — el eje booleano que faltaba.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Resolución en tres saltos, del más específico al más general:
 *
 *     app.tenant_entitlements   ¿este cliente tiene un trato especial vigente?
 *             ↓ si no hay fila, o expiró
 *     app.plan_features         ¿lo trae su plan?
 *             ↓ si no
 *     false                     deny por defecto
 *
 * Es el MISMO patrón que H3 usó para el presupuesto
 * (`024_agent_budgets.sql:11-18`), y se reusa a propósito: un sistema con dos
 * formas de resolver una excepción tiene dos formas de equivocarse.
 *
 * ── Dónde ocurre de verdad la resolución ────────────────────────────────────
 *
 * En SQL, dentro de la vista `app.tenant_entitlements_effective`. Este archivo
 * no encadena tres consultas: hace UNA y la vista ya trae la respuesta.
 *
 * No es una optimización. Es el criterio #4: un `expires_at` vencido tiene que
 * dejar de conceder, y eso se compara contra `now()` **de la base**. Hacerlo en
 * JavaScript pondría la vigencia de una prueba de 14 días a merced del reloj
 * del proceso — y un contenedor con la hora corrida mantendría viva una prueba
 * terminada sin que nadie se entere. El reloj de la base es uno solo.
 *
 * La regla 3 de §6 (un tenant que no está activo no tiene NINGUNA función) vive
 * también en la vista, por lo mismo: para que no dependa de que quien consulte
 * se acuerde de preguntarlo.
 */
import { tenantDb } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import { mapPgError } from '../errors';
import { TTL_CACHE_ENTITLEMENTS_MS } from './config';
import { noContratado } from './errores';
import type { EntitlementRow, EntitlementState, FeatureKey } from './catalogo';

const COLUMNAS =
  'tenant_id, feature_key, label, blurb, on_downgrade, position, granted, source, ' +
  'override_expires_at, override_note';

// ─── Caché ──────────────────────────────────────────────────────────────────
//
// Con TTL corto, copiando el patrón de `invalidarCachePresupuesto()` en
// `packages/agents/src/ledger/budget.ts:36-42`. Sin caché, cada mensaje
// entrante haría una consulta más antes de llegar al agente.
//
// El desfase máximo es de 60 s y sólo puede ir en una dirección incómoda: un
// cliente que acaba de pagar espera hasta un minuto. Por eso existe
// `invalidarEntitlements()`, que H10 llama al aplicar el cambio — el minuto es
// el peor caso de un camino que en la práctica no se recorre.

interface EntradaCache {
  valor: Map<string, EntitlementState>;
  expira: number;
}

const cache = new Map<string, EntradaCache>();

/**
 * Tira el caché de una empresa, o de todas.
 *
 * La llama H10 al aplicar un cambio de suscripción, `applyPlanChange()` al
 * terminar, y **cada prueba entre casos**. Esa última parte no es higiene: un
 * caché sin invalidación explícita en las pruebas produce suites que pasan en
 * verde y mienten — el segundo caso lee lo que dejó el primero y pasa por la
 * razón equivocada.
 */
export function invalidarEntitlements(tenantId?: string): void {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}

// ─── La consulta ────────────────────────────────────────────────────────────

async function leer(ctx: TenantContext): Promise<Map<string, EntitlementState>> {
  const cacheado = cache.get(ctx.tenantId);
  if (cacheado && cacheado.expira > Date.now()) return cacheado.valor;

  const { data, error } = await tenantDb(ctx)
    .from('tenant_entitlements_effective')
    .select(COLUMNAS);

  if (error) throw mapPgError(error, 'No se pudieron leer las funciones de tu plan');

  /*
   * `as unknown as` y no un cast directo: PostgREST tipa el resultado de un
   * `select()` con lista de columnas en crudo a partir de la cadena, y para una
   * VISTA que no está en su registro de tipos eso queda en `GenericStringError[]`.
   * El compilador tiene razón en que las dos formas no se parecen — la que sabe
   * qué devuelve la vista es la migración 130, no el tipo inferido.
   */
  const filas = (data as unknown as EntitlementRow[] | null) ?? [];
  const mapa = new Map<string, EntitlementState>();

  for (const f of filas) {
    mapa.set(f.feature_key, {
      key: f.feature_key,
      label: f.label,
      blurb: f.blurb,
      granted: f.granted === true,
      source: f.source,
      onDowngrade: f.on_downgrade,
      position: f.position,
      expiresAt: f.override_expires_at,
      note: f.override_note,
    });
  }

  cache.set(ctx.tenantId, { valor: mapa, expira: Date.now() + TTL_CACHE_ENTITLEMENTS_MS });
  return mapa;
}

// ─── La API ─────────────────────────────────────────────────────────────────

/**
 * ¿Esta empresa tiene contratada esta función?
 *
 * DENY POR DEFECTO: una función que no está en el catálogo, o que la consulta
 * no devolvió, es `false`. Nunca `true`.
 *
 * ── Y si la consulta FALLA ──────────────────────────────────────────────────
 *
 * También `false`. `can()` no lanza: devuelve un booleano, y el único booleano
 * seguro cuando no se sabe es el que no gasta dinero. Es el mismo fail-closed
 * de `canSignIn()` (`services/context.ts:167-175`) y de `resolverLimites()`
 * (`budget.ts:50`).
 *
 * Quien necesite distinguir "no lo tiene" de "no se pudo saber" usa
 * `entitlementsFor()`, que sí propaga el error.
 */
export async function can(ctx: TenantContext, feature: FeatureKey | string): Promise<boolean> {
  try {
    return (await leer(ctx)).get(feature)?.granted === true;
  } catch {
    return false;
  }
}

/**
 * Lanza 402 si la empresa no tiene contratada la función.
 *
 * Es la puerta que se pone en el punto de EJECUCIÓN, no sólo al encolar — ver
 * `queue.ts` y §2.5 del handoff.
 */
export async function assertEntitled(
  ctx: TenantContext,
  feature: FeatureKey | string,
): Promise<void> {
  let estado: EntitlementState | undefined;

  try {
    estado = (await leer(ctx)).get(feature);
  } catch {
    // Fail-closed, igual que `can()`. Se lanza el 402 sin blurb: no se pudo
    // leer el catálogo, así que no hay copy que enseñar.
    throw noContratado(feature);
  }

  if (estado?.granted === true) return;

  throw noContratado(feature, {
    ...(estado?.blurb ? { blurb: estado.blurb } : {}),
    ...(estado?.label ? { label: estado.label } : {}),
  });
}

/**
 * Todas las funciones y su estado. Lo consume `/ajustes/plan`.
 *
 * A diferencia de `can()`, esto SÍ propaga el error: la pantalla tiene que
 * poder distinguir "no tienes nada contratado" de "no pude preguntar", porque
 * pintar lo segundo como lo primero es exactamente el cero silencioso que manda
 * a alguien a depurar un sistema que está bien.
 */
export async function entitlementsFor(
  ctx: TenantContext,
): Promise<Record<string, boolean>> {
  const mapa = await leer(ctx);
  const salida: Record<string, boolean> = {};
  for (const [k, v] of mapa) salida[k] = v.granted;
  return salida;
}

/** Lo mismo, con el detalle completo: etiqueta, blurb, origen y vencimiento. */
export async function entitlementDetailsFor(ctx: TenantContext): Promise<EntitlementState[]> {
  return [...(await leer(ctx)).values()].sort((a, b) => a.position - b.position);
}

/** El estado de UNA función, con su detalle. `undefined` si no está en el catálogo. */
export async function entitlementFor(
  ctx: TenantContext,
  feature: FeatureKey | string,
): Promise<EntitlementState | undefined> {
  return (await leer(ctx)).get(feature);
}
