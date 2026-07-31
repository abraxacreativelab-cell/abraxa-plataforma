/**
 * ════════════════════════════════════════════════════════════════════════════
 *  BÓVEDA · El motor de propagación de fuente única.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Lee los valores VIGENTES de un tenant una vez por ventana de caché y
 *  devuelve un mapa ya formateado y con namespace, resuelto jerárquicamente.
 *  El mismo resolver le sirve a los tres consumidores:
 *
 *    · mensajes y plantillas   → render.ts        {precio.*} {valor.*}
 *    · prompts de agentes      → agent-inject.ts  bloque "DATOS VIGENTES"
 *    · contratos y documentos  → render.ts        {marca.*} {empresa.*}
 *
 *  Es la razón por la que cambiar un precio en un solo lugar lo cambia en
 *  todos: nadie más guarda una copia.
 *
 *  Portado de GARDEN `src/vault/resolver.ts` (219 líneas). Qué cambió:
 *
 *    · Los alcances bajaron de 4 a 2. `socio` y `propiedad` eran de Inperio
 *      Rooms; `scopeRank` pasó de cuatro niveles a dos.
 *    · `crm_pricing_refs` → `app.canonical_values`, vía `tenantDb(ctx)`: el
 *      filtro por tenant ya no se escribe a mano, no se puede omitir.
 *    · Se fue `resolveVaultForCompany()`: el puente `company_id` → `tenant_id`
 *      era una deuda de GARDEN. Aquí sólo existe `tenant_id`.
 *    · Se fue `white_label`: esa columna no existe en `app.tenants`. Los
 *      tokens de marca salen de `settings.marca`.
 */
import { tenantDb } from '@abraxa/db';
import type { TenantContext, VaultScope } from '@abraxa/db';
import { readCache, writeCache } from './cache';
import { formatMoney, formatVault } from './format';
import { loadTenantMeta } from './global-tables';
import type { ResolvedVault, VaultContext, VaultRow } from './types';
import { filas } from './rows';

/** Las columnas que necesita la resolución. `content` de documentos no entra aquí. */
const COLUMNS =
  'id, key, label, kind, value, value_text, value_json, currency, unit, note, ' +
  'area_slug, scope_type, scope_id, active, source_doc_id, position';

/** `VaultScope` (el contrato cruzado) → `VaultContext` (lo interno). */
export function scopeToContext(scope?: VaultScope): VaultContext {
  if (!scope || scope.type !== 'area') return {};
  return { area: scope.id ?? null };
}

/**
 * Prioridad del alcance según el contexto. Mayor gana; `-1` = no aplica.
 *
 * Un valor con `scope_type='area'` sólo compite cuando se está resolviendo
 * DENTRO de esa área. Fuera de ella no existe — que es justo lo que hace que
 * "la comisión de Ventas" no se filtre a un contrato de Finanzas.
 */
function scopeRank(row: VaultRow, ctx: VaultContext): number {
  switch (row.scope_type) {
    case 'area':
      return ctx.area && row.scope_id === ctx.area ? 2 : -1;
    case 'tenant':
      return 1;
    default:
      return -1;
  }
}

async function loadEntry(ctx: TenantContext) {
  const hit = readCache(ctx.tenantId);
  if (hit) return hit;

  const tenant = await loadTenantMeta(ctx);
  if (!tenant) return null;

  const { data, error } = await tenantDb(ctx)
    .from('canonical_values')
    .select(COLUMNS)
    .eq('active', true);

  if (error) {
    console.warn(`[vault] no se pudieron leer los valores: ${error.message}`);
    return null;
  }

  return writeCache(ctx.tenantId, filas<VaultRow>(data), tenant);
}

/**
 * Todos los valores vigentes del tenant, resueltos en el contexto dado.
 *
 * Devuelve `rows` (las filas ganadoras, para lógica que necesita el número
 * crudo) y `values` (el mapa de texto listo para interpolar).
 * `null` si el tenant no existe o la lectura falló — quien llama degrada.
 */
export async function resolveVault(
  ctx: TenantContext,
  vctx: VaultContext = {},
): Promise<ResolvedVault | null> {
  const entry = await loadEntry(ctx);
  if (!entry) return null;

  // 1) Una fila ganadora por clave, según la jerarquía de alcance.
  const winners = new Map<string, { row: VaultRow; rank: number }>();
  for (const row of entry.rows) {
    const rank = scopeRank(row, vctx);
    if (rank < 0) continue;
    const actual = winners.get(row.key);
    if (!actual || rank > actual.rank) winners.set(row.key, { row, rank });
  }

  const rows: Record<string, VaultRow> = {};
  const values: Record<string, string> = {};

  for (const [key, { row }] of winners) {
    rows[key] = row;
    values[`valor.${key}`] = formatVault(row);
    // {precio.*} es sólo dinero con monto: una plantilla de cotización que
    // escribe {precio.x} está pidiendo una cifra, no un texto.
    if (row.kind === 'money' && row.value != null) {
      values[`precio.${key}`] = formatMoney(row.value, row.currency);
    }
  }

  // 2) Marca y constantes de la empresa, desde `tenants.settings`.
  const settings = entry.tenant.settings ?? {};
  const marca = asRecord(settings.marca);
  for (const [k, v] of Object.entries(marca)) values[`marca.${k}`] = stringify(v);

  const empresa = { ...asRecord(settings.empresa), ...asRecord(settings.constants) };
  for (const [k, v] of Object.entries(empresa)) values[`empresa.${k}`] = stringify(v);

  // Siempre disponibles, aunque el emprendedor no haya configurado nada.
  values['empresa.nombre'] ??= entry.tenant.name;
  values['empresa.slug'] ??= entry.tenant.slug;

  // 3) Alias amigables: {comision} → valor.comision_pct.
  const alias = asRecord(settings.vault_aliases);
  for (const [nombre, destino] of Object.entries(alias)) {
    const target = String(destino ?? '');
    const v = values[target];
    if (v != null) values[nombre] = v;
  }

  return { tenant: entry.tenant, rows, values };
}

/**
 * Una sola clave, resuelta. Es lo que consume la tool `vault_value` del agente
 * cuando necesita el número exacto y no el bloque completo.
 */
export async function getVaultValue(
  ctx: TenantContext,
  key: string,
  vctx: VaultContext = {},
): Promise<
  | { found: false; key: string }
  | {
      found: true;
      key: string;
      formatted: string;
      raw: number | string | null;
      kind: string;
      label: string;
      note: string | null;
      scope: string;
    }
> {
  const resolved = await resolveVault(ctx, vctx);
  const row = resolved?.rows[key];
  if (!row) return { found: false, key };
  return {
    found: true,
    key,
    formatted: formatVault(row),
    raw: row.value ?? row.value_text ?? null,
    kind: row.kind,
    label: row.label,
    note: row.note,
    scope: row.scope_type === 'area' ? `área ${row.scope_id}` : 'toda la empresa',
  };
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function stringify(v: unknown): string {
  if (v == null) return '';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
