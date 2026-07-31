/**
 * Agrupación y progreso. Puro.
 *
 * En GARDEN esto vivía repartido entre `tasks-view.ts` (`groupTaskView`),
 * `tasks-meta.ts` (`groupKey`, `groupField`) y cada componente de vista, que
 * resolvía a mano la etiqueta y el orden de sus columnas. Por eso el tablero
 * por estado ordenaba distinto que la tabla agrupada por estado.
 *
 * Aquí las cuatro vistas piden sus columnas a la MISMA función. Cambiar la
 * agrupación de una vista es pasar otro `groupBy`, no escribir otra vista.
 */
import {
  PRIORITY_META,
  STATUS_META,
  TASK_PRIORITIES,
  TASK_STATUSES,
  isOpen,
  type Member,
  type Project,
  type SemanticTone,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from './types';
import type { GroupBy } from './view';

/** El bucket de "no tiene". Se pinta al final, siempre. */
export const SIN_VALOR = '__sin__';

/** Genérico en `T` para que agrupar no pierda las subtareas ya resueltas:
 *  la pantalla agrupa `TaskWithSubtasks` y quiere seguir teniéndolas. */
export interface TaskGroup<T extends Task = Task> {
  /** El valor de la propiedad de agrupación, o `SIN_VALOR`. */
  key: string;
  label: string;
  tone: SemanticTone;
  tasks: T[];
  /** `true` si arrastrar una tarjeta a este grupo tiene sentido. No lo tiene el
   *  grupo "sin proyecto" cuando el usuario ya está en un proyecto, ni ningún
   *  grupo cuando no hay agrupación. */
  droppable: boolean;
}

export function groupKeyOf(task: Task, groupBy: GroupBy): string {
  if (!groupBy) return 'todas';
  const v = task[groupBy];
  return v == null || v === '' ? SIN_VALOR : String(v);
}

export interface GroupContext {
  projects?: Project[];
  members?: Member[];
}

/** El nombre humano de una clave de grupo. Es el reemplazo de `companyBrand()`
 *  de GARDEN, que traía los ids de las empresas escritos en el código: aquí
 *  todo sale de los datos que ya se cargaron. */
export function groupLabelOf(key: string, groupBy: GroupBy, ctx: GroupContext = {}): string {
  if (!groupBy) return 'Todas';
  if (key === SIN_VALOR) {
    return {
      status: 'Sin estado',
      priority: 'Sin prioridad',
      assigned_to: 'Sin responsable',
      project_id: 'Sin proyecto',
    }[groupBy];
  }
  if (groupBy === 'status') return STATUS_META[key as TaskStatus]?.label ?? key;
  if (groupBy === 'priority') return PRIORITY_META[key as TaskPriority]?.label ?? key;
  if (groupBy === 'project_id') return ctx.projects?.find((p) => p.id === key)?.name ?? 'Proyecto';
  // Responsable: el nombre si el tenant lo tiene, si no el correo tal cual.
  const m = ctx.members?.find((x) => x.email === key);
  return m?.name?.trim() || key;
}

function toneOf(key: string, groupBy: GroupBy): SemanticTone {
  if (key === SIN_VALOR) return 'secondary';
  if (groupBy === 'status') return STATUS_META[key as TaskStatus]?.tone ?? 'outline';
  if (groupBy === 'priority') return PRIORITY_META[key as TaskPriority]?.tone ?? 'outline';
  return 'outline';
}

/**
 * El orden de las columnas. Fijo donde hay un orden natural (estado, prioridad)
 * y por datos donde lo hay (proyectos por `position`, miembros por su lista).
 *
 * Y siempre: los grupos declarados aparecen **aunque estén vacíos**. Una
 * columna "Bloqueada" que desaparece cuando no hay nada bloqueado es una
 * columna a la que no se puede arrastrar — y arrastrar ahí es justamente cómo
 * se bloquea una tarea.
 */
function ordenDeclarado(groupBy: GroupBy, ctx: GroupContext): string[] {
  if (groupBy === 'status') return TASK_STATUSES.filter((s) => s !== 'cancelled');
  if (groupBy === 'priority') return [...TASK_PRIORITIES];
  if (groupBy === 'project_id') {
    return [...(ctx.projects ?? [])]
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'es'))
      .map((p) => p.id);
  }
  if (groupBy === 'assigned_to') return (ctx.members ?? []).map((m) => m.email);
  return [];
}

