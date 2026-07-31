/**
 * Los criterios 5, 6 y 7 de H17-integraciones.md §11:
 *
 *   5. Sin `INTEGRATIONS_KEY`, guardar LANZA. No guarda en claro.
 *   6. Un ciphertext alterado en un byte FALLA al descifrar (GCM), no devuelve
 *      basura.
 *   7. Rotar: se cifra con la v2 y se sigue leyendo lo de la v1.
 *
 *  Y uno que no está en la lista y vale lo mismo: un sobre de una empresa no
 *  se abre con el contexto de otra, aunque alguien copie la fila entera.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { capturarEntorno, limpiarEntorno } from '../testing/entorno';
import { LLAVE_DE_PRUEBA, LLAVE_DE_PRUEBA_2 } from '../testing/fake-db';
import { abrir, cerrar, hayLlave, huella, versionActual } from './secret-box';

let restaurarEntorno: () => void;

beforeEach(() => {
  restaurarEntorno = capturarEntorno();
  limpiarEntorno();
  delete process.env.INTEGRATIONS_KEY;
  delete process.env.INTEGRATIONS_KEY_2;
});

afterEach(() => {
  restaurarEntorno();
});

describe('fail-closed sin llave', () => {
  it('cerrar() lanza si no hay INTEGRATIONS_KEY — nunca guarda en claro', () => {
    expect(() => cerrar('la-llave-de-evolution')).toThrow(/INTEGRATIONS_KEY/);
  });

  it('abrir() lanza si no hay llave, en vez de devolver algo', () => {
    process.env.INTEGRATIONS_KEY = LLAVE_DE_PRUEBA;
    const sobre = cerrar('la-llave-de-evolution');
    delete process.env.INTEGRATIONS_KEY;
    expect(() => abrir(sobre)).toThrow(/INTEGRATIONS_KEY/);
  });

  it('el mensaje del error no trae el secreto que se estaba cifrando', () => {
    try {
      cerrar('secreto-de-la-panaderia');
      throw new Error('debió lanzar');
    } catch (e) {
      expect(String((e as Error).message)).not.toContain('secreto-de-la-panaderia');
    }
  });

  it('una llave que no mide 32 bytes se rechaza en vez de recortarse', () => {
    process.env.INTEGRATIONS_KEY = Buffer.alloc(16, 'k').toString('base64');
    expect(() => cerrar('x')).toThrow(/32 bytes/);
  });

  it('hayLlave() dice la verdad sin lanzar — es lo que mira /_status', () => {
    expect(hayLlave()).toBe(false);
    process.env.INTEGRATIONS_KEY = LLAVE_DE_PRUEBA;
    expect(hayLlave()).toBe(true);
  });
});

describe('ida y vuelta', () => {
  beforeEach(() => {
    process.env.INTEGRATIONS_KEY = LLAVE_DE_PRUEBA;
  });

  it('lo que se cierra se abre igual', () => {
    const sobre = cerrar('la-llave-de-evolution');
    expect(abrir(sobre)).toBe('la-llave-de-evolution');
  });

  it('el ciphertext no contiene el texto claro', () => {
    const sobre = cerrar('la-llave-de-evolution');
    expect(sobre.ct.toString('utf8')).not.toContain('evolution');
    expect(sobre.ct.toString('hex')).not.toContain(
      Buffer.from('la-llave-de-evolution').toString('hex'),
    );
  });

  it('dos cifrados del mismo secreto dan ciphertexts distintos (nonce por sobre)', () => {
    const a = cerrar('mismo-secreto');
    const b = cerrar('mismo-secreto');
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ct.equals(b.ct)).toBe(false);
  });

  it('acepta un secreto con acentos y emoji sin corromperlo', () => {
    const raro = 'contraseña-año-🔑';
    expect(abrir(cerrar(raro))).toBe(raro);
  });
});

describe('GCM autentica: alterar un byte falla, no da basura', () => {
  beforeEach(() => {
    process.env.INTEGRATIONS_KEY = LLAVE_DE_PRUEBA;
  });

  it('un byte cambiado en el ciphertext lanza', () => {
    const sobre = cerrar('la-llave-de-evolution');
    const roto = { ...sobre, ct: Buffer.from(sobre.ct) };
    roto.ct.writeUInt8(roto.ct.readUInt8(0) ^ 0x01, 0);
    expect(() => abrir(roto)).toThrow();
  });

  it('un byte cambiado en la etiqueta lanza', () => {
    const sobre = cerrar('la-llave-de-evolution');
    const roto = { ...sobre, tag: Buffer.from(sobre.tag) };
    roto.tag.writeUInt8(roto.tag.readUInt8(0) ^ 0x01, 0);
    expect(() => abrir(roto)).toThrow();
  });

  it('un nonce cambiado lanza', () => {
    const sobre = cerrar('la-llave-de-evolution');
    const roto = { ...sobre, iv: Buffer.from(sobre.iv) };
    roto.iv.writeUInt8(roto.iv.readUInt8(0) ^ 0x01, 0);
    expect(() => abrir(roto)).toThrow();
  });
});

describe('el sobre está atado a su empresa (AAD)', () => {
  beforeEach(() => {
    process.env.INTEGRATIONS_KEY = LLAVE_DE_PRUEBA;
  });

  it('un sobre de la empresa A no se abre con el contexto de la B', () => {
    const sobre = cerrar('la-llave-de-la-panaderia', 'empresa-a:evolution');
    expect(abrir(sobre, 'empresa-a:evolution')).toBe('la-llave-de-la-panaderia');
    // Copiar la fila entera a otra empresa no basta: el dato asociado no cuadra.
    expect(() => abrir(sobre, 'empresa-b:evolution')).toThrow();
  });

  it('tampoco se abre reetiquetándolo como otro proveedor', () => {
    const sobre = cerrar('token', 'empresa-a:meta');
    expect(() => abrir(sobre, 'empresa-a:twilio')).toThrow();
  });
});

describe('rotación con versión, sin downtime', () => {
  it('cifra con la más alta y sigue leyendo lo de la anterior', () => {
    process.env.INTEGRATIONS_KEY = LLAVE_DE_PRUEBA;
    const viejo = cerrar('secreto-viejo');
    expect(viejo.version).toBe(1);

    // Llega la llave 2: lo nuevo se cifra con ella…
    process.env.INTEGRATIONS_KEY_2 = LLAVE_DE_PRUEBA_2;
    expect(versionActual()).toBe(2);
    const nuevo = cerrar('secreto-nuevo');
    expect(nuevo.version).toBe(2);

    // …y lo viejo se sigue abriendo con la 1. Sin apagar nada.
    expect(abrir(viejo)).toBe('secreto-viejo');
    expect(abrir(nuevo)).toBe('secreto-nuevo');
  });

  it('un sobre de una versión que ya no está en el entorno lanza diciendo cuál falta', () => {
    process.env.INTEGRATIONS_KEY = LLAVE_DE_PRUEBA;
    process.env.INTEGRATIONS_KEY_2 = LLAVE_DE_PRUEBA_2;
    const nuevo = cerrar('secreto-nuevo');
    delete process.env.INTEGRATIONS_KEY_2;
    expect(() => abrir(nuevo)).toThrow(/INTEGRATIONS_KEY_2/);
  });

  it('no se abre un sobre de la v2 con la llave de la v1', () => {
    process.env.INTEGRATIONS_KEY = LLAVE_DE_PRUEBA;
    process.env.INTEGRATIONS_KEY_2 = LLAVE_DE_PRUEBA_2;
    const nuevo = cerrar('secreto-nuevo');
    expect(() => abrir({ ...nuevo, version: 1 })).toThrow();
  });
});

describe('huella', () => {
  it('distingue dos credenciales sin permitir usar ninguna', () => {
    const a = huella('llave-de-la-panaderia');
    const b = huella('llave-de-la-inmobiliaria');
    expect(a).not.toBe(b);
    expect(a).not.toContain('panaderia');
    expect(a).toMatch(/^••••[a-zA-Z0-9]{4} · [0-9a-f]{8}$/);
  });

  it('la misma credencial da la misma huella — es lo que contesta "¿es la nueva?"', () => {
    expect(huella('la-misma')).toBe(huella('la-misma'));
  });

  it('un secreto cortísimo no revela su cola entera', () => {
    expect(huella('ab')).toMatch(/^•+ · [0-9a-f]{8}$/);
  });
});
