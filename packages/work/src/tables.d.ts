/**
 * Las tablas de H9, dadas de alta en el registro de `@abraxa/db`.
 *
 * Sin esta declaración `tenantDb(ctx).from('tasks')` no compila, y eso es a
 * propósito: una tabla que nadie declaró como aislada por tenant no debería ser
 * alcanzable por la vía aislada.
 *
 * Las cinco llevan `tenant_id` y RLS desde la migración 070. Aquí no hay
 * ninguna tabla global: un catálogo de estados o de prioridades sería una tabla
 * de la plataforma, y esos viven como constantes en `domain/types.ts` porque no
 * se configuran por cliente.
 */
// `export {}` convierte este archivo en MÓDULO, que es lo que hace que el
// `declare module` de abajo sea una AUMENTACIÓN (las interfaces se fusionan) y
// no una declaración ambiente que sustituiría al registro de H1.
export {};

declare module '@abraxa/db/tables' {
  interface DomainTableRegistry {
    projects: true;
    tasks: true;
    task_comments: true;
    task_events: true;
    task_views: true;
  }
}
