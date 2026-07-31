import { describe, expect, it } from 'vitest';
import { tarea } from '../testing/factories';
import { buildMonth, dueWithin, monthKey, overdue, shiftMonth } from './calendar';

// 31 de julio de 2026 a las 09:00, hora local.
const AHORA = new Date(2026, 6, 31, 9, 0, 0);

describe('buildMonth', () => {
  it('siempre son seis semanas de siete días, para que la rejilla no salte', () => {
    for (const mes of [1, 2, 6, 12]) {
      const m = buildMonth(2026, mes, [], AHORA);
      expect(m.weeks).toHaveLength(6);
      for (const semana of m.weeks) expect(semana).toHaveLength(7);
    }
  });

  it('la semana empieza en lunes', () => {
    // 1-jul-2026 es miércoles; la rejilla tiene que abrir el lunes 29-jun.
    const m = buildMonth(2026, 7, [], AHORA);
    expect(m.weeks[0]?.[0]?.date).toBe('2026-06-29');
    expect(m.weeks[0]?.[0]?.inMonth).toBe(false);
  });

  it('marca hoy y sólo hoy', () => {
    const m = buildMonth(2026, 7, [], AHORA);
    const hoy = m.weeks.flat().filter((d) => d.isToday);
    expect(hoy).toHaveLength(1);
    expect(hoy[0]?.date).toBe('2026-07-31');
  });

  it('coloca cada tarea en el día de su fecha de entrega', () => {
    const t = tarea({ due_date: '2026-07-15' });
    const dia = buildMonth(2026, 7, [t], AHORA).weeks.flat().find((d) => d.date === '2026-07-15');
    expect(dia?.tasks).toEqual([t]);
  });

  it('las que no tienen fecha no se esconden: son las que se olvidan', () => {
    const sinFecha = tarea({ due_date: null });
    expect(buildMonth(2026, 7, [sinFecha], AHORA).undated).toEqual([sinFecha]);
  });

  it('un día pasado sólo está vencido si algo sigue abierto', () => {
    const cerrada = tarea({ due_date: '2026-07-10', status: 'completed' });
    const abierta = tarea({ due_date: '2026-07-11', status: 'pending' });
    const dias = buildMonth(2026, 7, [cerrada, abierta], AHORA).weeks.flat();
    expect(dias.find((d) => d.date === '2026-07-10')?.isOverdue).toBe(false);
    expect(dias.find((d) => d.date === '2026-07-11')?.isOverdue).toBe(true);
  });

  it('el futuro nunca está vencido', () => {
    const futura = tarea({ due_date: '2026-08-15', status: 'pending' });
    const dia = buildMonth(2026, 8, [futura], AHORA).weeks.flat().find((d) => d.date === '2026-08-15');
    expect(dia?.isOverdue).toBe(false);
  });

  it('usa el día LOCAL: a las 21:00 en México "hoy" sigue siendo hoy', () => {
    // Con `toISOString()` esto marcaría el 1 de agosto, y "vence hoy" pasaría
    // a decir "vencida" seis horas antes de tiempo.
    const noche = new Date(2026, 6, 31, 21, 30, 0);
    const dias = buildMonth(2026, 7, [], noche).weeks.flat();
    expect(dias.find((d) => d.isToday)?.date).toBe('2026-07-31');
  });

  it('etiqueta el mes en español', () => {
    expect(buildMonth(2026, 7, [], AHORA).label).toBe('julio 2026');
  });
});

describe('navegación de meses', () => {
  it('avanza y retrocede cruzando el año', () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth(2026, 7, 0)).toEqual({ year: 2026, month: 7 });
  });

  it('aguanta saltos de más de un año', () => {
    expect(shiftMonth(2026, 7, 18)).toEqual({ year: 2028, month: 1 });
    expect(shiftMonth(2026, 7, -18)).toEqual({ year: 2025, month: 1 });
  });

  it('monthKey rellena el mes con cero', () => {
    expect(monthKey(2026, 7)).toBe('2026-07');
  });
});

describe('dueWithin y overdue', () => {
  const vencida = tarea({ id: 'vencida', due_date: '2026-07-20', status: 'pending' });
  const vencidaCerrada = tarea({ id: 'ya', due_date: '2026-07-20', status: 'completed' });
  const hoy = tarea({ id: 'hoy', due_date: '2026-07-31', status: 'in_progress' });
  const enTres = tarea({ id: 'tres', due_date: '2026-08-03', status: 'pending' });
  const lejos = tarea({ id: 'lejos', due_date: '2026-09-01', status: 'pending' });
  const todas = [lejos, enTres, hoy, vencida, vencidaCerrada];

  it('"¿qué se vence esta semana?" incluye hoy y excluye lo ya vencido', () => {
    expect(dueWithin(todas, 7, AHORA).map((t) => t.id)).toEqual(['hoy', 'tres']);
  });

  it('lo cerrado no se vence', () => {
    expect(overdue(todas, AHORA).map((t) => t.id)).toEqual(['vencida']);
  });

  it('ordena por fecha', () => {
    expect(dueWithin(todas, 60, AHORA).map((t) => t.id)).toEqual(['hoy', 'tres', 'lejos']);
  });
});
