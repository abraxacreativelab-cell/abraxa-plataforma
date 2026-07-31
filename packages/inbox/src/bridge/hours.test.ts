import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __olvidarAvisosDeZona,
  dentroDeHorario,
  minutosDe,
  momentoLocal,
  zonaValida,
} from './hours';
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

// ════════════════════════════════════════════════════════════════════════════
// Una zona horaria inválida ya no se traga en silencio.
//
// El `catch` de `momentoLocal` caía a UTC sin decir nada. Seguir en vez de
// romper está bien —un horario mal capturado no puede tumbar la ingesta de un
// mensaje— pero callarse no: un negocio de CDMX evaluado en UTC contesta seis
// horas corrido, con la pantalla de configuración mostrando el horario que el
// dueño puso. Sin una línea de log, eso sólo se diagnostica leyendo el código.
// ════════════════════════════════════════════════════════════════════════════
describe('una zona horaria que no existe', () => {
  const ahora = new Date('2026-07-31T18:00:00Z'); // viernes 12:00 CDMX
  const avisos: string[] = [];
  let espia: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    avisos.length = 0;
    __olvidarAvisosDeZona();
    espia = vi.spyOn(console, 'warn').mockImplementation((m: unknown) => {
      avisos.push(String(m));
    });
  });

  afterEach(() => espia.mockRestore());

  it('se registra en vez de desaparecer en un catch vacío', () => {
    momentoLocal(ahora, 'America/MexicoCity');

    expect(avisos).toHaveLength(1);
    // El mensaje tiene que llevar la zona culpable y decir qué se hizo en su
    // lugar: un aviso que no permite arreglarlo es tan inútil como el silencio.
    expect(avisos[0]).toContain('America/MexicoCity');
    expect(avisos[0]).toMatch(/UTC/);
  });

  it('sigue funcionando: cae a UTC y no rompe la ingesta', () => {
    const enUtc = momentoLocal(ahora, undefined);
    expect(momentoLocal(ahora, 'GMT-6')).toEqual(enUtc);
  });

  it('avisa UNA vez por zona, no una vez por mensaje', () => {
    for (let i = 0; i < 50; i++) momentoLocal(ahora, 'Marte/Olympus');

    // Un log que grita en cada WhatsApp se aprende a ignorar, y esa sordera es
    // la misma que teníamos con el catch vacío.
    expect(avisos).toHaveLength(1);
  });

  it('una zona VÁLIDA no dice nada', () => {
    momentoLocal(ahora, CDMX);
    expect(avisos).toEqual([]);
  });
});

describe('zonaValida', () => {
  it('acepta identificadores de la IANA', () => {
    expect(zonaValida(CDMX)).toBe(true);
    expect(zonaValida('UTC')).toBe(true);
    expect(zonaValida('Europe/Madrid')).toBe(true);
  });

  it('rechaza lo que el runtime no conoce', () => {
    // Los dos errores reales: el guion bajo olvidado y el offset escrito a mano.
    expect(zonaValida('America/MexicoCity')).toBe(false);
    expect(zonaValida('GMT-6')).toBe(false);
    expect(zonaValida('Marte/Olympus')).toBe(false);
    expect(zonaValida('')).toBe(false);
  });

  /**
   * `"CST"` SÍ pasa, y no es un descuido de la comprobación.
   *
   * El ICU de Node lo acepta como alias heredado y lo resuelve a la hora del
   * centro de EE. UU. Es una zona real: `momentoLocal()` la formatea sin lanzar
   * y el horario se evalúa en una zona coherente, no en UTC. Que sea ambigua
   * para un humano —hay varios "CST" en el mundo— no la vuelve inválida para el
   * runtime, y esta función responde exactamente una pregunta: «¿puede `Intl`
   * trabajar con esto?». Inventarse una lista negra propia sería empezar a
   * mantener una base de datos de zonas horarias a mano.
   */
  it('un alias heredado que el ICU sí resuelve no se rechaza', () => {
    expect(zonaValida('CST')).toBe(true);
  });
});