export function buildGroups<T extends Task>(
  tasks: T[],
  groupBy: GroupBy,
  ctx: GroupContext = {},
): Array<TaskGroup<T>> {
  if (!groupBy) {
    return [{ key: 'todas', label: 'Todas', tone: 'outline', tasks, droppable: false }];
  }

  const buckets = new Map<string, T[]>();
  for (const key of ordenDeclarado(groupBy, ctx)) buckets.set(key, []);

  for (const task of tasks) {
    const key = groupKeyOf(task, groupBy);
    const b = buckets.get(key);
    if (b) b.push(task);
    else buckets.set(key, [task]);
  }

  // El bucket "sin valor" se saca y se vuelve a poner al final: si apareció en
  // medio porque una tarea sin responsable llegó primero, quedaría intercalado.
  const sin = buckets.get(SIN_VALOR);
  buckets.delete(SIN_VALOR);

  const grupos: Array<TaskGroup<T>> = [...buckets.entries()].map(([key, list]) => ({
    key,
    label: groupLabelOf(key, groupBy, ctx),
    tone: toneOf(key, groupBy),
    tasks: list,
    droppable: true,
  }));

  // "Sin responsable" y "sin proyecto" SÍ aceptan tarjetas: desasignar
  // arrastrando es la manera natural de soltar algo que ya no es de nadie.
  // "Sin estado" y "sin prioridad" no: la columna no existe como valor.
  const aceptaVacio = groupBy === 'assigned_to' || groupBy === 'project_id';
  if (sin?.length || aceptaVacio) {
    grupos.push({
      key: SIN_VALOR,
      label: groupLabelOf(SIN_VALOR, groupBy, ctx),
      tone: 'secondary',
      tasks: sin ?? [],
      droppable: aceptaVacio,
    });
  }

  return grupos;
}

/** Qué campo cambia al soltar una tarjeta en otra columna, y con qué valor.
 *  `null` significa "esta columna no acepta". */
export function dropPatch(groupBy: GroupBy, groupKey: string): Partial<Task> | null {
  if (!groupBy) return null;
  const valor = groupKey === SIN_VALOR ? null : groupKey;

  if (groupBy === 'status') return valor ? { status: valor as TaskStatus } : null;
  if (groupBy === 'priority') return valor ? { priority: valor as TaskPriority } : null;
  if (groupBy === 'assigned_to') return { assigned_to: valor };
  return { project_id: valor };
}

// ════════════════════════════════════════════════════════════════════════════
// Progreso
// ════════════════════════════════════════════════════════════════════════════

export interface Progress {
  total: number;
  done: number;
  open: number;
  /** 0–100, entero. `0` cuando no hay nada: un 100% sobre cero tareas es la
   *  clase de dato que hace que alguien deje de creerle al panel. */
  pct: number;
}

export function progressOf(tasks: readonly Task[]): Progress {
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === 'completed').length;
  const open = tasks.filter((t) => isOpen(t.status)).length;
  return { total, done, open, pct: total === 0 ? 0 : Math.round((done / total) * 100) };
}

// ════════════════════════════════════════════════════════════════════════════
// Posición al soltar — el número que después persiste el reorder
// ════════════════════════════════════════════════════════════════════════════

/**
 * El `sort_order` que le toca a una tarjeta soltada en la posición `index` de
 * una columna: el punto medio entre sus dos nuevos vecinos.
 *
 * Es un promedio y no una renumeración porque una renumeración son N
 * escrituras por cada arrastre, y con dos personas moviendo el mismo tablero,
 * N escrituras es N oportunidades de pisarse.
 */
export function sortOrderFor(vecinos: readonly Task[], index: number): number {
  const antes = index > 0 ? vecinos[index - 1] : undefined;
  const despues = index < vecinos.length ? vecinos[index] : undefined;

  if (!antes && !despues) return 0;
  if (!antes) return (despues as Task).sort_order - 1;
  if (!despues) return antes.sort_order + 1;
  return (antes.sort_order + despues.sort_order) / 2;
}
