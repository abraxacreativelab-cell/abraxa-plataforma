/**
 * Tareas. Todo dato pasa por `tenantDb(ctx)`.
 *
 * ── Lo que se conserva de GARDEN, textual del handoff ───────────────────────
 *
 *  · El **guard 409** al completar una tarea con subtareas abiertas, con la
 *    lista para que la interfaz ofrezca *"Completar todas"*.
 *  · El **reorder transaccional**, que aquí vive en la 070 y se llama desde
 *    `data/rpc.ts`.
 *
 * ── Lo que cambia ───────────────────────────────────────────────────────────
 *
 *  · `assigned_by` deja de tener el default `'santiago'` de `tasks.ts:210` y lo
 *    llena el usuario de la sesión.
 *  · El historial se escribe en `task_events` en vez de mezclarse con los
 *    comentarios en una tabla con `update_type`.
 *  · No hay sincronización con `totem_today`: el Tótem es de GARDEN.
 */
import { PlatformError, tenantDb } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import { assertOk } from '../data/errors';
import { completeTaskCascade, reorderTasks } from '../data/rpc';
import { canComplete } from '../domain/hierarchy';
import { planReorder } from '../domain/reorder';
import { OPEN_STATUSES, type Task, type TaskComment, type TaskEvent } from '../domain/types';
import { parseOrThrow } from './parse';
import { commentSchema, reorderSchema, taskCreateSchema, taskPatchSchema } from './schemas';

/**
 * Tope de lectura. Las cuatro vistas trabajan sobre el conjunto completo en
 * memoria (filtrar, agrupar, contar), así que se lee todo de una vez.
 *
 * El tope existe para que una cuenta con historia no tumbe la pantalla, y
 * cuando se toca **se dice** (`truncated`). Un límite silencioso es peor que no
 * tener límite: la pantalla enseña 2000 tareas y jura que son todas.
 */
export const LIMITE_TAREAS = 2_000;

/** Los cambios que valen la pena recordar. El resto (descripción, etiquetas,
 *  estimación) se ve en la tarea misma; anotarlo sólo llenaría el historial de
 *  ruido y escondería lo que de verdad importa. */
const CAMPOS_CON_HISTORIA = ['status', 'assigned_to', 'due_date', 'priority', 'project_id'] as const;
type CampoConHistoria = (typeof CAMPOS_CON_HISTORIA)[number];

export interface TaskList {
  tasks: Task[];
  /** `true` si se alcanzó `LIMITE_TAREAS` y hay más sin traer. */
  truncated: boolean;
}

export async function listTasks(ctx: TenantContext): Promise<TaskList> {
  const { data, error } = await tenantDb(ctx)
    .from('tasks')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(LIMITE_TAREAS);

  assertOk(error, 'la lectura de tareas');
  const tasks = (data ?? []) as Task[];
  return { tasks, truncated: tasks.length >= LIMITE_TAREAS };
}

async function leerTarea(ctx: TenantContext, id: string): Promise<Task> {
  const { data, error } = await tenantDb(ctx).from('tasks').select('*').eq('id', id).maybeSingle();
  assertOk(error, 'la lectura de la tarea');
  if (!data) throw new PlatformError('NOT_FOUND', 'La tarea no existe');
  return data as Task;
}

export interface TaskDetail {
  task: Task;
  subtasks: Task[];
  comments: TaskComment[];
  events: TaskEvent[];
}

/** La tarea con todo lo que pinta el panel de detalle. */
export async function getTask(ctx: TenantContext, id: string): Promise<TaskDetail> {
  const db = tenantDb(ctx);
  const task = await leerTarea(ctx, id);

  const [subs, coms, evs] = await Promise.all([
    db.from('tasks').select('*').eq('parent_id', id).order('sort_order', { ascending: true }),
    db.from('task_comments').select('*').eq('task_id', id).order('created_at', { ascending: true }),
    db.from('task_events').select('*').eq('task_id', id).order('created_at', { ascending: true }),
  ]);

  assertOk(subs.error, 'la lectura de subtareas');
  assertOk(coms.error, 'la lectura de comentarios');
  assertOk(evs.error, 'la lectura del historial');

  return {
    task,
    subtasks: (subs.data ?? []) as Task[],
    comments: (coms.data ?? []) as TaskComment[],
    events: (evs.data ?? []) as TaskEvent[],
  };
}

async function anotar(
  ctx: TenantContext,
  filas: Array<{ task_id: string; field: string; from_value: string | null; to_value: string | null }>,
): Promise<void> {
  if (filas.length === 0) return;
  // El historial es best-effort A PROPÓSITO: que falle una anotación no puede
  // deshacer un cambio que el usuario ya vio aplicado en la pantalla. Lo que
  // NO es best-effort es el historial del reorder, que va dentro de su
  // transacción justamente porque ahí sí se puede revertir.
  const { error } = await tenantDb(ctx)
    .from('task_events')
    .insert(filas.map((f) => ({ ...f, actor: ctx.userEmail })));
  if (error) console.warn('[work] no se pudo anotar el historial:', error.message);
}

