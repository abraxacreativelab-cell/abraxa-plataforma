/**
 * `app.subscriptions` tiene `tenant_id`, así que se declara como tabla de
 * dominio: quien la consulte con una sesión de por medio —el panel de H14, o
 * una pantalla de "tu plan" dentro del producto— entra por `tenantDb(ctx)` y
 * hereda el filtro sin poder olvidarlo.
 *
 * Este paquete NO la usa por esa vía: la escribe desde el webhook, donde no
 * hay sesión de nadie (ver store.ts). Se declara para los demás.
 *
 * `app.plans` y `app.billing_events` no van aquí: son globales, sin
 * `tenant_id` que filtrar. Se tocan con `adminDb()` desde store.ts.
 */
declare module '@abraxa/db/tables' {
  interface DomainTableRegistry {
    subscriptions: true;
  }
}

export {};
