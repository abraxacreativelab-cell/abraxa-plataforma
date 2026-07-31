/**
 * BÓVEDA · Alta, edición y aprobación de valores canónicos.
 *
 * Toda escritura invalida la caché antes de devolver. Si no, el emprendedor
 * aprueba un precio, va a probar su agente, le contesta con el precio viejo y
 * pierde la confianza en el producto entero. Un minuto de caché es barato;
 * esa confianza no.
 */
import type { z } from 'zod';
import { PlatformError, notFound, tenantDb } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import { notifyVaultChanged } from '../cache';
import { formatVault } from '../format';
import { requireVaultEdit, requireVaultRead } from '../rbac';
import type { VaultRow } from '../types';
import { crearValorSchema, editarValorSchema } from './schema';
import { fila as filaDe, filas as filasDe } from '../rows';

const COLUMNS =
  'id, key, label, kind, value, value_text, value_json, currency, unit, note, ' +
  'area_slug, scope_type, scope_id, active, source_doc_id, position, ' +
  'approved_at, approved_by, created_at, updated_at';

export interface ListarValoresOpts {
  areaSlug?: string | null;
  soloBorradores?: boolean;
  busqueda?: string;
}

/** Todos los valores del tenant, activos y borradores. Ordenados como se pintan. */
export async function listarValores(
  ctx: TenantContext,
  opts: ListarValoresOpts = {},
): Promise<VaultRow[]> {
  requireVaultRead(ctx);

  let q = tenantDb(ctx).from('canonical_values').select(COLUMNS);
  if (opts.areaSlug !== undefined && opts.areaSlug !== null) q = q.eq('area_slug', opts.areaSlug);
  if (opts.soloBorradores) q = q.eq('active', false);

  const { data, error } = await q.order('position').order('key');
  if (error) throw new PlatformError('INTERNAL', `No se pudieron leer los valores: ${error.message}`);

  let resultado = filasDe<VaultRow>(data);

  if (opts.busqueda?.trim()) {
    const t = opts.busqueda.trim().toLowerCase();
    resultado = resultado.filter((v) =>
      [v.key, v.label, v.note ?? ''].some((campo) => campo.toLowerCase().includes(t)),
    );
  }
  return resultado;
}

