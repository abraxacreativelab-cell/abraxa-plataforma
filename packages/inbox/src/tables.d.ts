/**
 * Las tablas de H6, dadas de alta en el registro de `@abraxa/db`.
 *
 * Sin esta declaración `tenantDb(ctx).from('threads')` no compila, y eso es a
 * propósito: una tabla que nadie declaró como aislada por tenant no debería ser
 * alcanzable por la vía aislada.
 */
// `export {}` convierte este archivo en MÓDULO, que es lo que hace que el
// `declare module` de abajo sea una AUMENTACIÓN (las interfaces se fusionan) y
// no una declaración de módulo ambiente, que sustituiría a la de H1 y borraría
// `memberships` y `area_grants` del registro.
export {};

declare module '@abraxa/db/tables' {
  interface DomainTableRegistry {
    channels: true;
    threads: true;
    messages: true;
  }
}
