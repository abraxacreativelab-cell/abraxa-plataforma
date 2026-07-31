import { describe, expect, it } from 'vitest';
import { miembro, proyecto, tarea } from '../testing/factories';
import { SIN_VALOR, buildGroups, dropPatch, groupKeyOf, groupLabelOf, planDrop, progressOf } from './group';
import type { Task } from './types';

describe('buildGroups', () => {
  it('muestra las columnas de estado aunque estén vacías', () => {
    // Una columna "Bloqueada" que desaparece cuando no hay nada bloqueado es
    // una columna a la que no se puede arrastrar — y arrastrar ahí es cómo se
    // bloquea una tarea.
    const grupos = buildGroups([tarea({ status: 'pending' })], 'status');
    expect(grupos.map((g) => g.key)).toEqual(['pending', 'in_progress', 'blocked', 'completed']);
    expect(grupos.find((g) => g.key === 'blocked')?.tasks).toEqual([]);
  });

  it('no ofrece una columna "cancelled": no se cancela arrastrando', () => {
    expect(buildGroups([], 'status').map((g) => g.key)).not.toContain('cancelled');
  });

  it('ordena los proyectos por su posición y no por como llegaron', () => {
    const b = proyecto({ id: 'b', name: 'Bodega', position: 0 });
    const a = proyecto({ id: 'a', name: 'Apertura', position: 1 });
    const grupos = buildGroups([tarea({ project_id: 'a' })], 'project_id', { projects: [a, b] });
    expect(grupos.map((g) => g.key)).toEqual(['b', 'a', SIN_VALOR]);
  });

  it('pone el grupo "sin valor" al final aunque su primera tarea llegue antes', () => {
    // Sin miembros declarados, el bucket vacío se crearía PRIMERO al recorrer
    // las tareas y quedaría intercalado. Se saca y se vuelve a poner al final.
    const tareas = [tarea({ assigned_to: null }), tarea({ assigned_to: 'ana@x.mx' })];
    const grupos = buildGroups(tareas, 'assigned_to', { members: [] });
    expect(grupos.map((g) => g.key)).toEqual(['ana@x.mx', SIN_VALOR]);
  });

  it('sin agrupación devuelve un solo grupo que no acepta arrastres', () => {
    const grupos = buildGroups([tarea()], null);
    expect(grupos).toHaveLength(1);
    expect(grupos[0]?.droppable).toBe(false);
  });

  it('"sin responsable" y "sin proyecto" SÍ aceptan tarjetas; "sin estado" no', () => {
    expect(buildGroups([], 'assigned_to').at(-1)).toMatchObject({ key: SIN_VALOR, droppable: true });
    expect(buildGroups([], 'project_id').at(-1)).toMatchObject({ key: SIN_VALOR, droppable: true });
    expect(buildGroups([], 'status').map((g) => g.key)).not.toContain(SIN_VALOR);
  });

  it('un valor que no está declarado (un responsable que ya no es miembro) no desaparece', () => {
    const grupos = buildGroups([tarea({ assigned_to: 'exempleado@x.mx' })], 'assigned_to', { members: [] });
    expect(grupos.find((g) => g.key === 'exempleado@x.mx')?.tasks).toHaveLength(1);
  });

  it('no pierde ninguna tarea', () => {
    const tareas = [
      tarea({ status: 'pending' }),
      tarea({ status: 'blocked' }),
      tarea({ status: 'completed' }),
      tarea({ status: 'cancelled' }),
    ];
    const total = buildGroups(tareas, 'status').reduce((n, g) => n + g.tasks.length, 0);
    expect(total).toBe(tareas.length);
  });
});

