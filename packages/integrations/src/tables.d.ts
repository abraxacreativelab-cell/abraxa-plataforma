/**
 * Las tablas de H17 con `tenant_id`, dadas de alta en el registro de `@abraxa/db`.
 *
 * Sin esta declaración, `tenantDb(ctx).from('tenant_integrations')` no compila
 * — y eso es a propósito: una tabla que nadie declaró como aislada por tenant
 * no debería ser alcanzable por la vía aislada.
 *
 * Las dos llevan `tenant_id NOT NULL REFERENCES app.tenants(id)` y RLS activo
 * desde la migración que las crea (140 y 141). Ninguna es global: una
 * credencial siempre es de alguien.
 */
export {};

declare module '@abraxa/db/tables' {
  interface DomainTableRegistry {
    tenant_integrations: true;
    integration_events: true;
  }
}
