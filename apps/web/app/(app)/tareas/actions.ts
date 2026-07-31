'use server';

/**
 * Las escrituras de la pantalla de tareas.
 *
 * ── Por qué acciones de servidor y no `fetch` a `/work` ────────────────────
 *
 * El `TenantContext` se arma server-side desde la sesión verificada. Una
 * llamada desde el navegador tendría que mandar quién es y de qué empresa, y
 * ese dato NO puede venir del navegador. Con una acción de servidor el contexto
 * nunca sale del servidor: el cliente manda lo que quiere cambiar, no quién
 * dice ser.
 *
 * Las rutas de `packages/work/src/routes.ts` siguen existiendo para los otros
 * clientes (el móvil, una automatización de H8), pero la pantalla no las
 * necesita y así no paga un viaje de ida y vuelta de más.
 *
 * ── Y por qué devuelven en vez de lanzar ───────────────────────────────────
 *
 * Un error que cruza esta frontera llega al cliente sin código ni mensaje. Y
 * el código importa: `CONFLICT` es el que abre el modal *"Hay subtareas
 * abiertas → Completar todas"*, que es un criterio observable del handoff.
 */
import { revalidatePath } from 'next/cache';
import { PlatformError } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import { projectService, taskService, viewService } from '@abraxa/work';
import type { Project, SavedView, Task, TaskComment } from '@abraxa/work/domain';
import { contextoDeTareas } from './context';
import type { DetalleTarea, Fallo, Resultado } from './action-types';

const RUTA = '/tareas';

const sinSesion: Fallo = {
  ok: false,
  code: 'UNAUTHENTICATED',
  message: 'No hay sesión verificada. El módulo de sesión y empresa (H2) todavía no está cableado.',
};

function aFallo(err: unknown): Fallo {
  if (PlatformError.is(err)) {
    const abiertas = err.details?.openSubtasks;
    return {
      ok: false,
      code: err.code,
      message: err.message,
      ...(Array.isArray(abiertas) ? { openSubtasks: abiertas as Task[] } : {}),
    };
  }
  console.error('[tareas] acción fallida', err);
  return { ok: false, code: 'INTERNAL', message: 'Algo falló de nuestro lado. Vuelve a intentarlo.' };
}

/**
 * Un solo envoltorio: contexto, ejecución, traducción del error y refresco.
 *
 * `revalidatePath` sólo se dispara cuando la escritura salió bien. Refrescar
 * después de un fallo haría que la pantalla se recargue y el usuario pierda de
 * vista el mensaje que le estaba explicando qué pasó.
 */
async function accion<T>(fn: (ctx: TenantContext) => Promise<T>): Promise<Resultado<T>> {
  const ctx = await contextoDeTareas();
  if (!ctx) return sinSesion;
  try {
    const data = await fn(ctx);
    revalidatePath(RUTA);
    return { ok: true, data };
  } catch (err) {
    return aFallo(err);
  }
}

// ── Tareas ──────────────────────────────────────────────────────────────────

export async function crearTarea(input: unknown): Promise<Resultado<Task>> {
  return accion((ctx) => taskService.createTask(ctx, input));
}

export async function actualizarTarea(id: string, patch: unknown): Promise<Resultado<Task>> {
  return accion(async (ctx) => (await taskService.updateTask(ctx, id, patch)).task);
}

export async function borrarTarea(id: string): Promise<Resultado<null>> {
  return accion(async (ctx) => {
    await taskService.deleteTask(ctx, id);
    return null;
  });
}

/** La salida del 409: cierra las subtareas abiertas y el padre, o no cierra
 *  nada. Es una sola transacción en la base. */
export async function completarTodas(id: string): Promise<Resultado<{ closed: number }>> {
  return accion((ctx) => taskService.completeAll(ctx, id));
}

export async function reordenar(moves: unknown): Promise<Resultado<{ moved: number }>> {
  return accion((ctx) => taskService.reorder(ctx, { moves }));
}

export async function comentar(taskId: string, body: string): Promise<Resultado<TaskComment>> {
  return accion((ctx) => taskService.addComment(ctx, taskId, { body }));
}

/** El detalle completo, para el panel lateral. Se pide cuando se abre y no
 *  antes: cargar los comentarios de trescientas tareas para enseñar una sería
 *  pagar por lo que nadie pidió. */
export async function cargarDetalle(id: string): Promise<Resultado<DetalleTarea>> {
  const ctx = await contextoDeTareas();
  if (!ctx) return sinSesion;
  try {
    return { ok: true, data: await taskService.getTask(ctx, id) };
  } catch (err) {
    return aFallo(err);
  }
}

// ── Proyectos ───────────────────────────────────────────────────────────────

export async function crearProyecto(input: unknown): Promise<Resultado<Project>> {
  return accion((ctx) => projectService.createProject(ctx, input));
}

export async function actualizarProyecto(id: string, patch: unknown): Promise<Resultado<Project>> {
  return accion((ctx) => projectService.updateProject(ctx, id, patch));
}

export async function borrarProyecto(id: string): Promise<Resultado<{ orphaned: number }>> {
  return accion((ctx) => projectService.deleteProject(ctx, id));
}

// ── Vistas guardadas ────────────────────────────────────────────────────────

export async function guardarVista(input: unknown): Promise<Resultado<SavedView>> {
  return accion((ctx) => viewService.createView(ctx, input));
}

export async function actualizarVista(id: string, patch: unknown): Promise<Resultado<SavedView>> {
  return accion((ctx) => viewService.updateView(ctx, id, patch));
}

export async function borrarVista(id: string): Promise<Resultado<null>> {
  return accion(async (ctx) => {
    await viewService.deleteView(ctx, id);
    return null;
  });
}
