/**
 * El libro de consumo.
 *
 * Lo que se prueba aquí es la decisión que separa esto de GARDEN: la fila
 * guarda TOKENS, no un costo ya cocinado. Cuando un precio está mal, en GARDEN
 * es un dato perdido; aquí es un `UPDATE`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __setClientForTests } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import { corridasDesde, gastoDesde, registrarConsumo } from './usage-ledger';
import { createFakeDb, type FakeDb } from '../testing/fake-db';
import { usage } from '../testing/fakes';

const T = '11111111-1111-1111-1111-111111111111';
const ctx: TenantContext = {
  tenantId: T,
  tenantSlug: 'x',
  userEmail: 'a@b.mx',
  role: 'owner',
  areas: {},
};

const entrada = (extra: Record<string, unknown> = {}) => ({
  role: 'sales' as const,
  agentDefinitionId: 'a-1',
  provider: 'anthropic' as const,
  model: 'claude-haiku-4-5',
  usage: usage({ inputTokens: 1000, outputTokens: 100, cacheReadTokens: 4000 }),
  costo: { costUsd: 0.0019, source: 'priced' as const, pricingId: 'p-1' },
  iterations: 1,
  latencyMs: 850,
  status: 'ok' as const,
  ...extra,
});

let db: FakeDb;
let restaurar: () => void;

beforeEach(() => {
  db = createFakeDb({ usage_ledger: [] });
  restaurar = __setClientForTests(db.client);
});

afterEach(() => restaurar());

describe('escritura', () => {
  it('guarda los TOKENS crudos, no sólo el costo', async () => {
    await registrarConsumo(ctx, entrada());

    const f = db.tabla('usage_ledger')[0];
    expect(f?.input_tokens).toBe(1000);
    expect(f?.output_tokens).toBe(100);
    expect(f?.cache_read_tokens).toBe(4000);
    // Con esto, un precio corregido permite recalcular hacia atrás. GARDEN
    // guarda el número cocinado y no hay vuelta.
  });

  it('separa la escritura de caché por TTL: cuestan 1.25x y 2x', async () => {
    await registrarConsumo(
      ctx,
      entrada({ usage: usage({ cacheWrite5mTokens: 500, cacheWrite1hTokens: 700 }) }),
    );

    const f = db.tabla('usage_ledger')[0];
    expect(f?.cache_write_5m_tokens).toBe(500);
    expect(f?.cache_write_1h_tokens).toBe(700);
    // En una sola columna, el costo del TTL largo saldría 60% bajo.
  });

  it('guarda con qué precio se calculó, para poder auditarlo', async () => {
    await registrarConsumo(ctx, entrada());

    const f = db.tabla('usage_ledger')[0];
    expect(f?.cost_source).toBe('priced');
    expect(f?.pricing_id).toBe('p-1');
    // Sin esto, "¿por qué esta llamada costó eso?" no tiene respuesta.
  });

  it('NUNCA lanza: un fallo de contabilidad no puede tumbar una respuesta', async () => {
    restaurar();
    const roto = createFakeDb();
    // Un cliente que revienta al escribir.
    roto.client = {
      from: () => {
        throw new Error('la base se cayó');
      },
    } as unknown as typeof roto.client;
    restaurar = __setClientForTests(roto.client);

    await expect(registrarConsumo(ctx, entrada())).resolves.toBeUndefined();
  });
});

describe('idempotencia por request_id', () => {
  it('el mismo request_id no se cobra dos veces', async () => {
    const e = entrada({ usage: usage({ inputTokens: 100, requestId: 'msg_x' }) });

    await registrarConsumo(ctx, e);
    await registrarConsumo(ctx, e);

    expect(db.tabla('usage_ledger')).toHaveLength(1);
  });

  it('sin request_id sí se registran las dos: un error de red no tiene id', async () => {
    await registrarConsumo(ctx, entrada({ status: 'error' }));
    await registrarConsumo(ctx, entrada({ status: 'error' }));

    // El índice único es PARCIAL (WHERE request_id IS NOT NULL) justo por esto.
    expect(db.tabla('usage_ledger')).toHaveLength(2);
  });
});

describe('agregados', () => {
  it('suma el gasto desde una fecha', async () => {
    await registrarConsumo(ctx, entrada({ costo: { costUsd: 1.5, source: 'priced', pricingId: null }, usage: usage({ requestId: 'a' }) }));
    await registrarConsumo(ctx, entrada({ costo: { costUsd: 2.25, source: 'priced', pricingId: null }, usage: usage({ requestId: 'b' }) }));

    const total = await gastoDesde(ctx, new Date('2020-01-01'));
    expect(total).toBeCloseTo(3.75, 6);
  });

  it('cuenta corridas para el rate limit sin traerse las filas', async () => {
    await registrarConsumo(ctx, entrada({ usage: usage({ requestId: 'a' }) }));
    await registrarConsumo(ctx, entrada({ usage: usage({ requestId: 'b' }) }));

    expect(await corridasDesde(ctx, new Date('2020-01-01'))).toBe(2);
  });

  it('el gasto de otro tenant no cuenta', async () => {
    const otro: TenantContext = { ...ctx, tenantId: '22222222-2222-2222-2222-222222222222' };

    await registrarConsumo(ctx, entrada({ usage: usage({ requestId: 'a' }) }));
    await registrarConsumo(otro, entrada({ usage: usage({ requestId: 'b' }) }));

    expect(await corridasDesde(ctx, new Date('2020-01-01'))).toBe(1);
  });
});
