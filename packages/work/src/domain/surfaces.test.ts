import { describe, expect, it } from 'vitest';
import { miembro, tarea } from '../testing/factories';
import { buildMonth, overdue } from './calendar';
import { SIN_VALOR } from './group';
import type { Task } from './types';
import { buildSurfaces } from './surfaces';
import { presetFor, type ViewConfig } from './view';

/**
 * Las dos maneras en que una subtarea se caía de la pantalla.
 *
 * Las dos tenían el mismo origen —la vista recibía el ÁRBOL, y en el árbol las
 * subtareas no son tarjetas sino renglones dentro de su padre— y ninguna de las
 * 454 pruebas anteriores las veía, porque cada pieza se probaba sola y el
 * defecto sólo existe al componerlas.
 */

const AHORA = new Date('2026-08-15T10:00:00');

/** Una config sin filtros: aquí lo que se prueba es la FORMA, no el filtro. */
const config = (patch: Partial<ViewConfig> = {}): ViewConfig => ({
  ...presetFor('progreso'),
  filters: { op: 'and', rules: [] },
  ...patch,
});

const idsDelDia = (mes: ReturnType<typeof buildMonth>, fecha: string): string[] =>
  mes.weeks
    .flat()
    .find((d) => d.date === fecha)
    ?.tasks.map((t) => t.id) ?? [];

// ════════════════════════════════════════════════════════════════════════════
// B · El calendario
// ════════════════════════════════════════════════════════════════════════════

