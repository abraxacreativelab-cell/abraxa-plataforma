/**
 * La jerarquía Proyecto → Tarea → Subtarea, del lado del código.
 *
 * La base de datos ya impone que sea de un solo nivel (trigger
 * `tasks_guard_hierarchy` de la 070). Esto es lo que necesita el producto por
 * encima: armar el árbol, saber qué está abierto y decidir el 409.
 *
 * Todo puro para que el guard de las subtareas abiertas —el comportamiento que
 * el handoff pide conservar textualmente— se pueda probar sin una base viva.
 */
import { isOpen, type Task, type TaskWithSubtasks } from './types';

/** Las subtareas de `parentId` que siguen abiertas. Es la lista exacta que
 *  viaja en el cuerpo del 409 y la que llena el modal "Completar todas". */
export function openSubtasks(tasks: readonly Task[], parentId: string): Task[] {
  return tasks.filter((t) => t.parent_id === parentId && isOpen(t.status));
}

/**
 * ¿Se puede completar esta tarea?
 *
 * El guard que GARDEN resolvió bien y el handoff pide conservar: completar un
 * padre con subtareas abiertas deja el árbol mintiendo —el padre dice "listo" y
 * abajo cuelgan tres cosas sin hacer—, así que no se permite en silencio. Se
 * devuelve la lista y se ofrece cerrarlas todas.
 *
 * Una subtarea nunca tiene subtareas, así que siempre se puede completar.
 */
export function canComplete(
  tasks: readonly Task[],
  taskId: string,
): { ok: true } | { ok: false; open: Task[] } {
  const abiertas = openSubtasks(tasks, taskId);
  return abiertas.length === 0 ? { ok: true } : { ok: false, open: abiertas };
}

/** Arma el árbol de un nivel. Las subtareas salen del listado raíz y se cuelgan
 *  de su padre, ordenadas por `sort_order`. Una subtarea cuyo padre no está en
 *  el conjunto (filtrado, borrado) se trata como raíz: esconderla la
 *  desaparecería de la pantalla sin explicación. */
export function buildTree(tasks: readonly Task[]): TaskWithSubtasks[] {
  const porPadre = new Map<string, Task[]>();
  const ids = new Set(tasks.map((t) => t.id));

  for (const t of tasks) {
    if (!t.parent_id || !ids.has(t.parent_id)) continue;
    const lista = porPadre.get(t.parent_id);
    if (lista) lista.push(t);
    else porPadre.set(t.parent_id, [t]);
  }

  return tasks
    .filter((t) => !t.parent_id || !ids.has(t.parent_id))
    .map((t) => ({
      ...t,
      subtasks: (porPadre.get(t.id) ?? []).sort(
        (a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at),
      ),
    }));
}

/**
 * El árbol de lo que se ve, con los contadores DICIENDO LA VERDAD.
 *
 * Es la corrección a un error sutil de componer `buildTree(applyView(…))`: con
 * el filtro por defecto ("abiertas"), las subtareas ya completadas se caen
 * ANTES de armar el árbol, y la tarjeta del padre acaba diciendo "0/1" cuando
 * en realidad va "1/2". El contador se vuelve más pesimista justo cuando el
 * usuario más avanzó, que es la peor manera posible de equivocarse.
 *
 * Aquí el filtro decide QUÉ TARJETAS se ven; las subtareas de cada tarjeta se
 * cuelgan del conjunto completo.
 *
 * `visible` sigue mandando en el orden: viene de `applyView`, que ya ordenó.
 */
export function buildVisibleTree(all: readonly Task[], visible: readonly Task[]): TaskWithSubtasks[] {
  const visibleIds = new Set(visible.map((t) => t.id));

  const porPadre = new Map<string, Task[]>();
  for (const t of all) {
    if (!t.parent_id) continue;
    const lista = porPadre.get(t.parent_id);
    if (lista) lista.push(t);
    else porPadre.set(t.parent_id, [t]);
  }

  return visible
    // Una subtarea que pasa el filtro y cuyo padre no, se muestra como raíz:
    // esconderla la haría desaparecer de la pantalla sin explicación.
    .filter((t) => !t.parent_id || !visibleIds.has(t.parent_id))
    .map((t) => ({
      ...t,
      subtasks: (porPadre.get(t.id) ?? [])
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at)),
    }));
}

/** El resumen que va en la tarjeta: "2/5". */
export function subtaskSummary(subtasks: readonly Task[]): { done: number; total: number } {
  return {
    done: subtasks.filter((s) => s.status === 'completed').length,
    total: subtasks.length,
  };
}

/**
 * El estado que le toca a un padre según sus subtareas — sólo como SUGERENCIA.
 *
 * No se aplica sola: en GARDEN el estado del padre lo decide la persona, y
 * cambiárselo por debajo cada vez que alguien toca una subtarea es la clase de
 * automatismo que hace que el tablero se sienta embrujado. La interfaz la
 * ofrece; nadie la ejecuta sin un clic.
 */
export function suggestedParentStatus(subtasks: readonly Task[]): 'completed' | 'in_progress' | null {
  if (subtasks.length === 0) return null;
  if (subtasks.every((s) => s.status === 'completed')) return 'completed';
  if (subtasks.some((s) => s.status === 'in_progress' || s.status === 'completed')) return 'in_progress';
  return null;
}
