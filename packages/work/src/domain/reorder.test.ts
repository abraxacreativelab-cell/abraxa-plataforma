import { describe, expect, it } from 'vitest';
import { tarea } from '../testing/factories';
import { planReorder } from './reorder';

const padre = tarea({ id: 'p', status: 'in_progress' });
const subAbierta = tarea({ id: 's1', parent_id: 'p', status: 'pending', title: 'Pedir el permiso' });
const subCerrada = tarea({ id: 's2', parent_id: 'p', status: 'completed' });
const suelta = tarea({ id: 'x', status: 'pending' });

describe('planReorder — forma', () => {
  it('rechaza un arreglo vacío', () => {
    expect(planReorder([], [])).toMatchObject({ ok: false, reason: 'invalid' });
    expect(planReorder([], 'no soy un arreglo')).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('exige id y sort_order en cada movimiento', () => {
    expect(planReorder([suelta], [{ sort_order: 1 }])).toMatchObject({ ok: false, reason: 'invalid' });
    expect(planReorder([suelta], [{ id: 'x' }])).toMatchObject({ ok: false, reason: 'invalid' });
    expect(planReorder([suelta], [{ id: 'x', sort_order: Number.NaN }])).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
  });

  it('rechaza ids repetidos: dos posiciones para la misma tarjeta no significan nada', () => {
    const plan = planReorder([suelta], [
      { id: 'x', sort_order: 1 },
      { id: 'x', sort_order: 2 },
    ]);
    expect(plan).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('rechaza estados y prioridades inventados antes de mirar si la tarea existe', () => {
    // El error útil es el del valor inválido, no un 404 que manda a buscar en
    // el lugar equivocado.
    expect(planReorder([], [{ id: 'fantasma', sort_order: 1, status: 'archivada' }])).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
    expect(planReorder([suelta], [{ id: 'x', sort_order: 1, priority: 'altísima' }])).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
  });

  it('deja pasar sólo los campos que un arrastre puede cambiar', () => {
    const plan = planReorder([suelta], [
      { id: 'x', sort_order: 3, status: 'blocked', assigned_to: null, tenant_id: 'EL-DE-OTRO', title: 'pwned' },
    ]);
    expect(plan).toEqual({
      ok: true,
      moves: [{ id: 'x', sort_order: 3, status: 'blocked', assigned_to: null }],
    });
  });

  it('distingue "no viene la clave" de "viene en null"', () => {
    // Sin la distinción, cada arrastre en el tablero de estados desasignaría al
    // responsable de la tarjeta.
    const sinClave = planReorder([suelta], [{ id: 'x', sort_order: 1 }]);
    expect(sinClave).toEqual({ ok: true, moves: [{ id: 'x', sort_order: 1 }] });

    const conNull = planReorder([suelta], [{ id: 'x', sort_order: 1, project_id: null }]);
    expect(conNull).toEqual({ ok: true, moves: [{ id: 'x', sort_order: 1, project_id: null }] });
  });
});

describe('planReorder — existencia y aislamiento', () => {
  it('una tarea que no está en el conjunto del tenant es "no existe"', () => {
    // El conjunto lo cargó `tenantDb(ctx)`, así que una tarea de otro cliente
    // simplemente no está. La respuesta correcta es 404 y no 403: decir "existe
    // pero no es tuya" ya confirma que existe.
    const plan = planReorder([suelta], [{ id: 'de-otro-tenant', sort_order: 1 }]);
    expect(plan).toEqual({ ok: false, reason: 'not_found', taskId: 'de-otro-tenant' });
  });
});

describe('planReorder — el guard 409', () => {
  const universo = [padre, subAbierta, subCerrada, suelta];

  it('completar un padre con subtareas abiertas no procede, y dice cuáles', () => {
    const plan = planReorder(universo, [{ id: 'p', sort_order: 1, status: 'completed' }]);
    expect(plan.ok).toBe(false);
    if (plan.ok || plan.reason !== 'open_subtasks') throw new Error('debía ser open_subtasks');
    expect(plan.taskId).toBe('p');
    expect(plan.open.map((t) => t.title)).toEqual(['Pedir el permiso']);
  });

  it('mover el padre SIN completarlo sí procede', () => {
    expect(planReorder(universo, [{ id: 'p', sort_order: 9 }])).toMatchObject({ ok: true });
    expect(planReorder(universo, [{ id: 'p', sort_order: 9, status: 'blocked' }])).toMatchObject({ ok: true });
  });

  it('completar un padre que YA estaba completo no vuelve a disparar el guard', () => {
    // Reordenar una columna de "Listas" tocaría el guard en cada arrastre.
    const yaCompleto = tarea({ id: 'p2', status: 'completed' });
    const suSubAbierta = tarea({ id: 's3', parent_id: 'p2', status: 'pending' });
    const plan = planReorder([yaCompleto, suSubAbierta], [{ id: 'p2', sort_order: 1, status: 'completed' }]);
    expect(plan).toMatchObject({ ok: true });
  });

  it('completar una SUBTAREA nunca dispara el guard', () => {
    expect(planReorder(universo, [{ id: 's1', sort_order: 1, status: 'completed' }])).toMatchObject({ ok: true });
  });

  it('completar un padre cuyas subtareas ya están todas cerradas procede', () => {
    const p = tarea({ id: 'q' });
    const s = tarea({ id: 'qs', parent_id: 'q', status: 'completed' });
    expect(planReorder([p, s], [{ id: 'q', sort_order: 1, status: 'completed' }])).toMatchObject({ ok: true });
  });

  it('en un lote, un solo movimiento bloqueado detiene TODO', () => {
    // Es la razón de ser del reorder transaccional: no se aplica medio lote.
    const plan = planReorder(universo, [
      { id: 'x', sort_order: 1 },
      { id: 'p', sort_order: 2, status: 'completed' },
    ]);
    expect(plan).toMatchObject({ ok: false, reason: 'open_subtasks', taskId: 'p' });
  });
});
