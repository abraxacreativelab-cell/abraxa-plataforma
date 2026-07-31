/**
 * El presupuesto que sí se aplica.
 *
 * GARDEN declara `MONTHLY_BUDGET_USD` en src/config.ts:122 y ésa es su única
 * aparición en todo el repo: se valida con zod y nunca se lee. Estas pruebas
 * son la diferencia entre declarar un tope y tener uno.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __setClientForTests } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import {
  estadoPresupuesto,
  inicioDeMes,
  invalidarCachePresupuesto,
  resolverLimites,
  verificarPresupuesto,
} from './budget';
import { createFakeDb, type FakeDb } from '../testing/fake-db';

const T = '11111111-1111-1111-1111-111111111111';
const ctx: TenantContext = {
  tenantId: T,
  tenantSlug: 'panaderia-lupita',
  userEmail: 'lupita@ejemplo.mx',
  role: 'owner',
  areas: {},
};

const gasto = (usd: string, cuando = new Date().toISOString()): Record<string, unknown> => ({
  tenant_id: T,
  cost_usd: usd,
  created_at: cuando,
  agent_role: 'sales',
  provider: 'anthropic',
  model: 'claude-haiku-4-5',
});

let db: FakeDb;
let restaurar: () => void;

function montar(datos: Record<string, Array<Record<string, unknown>>> = {}): void {
  db = createFakeDb({
    tenants: [{ id: T, slug: 'panaderia-lupita', plan: 'free' }],
    agent_plan_limits: [
      { plan: 'free', monthly_budget_usd: '5.00', requests_per_minute: 10, max_output_tokens: 4096 },
      { plan: 'pro', monthly_budget_usd: '100.00', requests_per_minute: 60, max_output_tokens: 8192 },
    ],
    agent_budget_overrides: [],
    usage_ledger: [],
    ...datos,
  });
  restaurar = __setClientForTests(db.client);
  invalidarCachePresupuesto();
}

beforeEach(() => montar());
afterEach(() => restaurar());

describe('resolución de límites', () => {
  it('toma los del plan del tenant', async () => {
    const l = await resolverLimites(ctx);
    expect(l.plan).toBe('free');
    expect(l.monthlyBudgetUsd).toBe(5);
    expect(l.origen).toBe('plan');
  });

  it('un override por cliente gana sobre el plan', async () => {
    restaurar();
    montar({
      agent_budget_overrides: [
        { tenant_id: T, monthly_budget_usd: '50.00', requests_per_minute: null, note: 'campaña' },
      ],
    });

    const l = await resolverLimites(ctx);
    expect(l.monthlyBudgetUsd).toBe(50);
    expect(l.origen).toBe('override');
    // Lo que el override no fija, lo hereda del plan.
    expect(l.requestsPerMinute).toBe(10);
  });

  it('un plan desconocido cae en el default TACAÑO, no en uno permisivo', async () => {
    restaurar();
    montar({ tenants: [{ id: T, slug: 'x', plan: 'plan-que-no-existe' }] });

    const l = await resolverLimites(ctx);
    // Fail-closed. Un cliente que topa un límite bajo levanta la mano en
    // minutos; uno sin límite aparece en la factura a fin de mes.
    expect(l.monthlyBudgetUsd).toBe(5);
    expect(l.origen).toBe('default');
  });
});

describe('la ventana es el mes en curso', () => {
  it('inicioDeMes es el día 1 a las 00:00 UTC', () => {
    const d = inicioDeMes(new Date('2026-07-30T22:15:00Z'));
    expect(d.toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });

  it('el gasto del mes pasado no cuenta contra el de este', async () => {
    const mesPasado = new Date(Date.now() - 45 * 24 * 3600 * 1000).toISOString();
    restaurar();
    montar({ usage_ledger: [gasto('99.00', mesPasado), gasto('1.00')] });

    const e = await estadoPresupuesto(ctx);
    expect(e.gastadoUsd).toBeCloseTo(1.0, 6);
    expect(e.restanteUsd).toBeCloseTo(4.0, 6);
  });
});

describe('verificación antes de gastar', () => {
  it('deja pasar cuando hay saldo', async () => {
    restaurar();
    montar({ usage_ledger: [gasto('1.00')] });

    const l = await verificarPresupuesto(ctx);
    expect(l.monthlyBudgetUsd).toBe(5);
  });

  it('lanza BUDGET_EXCEEDED al llegar al tope', async () => {
    restaurar();
    montar({ usage_ledger: [gasto('5.00')] });

    await expect(verificarPresupuesto(ctx)).rejects.toMatchObject({
      code: 'BUDGET_EXCEEDED',
      status: 402,
      retryable: false,
    });
  });

  it('el error trae los números para poder actuar sin ir a buscar nada', async () => {
    restaurar();
    montar({ usage_ledger: [gasto('7.50')] });

    try {
      await verificarPresupuesto(ctx);
      expect.unreachable('debió lanzar');
    } catch (e) {
      const err = e as { message: string; details?: Record<string, unknown> };
      expect(err.message).toContain('$7.50');
      expect(err.message).toContain('$5.00');
      expect(err.details?.plan).toBe('free');
      expect(err.details?.origen).toBe('plan');
    }
  });

  it('lanza RATE_LIMITED al pasar las llamadas por minuto', async () => {
    const ahora = new Date().toISOString();
    restaurar();
    // 10 corridas en el último minuto es justo el tope del plan free.
    montar({ usage_ledger: Array.from({ length: 10 }, () => gasto('0.001', ahora)) });

    await expect(verificarPresupuesto(ctx)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
      // A diferencia del presupuesto, éste sí se reintenta.
      retryable: true,
    });
  });

  it('el ritmo se cuenta por TENANT, no en un cubo global del proceso', async () => {
    const otro = '22222222-2222-2222-2222-222222222222';
    const ahora = new Date().toISOString();
    restaurar();
    montar({
      tenants: [
        { id: T, slug: 'a', plan: 'free' },
        { id: otro, slug: 'b', plan: 'free' },
      ],
      usage_ledger: Array.from({ length: 10 }, () => ({ ...gasto('0.001', ahora), tenant_id: otro })),
    });

    // El otro tenant topó su límite; éste no se ve afectado. En GARDEN el
    // limitador vive en un Map del proceso y se pierde al reiniciar.
    await expect(verificarPresupuesto(ctx)).resolves.toBeTruthy();
  });
});
