/**
 * Criterio #6 — un driver que no es WhatsApp funciona en toda la cadena sin
 * tocar el código de H6.
 *
 * `ingest.test.ts` ya corre el flujo completo con un driver falso; aquí se
 * prueba la mecánica del enchufe: alta, reemplazo, error legible cuando falta,
 * y que la normalización de direcciones sea del CANAL y no del núcleo.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PlatformError } from '@abraxa/db';
import {
  __clearDrivers,
  driverFor,
  hasDriver,
  listDrivers,
  mostrarDireccion,
  normalizarDireccion,
  registerDriver,
} from './registry';
import { leerSobre } from './types';
import { createFakeDriver } from '../testing/fake-driver';

beforeEach(() => __clearDrivers());
afterEach(() => __clearDrivers());

describe('el registro', () => {
  it('da de alta y devuelve un driver por su tipo', () => {
    const d = createFakeDriver({ type: 'email' });
    registerDriver(d);
    expect(hasDriver('email')).toBe(true);
    expect(driverFor('email')).toBe(d);
  });

  it('acepta varios canales a la vez, ninguno privilegiado', () => {
    registerDriver(createFakeDriver({ type: 'email' }));
    registerDriver(createFakeDriver({ type: 'instagram' }));
    registerDriver(createFakeDriver({ type: 'sms' }));
    expect(listDrivers()).toEqual(['email', 'instagram', 'sms']);
    // Sin WhatsApp registrado, el resto sigue funcionando: el núcleo no lo
    // necesita para nada.
    expect(hasDriver('whatsapp')).toBe(false);
  });

  it('re-registrar el mismo tipo lo reemplaza', () => {
    const viejo = createFakeDriver({ type: 'sms' });
    const nuevo = createFakeDriver({ type: 'sms' });
    registerDriver(viejo);
    registerDriver(nuevo);
    expect(driverFor('sms')).toBe(nuevo);
    expect(listDrivers()).toEqual(['sms']);
  });

  it('sin driver, el error dice de quién es el canal', () => {
    try {
      driverFor('instagram');
      throw new Error('debió lanzar');
    } catch (err) {
      expect(PlatformError.is(err)).toBe(true);
      const e = err as PlatformError;
      expect(e.code).toBe('CHANNEL_ERROR');
      expect(e.message).toContain('H12');
      expect(e.retryable).toBe(false);
    }
    try {
      driverFor('email');
      throw new Error('debió lanzar');
    } catch (err) {
      expect((err as PlatformError).message).toContain('H13');
    }
  });

  it('rechaza un objeto que no cumple ChannelDriver', () => {
    expect(() => registerDriver({ type: 'sms' } as never)).toThrow(/ChannelDriver/);
    expect(() => registerDriver({} as never)).toThrow(/type/);
  });
});

describe('normalización de direcciones', () => {
  it('sin driver, se recorta y ya — es lo único honesto sin saber del canal', () => {
    expect(normalizarDireccion('email', '  ana@empresa.mx  ')).toBe('ana@empresa.mx');
  });

  it('la decide el driver, no el núcleo', () => {
    registerDriver(
      createFakeDriver({ type: 'email', normalizeAddress: (raw) => raw.trim().toLowerCase() }),
    );
    expect(normalizarDireccion('email', '  Ana@Empresa.MX ')).toBe('ana@empresa.mx');
    // Y para otro canal, distinta: el núcleo no impone ninguna.
    expect(normalizarDireccion('instagram', '  UnUsuario ')).toBe('UnUsuario');
  });

  it('mostrarDireccion cae a la dirección misma si el driver no opina', () => {
    registerDriver(createFakeDriver({ type: 'sms' }));
    expect(mostrarDireccion('sms', '+525512345678')).toBe('+525512345678');
  });
});

describe('el sobre del webhook', () => {
  it('lee un sobre bien formado', () => {
    expect(leerSobre({ channelId: 'c-1', payload: { a: 1 } })).toEqual({
      channelId: 'c-1',
      payload: { a: 1 },
      headers: undefined,
    });
  });

  it('rechaza lo que no lo es, sin lanzar', () => {
    expect(leerSobre(null)).toBeNull();
    expect(leerSobre('texto')).toBeNull();
    expect(leerSobre({ payload: {} })).toBeNull();
    expect(leerSobre({ channelId: '' })).toBeNull();
  });
});