export async function obtenerValor(ctx: TenantContext, id: string): Promise<VaultRow> {
  requireVaultRead(ctx);
  const { data, error } = await tenantDb(ctx)
    .from('canonical_values')
    .select(COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new PlatformError('INTERNAL', error.message);
  if (!data) throw notFound('Ese valor no existe en tu bóveda.');
  return filaDe<VaultRow>(data);
}

/**
 * Alta manual desde la UI.
 *
 * A diferencia de la ingesta, aquí `active` sí puede venir en `true`: lo está
 * escribiendo la persona dueña del negocio, con el número enfrente. Lo que
 * nunca nace activo es lo que EXTRAE un modelo de un documento.
 */
export async function crearValor(ctx: TenantContext, input: unknown): Promise<VaultRow> {
  requireVaultEdit(ctx);
  const v = parse(crearValorSchema, input);

  const scopeType = v.scope_type ?? 'tenant';
  const fila = {
    key: v.key,
    label: v.label,
    kind: v.kind,
    value: v.value ?? null,
    value_text: v.value_text ?? null,
    value_json: v.value_json ?? null,
    currency: v.currency ?? 'MXN',
    unit: v.unit ?? null,
    note: v.note ?? null,
    area_slug: v.area_slug ?? null,
    scope_type: scopeType,
    scope_id: scopeType === 'tenant' ? '' : (v.scope_id ?? ''),
    active: v.active ?? true,
    position: v.position ?? 0,
    source_doc_id: v.source_doc_id ?? null,
    approved_at: v.active === false ? null : new Date().toISOString(),
    approved_by: v.active === false ? null : ctx.userEmail,
  };

  const { data, error } = await tenantDb(ctx)
    .from('canonical_values')
    .insert(fila)
    .select(COLUMNS)
    .single();

  if (error) throw traducirError(error, v.key);
  await notifyVaultChanged(ctx.tenantId);
  return filaDe<VaultRow>(data);
}

export async function editarValor(
  ctx: TenantContext,
  id: string,
  input: unknown,
): Promise<VaultRow> {
  requireVaultEdit(ctx);
  const v = parse(editarValorSchema, input);

  const parche: Record<string, unknown> = { ...v };

  // Coherencia del alcance: si baja a 'tenant', el scope_id se limpia solo.
  // Dejarlo colgando pasaría el CHECK de la 031 sólo por accidente.
  if (v.scope_type === 'tenant') parche.scope_id = '';

  // Activarlo desde la edición cuenta como aprobación: quien lo prendió es
  // quien responde por esa cifra, y eso queda escrito.
  if (v.active === true) {
    parche.approved_at = new Date().toISOString();
    parche.approved_by = ctx.userEmail;
  } else if (v.active === false) {
    parche.approved_at = null;
    parche.approved_by = null;
  }

  const { data, error } = await tenantDb(ctx)
    .from('canonical_values')
    .update(parche)
    .eq('id', id)
    .select(COLUMNS)
    .maybeSingle();

  if (error) throw traducirError(error);
  if (!data) throw notFound('Ese valor no existe en tu bóveda.');

  await notifyVaultChanged(ctx.tenantId);
  return filaDe<VaultRow>(data);
}

/**
 * Aprobar un borrador.
 *
 * Es el gesto central del producto: hasta este clic, el número que un modelo
 * sacó de un documento no existe para nadie. Después de él, se propaga a los
 * contratos, a las plantillas de mensaje y a los prompts de todos los agentes.
 *
 * Devuelve el valor ya formateado para que la UI pueda decir exactamente qué
 * se propagó, en vez de un "guardado" que no informa nada.
 */
export async function aprobarValor(
  ctx: TenantContext,
  id: string,
): Promise<{ row: VaultRow; propagado: string }> {
  requireVaultEdit(ctx);

  const { data, error } = await tenantDb(ctx)
    .from('canonical_values')
    .update({
      active: true,
      approved_at: new Date().toISOString(),
      approved_by: ctx.userEmail,
    })
    .eq('id', id)
    .select(COLUMNS)
    .maybeSingle();

  if (error) throw new PlatformError('INTERNAL', error.message);
  if (!data) throw notFound('Ese valor no existe en tu bóveda.');

  await notifyVaultChanged(ctx.tenantId);
  const row = filaDe<VaultRow>(data);
  return { row, propagado: `{valor.${row.key}} → ${formatVault(row)}` };
}

/** Devolver un valor a borrador. Deja de propagarse sin perder el dato. */
export async function desactivarValor(ctx: TenantContext, id: string): Promise<VaultRow> {
  requireVaultEdit(ctx);
  return editarValor(ctx, id, { active: false });
}

export async function borrarValor(ctx: TenantContext, id: string): Promise<void> {
  requireVaultEdit(ctx);
  const { error } = await tenantDb(ctx).from('canonical_values').delete().eq('id', id);
  if (error) throw new PlatformError('INTERNAL', error.message);
  await notifyVaultChanged(ctx.tenantId);
}

/** Cuántos borradores esperan aprobación. El badge del panel de Dirección. */
export async function contarBorradores(ctx: TenantContext): Promise<number> {
  const { count, error } = await tenantDb(ctx)
    .from('canonical_values')
    .select('id', { head: true, count: 'exact' })
    .eq('active', false);
  if (error) return 0;
  return count ?? 0;
}

// ─────────────────────────────────────────────────────────────────────────────

/** Un error de validación tiene que decir QUÉ campo y POR QUÉ, no "inválido". */
function parse<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const r = schema.safeParse(input);
  if (r.success) return r.data as z.infer<S>;
  const detalle = r.error.issues
    .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
    .join(' · ');
  throw new PlatformError('VALIDATION', detalle);
}

interface DbError {
  code?: string;
  message: string;
}

function traducirError(error: DbError, key?: string): PlatformError {
  // 23505 = unique_violation contra canonical_values_identity_idx.
  if (error.code === '23505') {
    return new PlatformError(
      'CONFLICT',
      key
        ? `Ya existe un valor con la clave '${key}' en ese alcance. ` +
          'Edítalo en vez de crear otro: la gracia de la bóveda es que cada ' +
          'número viva en un solo lugar.'
        : 'Ya existe un valor con esa clave en ese alcance.',
    );
  }
  // 23514 = check_violation: clave mal formada o alcance incoherente.
  if (error.code === '23514') {
    return new PlatformError('VALIDATION', `La base rechazó el valor: ${error.message}`);
  }
  return new PlatformError('INTERNAL', error.message);
}
