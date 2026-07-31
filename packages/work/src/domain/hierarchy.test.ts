import { describe, expect, it } from 'vitest';
import { tarea } from '../testing/factories';
import {
  buildTree,
  buildVisibleTree,
  canComplete,
  openSubtasks,
  subtaskSummary,
  suggestedParentStatus,
} from './hierarchy';

describe('openSubtasks', () => {
  const padre = tarea({ id: 'p' });
  const abierta = tarea({ id: 's1', parent_id: 'p', status: 'in_progress' });
  const bloqueada = tarea({ id: 's2', parent_id: 'p', status: 'blocked' });
  const cerrada = tarea({ id: 's3', parent_id: 'p', status: 'completed' });
  const cancelada = tarea({ id: 's4', parent_id: 'p', status: 'cancelled' });
  const ajena = tarea({ id: 's5', parent_id: 'otro', status: 'pending' });

  it('cuenta pendiente, en progreso y bloqueada', () => {
    const abiertas = openSubtasks([padre, abierta, bloqueada, cerrada, cancelada, ajena], 'p');
    expect(abiertas.map((t) => t.id)).toEqual(['s1', 's2']);
  });

  it('una cancelada NO estorba para completar el padre', () => {
    // Cancelar es una manera de cerrar. Si contara como abierta, cancelar una
    // subtarea dejaría al padre imposible de completar para siempre.
    expect(openSubtasks([padre, cancelada], 'p')).toEqual([]);
  });
});

describe('canComplete — el guard que devuelve 409', () => {
  it('deja completar cuando no hay subtareas', () => {
    expect(canComplete([tarea({ id: 'p' })], 'p')).toEqual({ ok: true });
  });

  it('deja completar cuando todas las subtareas están cerradas', () => {
    const t = [tarea({ id: 'p' }), tarea({ id: 's', parent_id: 'p', status: 'completed' })];
    expect(canComplete(t, 'p')).toEqual({ ok: true });
  });

  it('NO deja completar con subtareas abiertas, y devuelve cuáles', () => {
    const abierta = tarea({ id: 's', parent_id: 'p', status: 'pending', title: 'Pedir el permiso' });
    const veredicto = canComplete([tarea({ id: 'p' }), abierta], 'p');
    expect(veredicto.ok).toBe(false);
    if (veredicto.ok) throw new Error('debía fallar');
    // Los TÍTULOS son la razón por la que se devuelven las filas y no los ids:
    // el modal dice "Pedir el permiso", no "s".
    expect(veredicto.open.map((t) => t.title)).toEqual(['Pedir el permiso']);
  });

  it('una subtarea siempre se puede completar', () => {
    const sub = tarea({ id: 's', parent_id: 'p' });
    expect(canComplete([tarea({ id: 'p' }), sub], 's')).toEqual({ ok: true });
  });
});

describe('buildTree', () => {
  it('cuelga las subtareas de su padre y las saca del listado raíz', () => {
    const p = tarea({ id: 'p' });
    const s1 = tarea({ id: 's1', parent_id: 'p', sort_order: 2 });
    const s2 = tarea({ id: 's2', parent_id: 'p', sort_order: 1 });
    const arbol = buildTree([p, s1, s2]);

    expect(arbol.map((t) => t.id)).toEqual(['p']);
    expect(arbol[0]?.subtasks.map((t) => t.id)).toEqual(['s2', 's1']);
  });

  it('una subtarea cuyo padre no está en el conjunto se muestra como raíz', () => {
    // Si se escondiera, filtrar por "urgentes" haría desaparecer subtareas
    // urgentes cuyo padre no es urgente — y nadie entendería por qué.
    const huerfana = tarea({ id: 's', parent_id: 'no-cargado' });
    expect(buildTree([huerfana]).map((t) => t.id)).toEqual(['s']);
  });

  it('un conjunto sin jerarquía sale igual', () => {
    const t = [tarea({ id: 'a' }), tarea({ id: 'b' })];
    expect(buildTree(t).map((x) => x.subtasks)).toEqual([[], []]);
  });

  it('no muta lo que recibe', () => {
    const p = tarea({ id: 'p' });
    const s = tarea({ id: 's', parent_id: 'p' });
    const entrada = [p, s];
    buildTree(entrada);
    expect(entrada).toEqual([p, s]);
    expect('subtasks' in p).toBe(false);
  });
});

