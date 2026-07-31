import { describe, expect, it } from 'vitest';
import { miembro, proyecto, tarea } from '../testing/factories';
import { SIN_VALOR, buildGroups, dropPatch, groupKeyOf, groupLabelOf, progressOf, sortOrderFor } from './group';

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

describe('sortOrderFor', () => {
  const vecinos = [tarea({ sort_order: 10 }), tarea({ sort_order: 20 }), tarea({ sort_order: 30 })];

  it('en medio toma el punto medio entre sus dos nuevos vecinos', () => {
    expect(sortOrderFor(vecinos, 1)).toBe(15);
    expect(sortOrderFor(vecinos, 2)).toBe(25);
  });

  it('al principio y al final se sale del rango', () => {
    expect(sortOrderFor(vecinos, 0)).toBe(9);
    expect(sortOrderFor(vecinos, 3)).toBe(31);
  });

  it('en una columna vacía es cero', () => {
    expect(sortOrderFor([], 0)).toBe(0);
  });

  it('el resultado siempre cae entre los vecinos, que es lo único que importa', () => {
    for (let i = 0; i <= vecinos.length; i++) {
      const valor = sortOrderFor(vecinos, i);
      const antes = vecinos[i - 1]?.sort_order;
      const despues = vecinos[i]?.sort_order;
      if (antes !== undefined) expect(valor).toBeGreaterThan(antes);
      if (despues !== undefined) expect(valor).toBeLessThan(despues);
    }
  });
});
