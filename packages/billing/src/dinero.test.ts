/**
 * ════════════════════════════════════════════════════════════════════════════
 *  De la unidad mínima de Stripe a la cifra que se guarda.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Stripe manda TODO importe como un entero en la unidad mínima de su moneda.
 *  «Centavos» es una traducción cómoda y falsa: en yenes la unidad mínima es
 *  el yen, y en dinares kuwaitíes es la milésima. Dividir siempre entre 100
 *  convierte ¥3000 en ¥30 — dos ceros de ingreso que desaparecen sin que nada
 *  falle.
 *
 *  Con el hallazgo B cerrado, la moneda se guarda junto a la cifra; esto es lo
 *  que hace que la cifra signifique lo que dice la moneda.
 */
import { describe, expect, it } from 'vitest';
import { MONEDA, montoDecimal } from './catalog';

describe('las monedas de dos decimales — el caso normal', () => {
  it('2500 centavos de dólar son 25.00', () => {
    expect(montoDecimal(2500, 'usd')).toBe(25);
  });

  it('50000 centavos de peso son 500.00', () => {
    expect(montoDecimal(50_000, 'mxn')).toBe(500);
  });

  it('el mínimo de Stripe no se pierde en el redondeo', () => {
    expect(montoDecimal(50, 'usd')).toBe(0.5);
    expect(montoDecimal(1, 'usd')).toBe(0.01);
  });

  it('la moneda del catálogo es una de éstas', () => {
    expect(montoDecimal(2500, MONEDA)).toBe(25);
  });
});

describe('las monedas SIN decimales', () => {
  it('3000 yenes son 3000 yenes, no 30', () => {
    expect(montoDecimal(3000, 'jpy')).toBe(3000);
  });

  it('vale para todas las de la lista de Stripe, no sólo el yen', () => {
    // Una de cada continente, para que se note que no es un caso especial
    // del yen sino una categoría.
    expect(montoDecimal(20_000, 'krw')).toBe(20_000);
    expect(montoDecimal(500_000, 'vnd')).toBe(500_000);
    expect(montoDecimal(15_000, 'clp')).toBe(15_000);
    expect(montoDecimal(9000, 'xof')).toBe(9000);
  });
});

describe('las monedas de TRES decimales', () => {
  it('el dinar kuwaití viene en milésimas', () => {
    // Stripe exige que el último dígito sea 0 en estas monedas, así que la
    // cifra cabe siempre en el numeric(10,2) de la columna.
    expect(montoDecimal(25_000, 'kwd')).toBe(25);
    expect(montoDecimal(1500, 'bhd')).toBe(1.5);
  });
});

describe('lo que no puede pasar', () => {
  it('la moneda se compara sin importar cómo venga escrita', () => {
    expect(montoDecimal(3000, 'JPY')).toBe(3000);
    expect(montoDecimal(2500, ' Usd ')).toBe(25);
  });

  it('una moneda desconocida se trata como de dos decimales, que es lo más común', () => {
    // No se lanza: el pago ya entró. La moneda queda escrita en la fila, así
    // que la cifra siempre se puede reinterpretar; una excepción aquí, no.
    expect(montoDecimal(2500, 'zzz')).toBe(25);
  });

  it('nunca devuelve un número con más de dos decimales', () => {
    for (const [centavos, moneda] of [
      [1, 'usd'],
      [3, 'usd'],
      [999_999, 'mxn'],
      [1230, 'kwd'],
    ] as const) {
      const v = montoDecimal(centavos, moneda);
      expect(Number(v.toFixed(2))).toBe(v);
    }
  });
});
