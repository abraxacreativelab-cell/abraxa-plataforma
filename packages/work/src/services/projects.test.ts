import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PlatformError, __setClientForTests } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import { createFakeDb, type FakeDb, type Fila } from '../testing/fake-db';
import { createProject, deleteProject, listProjects, updateProject } from './projects';

const A = '00000000-0000-0000-0000-0000000000aa';
const B = '00000000-0000-0000-0000-0000000000bb';

const ctxDe = (tenantId: string): TenantContext => ({
  tenantId,
  tenantSlug: tenantId === A ? 'panaderia-lupita' : 'taller-de-beto',
  userEmail: tenantId === A ? 'lupita@ejemplo.mx' : 'beto@ejemplo.mx',
  role: 'owner',
  areas: {},
});

const ctxA = ctxDe(A);
const ctxB = ctxDe(B);

const fila = (patch: Fila): Fila => ({
  status: 'active',
  position: 0,
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z',
  ...patch,
});

let db: FakeDb;
let restaurar: () => void;

beforeEach(() => {
  db = createFakeDb({
    projects: [
      fila({ id: 'p-a1', tenant_id: A, name: 'Apertura de sucursal', position: 1 }),
      fila({ id: 'p-a2', tenant_id: A, name: 'Bodega', position: 0 }),
      fila({ id: 'p-b1', tenant_id: B, name: 'Taller nuevo' }),
    ],
    tasks: [
      { id: 't1', tenant_id: A, project_id: 'p-a1', title: 'Firmar', status: 'pending' },
      { id: 't2', tenant_id: A, project_id: 'p-a1', title: 'Pintar', status: 'pending' },
      { id: 't3', tenant_id: A, project_id: null, title: 'Suelta', status: 'pending' },
    ],
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

describe('aislamiento por tenant', () => {
  it('cada quien ve sus proyectos', async () => {
    expect((await listProjects(ctxA)).map((p) => p.id)).toEqual(['p-a2', 'p-a1']);
    expect((await listProjects(ctxB)).map((p) => p.id)).toEqual(['p-b1']);
  });

  it('no se puede editar el de otro', async () => {
    expect((await esperarError(() => updateProject(ctxA, 'p-b1', { name: 'mío' }))).code).toBe('NOT_FOUND');
    expect(db.tabla('projects').find((p) => p.id === 'p-b1')?.name).toBe('Taller nuevo');
  });

  it('ni borrarlo', async () => {
    await esperarError(() => deleteProject(ctxA, 'p-b1'));
    expect(db.tabla('projects').some((p) => p.id === 'p-b1')).toBe(true);
  });
});

describe('createProject', () => {
  it('estampa el tenant y quién lo creó', async () => {
    const p = await createProject(ctxA, { name: 'Catálogo nuevo' });
    const guardado = db.tabla('projects').find((x) => x.id === p.id);
    expect(guardado?.tenant_id).toBe(A);
    expect(guardado?.created_by).toBe('lupita@ejemplo.mx');
  });

  it('rechaza un nombre vacío y campos que no existen', async () => {
    expect((await esperarError(() => createProject(ctxA, { name: ' ' }))).code).toBe('VALIDATION');
    expect((await esperarError(() => createProject(ctxA, { name: 'x', company_id: 'inperio' }))).code).toBe(
      'VALIDATION',
    );
  });
});

describe('deleteProject', () => {
  it('NO se lleva las tareas: un proyecto es una carpeta, no un dueño', async () => {
    const { orphaned } = await deleteProject(ctxA, 'p-a1');
    expect(orphaned).toBe(2);
    // Las tareas siguen ahí. El `ON DELETE SET NULL` de la 070 las suelta.
    expect(db.tabla('tasks')).toHaveLength(3);
  });

  it('dice cuántas tareas quedaron sueltas, para poder avisarlo antes', async () => {
    expect((await deleteProject(ctxA, 'p-a2')).orphaned).toBe(0);
  });
});
