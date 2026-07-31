/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El ÚNICO archivo de la bóveda que toca datos fuera de `tenantDb(ctx)`.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Está aislado a propósito: `adminDb()` no lleva filtro de tenant, así que
 *  todo lo que lo use tiene que caber en una pantalla y justificarse solo.
 *
 *  Dos usos, los dos legítimos y los dos declarados en el propio mensaje de la
 *  regla de ESLint que permite `adminDb()` para tablas globales:
 *
 *  1. `app.tenants` — de donde salen los namespaces `{empresa.*}` y `{marca.*}`.
 *
 *     No se puede leer con `tenantDb(ctx)`: ese helper agrega
 *     `.eq('tenant_id', …)` y la llave de aislamiento de `tenants` es `id`, no
 *     `tenant_id`. Aquí el filtro se escribe a mano —`.eq('id', ctx.tenantId)`—
 *     y se toma del CONTEXTO VERIFICADO, nunca de un parámetro del llamador.
 *
 *     Sería más limpio que `TenantContext` trajera `settings` y este archivo no
 *     existiera. Está pedido a H1/H2 en el PR; el día que llegue, esto se borra
 *     y `resolver.ts` cambia una línea.
 *
 *  2. `app.industry_templates` — catálogo de la plataforma, sin `tenant_id`,
 *     igual para todos los clientes. Declarado `-- tenantless:` en la 033.
 */
import { adminDb } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import type { TenantMeta } from './types';

interface TenantRowRaw {
  id: string;
  slug: string;
  name: string;
  industry_type: string | null;
  settings: Record<string, unknown> | null;
}

/**
 * Metadatos del tenant del contexto.
 *
 * `ctx.tenantId` ya viene de una sesión verificada (`TenancyPort.contextFor`),
 * así que el `.eq('id', …)` de abajo es tan estrecho como un `tenantDb`.
 */
export async function loadTenantMeta(ctx: TenantContext): Promise<TenantMeta | null> {
  const { data, error } = await adminDb()
    .from('tenants')
    .select('id, slug, name, industry_type, settings')
    .eq('id', ctx.tenantId)
    .maybeSingle();

  if (error) {
    console.warn(`[vault] no se pudo leer el tenant: ${error.message}`);
    return null;
  }
  if (!data) return null;

  const row = data as TenantRowRaw;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    industryType: row.industry_type ?? null,
    settings: (row.settings ?? {}) as Record<string, unknown>,
  };
}

export interface IndustryTemplateRaw {
  id: string;
  name: string;
  blurb: string;
  areas: unknown;
  expected_docs: unknown;
  expected_values: unknown;
  position: number;
}

/** Una plantilla de giro por id. `null` si el id no existe en el catálogo. */
export async function loadIndustryTemplate(id: string): Promise<IndustryTemplateRaw | null> {
  const { data, error } = await adminDb()
    .from('industry_templates')
    .select('id, name, blurb, areas, expected_docs, expected_values, position')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.warn(`[vault] no se pudo leer el giro '${id}': ${error.message}`);
    return null;
  }
  return (data as IndustryTemplateRaw | null) ?? null;
}

/** El catálogo completo. Lo consume H7 para preguntar "¿a qué te dedicas?". */
export async function listIndustryTemplates(): Promise<IndustryTemplateRaw[]> {
  const { data, error } = await adminDb()
    .from('industry_templates')
    .select('id, name, blurb, areas, expected_docs, expected_values, position')
    .order('position');

  if (error) {
    console.warn(`[vault] no se pudo listar el catálogo de giros: ${error.message}`);
    return [];
  }
  return (data ?? []) as IndustryTemplateRaw[];
}
