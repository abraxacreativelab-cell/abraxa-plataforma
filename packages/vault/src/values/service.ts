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
import { esRango } from '../ingest/money';
import { requireVaultEdit, requireVaultRead } from '../rbac';
import type { DecisionConflicto, VaultKind, VaultRow } from '../types';
import { crearValorSchema, editarValorSchema } from './schema';
import { fila as filaDe, filas as filasDe } from '../rows';

const COLUMNS =
  'id, key, label, kind, value, value_text, value_json, currency, unit, note, ' +
  'area_slug, scope_type, scope_id, active, source_doc_id, position, ' +
  'approved_at, approved_by, conflict_value, conflict_value_text, ' +
  'conflict_currency, conflict_note, conflict_doc_id, conflict_at, ' +
  'created_at, updated_at';

/**
 * Las seis columnas de conflicto, apagadas.
 *
 * Se escriben SIEMPRE juntas: la 031 tiene un CHECK que impide dejar media
 * contradicción escrita, porque un conflicto sin `conflict_at` no lo vería
 * nadie —ni la UI, ni el badge— y existiría en la base para siempre.
 */
const CONFLICTO_LIMPIO = {
  conflict_value: null,
  conflict_value_text: null,
  conflict_currency: null,
  conflict_note: null,
  conflict_doc_id: null,
  conflict_at: null,
} as const;

/** `true` si un documento posterior contradice esta cifra y nadie ha decidido. */
export function tieneConflicto(row: VaultRow): boolean {
  return row.conflict_at != null;
}

/**
 * `true` si la contradicción pendiente NO trae con qué reemplazar la cifra:
 * ni número (`conflict_value`) ni texto (`conflict_value_text`).
 *
 * Pasa cuando el documento decía un rango («de $800 a $900») o un pendiente
 * («por definir»): `money.ts` hace lo correcto y no inventa un número, pero lo
 * que queda anotado al lado del valor es una propuesta VACÍA.
 *
 * Aceptar una de éstas escribiría `value: null` **y** `active: true`, y como
 * los valores no tienen versiones —sólo los documentos las tienen— la cifra
 * aprobada desaparecería sin dejar rastro. La UI usa el mismo criterio para
 * apagar el botón; ésta es la que de verdad lo impide, porque el botón no es
 * la única puerta (están también las rutas HTTP de `http/routes.ts`).
 */
export function propuestaSinCifra(row: VaultRow): boolean {
  return row.conflict_value == null && !row.conflict_value_text;
}

export interface ListarValoresOpts {
  areaSlug?: string | null;
  soloBorradores?: boolean;
  /** Sólo los que un documento posterior contradice. El otro badge urgente. */
  soloConflictos?: boolean;
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

  // En memoria y no con un `.not()` de PostgREST: la lista de valores de un
  // negocio cabe holgadamente en una respuesta, y así el filtro se comporta
  // igual en la base real y en el doble de las pruebas.
  if (opts.soloConflictos) resultado = resultado.filter(tieneConflicto);

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

