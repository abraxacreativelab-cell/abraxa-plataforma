/**
 * `@abraxa/work/domain` — la lógica pura, sin servidor.
 *
 * Existe como entrada aparte por una razón concreta: `@abraxa/work` arrastra
 * Express (las rutas) y `@abraxa/db` (que a su vez arrastra el cliente de
 * Supabase). Nada de eso tiene por qué viajar al navegador para que una
 * tarjeta sepa de qué color va su prioridad.
 *
 * Los componentes de cliente de `apps/web/app/(app)/tareas/` importan de aquí.
 * El servidor importa de `@abraxa/work`, que también reexporta todo esto.
 *
 * REGLA: ningún archivo bajo `domain/` puede importar `@abraxa/db`, `express`
 * ni nada de `services/`. Es lo que mantiene este punto de entrada limpio, y lo
 * verifica `domain/purity.test.ts`.
 */
export * from './types';
export * from './view';
export * from './group';
export * from './calendar';
export * from './hierarchy';
export * from './reorder';
export * from './workspace-state';
export * from './format';
