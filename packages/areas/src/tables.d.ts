/**
 * Las tablas de H11, dadas de alta en el registro de `@abraxa/db`.
 *
 * Sin esta declaración `tenantDb(ctx).from('tenant_areas')` no compila, y eso
 * es a propósito: una tabla que nadie declaró como aislada por tenant no
 * debería ser alcanzable por la vía aislada.
 *
 * Las tres llevan `tenant_id` y RLS desde la migración 090.
 *
 * `app.area_catalog` NO está aquí, y no es un olvido: es catálogo de la
 * plataforma —el mismo para todos los clientes, como `app.industry_templates`—
 * y por eso no tiene `tenant_id` que filtrar. Se lee con `adminDb()` desde
 * `data/`, que es donde ESLint sí lo permite, con la razón escrita al lado.
 */
// `export {}` convierte este archivo en MÓDULO, que es lo que hace que el
// `declare module` de abajo sea una AUMENTACIÓN (las interfaces se fusionan) y
// no una declaración ambiente que sustituiría al registro de H1.
export {};

declare module '@abraxa/db/tables' {
  interface DomainTableRegistry {
    tenant_areas: true;
    tenant_milestones: true;
    area_onboarding_runs: true;
  }
}
