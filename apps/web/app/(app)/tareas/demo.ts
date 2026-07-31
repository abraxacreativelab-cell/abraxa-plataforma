import type { Project, SavedView, Task, TaskComment, TaskEvent } from '@abraxa/work/domain';
import { hoyLocal, presetFor } from '@abraxa/work/domain';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  La semilla del modo demostración — SÓLO en desarrollo
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  H5 sentó el precedente en `(app)/layout.tsx`: un interruptor por cookie que
 *  en producción no existe, para poder verificar los criterios del handoff con
 *  evidencia real sin romper el backend a propósito.
 *
 *  Aquí hace falta por lo mismo: el `TenantContext` lo entrega H2, que todavía
 *  no ha mergeado, así que hoy no hay manera de abrir esta pantalla con datos
 *  reales. Con `abraxa_work_demo=1` en desarrollo, las cuatro vistas se pueden
 *  abrir, filtrar, arrastrar, compartir por enlace y disparar el 409 de verdad.
 *
 *  La pantalla lo ANUNCIA con una barra permanente. Nada de datos de mentira
 *  que parezcan reales.
 *
 *  Los datos son de una panadería: es el ejemplo que usa el resto del repo
 *  (`panaderia-lupita` en las pruebas de H1) y sirve para ver que la pantalla
 *  aguanta nombres reales, no "Tarea 1".
 */

const YO = 'lupita@ejemplo.mx';

function dia(offset: number, hoy = new Date()): string {
  const d = new Date(hoy);
  d.setDate(d.getDate() + offset);
  return hoyLocal(d);
}

function hace(horas: number, hoy = new Date()): string {
  return new Date(hoy.getTime() - horas * 3_600_000).toISOString();
}

export interface SemillaDemoServidor {
  tasks: Task[];
  projects: Project[];
  views: SavedView[];
  comments: TaskComment[];
  events: TaskEvent[];
  members: Array<{ email: string; name: string | null }>;
  userEmail: string;
}

export function semillaDemo(ahora = new Date()): SemillaDemoServidor {
  const proyectos: Project[] = [
    proyecto('p1', 'Apertura de la sucursal norte', 0, ahora),
    proyecto('p2', 'Catálogo de temporada', 1, ahora),
  ];

  const tareas: Task[] = [
    t('t1', {
      title: 'Firmar el contrato de arrendamiento',
      project_id: 'p1',
      status: 'in_progress',
      priority: 'critica',
      assigned_to: YO,
      due_date: dia(1, ahora),
      sort_order: 0,
    }),
    // Con subtareas abiertas: es la que dispara el 409 al intentar completarla.
    t('t2', {
      title: 'Dejar lista la cocina',
      project_id: 'p1',
      status: 'in_progress',
      priority: 'alta',
      assigned_to: 'beto@ejemplo.mx',
      due_date: dia(6, ahora),
      sort_order: 1,
    }),
    t('t2a', { title: 'Comprar el horno de convección', parent_id: 't2', project_id: 'p1', status: 'completed', sort_order: 0 }),
    t('t2b', { title: 'Instalar la campana', parent_id: 't2', project_id: 'p1', status: 'pending', priority: 'alta', sort_order: 1 }),
    t('t2c', { title: 'Tramitar el permiso de gas', parent_id: 't2', project_id: 'p1', status: 'blocked', sort_order: 2 }),

    t('t3', {
      title: 'Contratar a dos personas de mostrador',
      project_id: 'p1',
      status: 'pending',
      priority: 'media',
      due_date: dia(14, ahora),
      sort_order: 2,
    }),
    t('t4', {
      title: 'Fotos del pan de muerto',
      project_id: 'p2',
      status: 'pending',
      priority: 'alta',
      assigned_to: 'sofia@ejemplo.mx',
      due_date: dia(-2, ahora), // vencida a propósito
      tags: ['marketing'],
      sort_order: 0,
    }),
    t('t5', {
      title: 'Definir precios de la temporada',
      project_id: 'p2',
      status: 'blocked',
      priority: 'critica',
      assigned_to: YO,
      due_date: dia(3, ahora),
      sort_order: 1,
    }),
    t('t6', {
      title: 'Renovar el seguro del local',
      status: 'pending',
      priority: 'baja',
      due_date: dia(21, ahora),
      sort_order: 0,
    }),
    t('t7', {
      title: 'Cotizar harina con tres proveedores',
      status: 'completed',
      priority: 'media',
      assigned_to: 'beto@ejemplo.mx',
      completed_at: hace(30, ahora),
      sort_order: 1,
    }),
    t('t8', { title: 'Cambiar el letrero de la entrada', status: 'pending', priority: 'baja', sort_order: 2 }),
  ];

  return {
    tasks: tareas,
    projects: proyectos,
    views: [
      {
        id: 'v1',
        owner_email: YO,
        name: 'Lo que se vence esta semana',
        kind: 'calendario',
        config: {
          ...presetFor('calendario'),
          filters: {
            op: 'and',
            rules: [
              { prop: 'status', cond: 'is_any', value: ['pending', 'in_progress', 'blocked'] },
              { prop: 'due_date', cond: 'next_n_days', value: 7 },
            ],
          },
        },
        shared: true,
        position: 0,
        created_at: hace(200, ahora),
        updated_at: hace(200, ahora),
      },
    ],
    comments: [
      {
        id: 'c1',
        task_id: 't2',
        author: 'beto@ejemplo.mx',
        body: 'El de gas es el que trae cola. Ya metí la solicitud, dicen que dos semanas.',
        created_at: hace(26, ahora),
      },
    ],
    events: [
      { id: 'e1', task_id: 't2', actor: YO, field: 'created', from_value: null, to_value: 'Dejar lista la cocina', created_at: hace(120, ahora) },
      { id: 'e2', task_id: 't2', actor: YO, field: 'assigned_to', from_value: null, to_value: 'beto@ejemplo.mx', created_at: hace(119, ahora) },
      { id: 'e3', task_id: 't2', actor: 'beto@ejemplo.mx', field: 'status', from_value: 'pending', to_value: 'in_progress', created_at: hace(48, ahora) },
    ],
    members: [
      { email: YO, name: 'Lupita' },
      { email: 'beto@ejemplo.mx', name: 'Beto' },
      { email: 'sofia@ejemplo.mx', name: 'Sofía' },
    ],
    userEmail: YO,
  };
}

function proyecto(id: string, name: string, position: number, ahora: Date): Project {
  return {
    id,
    name,
    description: null,
    goal: null,
    status: 'active',
    icon: null,
    start_date: null,
    target_date: null,
    position,
    created_by: YO,
    created_at: hace(300, ahora),
    updated_at: hace(300, ahora),
  };
}

function t(id: string, patch: Partial<Task> & { title: string }): Task {
  return {
    id,
    project_id: null,
    parent_id: null,
    description: null,
    status: 'pending',
    priority: 'media',
    assigned_to: null,
    assigned_by: YO,
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
