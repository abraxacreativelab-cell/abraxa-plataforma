import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PlatformError, __setClientForTests } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import { createFakeDb, type FakeDb, type Fila } from '../testing/fake-db';
import { presetFor } from '../domain/view';
import { createView, deleteView, getView, listViews, updateView } from './views';

const A = '00000000-0000-0000-0000-0000000000aa';
const B = '00000000-0000-0000-0000-0000000000bb';

const ctxDe = (tenantId: string, userEmail: string): TenantContext => ({
  tenantId,
  tenantSlug: tenantId === A ? 'panaderia-lupita' : 'taller-de-beto',
  userEmail,
  role: 'owner',
  areas: {},
});

const lupita = ctxDe(A, 'lupita@ejemplo.mx');
const sofia = ctxDe(A, 'sofia@ejemplo.mx'); // del mismo tenant
const beto = ctxDe(B, 'beto@ejemplo.mx'); // de otro tenant

const filaVista = (patch: Fila): Fila => ({
  kind: 'progreso',
  config: {},
  shared: false,
  position: 0,
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z',
  ...patch,
});

let db: FakeDb;
let restaurar: () => void;

beforeEach(() => {
  db = createFakeDb({
    task_views: [
      filaVista({ id: 'v-mia', tenant_id: A, owner_email: 'lupita@ejemplo.mx', name: 'Mi semana' }),
      filaVista({
        id: 'v-compartida',
        tenant_id: A,
        owner_email: 'lupita@ejemplo.mx',
        name: 'Lo del equipo',
        shared: true,
      }),
      filaVista({ id: 'v-privada-sofia', tenant_id: A, owner_email: 'sofia@ejemplo.mx', name: 'Lo de Sofía' }),
      filaVista({
        id: 'v-de-otro-tenant',
        tenant_id: B,
        owner_email: 'beto@ejemplo.mx',
        name: 'Compartida en el taller',
        shared: true,
      }),
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

describe('criterio 5 — una vista compartida la ven los demás del tenant', () => {
  it('y sólo los del tenant', async () => {
    expect((await listViews(sofia)).map((v) => v.id).sort()).toEqual(['v-compartida', 'v-privada-sofia']);
    // La compartida del OTRO tenant no aparece por ningún lado.
    expect((await listViews(sofia)).map((v) => v.id)).not.toContain('v-de-otro-tenant');
    expect((await listViews(beto)).map((v) => v.id)).toEqual(['v-de-otro-tenant']);
  });

  it('las privadas de otra persona no se listan', async () => {
    expect((await listViews(lupita)).map((v) => v.id).sort()).toEqual(['v-compartida', 'v-mia']);
  });

  it('pedir por id una vista privada ajena es 404, no 403', async () => {
    expect((await esperarError(() => getView(lupita, 'v-privada-sofia'))).code).toBe('NOT_FOUND');
    expect((await esperarError(() => getView(beto, 'v-compartida'))).code).toBe('NOT_FOUND');
  });

  it('pedir por id una compartida del propio tenant sí funciona', async () => {
    expect((await getView(sofia, 'v-compartida')).name).toBe('Lo del equipo');
  });
});

describe('sólo el dueño edita su vista', () => {
  it('compartir la hace visible, no editable por todos', async () => {
    const err = await esperarError(() => updateView(sofia, 'v-compartida', { name: 'La cambié yo' }));
    expect(err.code).toBe('FORBIDDEN');
    expect(db.tabla('task_views').find((v) => v.id === 'v-compartida')?.name).toBe('Lo del equipo');
  });

  it('ni borrarla', async () => {
    await esperarError(() => deleteView(sofia, 'v-compartida'));
    expect(db.tabla('task_views').some((v) => v.id === 'v-compartida')).toBe(true);
  });

  it('el dueño sí', async () => {
    expect((await updateView(lupita, 'v-compartida', { name: 'Lo del equipo v2' })).name).toBe(
      'Lo del equipo v2',
    );
    await deleteView(lupita, 'v-mia');
    expect(db.tabla('task_views').some((v) => v.id === 'v-mia')).toBe(false);
  });

  it('alguien de otro tenant ni siquiera la encuentra', async () => {
    expect((await esperarError(() => updateView(beto, 'v-compartida', { name: 'x' }))).code).toBe('NOT_FOUND');
  });
});

describe('normalización', () => {
  it('la configuración se limpia AL GUARDAR', async () => {
    const vista = await createView(lupita, {
      name: 'Con basura',
      kind: 'progreso',
      config: {
        filters: { op: 'and', rules: [{ prop: 'company_id', cond: 'is', value: 'inperio' }] },
        groupBy: 'milestone_id',
        sorts: 'no soy un arreglo',
      },
    });
    expect(vista.config.filters.rules).toEqual([]);
    expect(vista.config.groupBy).toBeNull();
    expect(vista.config.sorts).toEqual([]);
  });

  it('y también AL LEER, para que una fila vieja abra la pantalla igual', async () => {
    db.sembrar('task_views', [
      filaVista({
        id: 'v-vieja',
        tenant_id: A,
        owner_email: 'lupita@ejemplo.mx',
        name: 'De la versión pasada',
        kind: 'timeline', // una vista que ya no existe
        config: { colorBy: 'company_id', groupBy: 'company_id' },
      }),
    ]);
    const [vista] = await listViews(lupita);
    expect(vista?.kind).toBe('progreso');
    expect(vista?.config.groupBy).toBeNull();
  });

  it('el tenant se estampa solo', async () => {
    const vista = await createView(lupita, { name: 'Nueva', kind: 'calendario' });
    expect(db.tabla('task_views').find((v) => v.id === vista.id)?.tenant_id).toBe(A);
    expect(vista.owner_email).toBe('lupita@ejemplo.mx');
  });

  it('sin configuración toma el preset de su clase', async () => {
    const vista = await createView(lupita, { name: 'Vacía', kind: 'proyecto' });
    expect(vista.config).toEqual(presetFor('proyecto'));
  });

  it('rechaza una clase de vista que no es de las cuatro', async () => {
    expect((await esperarError(() => createView(lupita, { name: 'x', kind: 'gallery' }))).code).toBe(
      'VALIDATION',
    );
  });

  it('rechaza un nombre vacío', async () => {
    expect((await esperarError(() => createView(lupita, { name: '  ', kind: 'progreso' }))).code).toBe(
      'VALIDATION',
    );
  });
});
