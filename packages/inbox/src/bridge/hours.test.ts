import { describe, expect, it } from 'vitest';
import { dentroDeHorario, minutosDe, momentoLocal } from './hours';
import type { BusinessHours } from '../types';

const CDMX = 'America/Mexico_City';

describe('minutosDe', () => {
  it('lee horas normales', () => {
    expect(minutosDe('09:00')).toBe(540);
    expect(minutosDe('9:05')).toBe(545);
    expect(minutosDe('00:00')).toBe(0);
    expect(minutosDe('23:59')).toBe(1439);
  });

  it('rechaza lo que no es una hora', () => {
    expect(minutosDe('')).toBeNull();
    expect(minutosDe('25:00')).toBeNull();
    expect(minutosDe('09:70')).toBeNull();
    expect(minutosDe('nueve')).toBeNull();
  });
});

describe('momentoLocal', () => {
  it('traduce a la zona del negocio, no a la del servidor', () => {
    // 2026-07-31T18:00Z = viernes 12:00 en CDMX (UTC-6)
    expect(momentoLocal(new Date('2026-07-31T18:00:00Z'), CDMX)).toEqual({
      dia: 'vie',
      minutos: 12 * 60,
    });
  });

  it('cruza el día cuando toca', () => {
    // 2026-08-01T04:00Z = viernes 22:00 en CDMX
    expect(momentoLocal(new Date('2026-08-01T04:00:00Z'), CDMX)).toEqual({
      dia: 'vie',
      minutos: 22 * 60,
    });
  });

  it('una zona inválida cae a UTC en vez de romper la ingesta', () => {
    const m = momentoLocal(new Date('2026-07-31T18:00:00Z'), 'Marte/Olympus');
    expect(m).toEqual({ dia: 'vie', minutos: 18 * 60 });
  });

  it('sin zona usa UTC', () => {
    expect(momentoLocal(new Date('2026-07-31T18:30:00Z'), undefined)).toEqual({
      dia: 'vie',
      minutos: 18 * 60 + 30,
    });
  });
});

describe('dentroDeHorario', () => {
  const ahora = new Date('2026-07-31T18:00:00Z'); // viernes 12:00 CDMX

  it('sin horario, siempre abierto — es el default que vende el producto', () => {
    expect(dentroDeHorario(undefined, ahora)).toBe(true);
    expect(dentroDeHorario({}, ahora)).toBe(true);
    expect(dentroDeHorario({ tz: CDMX, semana: {} }, ahora)).toBe(true);
  });

  it('un día con tramos abre y cierra', () => {
    const h: BusinessHours = { tz: CDMX, semana: { vie: [['09:00', '18:00']] } };
    expect(dentroDeHorario(h, ahora)).toBe(true);
    expect(dentroDeHorario(h, new Date('2026-08-01T02:00:00Z'))).toBe(false); // 20:00 CDMX
  });

  it('el cierre es exclusivo: a las 18:00 en punto ya está cerrado', () => {
    const h: BusinessHours = { tz: CDMX, semana: { vie: [['09:00', '18:00']] } };
    // 2026-08-01T00:00Z = viernes 18:00 CDMX
    expect(dentroDeHorario(h, new Date('2026-08-01T00:00:00Z'))).toBe(false);
    // Un minuto antes sí.
    expect(dentroDeHorario(h, new Date('2026-07-31T23:59:00Z'))).toBe(true);
  });

  it('dos tramos contiguos no dejan hueco ni se traslapan', () => {
    const h: BusinessHours = {
      tz: CDMX,
      semana: { vie: [['09:00', '14:00'], ['14:00', '19:00']] },
    };
    // 14:00 CDMX = 20:00Z
    expect(dentroDeHorario(h, new Date('2026-07-31T20:00:00Z'))).toBe(true);
  });

  it('un día que no está en la semana es un día cerrado', () => {
    const h: BusinessHours = { tz: CDMX, semana: { lun: [['09:00', '18:00']] } };
    expect(dentroDeHorario(h, ahora)).toBe(false); // es viernes
  });

  it('un tramo que cruza la medianoche sigue abierto de madrugada', () => {
    // El bar abre viernes 20:00 y cierra sábado 02:00.
    const h: BusinessHours = { tz: CDMX, semana: { vie: [['20:00', '02:00']] } };
    expect(dentroDeHorario(h, new Date('2026-08-01T03:00:00Z'))).toBe(true); // vie 21:00
    expect(dentroDeHorario(h, new Date('2026-08-01T07:00:00Z'))).toBe(true); // sáb 01:00
    expect(dentroDeHorario(h, new Date('2026-08-01T09:00:00Z'))).toBe(false); // sáb 03:00
  });

  it('un tramo con basura se ignora sin tumbar el resto', () => {
    const h: BusinessHours = {
      tz: CDMX,
      semana: { vie: [['no', 'sé'], ['09:00', '18:00']] as Array<[string, string]> },
    };
    expect(dentroDeHorario(h, ahora)).toBe(true);
  });
});