describe('el calendario recibe tarjetas planas, no el árbol', () => {
  // El padre vence DESPUÉS de hoy a propósito: así la franja de vencidas mide
  // sólo lo que se está probando, que es la subtarea.
  const padre = tarea({ id: 'p', title: 'Abrir la sucursal', due_date: '2026-08-25' });
  const conFecha = tarea({ id: 's-fecha', parent_id: 'p', due_date: '2026-08-20' });
  const vencida = tarea({ id: 's-vencida', parent_id: 'p', due_date: '2026-08-01', status: 'pending' });
  const sinFecha = tarea({ id: 's-sin', parent_id: 'p', due_date: null });
  const todas = [padre, conFecha, vencida, sinFecha];

  const mes = (): ReturnType<typeof buildMonth> =>
    buildMonth(2026, 8, buildSurfaces(todas, config(), {}, AHORA).calendar, AHORA);

  it('una subtarea con fecha propia aparece EN SU DÍA', () => {
    // Con el árbol, el día 20 salía vacío: `s-fecha` estaba colgada de `p`.
    expect(idsDelDia(mes(), '2026-08-20')).toEqual(['s-fecha']);
  });

  it('el padre sigue en el suyo, y cada uno en el suyo', () => {
    expect(idsDelDia(mes(), '2026-08-25')).toEqual(['p']);
  });

  it('una subtarea vencida sale en la franja de vencidas', () => {
    const cal = buildSurfaces(todas, config(), {}, AHORA).calendar;
    expect(overdue(cal, AHORA).map((t) => t.id)).toEqual(['s-vencida']);
  });

  it('una subtarea sin fecha sale en la franja de "sin fecha"', () => {
    // No es cosmético: la ÚNICA manera de ponerle fecha a algo en esta vista es
    // arrastrarlo desde esa franja. Escondida ahí, no había forma de fecharla.
    expect(mes().undated.map((t) => t.id)).toEqual(['s-sin']);
  });

  it('el filtro sigue mandando: una subtarea que no pasa el filtro no se cuela', () => {
    // El árbol conserva las subtareas filtradas para que el contador del padre
    // diga la verdad; el calendario no puede heredar ese arrastre.
    const hecha = tarea({ id: 's-hecha', parent_id: 'p', due_date: '2026-08-12', status: 'completed' });
    const cal = buildSurfaces([...todas, hecha], config({ filters: presetFor('progreso').filters }), {}, AHORA)
      .calendar;
    expect(cal.map((t) => t.id)).not.toContain('s-hecha');
  });

  it('ninguna tarea visible se queda fuera del calendario', () => {
    const s = buildSurfaces(todas, config(), {}, AHORA);
    const enCalendario = new Set(s.calendar.map((t) => t.id));
    for (const t of s.visible) expect(enCalendario.has(t.id)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// C · Las columnas
// ════════════════════════════════════════════════════════════════════════════

describe('agrupar por responsable no esconde el trabajo de nadie', () => {
  const lupita = miembro({ email: 'lupita@ejemplo.mx', name: 'Lupita' });
  const beto = miembro({ email: 'beto@ejemplo.mx', name: 'Beto' });

  const padre = tarea({ id: 'p', title: 'Abrir la sucursal', assigned_to: lupita.email });
  const deBeto = tarea({ id: 's-beto', parent_id: 'p', title: 'Tramitar el gas', assigned_to: beto.email });
  const deLupita = tarea({ id: 's-lupita', parent_id: 'p', assigned_to: lupita.email });
  const todas = [padre, deBeto, deLupita];

  const columnas = (tasks: Task[] = todas): Map<string, string[]> =>
    new Map(
      buildSurfaces(
        tasks,
        config({ groupBy: 'assigned_to' }),
        { members: [lupita, beto] },
        AHORA,
      ).groups.map((g) => [g.key, g.tasks.map((t) => t.id)]),
    );

  it('la subtarea asignada a otra persona SALE EN LA COLUMNA DE ESA PERSONA', () => {
    // Antes: la columna de Beto salía vacía. Su trabajo estaba dibujado dentro
    // de la tarjeta de Lupita, en la columna de Lupita.
    expect(columnas().get(beto.email)).toEqual(['s-beto']);
  });

  it('la que sí es de la misma persona se queda colgada del padre', () => {
    expect(columnas().get(lupita.email)).toEqual(['p']);
  });

  it('el contador del padre sigue contando TODAS sus subtareas', () => {
    // Sacar la subtarea a flote no la descuenta del padre: "1/2" es el trabajo
    // del padre, no el que cabe en su columna.
    const grupos = buildSurfaces(todas, config({ groupBy: 'assigned_to' }), { members: [lupita, beto] }, AHORA)
      .groups;
    const tarjetaDelPadre = grupos.flatMap((g) => g.tasks).find((t) => t.id === 'p');
    expect(tarjetaDelPadre?.subtasks.map((s) => s.id)).toEqual(['s-beto', 's-lupita']);
  });

  it('una subtarea sin responsable cae en "Sin responsable" y se puede asignar arrastrando', () => {
    const huerfana = tarea({ id: 's-nadie', parent_id: 'p', assigned_to: null });
    expect(columnas([...todas, huerfana]).get(SIN_VALOR)).toEqual(['s-nadie']);
  });

  it('nadie aparece dos veces en la misma columna', () => {
    for (const [, ids] of columnas()) expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('agrupar por estado tampoco esconde el trabajo', () => {
  const padre = tarea({ id: 'p', status: 'pending' });
  const enCurso = tarea({ id: 's', parent_id: 'p', status: 'in_progress' });

  it('la subtarea en curso aparece en la columna "En curso"', () => {
    // Además de que la columna mentía en su cuenta, la tarjeta no existía —y
    // sin tarjeta no hay a qué arrastrar para cambiarle el estado.
    const grupos = buildSurfaces([padre, enCurso], config({ groupBy: 'status' }), {}, AHORA).groups;
    expect(grupos.find((g) => g.key === 'in_progress')?.tasks.map((t) => t.id)).toEqual(['s']);
    expect(grupos.find((g) => g.key === 'pending')?.tasks.map((t) => t.id)).toEqual(['p']);
  });
});

describe('sin agrupación nada cambia', () => {
  it('la subtarea sigue colgada de su padre en la lista', () => {
    const padre = tarea({ id: 'p', assigned_to: 'lupita@ejemplo.mx' });
    const hija = tarea({ id: 's', parent_id: 'p', assigned_to: 'beto@ejemplo.mx' });
    const grupos = buildSurfaces([padre, hija], config({ groupBy: null }), {}, AHORA).groups;

    expect(grupos).toHaveLength(1);
    expect(grupos[0]?.tasks.map((t) => t.id)).toEqual(['p']);
    expect(grupos[0]?.tasks[0]?.subtasks.map((t) => t.id)).toEqual(['s']);
  });
});
