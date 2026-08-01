/**
 * ════════════════════════════════════════════════════════════════════════════
 *  La excepción por cliente: el trato especial, con su razón escrita.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Es la operación que el panel de agencia de H14 pinta como un botón
 * (enganche #5 de §11). H16 la entrega; H14 decide dónde va.
 *
 * ── Los dos sentidos, y por qué el segundo importa tanto ───────────────────
 *
 *   granted = true    concede algo que su plan no trae — una prueba, una
 *                     cortesía, un cliente al que se le prometió algo en la
 *                     venta y todavía no está empaquetado;
 *   granted = false   QUITA algo que su plan SÍ trae.
 *
 * El segundo es el que casi nadie construye y el que siempre acaba haciendo
 * falta: es cómo se apaga una función a un cliente que está abusando de ella
 * —o que la tiene mal configurada y está mandando spam por nuestro número— sin
 * bajarle el plan entero, que castigaría también todo lo que sí está usando
 * bien.
 *
 * ── La nota es obligatoria en la base, no aquí ─────────────────────────────
 *
 * `CHECK (length(btrim(note)) >= 8)` en la migración 130, con el mismo criterio
 * de `app.agent_budget_overrides.note` (024:63-65). Validarla también aquí sirve
 * para dar un mensaje decente antes de ir a Postgres, pero la que manda es la
 * de la base: un permiso especial sin razón escrita es un misterio en seis
 * meses, y una validación que sólo vive en TypeScript se salta con un `curl`.
 */
import { tenantDb } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import { PlatformError } from '@abraxa/db';
import { mapPgError } from '../errors';
import { invalidarEntitlements } from './can';
import type { FeatureKey } from './catalogo';

/** Lo mínimo que tiene que decir una nota para explicar algo dentro de un año. */
export const MINIMO_NOTA = 8;

export interface SetOverrideInput {
  feature: FeatureKey | string;
  /** `true` concede; `false` quita. Los dos sentidos son legítimos. */
  granted: boolean;
  /** Obligatoria. La base la exige con al menos 8 caracteres útiles. */
  note: string;
  /** Concesión temporal. ISO 8601. Ausente = sin vencimiento. */
  expiresAt?: string | null;
  /** Correo de quien lo concede. Queda en la fila. */
  updatedBy?: string | null;
}

export interface OverrideRow {
  featureKey: string;
  granted: boolean;
  note: string;
  expiresAt: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

interface Fila {
  feature_key: string;
  granted: boolean;
  note: string;
  expires_at: string | null;
  updated_by: string | null;
  updated_at: string;
}

/**
 * Pone o reemplaza el trato especial de una empresa sobre una función.
 *
 * Es un upsert sobre `(tenant_id, feature_key)`: conceder dos veces la misma
 * función deja UNA fila con la última nota, no dos filas contradictorias.
 */
export async function setOverride(
  ctx: TenantContext,
  i: SetOverrideInput,
): Promise<OverrideRow> {
  const nota = (i.note ?? '').trim();
  if (nota.length < MINIMO_NOTA) {
    throw new PlatformError(
      'VALIDATION',
      `La razón del trato especial es obligatoria y tiene que decir algo ` +
        `(al menos ${MINIMO_NOTA} caracteres). Dentro de seis meses, esta nota va a ser ` +
        `lo único que explique por qué este cliente tiene lo que tiene.`,
    );
  }

  if (i.expiresAt != null && Number.isNaN(Date.parse(i.expiresAt))) {
    throw new PlatformError('VALIDATION', '`expiresAt` no es una fecha válida.');
  }

  const { data, error } = await tenantDb(ctx)
    .from('tenant_entitlements')
    .upsert(
      {
        feature_key: i.feature,
        granted: i.granted,
        note: nota,
        expires_at: i.expiresAt ?? null,
        updated_by: i.updatedBy ?? ctx.userEmail ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,feature_key' },
    )
    .select('feature_key, granted, note, expires_at, updated_by, updated_at');

  if (error) throw mapPgError(error, 'No se pudo guardar el trato especial');

  invalidarEntitlements(ctx.tenantId);

  const fila = (Array.isArray(data) ? data[0] : data) as Fila | null | undefined;
  return {
    featureKey: fila?.feature_key ?? String(i.feature),
    granted: fila?.granted ?? i.granted,
    note: fila?.note ?? nota,
    expiresAt: fila?.expires_at ?? i.expiresAt ?? null,
    updatedBy: fila?.updated_by ?? null,
    updatedAt: fila?.updated_at ?? new Date().toISOString(),
  };
}

/**
 * Quita el trato especial: la empresa vuelve a lo que diga su plan.
 *
 * Éste es el único DELETE del carril, y no contradice "pausar, nunca borrar":
 * lo que se borra es el PERMISO, no el dato del cliente. Dejarlo como una fila
 * marcada sería peor — un override "inactivo" que sigue en la tabla es la clase
 * de fila que alguien reactiva por error seis meses después.
 *
 * El rastro de que existió queda igual: si el override estaba pausando o
 * concediendo algo, el próximo `applyPlanChange()` lo registra en `effects`.
 */
export async function clearOverride(
  ctx: TenantContext,
  feature: FeatureKey | string,
): Promise<boolean> {
  const { data, error } = await tenantDb(ctx)
    .from('tenant_entitlements')
    .delete()
    .eq('feature_key', feature)
    .select('feature_key');

  if (error) throw mapPgError(error, 'No se pudo quitar el trato especial');

  invalidarEntitlements(ctx.tenantId);
  return (((data as unknown[] | null) ?? []).length ?? 0) > 0;
}

/**
 * Los tratos especiales de una empresa, incluidos los VENCIDOS.
 *
 * Que devuelva los vencidos es deliberado: la vista `tenant_entitlements_
 * effective` ya los ignora para decidir, y quien mira esta lista está haciendo
 * la otra pregunta — "¿qué se le concedió a este cliente alguna vez y por qué?".
 * Esconder los vencidos aquí dejaría esa pregunta sin respuesta y la nota, que
 * es la parte valiosa, invisible.
 */
export async function overridesFor(ctx: TenantContext): Promise<OverrideRow[]> {
  const { data, error } = await tenantDb(ctx)
    .from('tenant_entitlements')
    .select('feature_key, granted, note, expires_at, updated_by, updated_at');

  if (error) throw mapPgError(error, 'No se pudieron leer los tratos especiales');

  return ((data as Fila[] | null) ?? []).map((f) => ({
    featureKey: f.feature_key,
    granted: f.granted,
    note: f.note,
    expiresAt: f.expires_at,
    updatedBy: f.updated_by,
    updatedAt: f.updated_at,
  }));
}
