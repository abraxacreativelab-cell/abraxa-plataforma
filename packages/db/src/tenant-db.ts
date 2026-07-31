import type { TenantContext } from '../ports';
import { serviceClient } from './client';
import { PlatformError } from './errors';
import type { DomainTable } from './tables';

/** Opciones de conteo de PostgREST. */
export interface SelectOptions {
  head?: boolean;
  count?: 'exact' | 'planned' | 'estimated';
}

/**
 * Escribe `tenant_id` en cada fila, PISANDO lo que venga.
 *
 * Pisar y no rellenar es la decisión importante: si un payload de la red trae
 * `tenant_id` de otra empresa, aquí muere. Rellenar sólo cuando falta dejaría
 * abierta esa puerta.
 */
export function stampTenant<T extends Record<string, unknown>>(
  rows: T | T[],
  tenantId: string,
): Array<T & { tenant_id: string }> {
  const list = Array.isArray(rows) ? rows : [rows];
  return list.map((r) => ({ ...r, tenant_id: tenantId }));
}

/**
 * Quita `tenant_id` de un patch de UPDATE.
 * Una fila no se muda de empresa. Si alguien lo intenta, se ignora en silencio
 * en vez de mover el dato a otro cliente.
 */
export function stripTenant<T extends Record<string, unknown>>(patch: T): Omit<T, 'tenant_id'> {
  const { tenant_id: _descartado, ...resto } = patch as T & { tenant_id?: unknown };
  return resto as Omit<T, 'tenant_id'>;
}

/**
 * Tabla ya acotada al tenant. El tipo se INFIERE de la implementación a
 * propósito: escribirlo a mano ataría este paquete a la firma interna de
 * postgrest-js, que cambia entre versiones menores.
 */
function scoped(table: DomainTable, tenantId: string) {
  // Un builder nuevo por operación: los de PostgREST llevan estado de URL y
  // reusarlos entre llamadas mezcla filtros de consultas distintas.
  const t = () => serviceClient().from(table);

  return {
    /** SELECT ya filtrado por `tenant_id`. Encadena `.eq()`, `.order()`, etc. */
    select: <Q extends string = '*'>(columns?: Q, options?: SelectOptions) =>
      t()
        .select(columns ?? ('*' as Q), options)
        .eq('tenant_id', tenantId),

    /** INSERT con `tenant_id` estampado. */
    insert: (rows: Record<string, unknown> | Array<Record<string, unknown>>) =>
      t().insert(stampTenant(rows, tenantId)),

    upsert: (
      rows: Record<string, unknown> | Array<Record<string, unknown>>,
      options?: { onConflict?: string; ignoreDuplicates?: boolean },
    ) => t().upsert(stampTenant(rows, tenantId), options),

    /** UPDATE filtrado por `tenant_id`, y sin poder cambiarlo. */
    update: (patch: Record<string, unknown>) =>
      t().update(stripTenant(patch)).eq('tenant_id', tenantId),

    /** DELETE filtrado por `tenant_id`. */
    delete: () => t().delete().eq('tenant_id', tenantId),
  };
}

export type TenantScopedTable = ReturnType<typeof scoped>;

export interface TenantDb {
  readonly tenantId: string;
  from(table: DomainTable): TenantScopedTable;
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  LA ÚNICA VÍA de acceso a datos de dominio.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * GARDEN dejó 145 de 170 tablas sin RLS, y el aislamiento entre clientes
 * colgaba de 447 `.eq('tenant_id', …)` escritos a mano. Basta que UNO falte
 * para que un cliente vea los datos de otro.
 *
 * Aquí el filtro no se escribe: no se puede omitir. Olvidarlo no es un bug que
 * se descubre en producción, es un `from()` que no existe.
 *
 *   const { data } = await tenantDb(ctx).from('threads').select('*').eq('status', 'open');
 *
 * Las filas las tipa cada paquete con sus propias interfaces: no hay un
 * `Database` generado central, justamente para que 14 conversaciones no tengan
 * que regenerarlo cada vez que alguien agrega una tabla.
 *
 * Para dar de alta tenants o tocar tablas globales, `adminDb()` — a la vista y
 * con su razón escrita.
 */
export function tenantDb(ctx: TenantContext): TenantDb {
  const tenantId = ctx?.tenantId;
  if (!tenantId || typeof tenantId !== 'string') {
    throw new PlatformError(
      'FORBIDDEN',
      'tenantDb() sin tenantId. El contexto se arma con TenancyPort.contextFor() ' +
        'desde una sesión verificada, nunca desde un header del navegador.',
    );
  }

  return {
    tenantId,
    from: (table) => scoped(table, tenantId),
  };
}
