/**
 * Criterio #3 — el costo es REAL, y sobre todo: es RECALCULABLE.
 *
 * Lo que separa esto de GARDEN no es la fórmula. Es que la fila guarda los
 * tokens, así que un precio equivocado se corrige y el costo se rehace. En
 * GARDEN la fila guarda un número ya cocinado: cuando está mal, se ve idéntico
 * a cuando está bien y no queda nada con qué rehacerlo.
 */
import { describe, expect, it } from 'vitest';
import { calcularCosto, costoSinCache } from './compute';
import { createStaticPricingCatalog, type PricingRow } from './catalog';
import { usage } from '../testing/fakes';

const HAIKU: PricingRow = {
  id: 'p-haiku',
  provider: 'anthropic',
  model: 'claude-haiku-4-5',
  inputPerMtok: 1.0,
  outputPerMtok: 5.0,
  cacheWrite5mPerMtok: 1.25,
  cacheWrite1hPerMtok: 2.0,
  cacheReadPerMtok: 0.1,
  currency: 'USD',
  effectiveFrom: '2026-01-01',
};

describe('cálculo de costo', () => {
  it('suma los cinco conceptos con su precio propio', () => {
    const r = calcularCosto(
      usage({
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
        cacheWrite5mTokens: 1_000_000,
        cacheWrite1hTokens: 1_000_000,
      }),
      HAIKU,
    );

    // 1.00 + 5.00 + 0.10 + 1.25 + 2.00
    expect(r.costUsd).toBeCloseTo(9.35, 6);
    expect(r.source).toBe('priced');
    expect(r.pricingId).toBe('p-haiku');
  });

  it('la escritura de caché cuesta MÁS que el input, y el TTL de 1h más que el de 5m', () => {
    const w5m = calcularCosto(usage({ cacheWrite5mTokens: 1_000_000 }), HAIKU).costUsd;
    const w1h = calcularCosto(usage({ cacheWrite1hTokens: 1_000_000 }), HAIKU).costUsd;
    const inp = calcularCosto(usage({ inputTokens: 1_000_000 }), HAIKU).costUsd;

    expect(w5m).toBeGreaterThan(inp);
    expect(w1h).toBeGreaterThan(w5m);
    // Con una sola columna de "cache_write" estos dos números serían el mismo,
    // y el costo del TTL largo saldría 60% bajo.
  });

  it('leer del caché cuesta una décima parte del input', () => {
    const lectura = calcularCosto(usage({ cacheReadTokens: 1_000_000 }), HAIKU).costUsd;
    const entrada = calcularCosto(usage({ inputTokens: 1_000_000 }), HAIKU).costUsd;
    expect(lectura).toBeCloseTo(entrada * 0.1, 6);
  });

  it('el costo reportado por el proveedor gana sobre cualquier cálculo', () => {
    const r = calcularCosto(
      usage({ inputTokens: 999_999_999, providerCostUsd: 0.0042 }),
      HAIKU,
    );
    expect(r.costUsd).toBe(0.0042);
    expect(r.source).toBe('provider');
    expect(r.pricingId).toBeNull();
  });

  it('SIN PRECIO no inventa un número: marca unpriced y registra en 0', () => {
    const r = calcularCosto(usage({ inputTokens: 500_000, outputTokens: 500_000 }), null);

    expect(r.costUsd).toBe(0);
    expect(r.source).toBe('unpriced');
    // GARDEN, en este caso, aplicaba {input:1.0, output:3.0} en silencio. Ése
    // es el camino por el que se cobra mal durante meses sin enterarse.
  });

  it('redondea a los 6 decimales de numeric(12,6) del ledger', () => {
    const r = calcularCosto(usage({ inputTokens: 1 }), HAIKU);
    // Que la API reporte un número y la base guarde otro, aunque difieran en el
    // sexto decimal, es lo que hace que una suma no cuadre.
    expect(r.costUsd).toBe(Number(r.costUsd.toFixed(6)));
  });
});

describe('el costo se puede RECALCULAR — lo que GARDEN no puede', () => {
  it('con los mismos tokens y un precio corregido, sale el costo correcto', () => {
    const tokens = usage({ inputTokens: 1_000_000, outputTokens: 200_000 });

    const conPrecioMalo = calcularCosto(tokens, { ...HAIKU, inputPerMtok: 15.0 });
    const conPrecioBueno = calcularCosto(tokens, HAIKU);

    expect(conPrecioMalo.costUsd).toBeCloseTo(16.0, 6);
    expect(conPrecioBueno.costUsd).toBeCloseTo(2.0, 6);

    // Ése es exactamente el error verificado en GARDEN: claude-opus-4.6
    // capturado a $15/$75 cuando cuesta $5/$25. Como el ledger guarda los
    // tokens, aquí es un UPDATE; allá es un dato perdido.
  });
});

describe('ahorro del caché', () => {
  it('cuantifica lo que se habría pagado sin caché', () => {
    const u = usage({ inputTokens: 200, outputTokens: 50, cacheReadTokens: 4000 });

    const conCache = calcularCosto(u, HAIKU).costUsd;
    const sinCache = costoSinCache(u, HAIKU);

    expect(sinCache).toBeGreaterThan(conCache);
    // Los 4,000 tokens servidos del caché a 0.1x contra 1.0x. No es "3x más
    // caro": es perder ~90% del ahorro en cada llamada repetida.
  });
});

describe('vigencia por fecha del catálogo', () => {
  const catalogo = createStaticPricingCatalog([
    { ...HAIKU, id: 'intro', model: 'claude-sonnet-5', inputPerMtok: 2.0, effectiveFrom: '2026-01-01' },
    { ...HAIKU, id: 'lista', model: 'claude-sonnet-5', inputPerMtok: 3.0, effectiveFrom: '2026-09-01' },
  ]);

  it('en agosto toma el precio introductorio', async () => {
    const f = await catalogo.lookup('anthropic', 'claude-sonnet-5', new Date('2026-08-15'));
    expect(f?.id).toBe('intro');
    expect(f?.inputPerMtok).toBe(2.0);
  });

  it('en septiembre el precio sube solo, sin que nadie toque código', async () => {
    const f = await catalogo.lookup('anthropic', 'claude-sonnet-5', new Date('2026-09-02'));
    expect(f?.id).toBe('lista');
    expect(f?.inputPerMtok).toBe(3.0);
  });

  it('un modelo sin fila devuelve null, no un precio inventado', async () => {
    expect(await catalogo.lookup('anthropic', 'modelo-nuevo-sin-precio')).toBeNull();
  });
});
