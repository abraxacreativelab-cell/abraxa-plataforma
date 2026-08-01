import { describe, expect, it } from 'vitest';
import { esIdOpaco, mostrarDireccionMeta, normalizarDireccionMeta } from './direccion';

describe('normalizarDireccionMeta', () => {
  it('deja los ids opacos INTACTOS', () => {
    // Un PSID/IGSID parece un número y no lo es: `Number('17841400000000000')`
    // ya pierde precisión. Cualquier "arreglo" sobre él manda el mensaje al
    // vacío. Lo único que se hace es recortar.
    expect(normalizarDireccionMeta('17841400000000000')).toBe('17841400000000000');
    expect(normalizarDireccionMeta('  6072012345678901  ')).toBe('6072012345678901');
  });

  it('quita la arroba y baja a minúsculas', () => {
    expect(normalizarDireccionMeta('@Abraxa')).toBe('abraxa');
    expect(normalizarDireccionMeta('ABRAXA')).toBe('abraxa');
  });

  it('se queda con el handle de una URL de perfil', () => {
    expect(normalizarDireccionMeta('https://instagram.com/Abraxa/')).toBe('abraxa');
    expect(normalizarDireccionMeta('https://www.instagram.com/abraxa?hl=es')).toBe('abraxa');
    expect(normalizarDireccionMeta('https://m.me/minegocio')).toBe('minegocio');
  });

  it('es IDEMPOTENTE — se aplica en el webhook y en la bandeja', () => {
    // Lo exige `ExtrasDriver.normalizeAddress`. Si las dos rutas no convergen,
    // se abren dos hilos para la misma persona.
    for (const entrada of ['@Abraxa', 'https://instagram.com/Abraxa/', '17841400000000000', ' X ']) {
      const una = normalizarDireccionMeta(entrada);
      expect(normalizarDireccionMeta(una)).toBe(una);
    }
  });

  it('converge con `normalizarHandle` de H15 — o el CRM parte el contacto en dos', () => {
    // Los tres casos documentados en `packages/crm/src/identity.ts:190-193`. El
    // CRM normaliza otra vez por su cuenta antes de escribir la identidad: si
    // las dos difieren aunque sea en las mayúsculas, el índice único
    // (tenant_id, channel, identifier) deja de emparejar y el mismo cliente
    // acaba con dos fichas.
    expect(normalizarDireccionMeta('@Abraxa')).toBe('abraxa');
    expect(normalizarDireccionMeta('https://instagram.com/abraxa/')).toBe('abraxa');
    expect(normalizarDireccionMeta('17841400000000000')).toBe('17841400000000000');
  });

  it('con basura devuelve cadena vacía, no un fragmento', () => {
    expect(normalizarDireccionMeta('')).toBe('');
    expect(normalizarDireccionMeta('   ')).toBe('');
    expect(normalizarDireccionMeta(undefined as unknown as string)).toBe('');
  });
});

describe('mostrarDireccionMeta', () => {
  it('marca cuándo es un id y cuándo un handle', () => {
    // Sin la marca, quien mira la bandeja cree que el cliente se llama
    // «17841400000000000».
    expect(mostrarDireccionMeta('17841400000000000')).toBe('id:17841400000000000');
    expect(mostrarDireccionMeta('abraxa')).toBe('@abraxa');
    expect(mostrarDireccionMeta('')).toBe('');
  });

  it('NO recorta el id: es lo único con lo que se puede pedir soporte a Meta', () => {
    const largo = '17841400000000000';
    expect(mostrarDireccionMeta(largo)).toContain(largo);
  });
});

describe('esIdOpaco', () => {
  it('distingue un id de un nombre de usuario', () => {
    expect(esIdOpaco('17841400000000000')).toBe(true);
    expect(esIdOpaco('123456')).toBe(true);
    expect(esIdOpaco('12345')).toBe(false);
    expect(esIdOpaco('abraxa')).toBe(false);
    expect(esIdOpaco('abraxa2026')).toBe(false);
  });
});
