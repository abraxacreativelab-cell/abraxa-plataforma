/**
 * El plan de un reorder, calculado antes de escribir nada.
 *
 * ── Por qué existe si el RPC ya valida ──────────────────────────────────────
 *
 * `app.reorder_tasks` (migración 070) es quien de verdad garantiza que N
 * movimientos valgan como uno: bloquea las filas, revisa el guard y revierte
 * todo si algo falla. Eso no se puede hacer desde el código.
 *
 * Pero el RPC sólo puede devolver `open_subtasks:<ids>`, y la pantalla necesita
 * los TÍTULOS de esas subtareas para poder decir *"Hay 3 subtareas abiertas →
 * Completar todas"*. Además, decidir el 409 aquí evita ir a la base de datos
 * para un movimiento que ya se sabe que no procede.
 *
 * Así que la misma regla vive en dos lados a propósito, con papeles distintos:
 * esto responde bonito, el RPC es lo que impide la carrera. Es la razón por la
 * que esta función es pura y está probada: si las dos reglas se separan, se
 * separan aquí y se nota en la prueba.
 */
import { canComplete } from './hierarchy';
import { isTaskPriority, isTaskStatus, type Task, type TaskPriority, type TaskStatus } from './types';

/** Un movimiento. `id` y `sort_order` son obligatorios; el resto es lo que
 *  cambia al soltar la tarjeta en otra columna. */
export interface Move {
  id: string;
  sort_order: number;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigned_to?: string | null;
  project_id?: string | null;
}

export type ReorderPlan =
  | { ok: true; moves: Move[] }
  | { ok: false; reason: 'not_found'; taskId: string }
  | { ok: false; reason: 'invalid'; detail: string }
  | { ok: false; reason: 'open_subtasks'; taskId: string; open: Task[] };

const esMovimiento = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Valida y decide. No escribe: devuelve el plan que el servicio manda al RPC.
 *
 * El orden de las comprobaciones importa. La validación de forma va antes que
 * la existencia, y la existencia antes que el guard: si alguien manda un
 * `status` inventado sobre una tarea que no existe, el error útil es el del
 * `status`, no un 404 que le hace buscar en el lugar equivocado.
 */
export function planReorder(tasks: readonly Task[], raw: unknown): ReorderPlan {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, reason: 'invalid', detail: 'moves debe ser un arreglo no vacío' };
  }

  const vistos = new Set<string>();
  const moves: Move[] = [];

  for (const item of raw) {
    if (!esMovimiento(item)) {
      return { ok: false, reason: 'invalid', detail: 'cada movimiento debe ser un objeto' };
    }
    const id = item.id;
    if (typeof id !== 'string' || id.length === 0) {
      return { ok: false, reason: 'invalid', detail: 'cada movimiento requiere id' };
    }
    if (vistos.has(id)) {
      return { ok: false, reason: 'invalid', detail: `id repetido: ${id}` };
    }
    vistos.add(id);

    const sort = item.sort_order;
    if (typeof sort !== 'number' || !Number.isFinite(sort)) {
      return { ok: false, reason: 'invalid', detail: `sort_order inválido en ${id}` };
    }

    const move: Move = { id, sort_order: sort };

    if ('status' in item && item.status != null) {
      if (!isTaskStatus(item.status)) {
        return { ok: false, reason: 'invalid', detail: `estado inválido: ${String(item.status)}` };
      }
      move.status = item.status;
    }
    if ('priority' in item && item.priority != null) {
      if (!isTaskPriority(item.priority)) {
        return { ok: false, reason: 'invalid', detail: `prioridad inválida: ${String(item.priority)}` };
      }
      move.priority = item.priority;
    }
    if ('assigned_to' in item) {
      const a = item.assigned_to;
      if (a !== null && typeof a !== 'string') {
        return { ok: false, reason: 'invalid', detail: `responsable inválido en ${id}` };
      }
      move.assigned_to = a;
    }
    if ('project_id' in item) {
      const p = item.project_id;
      if (p !== null && typeof p !== 'string') {
        return { ok: false, reason: 'invalid', detail: `proyecto inválido en ${id}` };
      }
      move.project_id = p;
    }

    moves.push(move);
  }

  const porId = new Map(tasks.map((t) => [t.id, t]));

  for (const move of moves) {
    const actual = porId.get(move.id);
    // La tarea se busca en el conjunto DEL TENANT que ya cargó el servicio. Una
    // tarea de otro cliente no está en ese conjunto, así que aquí es un 404 —
    // que es la respuesta correcta: "no existe" y no "existe pero no es tuya".
    if (!actual) return { ok: false, reason: 'not_found', taskId: move.id };

    if (move.status === 'completed' && actual.status !== 'completed' && actual.parent_id === null) {
      const veredicto = canComplete(tasks, move.id);
      if (!veredicto.ok) {
        return { ok: false, reason: 'open_subtasks', taskId: move.id, open: veredicto.open };
      }
    }
  }

  return { ok: true, moves };
}
