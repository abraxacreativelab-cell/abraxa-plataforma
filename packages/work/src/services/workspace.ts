/**
 * Todo lo que necesita la pantalla, en una sola pasada.
 *
 * Las cuatro vistas se alimentan del MISMO conjunto: filtrar, agrupar y contar
 * pasan en memoria. Por eso cambiar de pestaña es instantáneo y por eso el
 * filtro sobrevive al cambio — no hay una petición por vista que pueda volver
 * con otra cosa.
 *
 * En GARDEN cada vista pedía lo suyo, y por eso el tablero y la tabla podían
 * enseñar conteos distintos de las mismas tareas durante unos segundos.
 */
import type { TenantContext } from '@abraxa/db';
import type { Member, Project, Task } from '../domain/types';
import type { SavedView } from '../domain/view';
import { listMembers } from './members';
import { listProjects } from './projects';
import { listTasks } from './tasks';
import { listViews } from './views';

export interface Workspace {
  tasks: Task[];
  projects: Project[];
  members: Member[];
  views: SavedView[];
  /** Se alcanzó el tope de lectura y hay tareas que no se trajeron. Se dice: un
   *  límite silencioso hace que la pantalla jure que ésas son todas. */
  truncated: boolean;
  /** La lista del equipo no es la de verdad (falta H2 o su lectura falló). */
  teamDegraded: boolean;
}

export async function loadWorkspace(ctx: TenantContext): Promise<Workspace> {
  // En paralelo: son cuatro lecturas independientes y la pantalla no puede
  // pintar sin las cuatro. En serie serían cuatro viajes de ida y vuelta.
  const [tareas, projects, views, equipo] = await Promise.all([
    listTasks(ctx),
    listProjects(ctx),
    listViews(ctx),
    listMembers(ctx),
  ]);

  return {
    tasks: tareas.tasks,
    projects,
    views,
    members: equipo.members,
    truncated: tareas.truncated,
    teamDegraded: equipo.degraded,
  };
}
