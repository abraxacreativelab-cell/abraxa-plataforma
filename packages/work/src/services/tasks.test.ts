import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PlatformError, __setClientForTests } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import { createFakeDb, type FakeDb, type Fila } from '../testing/fake-db';
import { addComment, completeAll, createTask, deleteTask, getTask, listTasks, reorder, updateTask } from './tasks';

const A = '00000000-0000-0000-0000-0000000000aa';
const B = '00000000-0000-0000-0000-0000000000bb';

const ctxDe = (tenantId: string, email = 'lupita@ejemplo.mx'): TenantContext => ({
  tenantId,
  tenantSlug: tenantId === A ? 'panaderia-lupita' : 'taller-de-beto',
  userEmail: email,
  role: 'owner',
  areas: { direccion: 'admin' },
});

const ctxA = ctxDe(A);
const ctxB = ctxDe(B, 'beto@ejemplo.mx');

const fila = (patch: Fila): Fila => ({
  status: 'pending',
  priority: 'media',
  parent_id: null,
  project_id: null,
  assigned_to: null,
  tags: [],
  sort_order: 0,
  completed_at: null,
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z',
  ...patch,
});

let db: FakeDb;
let restaurar: () => void;

beforeEach(() => {
  db = createFakeDb({
    tasks: [
      fila({ id: 't-a1', tenant_id: A, title: 'Hornear el pan', sort_order: 1 }),
      fila({ id: 't-a2', tenant_id: A, title: 'Cotizar harina', sort_order: 2, status: 'in_progress' }),
      fila({ id: 't-b1', tenant_id: B, title: 'Cambiar el aceite', sort_order: 1 }),
    ],
    task_comments: [],
    task_events: [],
  });
  restaurar = __setClientForTests(db.client);
});

afterEach(() => restaurar());

async function esperarError(fn: () => Promise<unknown>): Promise<PlatformError> {
  try {
    await fn();
  } catch (e) {
    if (PlatformError.is(e)) return e;
    throw e;
  }
  throw new Error('se esperaba un PlatformError y no hubo ninguno');
}

