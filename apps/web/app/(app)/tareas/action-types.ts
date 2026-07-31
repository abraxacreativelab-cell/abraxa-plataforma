import type { Project, SavedView, Task, TaskComment } from '@abraxa/work/domain';

/**
 * El resultado de una acción de servidor.
 *
 * Se devuelve en vez de lanzarse porque un error que cruza la frontera de un
 * Server Action llega al cliente como "An error occurred in the Server
 * Components render" y nada más: el mensaje y el código se pierden. Y aquí el
 * código IMPORTA — `CONFLICT` es el que abre el modal de subtareas abiertas.
 *
 * Vive en su propio archivo porque un módulo `'use server'` sólo puede exportar
 * funciones asíncronas.
 */
export type Fallo = {
  ok: false;
  code: string;
  message: string;
  /** Cuando el código es `CONFLICT`, las subtareas que estorban. */
  openSubtasks?: Task[];
};

export type Resultado<T> = { ok: true; data: T } | Fallo;

export type ResultadoTarea = Resultado<Task>;
export type ResultadoProyecto = Resultado<Project>;
export type ResultadoVista = Resultado<SavedView>;
export type ResultadoComentario = Resultado<TaskComment>;
export type ResultadoVacio = Resultado<null>;

export interface DetalleTarea {
  task: Task;
  subtasks: Task[];
  comments: TaskComment[];
  events: Array<{
    id: string;
    task_id: string;
    actor: string | null;
    field: string;
    from_value: string | null;
    to_value: string | null;
    created_at: string;
  }>;
}
