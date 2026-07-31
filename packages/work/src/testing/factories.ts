/**
 * Constructores de filas para las pruebas.
 *
 * Cada uno devuelve una fila COMPLETA y válida, y sólo se sobrescribe lo que la
 * prueba de verdad está probando. Así una prueba de filtros por fecha se lee
 * como `tarea({ due_date: '2026-08-01' })` y no como treinta campos de ruido
 * entre los que hay que buscar cuál importa.
 */
import type { Member, Project, Task, TaskComment, TaskEvent } from '../domain/types';
import type { SavedView, ViewKind } from '../domain/view';
import { presetFor } from '../domain/view';

let n = 0;
const siguiente = (): string => {
  n += 1;
  return `id-${n}`;
};

/** Reinicia el contador para que los ids sean estables prueba a prueba. */
export function resetIds(): void {
  n = 0;
}

export function tarea(patch: Partial<Task> = {}): Task {
  const id = patch.id ?? siguiente();
  return {
    id,
    project_id: null,
    parent_id: null,
    title: `Tarea ${id}`,
    description: null,
    status: 'pending',
    priority: 'media',
    assigned_to: null,
    assigned_by: null,
    start_date: null,
    due_date: null,
    estimate_hours: null,
    tags: [],
    sort_order: 0,
    completed_at: null,
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
    ...patch,
  };
}

export function proyecto(patch: Partial<Project> = {}): Project {
  const id = patch.id ?? siguiente();
  return {
    id,
    name: `Proyecto ${id}`,
    description: null,
    goal: null,
    status: 'active',
    icon: null,
    start_date: null,
    target_date: null,
    position: 0,
    created_by: null,
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
    ...patch,
  };
}

export function miembro(patch: Partial<Member> = {}): Member {
  return { email: 'lupita@ejemplo.mx', name: 'Lupita', ...patch };
}

export function comentario(patch: Partial<TaskComment> = {}): TaskComment {
  const id = patch.id ?? siguiente();
  return {
    id,
    task_id: 'tarea-1',
    author: 'lupita@ejemplo.mx',
    body: 'Va quedando.',
    created_at: '2026-07-01T00:00:00.000Z',
    ...patch,
  };
}

export function evento(patch: Partial<TaskEvent> = {}): TaskEvent {
  const id = patch.id ?? siguiente();
  return {
    id,
    task_id: 'tarea-1',
    actor: 'lupita@ejemplo.mx',
    field: 'status',
    from_value: 'pending',
    to_value: 'in_progress',
    created_at: '2026-07-01T00:00:00.000Z',
    ...patch,
  };
}

export function vistaGuardada(patch: Partial<SavedView> = {}): SavedView {
  const id = patch.id ?? siguiente();
  const kind: ViewKind = patch.kind ?? 'progreso';
  return {
    id,
    owner_email: 'lupita@ejemplo.mx',
    name: `Vista ${id}`,
    kind,
    config: presetFor(kind),
    shared: false,
    position: 0,
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
    ...patch,
  };
}