// ════════════════════════════════════════════════════════════════════════════
describe('criterio 6 — un tenant no ve las tareas de otro', () => {
  it('el listado sólo trae las suyas', async () => {
    expect((await listTasks(ctxA)).tasks.map((t) => t.id)).toEqual(['t-a1', 't-a2']);
    expect((await listTasks(ctxB)).tasks.map((t) => t.id)).toEqual(['t-b1']);
  });

  it('leer una tarea ajena por su id es un 404, no un 403', async () => {
    // Decir "existe pero no es tuya" ya confirma que existe.
    const err = await esperarError(() => getTask(ctxA, 't-b1'));
    expect(err.code).toBe('NOT_FOUND');
  });

  it('actualizar una tarea ajena no la toca', async () => {
    const err = await esperarError(() => updateTask(ctxA, 't-b1', { title: 'secuestrada' }));
    expect(err.code).toBe('NOT_FOUND');
    expect(db.tabla('tasks').find((t) => t.id === 't-b1')?.title).toBe('Cambiar el aceite');
  });

  it('borrar una tarea ajena no la borra', async () => {
    await esperarError(() => deleteTask(ctxA, 't-b1'));
    expect(db.tabla('tasks').some((t) => t.id === 't-b1')).toBe(true);
  });

  it('reordenar una tarea ajena falla y no mueve nada', async () => {
    const err = await esperarError(() => reorder(ctxA, { moves: [{ id: 't-b1', sort_order: 99 }] }));
    expect(err.code).toBe('NOT_FOUND');
    expect(db.tabla('tasks').find((t) => t.id === 't-b1')?.sort_order).toBe(1);
  });

  it('un tenant_id metido en el cuerpo NO muda la tarea de empresa', async () => {
    // `stampTenant` lo pisa; el esquema `.strict()` ni siquiera lo deja llegar.
    const err = await esperarError(() => createTask(ctxA, { title: 'x', tenant_id: B }));
    expect(err.code).toBe('VALIDATION');
  });

  it('un comentario en una tarea ajena no se escribe', async () => {
    await esperarError(() => addComment(ctxA, 't-b1', { body: 'hola' }));
    expect(db.tabla('task_comments')).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('createTask', () => {
  it('estampa el tenant y a quien la creó', async () => {
    const task = await createTask(ctxA, { title: 'Comprar levadura' });
    const guardada = db.tabla('tasks').find((t) => t.id === task.id);
    expect(guardada?.tenant_id).toBe(A);
    // GARDEN ponía `assigned_by: 'santiago'` por default (tasks.ts:210).
    expect(guardada?.assigned_by).toBe('lupita@ejemplo.mx');
  });

  it('rechaza un título vacío', async () => {
    expect((await esperarError(() => createTask(ctxA, { title: '   ' }))).code).toBe('VALIDATION');
  });

  it('rechaza campos que no existen en vez de ignorarlos', async () => {
    expect((await esperarError(() => createTask(ctxA, { title: 'x', pwn: 1 }))).code).toBe('VALIDATION');
  });

  it('normaliza el correo del responsable a minúsculas', async () => {
    // Si no, "por responsable" le abre dos columnas a la misma persona.
    const t = await createTask(ctxA, { title: 'x', assigned_to: 'Ana@Ejemplo.MX' });
    expect(t.assigned_to).toBe('ana@ejemplo.mx');
  });

  it('rechaza una fecha que no existe en el calendario', async () => {
    expect((await esperarError(() => createTask(ctxA, { title: 'x', due_date: '2026-02-31' }))).code).toBe(
      'VALIDATION',
    );
    expect((await esperarError(() => createTask(ctxA, { title: 'x', due_date: '31/07/2026' }))).code).toBe(
      'VALIDATION',
    );
  });

  it('anota la creación en el historial', async () => {
    const t = await createTask(ctxA, { title: 'Comprar levadura' });
    expect(db.tabla('task_events')).toContainEqual(
      expect.objectContaining({ task_id: t.id, field: 'created', to_value: 'Comprar levadura' }),
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('updateTask — el guard 409', () => {
  beforeEach(() => {
    db.sembrar('tasks', [
      fila({ id: 'p', tenant_id: A, title: 'Abrir la sucursal', status: 'in_progress' }),
      fila({ id: 's1', tenant_id: A, title: 'Firmar el contrato', parent_id: 'p', status: 'pending' }),
      fila({ id: 's2', tenant_id: A, title: 'Pintar', parent_id: 'p', status: 'completed' }),
      fila({ id: 'suelta', tenant_id: A, title: 'Suelta' }),
    ]);
  });

  it('completar un padre con subtareas abiertas devuelve CONFLICT con la lista', async () => {
    const err = await esperarError(() => updateTask(ctxA, 'p', { status: 'completed' }));
    expect(err.code).toBe('CONFLICT');
    expect(err.status).toBe(409);

    const abiertas = err.details?.openSubtasks as Array<{ id: string; title: string }>;
    expect(abiertas.map((t) => t.title)).toEqual(['Firmar el contrato']);
  });

  it('y NO cambia el estado del padre', async () => {
    await esperarError(() => updateTask(ctxA, 'p', { status: 'completed' }));
    expect(db.tabla('tasks').find((t) => t.id === 'p')?.status).toBe('in_progress');
  });

  it('cerrar la subtarea abierta destraba al padre', async () => {
    await updateTask(ctxA, 's1', { status: 'completed' });
    const { task } = await updateTask(ctxA, 'p', { status: 'completed' });
    expect(task.status).toBe('completed');
  });

  it('mover el padre sin completarlo no dispara el guard', async () => {
    const { task } = await updateTask(ctxA, 'p', { status: 'blocked' });
    expect(task.status).toBe('blocked');
  });

  it('completar una subtarea nunca dispara el guard', async () => {
    const { task } = await updateTask(ctxA, 's1', { status: 'completed' });
    expect(task.status).toBe('completed');
  });

  it('una tarea sin subtareas se completa sin más', async () => {
    const { task } = await updateTask(ctxA, 'suelta', { status: 'completed' });
    expect(task.status).toBe('completed');
  });
});

describe('completeAll — la salida del 409', () => {
  beforeEach(() => {
    db.sembrar('tasks', [
      fila({ id: 'p', tenant_id: A, title: 'Abrir la sucursal', status: 'in_progress' }),
      fila({ id: 's1', tenant_id: A, parent_id: 'p', status: 'pending' }),
      fila({ id: 's2', tenant_id: A, parent_id: 'p', status: 'blocked' }),
      fila({ id: 's3', tenant_id: A, parent_id: 'p', status: 'completed' }),
      fila({ id: 'ajena', tenant_id: B, parent_id: 'p', status: 'pending' }),
    ]);
  });

  it('cierra las subtareas abiertas y el padre de una vez', async () => {
    const { closed } = await completeAll(ctxA, 'p');
    expect(closed).toBe(3); // s1, s2 y el padre

    const porId = new Map(db.tabla('tasks').map((t) => [t.id, t.status]));
    expect(porId.get('s1')).toBe('completed');
    expect(porId.get('s2')).toBe('completed');
    expect(porId.get('p')).toBe('completed');
  });

  it('no toca una subtarea de otro tenant aunque cuelgue del mismo id', async () => {
    await completeAll(ctxA, 'p');
    expect(db.tabla('tasks').find((t) => t.id === 'ajena')?.status).toBe('pending');
  });

  it('deja el rastro en el historial', async () => {
    await completeAll(ctxA, 'p');
    const cerradas = db.tabla('task_events').filter((e) => e.to_value === 'completed');
    expect(cerradas).toHaveLength(3);
    expect(cerradas.every((e) => e.actor === 'lupita@ejemplo.mx')).toBe(true);
  });

  it('sobre una tarea ajena no hace nada', async () => {
    const err = await esperarError(() => completeAll(ctxA, 'ajena'));
    expect(err.code).toBe('NOT_FOUND');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('updateTask — historial', () => {
  it('anota sólo los campos que de verdad cambiaron', async () => {
    await updateTask(ctxA, 't-a1', { status: 'in_progress', priority: 'media', assigned_to: 'ana@x.mx' });

    const campos = db.tabla('task_events').map((e) => e.field);
    expect(campos).toContain('status');
    expect(campos).toContain('assigned_to');
    // `priority` venía en el patch pero ya valía 'media': no es un cambio.
    expect(campos).not.toContain('priority');
  });

  it('guarda el antes y el después', async () => {
    await updateTask(ctxA, 't-a1', { status: 'blocked' });
    expect(db.tabla('task_events')[0]).toMatchObject({
      field: 'status',
      from_value: 'pending',
      to_value: 'blocked',
      actor: 'lupita@ejemplo.mx',
    });
  });

  it('cambiar la descripción no ensucia el historial', async () => {
    await updateTask(ctxA, 't-a1', { description: 'con masa madre' });
    expect(db.tabla('task_events')).toHaveLength(0);
  });

  it('un patch vacío es un error, no una escritura silenciosa', async () => {
    expect((await esperarError(() => updateTask(ctxA, 't-a1', {}))).code).toBe('VALIDATION');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('reorder — criterio 4', () => {
  it('persiste el sort_order', async () => {
    const { moved } = await reorder(ctxA, {
      moves: [
        { id: 't-a1', sort_order: 10 },
        { id: 't-a2', sort_order: 5 },
      ],
    });
    expect(moved).toBe(2);

    // Y sobrevive a "recargar": se vuelve a leer de la base.
    expect((await listTasks(ctxA)).tasks.map((t) => t.id)).toEqual(['t-a2', 't-a1']);
  });

  it('mover entre columnas cambia el campo de la agrupación', async () => {
    await reorder(ctxA, { moves: [{ id: 't-a1', sort_order: 1, status: 'blocked' }] });
    expect(db.tabla('tasks').find((t) => t.id === 't-a1')?.status).toBe('blocked');
  });

  it('un movimiento bloqueado revierte TODO el lote', async () => {
    db.sembrar('tasks', [
      fila({ id: 'p', tenant_id: A, status: 'in_progress', sort_order: 1 }),
      fila({ id: 's', tenant_id: A, parent_id: 'p', status: 'pending', title: 'Falta esto' }),
      fila({ id: 'otra', tenant_id: A, sort_order: 1 }),
    ]);

    const err = await esperarError(() =>
      reorder(ctxA, {
        moves: [
          { id: 'otra', sort_order: 99 },
          { id: 'p', sort_order: 2, status: 'completed' },
        ],
      }),
    );

    expect(err.code).toBe('CONFLICT');
    // Lo importante: la PRIMERA no se aplicó. El lote se rechaza entero antes
    // de escribir; bajo concurrencia, el mismo guard dentro de
    // `app.reorder_tasks` revierte la transacción.
    expect(db.tabla('tasks').find((t) => t.id === 'otra')?.sort_order).toBe(1);
  });

  it('el 409 del reorder trae los títulos, no sólo los ids', async () => {
    db.sembrar('tasks', [
      fila({ id: 'p', tenant_id: A, status: 'in_progress' }),
      fila({ id: 's', tenant_id: A, parent_id: 'p', status: 'pending', title: 'Falta esto' }),
    ]);
    const err = await esperarError(() =>
      reorder(ctxA, { moves: [{ id: 'p', sort_order: 1, status: 'completed' }] }),
    );
    const abiertas = err.details?.openSubtasks as Array<{ title: string }>;
    expect(abiertas.map((t) => t.title)).toEqual(['Falta esto']);
  });

  it('anota el cambio de estado en el historial dentro de la misma operación', async () => {
    await reorder(ctxA, { moves: [{ id: 't-a1', sort_order: 1, status: 'in_progress' }] });
    expect(db.tabla('task_events')).toContainEqual(
      expect.objectContaining({ task_id: 't-a1', field: 'status', to_value: 'in_progress' }),
    );
  });

  it('rechaza un lote vacío', async () => {
    expect((await esperarError(() => reorder(ctxA, { moves: [] }))).code).toBe('VALIDATION');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('getTask', () => {
  it('trae subtareas, comentarios e historial', async () => {
    db.sembrar('tasks', [
      fila({ id: 'p', tenant_id: A, title: 'Padre' }),
      fila({ id: 's', tenant_id: A, parent_id: 'p', title: 'Hija' }),
    ]);
    await addComment(ctxA, 'p', { body: 'Va quedando' });
    await updateTask(ctxA, 'p', { status: 'in_progress' });

    const detalle = await getTask(ctxA, 'p');
    expect(detalle.task.title).toBe('Padre');
    expect(detalle.subtasks.map((t) => t.id)).toEqual(['s']);
    expect(detalle.comments.map((c) => c.body)).toEqual(['Va quedando']);
    expect(detalle.events.map((e) => e.field)).toEqual(['status']);
  });
});

describe('deleteTask', () => {
  it('borra la tarea del tenant', async () => {
    await deleteTask(ctxA, 't-a1');
    expect(db.tabla('tasks').some((t) => t.id === 't-a1')).toBe(false);
  });
});
