/**
 * La regla que no se negocia: un token desconocido queda VACÍO, nunca
 * `{algo}` crudo.
 *
 * Un contrato o un WhatsApp que le llega al cliente final con `{precio_base}`
 * a la vista es peor que uno con un hueco: el hueco se lee como un error de
 * captura, la llave se lee como un producto roto.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { interpolate, interpolateVerbose, renderTemplate, tokensUsados } from './render';
import { montar, montarCaido, valor, type Harness } from './testing/harness';
import { vaultService } from './vault-port';

describe('interpolate', () => {
  it('sustituye lo que conoce', () => {
    expect(interpolate('Hola {nombre}', { nombre: 'Ana' })).toBe('Hola Ana');
  });

  it('VACÍA lo que no conoce', () => {
    expect(interpolate('Cuesta {precio.base} pesos', {})).toBe('Cuesta  pesos');
  });

  it('soporta acentos y guiones en las claves', () => {
    expect(interpolate('{valor.comision_año}', { 'valor.comision_año': '20%' })).toBe('20%');
    expect(interpolate('{marca.color-primario}', { 'marca.color-primario': '#A85A3A' })).toBe(
      '#A85A3A',
    );
  });

  it('no toca llaves que no son tokens', () => {
    expect(interpolate('function () { return 1 }', {})).toBe('function () { return 1 }');
  });

  it('sobrevive a null y a undefined', () => {
    expect(interpolate(null as unknown as string, {})).toBe('');
  });
});

describe('interpolateVerbose', () => {
  it('reporta qué faltó para poder avisar ANTES de mandar', () => {
    const { text, missing } = interpolateVerbose('{a} y {b}', { a: 'uno' });
    expect(text).toBe('uno y ');
    expect(missing).toEqual(['b']);
  });

  it('un valor presente pero vacío también cuenta como faltante', () => {
    expect(interpolateVerbose('{a}', { a: '' }).missing).toEqual(['a']);
  });
});

describe('tokensUsados', () => {
  it('enumera sin repetir', () => {
    expect(tokensUsados('{a} {b} {a}')).toEqual(['a', 'b']);
  });
});

describe('renderTemplate contra la bóveda', () => {
  let h: Harness;
  beforeEach(() => {
    h = montar();
    h.db.sembrar('canonical_values', [
      valor(h.a.tenantId, { key: 'anticipo_pct', kind: 'percent', value: 50 }),
      valor(h.a.tenantId, { key: 'precio_base', value: 12000 }),
    ]);
  });
  afterEach(() => h.restaurar());

  it('renderiza un contrato con valores y marca', async () => {
    const plantilla =
      'El cliente pagará {valor.precio_base} con un anticipo del {valor.anticipo_pct}. ' +
      'Emite {empresa.nombre}, RFC {empresa.rfc}.';

    const { text, missing } = await renderTemplate(h.a, plantilla);
    expect(text).toBe(
      'El cliente pagará $12,000 con un anticipo del 50%. ' +
        'Emite Taquería La Nueva, RFC XAXX010101000.',
    );
    expect(missing).toEqual([]);
  });

  it('las variables extra ganan sobre la bóveda', async () => {
    // Quien renderiza un contrato concreto sabe cosas de ese contrato que la
    // bóveda no tiene por qué saber.
    const { text } = await renderTemplate(h.a, '{valor.precio_base}', {
      extra: { 'valor.precio_base': '$15,000 (negociado)' },
    });
    expect(text).toBe('$15,000 (negociado)');
  });

  it('un token que la bóveda no tiene queda vacío y se reporta', async () => {
    const { text, missing } = await renderTemplate(h.a, 'Garantía: {valor.garantia_meses} meses');
    expect(text).toBe('Garantía:  meses');
    expect(missing).toEqual(['valor.garantia_meses']);
  });

  it('con la bóveda caída, el port SIGUE sin dejar llaves a la vista', async () => {
    // El peor caso posible: se cayó todo y aun así el cliente final no puede
    // ver `{precio_base}` en su cotización.
    const caida = montarCaido('lanza');
    try {
      const texto = await vaultService.render(h.a, 'Cuesta {valor.precio_base} pesos');
      expect(texto).toBe('Cuesta  pesos');
      expect(texto).not.toContain('{');
    } finally {
      caida.restaurar();
    }
  });
});
