/**
 * Qué recibe CADA vista. Puro.
 *
 * ── Por qué esto es una función y no tres `useMemo` en la pantalla ──────────
 *
 * Las cuatro vistas comparten filtro, orden y datos, pero NO comparten forma:
 * el tablero, la lista y el progreso dibujan columnas de tarjetas con sus
 * subtareas colgadas; el calendario dibuja días, y en un día no cabe una
 * jerarquía — cabe lo que vence ese día.
 *
 * Mientras esa decisión vivió repartida en la pantalla, al calendario le
 * llegaba el ÁRBOL. Y el árbol no contiene subtareas: las tiene colgadas dentro
 * de sus padres. El resultado era que ninguna subtarea aparecía en el
 * calendario — ni en su día, ni en la franja de vencidas, ni en la de sin
 * fecha— aunque tuviera su propia fecha de entrega, que es exactamente lo que
 * el encabezado de `calendar.tsx` promete que no pasa. Peor: la fecha de una
 * subtarea sólo se puede poner arrastrándola en el calendario, así que la
 * subtarea sin fecha no tenía forma de conseguir una.
 *
 * Aquí las dos superficies salen del MISMO filtro y cada una se queda con la
 * forma que le toca. Que sea una sola función es lo que permite probar de un
 * jalón la propiedad que importa: **una tarea visible aparece en alguna parte
 * de cualquier vista**. Ninguna se puede caer entre las dos formas.
 */
import { buildGroups, type GroupContext, type TaskGroup } from './group';
import { buildVisibleTree } from './hierarchy';
import type { Task, TaskWithSubtasks } from './types';
import { applyView, type ViewConfig } from './view';

export interface Surfaces {
  /**
   * Lo que pasa el filtro, plano y ya ordenado. Es la cuenta que se enseña al
   * pie ("18 de 40 tareas con los filtros puestos") y la base de las otras dos.
   */
  visible: Task[];
  /** Las columnas: tablero, lista y progreso. Con las subtareas colgadas de su
   *  padre — salvo las que caen en otra columna, que salen a flote. */
  groups: Array<TaskGroup<TaskWithSubtasks>>;
  /**
   * Las tarjetas del calendario: PLANAS, padres y subtareas por igual.
   *
   * Un padre que vence el 10 y su subtarea que vence el 20 son dos cosas en dos
   * días distintos. Colgar la segunda de la primera la borra del calendario.
   */
  calendar: Task[];
}

export function buildSurfaces(
  all: readonly Task[],
  config: ViewConfig,
  ctx: GroupContext = {},
  now = new Date(),
): Surfaces {
  const visible = applyView([...all], config, now);
  const tree = buildVisibleTree(all, visible, { splitBy: config.groupBy });

  return {
    visible,
    groups: buildGroups(tree, config.groupBy, ctx),
    // Sin aplanar el árbol y sin volver a filtrar: `visible` YA es la lista
    // plana de lo que pasa el filtro. Aplanar el árbol traería de vuelta las
    // subtareas que el filtro descartó —las que sólo siguen ahí para que el
    // contador del padre diga la verdad— y el calendario pintaría tareas
    // completadas con el filtro "abiertas" puesto.
    calendar: visible,
  };
}