  // Si el emprendedor toca la cifra, la contradicción pendiente deja de tener
  // sentido: acaba de decidir a mano, que es exactamente lo que se le pedía.
  // Dejar el conflicto marcado lo mandaría a resolver algo que ya resolvió.
  const tocaLaCifra =
    v.value !== undefined ||
    v.value_text !== undefined ||
    v.value_json !== undefined ||
    v.currency !== undefined;
  if (tocaLaCifra) Object.assign(parche, CONFLICTO_LIMPIO);

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

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Resolver una contradicción.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * La ingesta no decide cuando un documento nuevo desmiente una cifra que ya se
 * aprobó: la deja marcada y sigue de largo (ver `ingest/pipeline.ts`). Aquí es
 * donde una persona decide, que es el único lugar donde se puede decidir.
 *
 *   `aceptar`   — la cifra del documento nuevo pasa a ser la vigente, y queda
 *                 aprobada por quien lo aceptó. La trazabilidad se mueve con
 *                 ella: `source_doc_id` pasa a ser el documento que la trajo.
 *   `descartar` — se queda la de siempre. El documento nuevo no cambia nada.
 *
 * En los dos casos el conflicto se apaga: si no, el aviso reaparecería en cada
 * pantalla para siempre y el emprendedor aprendería a ignorarlo.
 */
export async function resolverConflicto(
  ctx: TenantContext,
  id: string,
  decision: DecisionConflicto,
): Promise<{ row: VaultRow; propagado: string }> {
  requireVaultEdit(ctx);

  const actual = await obtenerValor(ctx, id);
  if (!tieneConflicto(actual)) {
    throw new PlatformError(
      'VALIDATION',
      `«${actual.label}» no tiene ninguna contradicción pendiente. ` +
        'Puede que alguien más ya la haya resuelto.',
    );
  }

  // ── Aceptar una propuesta VACÍA dejaría el valor vigente y sin cifra ──
  //
  // El documento dijo algo («de $800 a $900»), pero no dijo un número. Aplicar
  // eso borraría la cifra aprobada Y la dejaría activa: el agente dejaría de
  // saber el precio y la cotización saldría con un hueco donde iba. Y nadie
  // vería un error, porque la acción respondería que todo salió bien.
  //
  // `crearValorSchema` ya prohíbe guardar un `money` sin número a mano. Que
  // esta ruta pudiera escribir exactamente eso era la asimetría que delataba
  // el defecto: la misma base de datos, la misma regla, dos respuestas.
  if (decision === 'aceptar' && propuestaSinCifra(actual)) {
    throw new PlatformError('VALIDATION', porQueNoSePuedeAceptar(actual));
  }

  const parche: Record<string, unknown> =
    decision === 'aceptar'
      ? {
          value: actual.conflict_value ?? null,
          value_text: actual.conflict_value_text ?? null,
          currency: actual.conflict_currency ?? actual.currency,
          // La nota del documento nuevo sólo pisa a la vieja si dice algo.
          note: actual.conflict_note ?? actual.note,
          source_doc_id: actual.conflict_doc_id ?? actual.source_doc_id,
          // Aceptar es aprobar: quien lo acepta responde por esa cifra.
          active: true,
          approved_at: new Date().toISOString(),
          approved_by: ctx.userEmail,
          ...CONFLICTO_LIMPIO,
        }
      : { ...CONFLICTO_LIMPIO };

  const { data, error } = await tenantDb(ctx)
    .from('canonical_values')
    .update(parche)
    .eq('id', id)
    .select(COLUMNS)
    .maybeSingle();

  if (error) throw traducirError(error);
  if (!data) throw notFound('Ese valor no existe en tu bóveda.');

  await notifyVaultChanged(ctx.tenantId);
  const row = filaDe<VaultRow>(data);
  return {
    row,
    propagado:
      decision === 'aceptar'
        ? `{valor.${row.key}} → ${formatVault(row)}`
        : `{valor.${row.key}} se queda en ${formatVault(row)}`,
  };
}

/** Cuántas contradicciones esperan decisión. El badge urgente de Dirección. */
export async function contarConflictos(ctx: TenantContext): Promise<number> {
  requireVaultRead(ctx);
  const { data, error } = await tenantDb(ctx)
    .from('canonical_values')
    .select('id, conflict_at');
  if (error) return 0;
  return filasDe<{ conflict_at: string | null }>(data).filter((v) => v.conflict_at != null).length;
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

/** Cómo se llama, en cristiano, lo que le falta a cada tipo. */
const LO_QUE_FALTA: Record<VaultKind, string> = {
  money: 'un precio',
  percent: 'un porcentaje',
  number: 'un número',
  text: 'un texto',
  date: 'una fecha',
  bool: 'un sí o un no',
  list: 'una lista',
};

/**
 * Por qué no se puede aceptar, en los términos del emprendedor.
 *
 * Cita LO QUE EL DOCUMENTO SÍ TRAJO. Un «no se puede» a secas lo deja sin saber
 * qué número escribir, y con el documento abierto enfrente pensando que el
 * producto se equivoca. Y ofrece las dos salidas que de verdad existen, porque
 * un error sin salida es un callejón.
 */
function porQueNoSePuedeAceptar(v: VaultRow): string {
  const dijo = v.conflict_note?.trim();
  const falta = LO_QUE_FALTA[v.kind] ?? 'un valor';

  const queDice = !dijo
    ? `El documento no trajo ${falta} para «${v.label}».`
    : esRango(dijo)
      ? `El documento dice «${dijo}», que es un rango, no ${falta}.`
      : `El documento dice «${dijo}», que no es ${falta}.`;

  const vigente = formatVault(v);
  const queSePierde = vigente
    ? `Aceptarlo dejaría «${v.label}» vigente y vacío: ${vigente} desaparecería ` +
      'sin quedar guardado en ningún lado, y tus contratos, mensajes y agentes ' +
      'dejarían de saberlo.'
    : `Aceptarlo dejaría «${v.label}» vigente y vacío.`;

  const escribelo =
    v.kind === 'money' || v.kind === 'percent' || v.kind === 'number'
      ? 'Escribe tú el número al editarlo'
      : 'Escríbelo tú al editarlo';

  return `${queDice} ${queSePierde} ${escribelo}, o descarta la propuesta.`;
}

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