describe('groupKeyOf y groupLabelOf', () => {
  it('resuelve el nombre del proyecto desde los datos, no desde una lista escrita a mano', () => {
    // GARDEN tenía los ids de empresa en `lib/brand.ts`; aquí todo sale de la
    // fila que ya se cargó.
    const p = proyecto({ id: 'p1', name: 'Apertura de sucursal' });
    expect(groupLabelOf('p1', 'project_id', { projects: [p] })).toBe('Apertura de sucursal');
  });

  it('usa el nombre del miembro y cae al correo cuando no hay nombre', () => {
    const ctx = { members: [miembro({ email: 'ana@x.mx', name: 'Ana' }), miembro({ email: 'b@x.mx', name: null })] };
    expect(groupLabelOf('ana@x.mx', 'assigned_to', ctx)).toBe('Ana');
    expect(groupLabelOf('b@x.mx', 'assigned_to', ctx)).toBe('b@x.mx');
    expect(groupLabelOf('nadie@x.mx', 'assigned_to', ctx)).toBe('nadie@x.mx');
  });

  it('etiqueta el bucket vacío según lo que falta', () => {
    expect(groupLabelOf(SIN_VALOR, 'assigned_to')).toBe('Sin responsable');
    expect(groupLabelOf(SIN_VALOR, 'project_id')).toBe('Sin proyecto');
  });

  it('la cadena vacía cuenta como "sin valor", igual que el nulo', () => {
    expect(groupKeyOf(tarea({ assigned_to: '' }), 'assigned_to')).toBe(SIN_VALOR);
    expect(groupKeyOf(tarea({ assigned_to: null }), 'assigned_to')).toBe(SIN_VALOR);
  });
});

describe('dropPatch', () => {
  it('soltar en otra columna cambia exactamente el campo de esa agrupación', () => {
    expect(dropPatch('status', 'in_progress')).toEqual({ status: 'in_progress' });
    expect(dropPatch('priority', 'alta')).toEqual({ priority: 'alta' });
    expect(dropPatch('project_id', 'p1')).toEqual({ project_id: 'p1' });
  });

  it('soltar en "sin responsable" desasigna', () => {
    expect(dropPatch('assigned_to', SIN_VALOR)).toEqual({ assigned_to: null });
    expect(dropPatch('project_id', SIN_VALOR)).toEqual({ project_id: null });
  });

  it('no hay manera de dejar una tarea sin estado ni sin prioridad', () => {
    expect(dropPatch('status', SIN_VALOR)).toBeNull();
    expect(dropPatch('priority', SIN_VALOR)).toBeNull();
    expect(dropPatch(null, 'lo-que-sea')).toBeNull();
  });
});

describe('progressOf', () => {
  it('cuenta hechas, abiertas y porcentaje', () => {
    const tareas = [
      tarea({ status: 'completed' }),
      tarea({ status: 'completed' }),
      tarea({ status: 'pending' }),
      tarea({ status: 'blocked' }),
    ];
    expect(progressOf(tareas)).toEqual({ total: 4, done: 2, open: 2, pct: 50 });
  });

  it('sin tareas el porcentaje es 0, nunca 100', () => {
    // Un 100% sobre cero tareas es la clase de dato que hace que alguien deje
    // de creerle al panel.
    expect(progressOf([])).toEqual({ total: 0, done: 0, open: 0, pct: 0 });
  });

  it('una cancelada no cuenta como hecha ni como abierta', () => {
    expect(progressOf([tarea({ status: 'cancelled' })])).toEqual({ total: 1, done: 0, open: 0, pct: 0 });
  });
});