describe('buildVisibleTree', () => {
  const p = tarea({ id: 'p', status: 'in_progress' });
  const hecha = tarea({ id: 's1', parent_id: 'p', status: 'completed', sort_order: 1 });
  const falta = tarea({ id: 's2', parent_id: 'p', status: 'pending', sort_order: 2 });
  const todas = [p, hecha, falta];

  it('el contador cuenta TODAS las subtareas, no sólo las que pasan el filtro', () => {
    // Con el filtro "abiertas", `s1` no está en `visible`. Componer
    // buildTree(applyView(...)) diría "0/1"; la verdad es "1/2".
    const visible = [p, falta];
    const arbol = buildVisibleTree(todas, visible);

    expect(arbol.map((t) => t.id)).toEqual(['p']);
    expect(subtaskSummary(arbol[0]?.subtasks ?? [])).toEqual({ done: 1, total: 2 });
  });

  it('respeta el orden que trae `visible`', () => {
    const otra = tarea({ id: 'z', status: 'pending' });
    expect(buildVisibleTree([...todas, otra], [otra, p]).map((t) => t.id)).toEqual(['z', 'p']);
  });

  it('una subtarea que pasa el filtro y cuyo padre no, se muestra como raíz', () => {
    const arbol = buildVisibleTree(todas, [falta]);
    expect(arbol.map((t) => t.id)).toEqual(['s2']);
    expect(arbol[0]?.subtasks).toEqual([]);
  });

  it('ordena las subtareas por sort_order', () => {
    const a = tarea({ id: 'a', parent_id: 'p', sort_order: 9 });
    const b = tarea({ id: 'b', parent_id: 'p', sort_order: 1 });
    const arbol = buildVisibleTree([p, a, b], [p]);
    expect(arbol[0]?.subtasks.map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('no muta lo que recibe', () => {
    const entrada = [p, hecha, falta];
    buildVisibleTree(entrada, [p]);
    expect('subtasks' in p).toBe(false);
    expect(entrada.map((t) => t.id)).toEqual(['p', 's1', 's2']);
  });

  // ── `splitBy`: colgar es esconder ─────────────────────────────────────────

  describe('una subtarea sólo se cuelga si cae en la MISMA columna', () => {
    const jefa = tarea({ id: 'p', assigned_to: 'lupita@ejemplo.mx' });
    const suya = tarea({ id: 'mia', parent_id: 'p', assigned_to: 'lupita@ejemplo.mx' });
    const ajena = tarea({ id: 'suya', parent_id: 'p', assigned_to: 'beto@ejemplo.mx' });
    const conjunto = [jefa, suya, ajena];

    it('sin splitBy, todo se cuelga como antes', () => {
      expect(buildVisibleTree(conjunto, conjunto).map((t) => t.id)).toEqual(['p']);
    });

    it('con splitBy, la de otro responsable sale a flote y la del mismo no', () => {
      const arbol = buildVisibleTree(conjunto, conjunto, { splitBy: 'assigned_to' });
      expect(arbol.map((t) => t.id)).toEqual(['p', 'suya']);
    });

    it('la que salió a flote SIGUE contando para el padre', () => {
      const arbol = buildVisibleTree(conjunto, conjunto, { splitBy: 'assigned_to' });
      expect(arbol[0]?.subtasks.map((t) => t.id)).toEqual(['mia', 'suya']);
    });

    it('sale a flote sin subtareas propias: no puede tenerlas', () => {
      const arbol = buildVisibleTree(conjunto, conjunto, { splitBy: 'assigned_to' });
      expect(arbol[1]?.subtasks).toEqual([]);
    });

    it('splitBy por una propiedad que padre e hija comparten no saca a nadie', () => {
      expect(buildVisibleTree(conjunto, conjunto, { splitBy: 'priority' }).map((t) => t.id)).toEqual(['p']);
    });
  });
});

describe('subtaskSummary', () => {
  it('cuenta hechas sobre el total', () => {
    const subs = [
      tarea({ status: 'completed' }),
      tarea({ status: 'completed' }),
      tarea({ status: 'pending' }),
    ];
    expect(subtaskSummary(subs)).toEqual({ done: 2, total: 3 });
  });
});

describe('suggestedParentStatus', () => {
  it('sugiere completar cuando ya no falta nada', () => {
    expect(suggestedParentStatus([tarea({ status: 'completed' })])).toBe('completed');
  });

  it('sugiere "en progreso" en cuanto algo arrancó', () => {
    expect(suggestedParentStatus([tarea({ status: 'in_progress' }), tarea({ status: 'pending' })])).toBe(
      'in_progress',
    );
  });

  it('no sugiere nada si nadie ha empezado', () => {
    expect(suggestedParentStatus([tarea({ status: 'pending' })])).toBeNull();
  });

  it('sin subtareas no hay nada que sugerir', () => {
    expect(suggestedParentStatus([])).toBeNull();
  });
});
