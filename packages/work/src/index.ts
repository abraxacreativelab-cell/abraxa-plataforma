/**
 * @abraxa/work — Tareas y proyectos (H9)
 *
 * Donde el emprendedor y su equipo ven qué hay que hacer. Cuatro vistas —
 * proyecto, responsable, calendario y progreso— sobre el mismo conjunto de
 * tareas, con filtros que se prenden y apagan, jerarquía configurable por vista
 * y vistas guardadas que se pueden compartir.
 *
 * Portado de GARDEN y sobre todo RESTADO: allá eran siete vistas, un tablero
 * por empresa de 678 líneas y un `workspace.tsx` de mil. Aquí no existe
 * "empresa" —el usuario tiene una— y los hitos son del roadmap del negocio
 * (H11), no de las tareas.
 *
 * ── El mapa ────────────────────────────────────────────────────────────────
 *
 *   domain/     lógica pura y probada: filtros, orden, agrupación, calendario,
 *               jerarquía, el guard 409 y el estado de la pantalla.
 *   data/       el puente a las dos funciones transaccionales de la 070 y la
 *               traducción de errores de Postgres a errores de dominio.
 *   services/   el trabajo real, siempre por `tenantDb(ctx)`.
 *   routes.ts   la API. `apps/api` la monta en `/work`.
 *
 * La pantalla vive en `apps/web/app/(app)/tareas/` y llama a `services/` en
 * proceso, no por HTTP.
 */
// `tables.d.ts` aumenta `DomainTableRegistry` de `@abraxa/db`, y una
// aumentación sólo aplica si su archivo está DENTRO del programa. El proyecto
// de Node lo recoge por glob (`packages/*/src/**/*.ts`), pero el de `apps/web`
// llega hasta aquí siguiendo un import y nunca vería el `.d.ts` suelto: sin
// esta referencia, `tenantDb(ctx).from('tasks')` no compila en `typecheck:web`.
//
// La regla de ESLint pide un `import` en su lugar, y no aplica: un `.d.ts` no
// se puede importar sin renombrarlo a `.ts`, y el nombre `tables.d.ts` es la
// convención que documenta `packages/db/src/tables.ts` y que sigue H3.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./tables.d.ts" />
import { registerPort } from '@abraxa/db';
import { workPort } from './port';

// Registrado al importar el paquete. `apps/api` lo importa al arrancar, así que
// H8 y H3 encuentran `usePort('work')` listo sin que nadie edite un cableado
// central.
registerPort('work', workPort);

export { router } from './routes';
export { meta } from './meta';
export { workPort };

// ── Dominio (puro — lo consume también la pantalla) ─────────────────────────
export * from './domain/types';
export * from './domain/view';
export * from './domain/group';
export * from './domain/calendar';
export * from './domain/hierarchy';
export * from './domain/reorder';
export * from './domain/workspace-state';
export * from './domain/format';

// ── Servicios (servidor) ────────────────────────────────────────────────────
export * as projectService from './services/projects';
export * as taskService from './services/tasks';
export * as viewService from './services/views';
export { listMembers, type MemberList } from './services/members';
export { loadWorkspace, type Workspace } from './services/workspace';