describe('planDrop', () => {
  const vecinos = [tarea({ sort_order: 10 }), tarea({ sort_order: 20 }), tarea({ sort_order: 30 })];

  /**
   * Aplica el plan y devuelve la columna COMO SE VERÍA DESPUÉS DE RECARGAR:
   * ordenada por `sort_order`, que es lo que hace `listTasks`.
   *
   * Las pruebas de abajo afirman sobre eso y no sobre los números, porque el
   * número es un detalle y "la tarjeta se queda donde la solté" es el criterio
   * observable 4. Con la implementación anterior, esta función devolvía el
   * mismo orden con el que entraba.
   */
  const despuesDeSoltar = (columna: Task[], index: number, arrastrada: Task): string[] => {
    const plan = planDrop(columna, index);
    const nuevos = new Map<string, number>(plan.renumber.map((r) => [r.id, r.sort_order]));
    return [
      ...columna.map((t) => ({ ...t, sort_order: nuevos.get(t.id) ?? t.sort_order })),
      { ...arrastrada, sort_order: plan.sort_order },
    ]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((t) => t.id);
  };

  it('en medio toma el punto medio entre sus dos nuevos vecinos', () => {
    expect(planDrop(vecinos, 1)).toEqual({ sort_order: 15, renumber: [] });
    expect(planDrop(vecinos, 2)).toEqual({ sort_order: 25, renumber: [] });
  });

  it('al principio y al final se sale del rango', () => {
    expect(planDrop(vecinos, 0)).toEqual({ sort_order: 9, renumber: [] });
    expect(planDrop(vecinos, 3)).toEqual({ sort_order: 31, renumber: [] });
  });

  it('en una columna vacía es cero', () => {
    expect(planDrop([], 0)).toEqual({ sort_order: 0, renumber: [] });
  });

  it('con hueco de sobra no mueve a nadie más', () => {
    for (let i = 0; i <= vecinos.length; i++) {
      const { sort_order, renumber } = planDrop(vecinos, i);
      expect(renumber).toEqual([]);
      const antes = vecinos[i - 1]?.sort_order;
      const despues = vecinos[i]?.sort_order;
      if (antes !== undefined) expect(sort_order).toBeGreaterThan(antes);
      if (despues !== undefined) expect(sort_order).toBeLessThan(despues);
    }
  });

  // ── El defecto que typecheck, lint y 454 pruebas no podían ver ────────────

  it('entre dos vecinos EMPATADOS la tarjeta se queda donde la soltaron', () => {
    // Era el estado por defecto de la base: `sort_order numeric DEFAULT 0`.
    // El punto medio entre 0 y 0 es 0, así que el reorder escribía el valor que
    // la fila ya tenía y el servidor contestaba `{ moved: 1 }` — un no-op
    // reportado como éxito, y la tarjeta regresándose sola a su sitio.
    const empatados = [tarea({ id: 'C', sort_order: 0 }), tarea({ id: 'B', sort_order: 0 })];
    expect(despuesDeSoltar(empatados, 1, tarea({ id: 'A', sort_order: 0 }))).toEqual(['C', 'A', 'B']);
  });

  it('una columna entera empatada se endereza en UNA sola escritura', () => {
    const columna = [
      tarea({ id: 'x1', sort_order: 0 }),
      tarea({ id: 'x2', sort_order: 0 }),
      tarea({ id: 'x3', sort_order: 0 }),
    ];
    const plan = planDrop(columna, 2);
    // Sólo viajan las que de verdad cambian de número: `x1` ya valía 0.
    expect(plan.renumber).toEqual([
      { id: 'x2', sort_order: 1 },
      { id: 'x3', sort_order: 3 },
    ]);
    expect(despuesDeSoltar(columna, 2, tarea({ id: 'A' }))).toEqual(['x1', 'x2', 'A', 'x3']);
  });

  it('soltar en el mismo hueco doscientas veces seguidas nunca deja de funcionar', () => {
    // El promedio agota la precisión del doble en ~52 iteraciones sobre un
    // hueco de tamaño 1: a partir de ahí `(a + b) / 2` devuelve `a` y ese hueco
    // queda muerto para siempre. Con la renumeración, no.
    let columna: Task[] = [tarea({ id: 'ini', sort_order: 1 }), tarea({ id: 'fin', sort_order: 2 })];

    for (let k = 0; k < 200; k += 1) {
      const arrastrada = tarea({ id: `n${k}`, sort_order: 0 });
      const plan = planDrop(columna, 1);
      const nuevos = new Map<string, number>(plan.renumber.map((r) => [r.id, r.sort_order]));
      columna = [
        ...columna.map((t) => ({ ...t, sort_order: nuevos.get(t.id) ?? t.sort_order })),
        { ...arrastrada, sort_order: plan.sort_order },
      ].sort((a, b) => a.sort_order - b.sort_order);

      // La recién soltada queda SIEMPRE en la posición 1, que es donde se soltó.
      expect(columna[1]?.id).toBe(`n${k}`);
    }
    // Y no quedó ni un empate detrás.
    expect(new Set(columna.map((t) => t.sort_order)).size).toBe(columna.length);
  });

  it('si la columna no está ordenada por sort_order, renumera en vez de mentir', () => {
    // Es lo que pasará el día que la barra pueda ordenar por otra propiedad:
    // el orden que se ve deja de coincidir con el `sort_order` guardado.
    const desordenada = [tarea({ id: 'x', sort_order: 5 }), tarea({ id: 'y', sort_order: 1 })];
    expect(despuesDeSoltar(desordenada, 1, tarea({ id: 'A' }))).toEqual(['x', 'A', 'y']);
  });
});
