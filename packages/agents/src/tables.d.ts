/**
 * Las tablas de H3 con `tenant_id`, dadas de alta en el registro de `@abraxa/db`.
 *
 * Sin esta declaración, `tenantDb(ctx).from('usage_ledger')` no compila — y eso
 * es a propósito: una tabla que nadie declaró como aislada por tenant no
 * debería ser alcanzable por la vía aislada.
 *
 * NO van aquí (son globales, se tocan con `adminDb()` y su migración lo declara
 * con `-- tenantless:`):
 *   · app.model_pricing      catálogo de precios de la plataforma
 *   · app.agent_plan_limits  catálogo de límites por plan
 */
// `export {}` convierte este archivo en MÓDULO, que es lo que hace que el
// `declare module` de abajo sea una AUMENTACIÓN (las interfaces se fusionan) y
// no una declaración de módulo ambiente (que sustituiría a la de H1 y borraría
// `memberships` y `area_grants` del registro).
export {};

declare module '@abraxa/db/tables' {
  interface DomainTableRegistry {
    agent_definitions: true;
    agent_messages: true;
    usage_ledger: true;
    agent_budget_overrides: true;
  }
}
