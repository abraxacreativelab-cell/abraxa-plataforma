/**
 * Las tablas de H7 con `tenant_id`, dadas de alta en el registro de `@abraxa/db`.
 *
 * Sin esta declaración `tenantDb(ctx).from('onboarding_sessions')` no compila, y
 * eso es a propósito: una tabla que nadie declaró como aislada por tenant no
 * debería ser alcanzable por la vía aislada.
 *
 * `app.tenants` NO va aquí: su llave de aislamiento es `id`, no `tenant_id`, y
 * por eso se toca con `adminDb()` desde synthesis/industria.ts, con su razón
 * escrita.
 */
// `export {}` convierte este archivo en MÓDULO, que es lo que hace que el
// `declare module` de abajo sea una AUMENTACIÓN (las interfaces se fusionan) y
// no una declaración ambiente que sustituiría a la de H1.
export {};

declare module '@abraxa/db/tables' {
  interface DomainTableRegistry {
    onboarding_sessions: true;
    onboarding_blueprints: true;
  }
}
