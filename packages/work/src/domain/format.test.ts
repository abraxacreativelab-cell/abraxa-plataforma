import { describe, expect, it } from 'vitest';
import { desde, diasHasta, fechaCorta, hoyLocal, iniciales, nombreCorto, plural, vencimiento } from './format';

// 31 de julio de 2026 a las 09:00, hora local.
const AHORA = new Date(2026, 6, 31, 9, 0, 0);

describe('fechas', () => {
  it('no se corre un día por interpretar la fecha como UTC', () => {
    // `new Date('2026-08-03')` es medianoche UTC, y en México eso se pinta
    // como el 2 de agosto. Por eso la cadena se parte a mano.
    expect(fechaCorta('2026-08-03', AHORA)).toBe('3 ago');
    expect(fechaCorta('2026-01-01', AHORA)).toBe('1 ene');
  });

  it('el año sólo aparece cuando no es el actual', () => {
    expect(fechaCorta('2026-12-31', AHORA)).toBe('31 dic');
    expect(fechaCorta('2027-01-05', AHORA)).toBe('5 ene 2027');
  });

  it('sin fecha no inventa nada', () => {
    expect(fechaCorta(null)).toBe('');
    expect(fechaCorta(undefined)).toBe('');
    expect(vencimiento(null)).toBe('');
  });

  it('hoyLocal usa la hora local aunque sea de noche', () => {
    expect(hoyLocal(new Date(2026, 6, 31, 23, 45))).toBe('2026-07-31');
  });

  it('diasHasta cuenta días de calendario, no de 24 horas', () => {
    // A las 09:00 de hoy, mañana a cualquier hora sigue siendo "1 día".
    expect(diasHasta('2026-08-01', AHORA)).toBe(1);
    expect(diasHasta('2026-07-31', AHORA)).toBe(0);
    expect(diasHasta('2026-07-30', AHORA)).toBe(-1);
  });

  it('aguanta el cambio de horario de verano', () => {
    // Entre el 1 y el 30 de abril hay 29 días de calendario aunque uno de
    // ellos dure 23 horas. Redondear el cociente es lo que lo hace cierto.
    expect(diasHasta('2026-04-30', new Date(2026, 3, 1, 12))).toBe(29);
  });

  it('el vencimiento cercano se dice en palabras y el lejano con la fecha', () => {
    expect(vencimiento('2026-07-31', AHORA)).toBe('hoy');
    expect(vencimiento('2026-08-01', AHORA)).toBe('mañana');
    expect(vencimiento('2026-07-30', AHORA)).toBe('ayer');
    expect(vencimiento('2026-08-05', AHORA)).toBe('en 5 días');
    expect(vencimiento('2026-07-28', AHORA)).toBe('hace 3 días');
    expect(vencimiento('2026-09-18', AHORA)).toBe('18 sep');
    expect(vencimiento('2026-06-01', AHORA)).toBe('venció el 1 jun');
  });
});

describe('desde', () => {
  it('dice cuánto hace, sin decimales', () => {
    expect(desde(new Date(AHORA.getTime() - 30_000).toISOString(), AHORA)).toBe('hace un momento');
    expect(desde(new Date(AHORA.getTime() - 5 * 60_000).toISOString(), AHORA)).toBe('hace 5 min');
    expect(desde(new Date(AHORA.getTime() - 3 * 3_600_000).toISOString(), AHORA)).toBe('hace 3 h');
    expect(desde(new Date(AHORA.getTime() - 2 * 86_400_000).toISOString(), AHORA)).toBe('hace 2 d');
  });

  it('una fecha rota no pinta "NaN" en la cara del usuario', () => {
    expect(desde('no es una fecha', AHORA)).toBe('');
  });
});

describe('personas', () => {
  it('prefiere el nombre y cae a la parte del correo antes de la arroba', () => {
    expect(nombreCorto('ana@ejemplo.mx', 'Ana Pérez')).toBe('Ana Pérez');
    expect(nombreCorto('ana@ejemplo.mx', null)).toBe('ana');
    expect(nombreCorto('ana@ejemplo.mx', '   ')).toBe('ana');
    expect(nombreCorto(null)).toBe('Sin responsable');
  });

  it('las iniciales salen del nombre completo o del correo', () => {
    expect(iniciales('x@y.mx', 'Ana Pérez')).toBe('AP');
    expect(iniciales('lupita.ramos@ejemplo.mx')).toBe('LR');
    expect(iniciales('beto@ejemplo.mx')).toBe('B');
    expect(iniciales(null)).toBe('SR');
  });
});

describe('plural', () => {
  it('concuerda', () => {
    expect(plural(1, 'subtarea abierta', 'subtareas abiertas')).toBe('1 subtarea abierta');
    expect(plural(3, 'subtarea abierta', 'subtareas abiertas')).toBe('3 subtareas abiertas');
    expect(plural(0, 'tarea', 'tareas')).toBe('0 tareas');
  });
});
