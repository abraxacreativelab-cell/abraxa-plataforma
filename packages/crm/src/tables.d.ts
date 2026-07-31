/**
 * Las tablas de H15 con `tenant_id`, dadas de alta en el registro de `@abraxa/db`.
 *
 * Sin esta declaración, `tenantDb(ctx).from('contacts')` no compila — y eso es
 * a propósito: una tabla que nadie declaró como aislada por tenant no debería
 * ser alcanzable por la vía aislada.
 *
 * Las siete llevan `tenant_id NOT NULL REFERENCES app.tenants(id)` y RLS activo
 * desde la migración que las crea (120, 121, 122). Ninguna es global, así que
 * `adminDb()` no aparece en este paquete ni una vez.
 */
// `export {}` convierte este archivo en MÓDULO, que es lo que hace que el
// `declare module` de abajo sea una AUMENTACIÓN (las interfaces se fusionan) y
// no una declaración de módulo ambiente (que sustituiría a la de H1 y borraría
// `memberships` y `area_grants` del registro).
export {};

declare module '@abraxa/db/tables' {
  interface DomainTableRegistry {
    contacts: true;
    contact_identities: true;
    contact_tags: true;
    contact_merges: true;
    contact_events: true;
    pipelines: true;
    pipeline_stages: true;
    contact_stages: true;
  }
}
