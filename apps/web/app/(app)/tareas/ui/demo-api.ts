'use client';

import {
  canComplete,
  isOpen,
  normalizeViewConfig,
  normalizeViewKind,
  planReorder,
  type Project,
  type SavedView,
  type Task,
  type TaskComment,
  type TaskEvent,
} from '@abraxa/work/domain';
import type { DetalleTarea, Fallo } from '../action-types';
import type { WorkApi } from './api';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El respaldo en memoria — SÓLO en desarrollo
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  H5 sentó el precedente en este mismo repo: `(app)/layout.tsx` trae un
 *  interruptor de estados con la cookie `abraxa_shell_demo`, *"sólo en
 *  desarrollo"*, y su razón está escrita ahí — poder verificar un criterio del
 *  handoff con evidencia real sin tener que romper el backend a propósito.
 *
 *  Aquí hace falta por lo mismo. El contexto del tenant lo entrega H2, que aún
 *  no ha mergeado, así que hoy no hay manera de abrir esta pantalla con datos
 *  de verdad. Con la cookie `abraxa_work_demo` puesta, las cuatro vistas se
 *  pueden abrir, filtrar, arrastrar y compartir por enlace, y el guard 409 se
 *  puede disparar de verdad.
 *
 *  ── Lo que lo hace honesto ─────────────────────────────────────────────────
 *
 *   · En producción no existe: `page.tsx` ni siquiera lee la cookie.
 *   · La pantalla lo ANUNCIA con una barra permanente. Nada de datos de mentira
 *     que parezcan reales.
 *   · Reproduce las reglas del dominio llamando a las MISMAS funciones puras
 *     que usa el servidor (`planReorder`, `canComplete`, `normalizeViewConfig`).
 *     No es una segunda implementación que se pueda separar de la primera.
 */

let n = 0;
const id = (p: string): string => {
  n += 1;
  return `${p}-${n}`;
};
const ahora = (): string => new Date().toISOString();

const fallo = (code: string, message: string, openSubtasks?: Task[]): Fallo => ({
  ok: false,
  code,
  message,
  ...(openSubtasks ? { openSubtasks } : {}),
});

export interface SemillaDemo {
  tasks: Task[];
  projects: Project[];
  views: SavedView[];
  comments: TaskComment[];
  events: TaskEvent[];
  userEmail: string;
}