export async function createTask(ctx: TenantContext, input: unknown): Promise<Task> {
  const datos = parseOrThrow(taskCreateSchema, input);

  const { data, error } = await tenantDb(ctx)
    .from('tasks')
    .insert({
      ...datos,
      // Quien crea es quien pidió, no una constante. En GARDEN el default
      // `'santiago'` convertía toda tarea creada por un agente en tarea suya.
      assigned_by: ctx.userEmail,
    })
    .select()
    .single();

  assertOk(error, 'la creación de la tarea');
  const task = data as Task;
  await anotar(ctx, [{ task_id: task.id, field: 'created', from_value: null, to_value: task.title }]);
  return task;
}

export interface UpdateResult {
  task: Task;
}

/**
 * Actualiza una tarea. Aquí vive el guard 409.
 *
 * El guard se comprueba ANTES de escribir y con la lista de subtareas en la
 * mano, para que el 409 pueda decir *cuáles* están abiertas. El backstop contra
 * la carrera —que alguien reabra una subtarea entre la lectura y el UPDATE— es
 * el mismo guard dentro de `app.reorder_tasks` y de `complete_task_cascade`.
 */
export async function updateTask(ctx: TenantContext, id: string, input: unknown): Promise<UpdateResult> {
  const patch = parseOrThrow(taskPatchSchema, input);
  const antes = await leerTarea(ctx, id);

  if (patch.status === 'completed' && antes.status !== 'completed' && antes.parent_id === null) {
    const { data, error } = await tenantDb(ctx)
      .from('tasks')
      .select('*')
      .eq('parent_id', id)
      .in('status', [...OPEN_STATUSES]);
    assertOk(error, 'la revisión de subtareas');

    const veredicto = canComplete([antes, ...((data ?? []) as Task[])], id);
    if (!veredicto.ok) {
      throw new PlatformError(
        'CONFLICT',
        veredicto.open.length === 1
          ? 'Hay 1 subtarea abierta.'
          : `Hay ${veredicto.open.length} subtareas abiertas.`,
        { details: { openSubtasks: veredicto.open } },
      );
    }
  }

  const { data, error } = await tenantDb(ctx)
    .from('tasks')
    .update(patch)
    .eq('id', id)
    .select()
    .maybeSingle();

  assertOk(error, 'la actualización de la tarea');
  if (!data) throw new PlatformError('NOT_FOUND', 'La tarea no existe');
  const despues = data as Task;

  await anotar(
    ctx,
    CAMPOS_CON_HISTORIA.filter((c) => c in patch && antes[c] !== despues[c]).map((c: CampoConHistoria) => ({
      task_id: id,
      field: c,
      from_value: antes[c] == null ? null : String(antes[c]),
      to_value: despues[c] == null ? null : String(despues[c]),
    })),
  );

  return { task: despues };
}

/** Cierra las subtareas abiertas y el padre en una sola transacción. Es el
 *  botón "Completar todas" del modal del 409. */
export async function completeAll(ctx: TenantContext, id: string): Promise<{ closed: number }> {
  await leerTarea(ctx, id); // 404 dentro del tenant antes de tocar el RPC
  return { closed: await completeTaskCascade(ctx, id) };
}

export async function deleteTask(ctx: TenantContext, id: string): Promise<void> {
  await leerTarea(ctx, id);
  // Las subtareas, comentarios e historial se van con ella por ON DELETE
  // CASCADE de la 070: borrar el padre y dejar subtareas huérfanas es peor que
  // no poder borrarlo.
  const { error } = await tenantDb(ctx).from('tasks').delete().eq('id', id);
  assertOk(error, 'el borrado de la tarea');
}

export async function addComment(ctx: TenantContext, taskId: string, input: unknown): Promise<TaskComment> {
  const { body } = parseOrThrow(commentSchema, input);
  await leerTarea(ctx, taskId);

  const { data, error } = await tenantDb(ctx)
    .from('task_comments')
    .insert({ task_id: taskId, author: ctx.userEmail, body })
    .select()
    .single();

  assertOk(error, 'el comentario');
  return data as TaskComment;
}

/**
 * Reordena. Dos pasos, con papeles distintos:
 *
 *  1. `planReorder` sobre las tareas DEL TENANT: valida la forma, resuelve el
 *     404 y arma el 409 con los títulos de las subtareas.
 *  2. `app.reorder_tasks`: lo aplica como una sola transacción, con las filas
 *     bloqueadas.
 */
export async function reorder(ctx: TenantContext, input: unknown): Promise<{ moved: number }> {
  const { moves } = parseOrThrow(reorderSchema, input);
  const { tasks } = await listTasks(ctx);

  const plan = planReorder(tasks, moves);
  if (!plan.ok) {
    if (plan.reason === 'invalid') throw new PlatformError('VALIDATION', plan.detail);
    if (plan.reason === 'not_found') throw new PlatformError('NOT_FOUND', 'La tarea no existe');
    throw new PlatformError(
      'CONFLICT',
      plan.open.length === 1 ? 'Hay 1 subtarea abierta.' : `Hay ${plan.open.length} subtareas abiertas.`,
      { details: { taskId: plan.taskId, openSubtasks: plan.open } },
    );
  }

  return { moved: await reorderTasks(ctx, plan.moves) };
}
