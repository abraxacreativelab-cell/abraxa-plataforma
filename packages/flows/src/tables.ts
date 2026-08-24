/**
 * Las cuatro tablas de H8, dadas de alta en el registro de `@abraxa/db`.
 *
 * Sin esta declaración `tenantDb(ctx).from('flows')` no compila, y eso es a
 * propósito: una tabla que nadie declaró como aislada por tenant no debería ser
 * alcanzable por la vía aislada.
 *
 * ── Por qué es `.ts` y no `.d.ts`, aunque H1 documente el `.d.ts` ──────────
 *
 * Porque nadie importa una declaración suelta. El tsconfig de los paquetes de
 * backend la alcanza por su glob, pero el de `apps/web` **sólo compila lo que
 * llega por un import**, y la pantalla de automatizaciones importa este
 * paquete. Con un `.d.ts` huérfano, `npm run typecheck:web` reventaba con 22
 * errores de `store.ts` — el registro de tablas no existía en ESE programa.
 *
 * `types.ts` hace `import './tables'` para traerla, que es la misma solución
 * que dejó escrita H4 en `packages/vault/src/tables.ts`.
 *
 * Ver CONTRIBUTING.md § El aislamiento entre clientes.
 */
// `export {}` convierte este archivo en MÓDULO, y eso es lo que hace que el
// `declare module` de abajo sea una AUMENTACIÓN —las interfaces se fusionan— y
// no una declaración de módulo AMBIENTE, que SUSTITUIRÍA al registro de H1.
//
// No es teórico: sin esta línea, `npm run typecheck` pasaba aquí y reventaba
// con 40 errores en packages/vault y packages/work — sus tablas desaparecían
// del registro porque este archivo lo reemplazaba entero. H6 y H9 dejaron el
// mismo comentario en los suyos; ésta fue la vez que faltó.
export {};

declare module '@abraxa/db/tables' {
  interface DomainTableRegistry {
    flows: true;
    flow_versions: true;
    flow_runs: true;
    flow_steps: true;
  }
}
