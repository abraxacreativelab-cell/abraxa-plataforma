/**
 * El vocabulario de H9. Puro: sin React, sin Express, sin base de datos.
 *
 * Vive aquí y no en `@abraxa/db/ports` porque los ports son el contrato
 * CRUZADO —lo que otros handoffs consumen de mí— y esto es el detalle interno
 * del módulo. Lo único que H8 y las tools del agente necesitan saber de tareas
 * es `WorkPort.createTask`.
 */

export const TASK_STATUSES = [
  'pending',
  'in_progress',
  'blocked',
  'completed',
  'cancelled',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Los que cuentan como "todavía hay que hacerlo". Es la definición de la que
 *  cuelgan el guard 409, el progreso y el filtro por defecto de las 4 vistas. */
export const OPEN_STATUSES: readonly TaskStatus[] = ['pending', 'in_progress', 'blocked'];

export const isOpen = (s: TaskStatus): boolean => OPEN_STATUSES.includes(s);

export const TASK_PRIORITIES = ['critica', 'alta', 'media', 'baja'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const PROJECT_STATUSES = ['active', 'paused', 'completed', 'archived'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/**
 * Etiquetas y tono semántico. El COLOR no está aquí a propósito: los estados
 * se pintan con las variantes de `Badge` de H5 (`success`, `warning`, `error`,
 * `info`), que son tokens fijos y no siguen al acento del área. GARDEN tenía
 * los hex a mano en `tasks-meta.ts` y por eso "Listo" era de un verde distinto
 * en cada pantalla.
 */
export type SemanticTone = 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'error' | 'info';

export const STATUS_META: Record<TaskStatus, { label: string; tone: SemanticTone }> = {
  pending: { label: 'Pendiente', tone: 'info' },
  in_progress: { label: 'En progreso', tone: 'default' },
  blocked: { label: 'Bloqueada', tone: 'warning' },
  completed: { label: 'Lista', tone: 'success' },
  cancelled: { label: 'Cancelada', tone: 'secondary' },
};

export const PRIORITY_META: Record<TaskPriority, { label: string; tone: SemanticTone; rank: number }> = {
  critica: { label: 'Crítica', tone: 'error', rank: 0 },
  alta: { label: 'Alta', tone: 'warning', rank: 1 },
  media: { label: 'Media', tone: 'outline', rank: 2 },
  baja: { label: 'Baja', tone: 'secondary', rank: 3 },
};

export const PROJECT_STATUS_META: Record<ProjectStatus, { label: string; tone: SemanticTone }> = {
  active: { label: 'Activo', tone: 'success' },
  paused: { label: 'En pausa', tone: 'warning' },
  completed: { label: 'Completado', tone: 'info' },
  archived: { label: 'Archivado', tone: 'secondary' },
};

// ════════════════════════════════════════════════════════════════════════════
// Filas
// ════════════════════════════════════════════════════════════════════════════

export interface Project {
  id: string;
  name: string;
  description: string | null;
  goal: string | null;
  status: ProjectStatus;
  icon: string | null;
  start_date: string | null;
  target_date: string | null;
  position: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  project_id: string | null;
  parent_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigned_to: string | null;
  assigned_by: string | null;
  start_date: string | null;
  due_date: string | null;
  estimate_hours: number | null;
  tags: string[];
  sort_order: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Una tarea raíz con sus subtareas ya resueltas. Un solo nivel: las subtareas
 *  son `Task` planas y nunca traen las suyas, porque no pueden tenerlas. */
export interface TaskWithSubtasks extends Task {
  subtasks: Task[];
}

export interface TaskComment {
  id: string;
  task_id: string;
  author: string | null;
  body: string;
  created_at: string;
}

/** Historial. Lo escribe el sistema, no una persona. */
export interface TaskEvent {
  id: string;
  task_id: string;
  actor: string | null;
  field: string;
  from_value: string | null;
  to_value: string | null;
  created_at: string;
}

/** Miembro del tenant, tal como lo entrega `TenancyPort.listMembers`. */
export interface Member {
  email: string;
  name: string | null;
}

// ════════════════════════════════════════════════════════════════════════════
// Guardas de valor — la frontera entre "lo que llegó por la red" y el dominio
// ════════════════════════════════════════════════════════════════════════════

export const isTaskStatus = (v: unknown): v is TaskStatus =>
  typeof v === 'string' && (TASK_STATUSES as readonly string[]).includes(v);

export const isTaskPriority = (v: unknown): v is TaskPriority =>
  typeof v === 'string' && (TASK_PRIORITIES as readonly string[]).includes(v);

export const isProjectStatus = (v: unknown): v is ProjectStatus =>
  typeof v === 'string' && (PROJECT_STATUSES as readonly string[]).includes(v);
