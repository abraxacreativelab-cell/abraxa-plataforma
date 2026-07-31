import { describe, expect, it } from 'vitest';
import { esJidIgnorable, jidATelefono, normalizarTelefono, telefonoAJid } from './phone';

describe('normalizarTelefono', () => {
  it('colapsa el 1 de móvil de México', () => {
    // Es EL caso: WhatsApp manda 52 1 XXXXXXXXXX y el formulario manda 10
    // dígitos. Si no convergen, el mismo cliente abre dos hilos.
    expect(normalizarTelefono('5215512345678')).toBe('+525512345678');
    expect(normalizarTelefono('525512345678')).toBe('+525512345678');
    expect(normalizarTelefono('5512345678')).toBe('+525512345678');
    expect(normalizarTelefono('+52 55 1234 5678')).toBe('+525512345678');
    expect(normalizarTelefono('(55) 1234-5678')).toBe('+525512345678');
  });

  it('respeta los internacionales', () => {
    expect(normalizarTelefono('+1 415 555 0123')).toBe('+14155550123');
    expect(normalizarTelefono('+34 600 123 456')).toBe('+34600123456');
  });

  it('es idempotente — se aplica en el webhook y en la UI', () => {
    const una = normalizarTelefono('5215512345678');
    expect(normalizarTelefono(una)).toBe(una);
  });

  it('con basura devuelve cadena vacía en vez de un "+"', () => {
    expect(normalizarTelefono('')).toBe('');
    expect(normalizarTelefono('hola')).toBe('');
  });
});

describe('telefonoAJid / jidATelefono', () => {
  it('van y vuelven al mismo teléfono canónico', () => {
    expect(telefonoAJid('5512345678')).toBe('525512345678@s.whatsapp.net');
    expect(jidATelefono('5215512345678@s.whatsapp.net')).toBe('+525512345678');
    expect(jidATelefono(telefonoAJid('+52 55 1234 5678'))).toBe('+525512345678');
  });

  it('el JID de WhatsApp con el 1 y el del formulario dan el MISMO hilo', () => {
    expect(jidATelefono('5215512345678@s.whatsapp.net')).toBe(normalizarTelefono('5512345678'));
  });
});

describe('esJidIgnorable', () => {
  it('ignora grupos y estados', () => {
    expect(esJidIgnorable('12036304@g.us')).toBe(true);
    expect(esJidIgnorable('status@broadcast')).toBe(true);
    expect(esJidIgnorable('')).toBe(true);
  });

  it('no ignora una conversación uno a uno', () => {
    expect(esJidIgnorable('525512345678@s.whatsapp.net')).toBe(false);
  });
});