export function crearApiDemo(semilla: SemillaDemo): WorkApi {
  const tasks = [...semilla.tasks];
  const projects = [...semilla.projects];
  const views = [...semilla.views];
  const comments = [...semilla.comments];
  const events = [...semilla.events];

  const buscar = (taskId: string): Task | undefined => tasks.find((t) => t.id === taskId);

  const anotar = (taskId: string, field: string, from: string | null, to: string | null): void => {
    events.push({
      id: id('ev'),
      task_id: taskId,
      actor: semilla.userEmail,
      field,
      from_value: from,
      to_value: to,
      created_at: ahora(),
    });
  };

  const CON_HISTORIA = ['status', 'assigned_to', 'due_date', 'priority', 'project_id'] as const;

  const aplicar = (t: Task, patch: Record<string, unknown>): Task => {
    const siguiente = { ...t, ...patch, updated_at: ahora() } as Task;
    if (patch.status !== undefined) {
      siguiente.completed_at = siguiente.status === 'completed' ? ahora() : null;
    }
    // La subtarea hereda el proyecto del padre — el mismo invariante que impone
    // el trigger `tasks_guard_hierarchy` de la 070.
    if (siguiente.parent_id) {
      siguiente.project_id = buscar(siguiente.parent_id)?.project_id ?? null;
    }
    for (const campo of CON_HISTORIA) {
      if (campo in patch && t[campo] !== siguiente[campo]) {
        anotar(t.id, campo, t[campo] == null ? null : String(t[campo]), siguiente[campo] == null ? null : String(siguiente[campo]));
      }
    }
    const i = tasks.findIndex((x) => x.id === t.id);
    if (i >= 0) tasks[i] = siguiente;
    return siguiente;
  };

  return {
    async crearTarea(input) {
      const titulo = String(input.title ?? '').trim();
      if (!titulo) return fallo('VALIDATION', 'title: requerido');

      const padre = typeof input.parent_id === 'string' ? buscar(input.parent_id) : undefined;
      if (input.parent_id && !padre) return fallo('VALIDATION', 'La tarea padre no existe');
      if (padre?.parent_id) {
        return fallo('VALIDATION', 'Sólo hay un nivel de subtareas: una subtarea no puede tener subtareas.');
      }

      const task: Task = {
        id: id('t'),
        project_id: padre ? padre.project_id : ((input.project_id as string | null) ?? null),
        parent_id: (input.parent_id as string | null) ?? null,
        title: titulo,
        description: (input.description as string | null) ?? null,
        status: (input.status as Task['status']) ?? 'pending',
        priority: (input.priority as Task['priority']) ?? 'media',
        assigned_to: (input.assigned_to as string | null) ?? null,
        assigned_by: semilla.userEmail,
        start_date: (input.start_date as string | null) ?? null,
        due_date: (input.due_date as string | null) ?? null,
        estimate_hours: (input.estimate_hours as number | null) ?? null,
        tags: Array.isArray(input.tags) ? (input.tags as string[]) : [],
        sort_order: typeof input.sort_order === 'number' ? input.sort_order : 0,
        completed_at: null,
        created_at: ahora(),
        updated_at: ahora(),
      };
      tasks.push(task);
      anotar(task.id, 'created', null, task.title);
      return task;
    },

    async actualizarTarea(taskId, patch) {
      const t = buscar(taskId);
      if (!t) return fallo('NOT_FOUND', 'La tarea no existe');

      if (patch.status === 'completed' && t.status !== 'completed' && t.parent_id === null) {
        const veredicto = canComplete(tasks, taskId);
        if (!veredicto.ok) {
          return fallo(
            'CONFLICT',
            veredicto.open.length === 1 ? 'Hay 1 subtarea abierta.' : `Hay ${veredicto.open.length} subtareas abiertas.`,
            veredicto.open,
          );
        }
      }
      return aplicar(t, patch);
    },

    async borrarTarea(taskId) {
      const t = buscar(taskId);
      if (!t) return fallo('NOT_FOUND', 'La tarea no existe');
      // ON DELETE CASCADE: el padre se lleva a sus subtareas.
      const fuera = new Set([taskId, ...tasks.filter((x) => x.parent_id === taskId).map((x) => x.id)]);
      for (let i = tasks.length - 1; i >= 0; i--) {
        const actual = tasks[i];
        if (actual && fuera.has(actual.id)) tasks.splice(i, 1);
      }
      return null;
    },

    async completarTodas(taskId) {
      const t = buscar(taskId);
      if (!t) return fallo('NOT_FOUND', 'La tarea no existe');
      let closed = 0;
      for (const sub of tasks.filter((x) => x.parent_id === taskId && isOpen(x.status))) {
        aplicar(sub, { status: 'completed' });
        closed += 1;
      }
      if (t.status !== 'completed') {
        aplicar(buscar(taskId) as Task, { status: 'completed' });
        closed += 1;
      }
      return { closed };
    },

    async reordenar(moves) {
      const plan = planReorder(tasks, moves);
      if (!plan.ok) {
        if (plan.reason === 'invalid') return fallo('VALIDATION', plan.detail);
        if (plan.reason === 'not_found') return fallo('NOT_FOUND', 'La tarea no existe');
        return fallo(
          'CONFLICT',
          plan.open.length === 1 ? 'Hay 1 subtarea abierta.' : `Hay ${plan.open.length} subtareas abiertas.`,
          plan.open,
        );
      }
      for (const m of plan.moves) {
        const t = buscar(m.id);
        if (!t) continue;
        const { id: _ignorado, ...patch } = m;
        aplicar(t, patch as Record<string, unknown>);
      }
      return { moved: plan.moves.length };
    },

    async comentar(taskId, body) {
      if (!buscar(taskId)) return fallo('NOT_FOUND', 'La tarea no existe');
      const c: TaskComment = {
        id: id('c'),
        task_id: taskId,
        author: semilla.userEmail,
        body,
        created_at: ahora(),
      };
      comments.push(c);
      return c;
    },

    async cargarDetalle(taskId): Promise<DetalleTarea | Fallo> {
      const task = buscar(taskId);
      if (!task) return fallo('NOT_FOUND', 'La tarea no existe');
      return {
        task,
        subtasks: tasks.filter((t) => t.parent_id === taskId).sort((a, b) => a.sort_order - b.sort_order),
        comments: comments.filter((c) => c.task_id === taskId),
        events: events.filter((e) => e.task_id === taskId),
      };
    },

    async crearProyecto(name) {
      const p: Project = {
        id: id('p'),
        name,
        description: null,
        goal: null,
        status: 'active',
        icon: null,
        start_date: null,
        target_date: null,
        position: projects.length,
        created_by: semilla.userEmail,
        created_at: ahora(),
        updated_at: ahora(),
      };
      projects.push(p);
      return p;
    },

    async actualizarProyecto(projectId, patch) {
      const i = projects.findIndex((p) => p.id === projectId);
      const actual = projects[i];
      if (!actual) return fallo('NOT_FOUND', 'El proyecto no existe');
      const siguiente = { ...actual, ...patch, updated_at: ahora() } as Project;
      projects[i] = siguiente;
      return siguiente;
    },

    async borrarProyecto(projectId) {
      const i = projects.findIndex((p) => p.id === projectId);
      if (i < 0) return fallo('NOT_FOUND', 'El proyecto no existe');
      projects.splice(i, 1);
      // ON DELETE SET NULL: las tareas quedan sueltas, no se borran.
      let orphaned = 0;
      for (let j = 0; j < tasks.length; j++) {
        const t = tasks[j];
        if (t && t.project_id === projectId) {
          tasks[j] = { ...t, project_id: null };
          orphaned += 1;
        }
      }
      return { orphaned };
    },

    async guardarVista(input) {
      const kind = normalizeViewKind(input.kind);
      const nombre = String(input.name ?? '').trim();
      if (!nombre) return fallo('VALIDATION', 'name: requerido');
      if (views.some((v) => v.owner_email === semilla.userEmail && v.name.toLowerCase() === nombre.toLowerCase())) {
        return fallo('CONFLICT', 'Ya tienes una vista guardada con ese nombre');
      }
      const v: SavedView = {
        id: id('v'),
        owner_email: semilla.userEmail,
        name: nombre,
        kind,
        config: normalizeViewConfig(input.config, kind),
        shared: input.shared === true,
        position: views.length,
        created_at: ahora(),
        updated_at: ahora(),
      };
      views.push(v);
      return v;
    },

    async actualizarVista(viewId, patch) {
      const i = views.findIndex((v) => v.id === viewId);
      const actual = views[i];
      if (!actual) return fallo('NOT_FOUND', 'La vista no existe');
      if (actual.owner_email !== semilla.userEmail) {
        return fallo('FORBIDDEN', 'Sólo quien creó la vista puede cambiarla');
      }
      const kind = normalizeViewKind(patch.kind ?? actual.kind);
      const siguiente: SavedView = {
        ...actual,
        ...(typeof patch.name === 'string' ? { name: patch.name } : {}),
        ...(typeof patch.shared === 'boolean' ? { shared: patch.shared } : {}),
        kind,
        config: patch.config !== undefined ? normalizeViewConfig(patch.config, kind) : actual.config,
        updated_at: ahora(),
      };
      views[i] = siguiente;
      return siguiente;
    },

    async borrarVista(viewId) {
      const i = views.findIndex((v) => v.id === viewId);
      if (i < 0) return fallo('NOT_FOUND', 'La vista no existe');
      views.splice(i, 1);
      return null;
    },
  };
}
