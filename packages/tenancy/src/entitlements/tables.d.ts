/**
 * Las tablas de H16 que se tocan por la vía aislada.
 *
 * Declararlas aquí es lo que hace que `tenantDb(ctx).from('feature_pauses')`
 * compile. Sin este archivo el compilador frena, y eso es a propósito: una
 * tabla que nadie declaró como aislada por tenant no debería ser alcanzable por
 * la vía que aísla.
 *
 * ── Por qué está aquí y no en `src/tables.d.ts` ────────────────────────────
 *
 * Porque ese archivo es de H2 y este subárbol es de H16. TypeScript fusiona las
 * dos augmentaciones del mismo módulo sin que ninguno de los dos carriles tenga
 * que tocar el archivo del otro — que es exactamente la propiedad que hace
 * posible que H16 viva dentro de `packages/tenancy` sin colisionar.
 *
 * ── `tenant_entitlements_effective` es una VISTA, no una tabla ─────────────
 *
 * Y se declara igual, a propósito. PostgREST no distingue: expone las dos por
 * nombre. Lo que importa para el aislamiento es que la vista TIENE `tenant_id`,
 * así que el `.eq('tenant_id', …)` que `tenantDb()` pone solo la acota igual
 * que a cualquier tabla. Una vista sin `tenant_id` no podría estar en esta
 * lista, y ése es justo el filtro que se quiere.
 *
 * NO van aquí `app.features` ni `app.plan_features`: son catálogo de la
 * plataforma, no tienen `tenant_id` que filtrar, y su migración las declara
 * `-- tenantless:`. Se leen a través de la vista, ya acotadas.
 */
declare module '@abraxa/db/tables' {
  interface DomainTableRegistry {
    /** Vista: la resolución de tres saltos, evaluada en SQL. Ver migración 130. */
    tenant_entitlements_effective: true;
    /** La excepción por cliente. Se escribe desde el panel de H14. */
    tenant_entitlements: true;
    /** Pausas vivas e históricas. Pausar, nunca borrar. */
    feature_pauses: true;
    /** Bitácora de cambios de plan, con sus efectos resueltos. */
    plan_changes: true;
    /** Trabajos que no se corrieron, y por qué. */
    plan_skips: true;
  }
}

export {};
