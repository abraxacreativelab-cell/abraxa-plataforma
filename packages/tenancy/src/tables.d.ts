/**
 * Las tablas de H2 que se tocan por la vía aislada.
 *
 * Declararlas aquí es lo que hace que `tenantDb(ctx).from('invitations')`
 * compile. Sin este archivo el compilador frena, y eso es a propósito: una
 * tabla que nadie declaró como aislada por tenant no debería ser alcanzable
 * por la vía que aísla.
 *
 * NO van aquí las tablas globales — `app.users`, `app.plans`, `app.tenants` —
 * porque no tienen `tenant_id` que filtrar. Se tocan con `adminDb()` desde
 * `src/db/`, con su razón escrita, y su migración las declara `-- tenantless:`.
 */
/*
 * El `export {}` de abajo no es adorno.
 *
 * Sin él, este archivo es un script global y `declare module '…'` significa
 * "declaro un módulo ambiente" — es decir, REEMPLAZA la definición de
 * @abraxa/db/tables en vez de ampliarla, y `DomainTableRegistry` se queda sin
 * las tablas de H1. Con él, el archivo es un módulo y `declare module` pasa a
 * ser una augmentación, que es lo que se busca.
 */
declare module '@abraxa/db/tables' {
  interface DomainTableRegistry {
    invitations: true;
    tenant_events: true;
  }
}

export {};
