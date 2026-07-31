/**
 * La capa de datos. Dos cosas que sólo se ven aquí:
 *
 *   · `slugOcupado` es FAIL-CLOSED. Si devolviera `false` cuando la consulta
 *     falla, `derivarSlug` entregaría un slug ya tomado y el alta moriría
 *     contra el UNIQUE — con el pago ya cobrado.
 *   · `syncPlanCatalog` NUNCA borra. Un plan que desaparece de `app.plans` se
 *     lleva por delante el `REFERENCES` de toda suscripción que lo use.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformError, __setClientForTests } from '@abraxa/db';
import { resetEnvCache } from '@abraxa/config';
import { FakeDb } from './pruebas/fake-db';
import { PLAN_CATALOG } from './catalog';
import { guardarSuscripcion, marcarError, registrarEvento, slugOcupado, syncPlanCatalog } from './store';

let db: FakeDb;
let quitar: () => void;

beforeEach(() => {
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL = 'https://ejemplo.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'llave-de-servicio-de-prueba-suficientemente-larga';
  resetEnvCache();

  db = new FakeDb();
  quitar = __setClientForTests(db as never);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  quitar();
  vi.restoreAllMocks();
});

describe('registrarEvento', () => {
  it('el primero entra, el segundo se marca duplicado', async () => {
    expect(await registrarEvento({ stripeEventId: 'evt_1', type: 't', payload: {} })).toEqual({
      duplicado: false,
    });
    expect(await registrarEvento({ stripeEventId: 'evt_1', type: 't', payload: {} })).toEqual({
      duplicado: true,
    });
    expect(db.tabla('billing_events')).toHaveLength(1);
  });

  it('un fallo real de la base LANZA y es reintentable', async () => {
    db.fallarEn = { tabla: 'billing_events', mensaje: 'timeout' };
    await expect(
      registrarEvento({ stripeEventId: 'evt_2', type: 't', payload: {} }),
    ).rejects.toMatchObject({ code: 'INTERNAL', retryable: true });
  });
});

describe('slugOcupado — fail-closed', () => {
  it('dice la verdad cuando la base contesta', async () => {
    db.sembrar('tenants', [{ slug: 'panaderia-lupita' }]);
    expect(await slugOcupado('panaderia-lupita')).toBe(true);
    expect(await slugOcupado('tacos-el-gordo')).toBe(false);
  });

  it('LANZA en vez de decir "libre" cuando la consulta falla', async () => {
    db.fallarEn = { tabla: 'tenants', mensaje: 'se cayó la red' };
    // Un `false` aquí sería un slug ocupado entregado como libre.
    await expect(slugOcupado('panaderia-lupita')).rejects.toThrow(PlatformError);
  });
});

describe('guardarSuscripcion', () => {
  it('reintentar actualiza la misma fila en vez de duplicar el cobro', async () => {
    const base = {
      tenantId: 'T1',
      planId: 'pro',
      status: 'active',
      amountUsd: 25,
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: null,
      currentPeriodEnd: null,
    };

    await guardarSuscripcion(base);
    await guardarSuscripcion({ ...base, amountUsd: 40 });

    const filas = db.tabla('subscriptions');
    expect(filas).toHaveLength(1);
    expect(filas[0].amount_usd).toBe(40);
  });

  it('un fallo LANZA para que el webhook no devuelva 200', async () => {
    db.fallarEn = { tabla: 'subscriptions', mensaje: 'no hay conexión' };
    await expect(
      guardarSuscripcion({
        tenantId: 'T1',
        planId: 'pro',
        status: 'active',
        amountUsd: 1,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        currentPeriodEnd: null,
      }),
    ).rejects.toThrow(PlatformError);
  });
});

describe('marcarError', () => {
  it('anota el motivo y suma un intento', async () => {
    await registrarEvento({ stripeEventId: 'evt_3', type: 't', payload: {} });

    await marcarError('evt_3', 'primera falla');
    await marcarError('evt_3', 'segunda falla');

    const e = db.tabla('billing_events')[0];
    expect(e.error).toBe('segunda falla');
    expect(e.attempts).toBe(2);
  });

  it('recorta un motivo gigante en vez de reventar la columna', async () => {
    await registrarEvento({ stripeEventId: 'evt_4', type: 't', payload: {} });
    await marcarError('evt_4', 'x'.repeat(5000));
    expect(String(db.tabla('billing_events')[0].error)).toHaveLength(2000);
  });
});

describe('syncPlanCatalog', () => {
  it('escribe el catálogo completo', async () => {
    const { sincronizados } = await syncPlanCatalog();

    expect(sincronizados).toBe(PLAN_CATALOG.length);
    expect(db.tabla('plans').map((p) => p.id)).toEqual(['free', 'pro']);
  });

  it('correrlo dos veces no duplica ni cambia nada', async () => {
    await syncPlanCatalog();
    const primera = JSON.stringify(db.tabla('plans'));

    await syncPlanCatalog();
    expect(db.tabla('plans')).toHaveLength(PLAN_CATALOG.length);
    expect(JSON.stringify(db.tabla('plans'))).toBe(primera);
  });

  it('NO borra un plan que ya no está en el catálogo', async () => {
    // Retirar un plan es desactivarlo. Borrarlo rompe el REFERENCES de las
    // suscripciones que lo usan.
    db.sembrar('plans', [{ id: 'legacy', name: 'Viejo', limits: {}, position: 9, active: false }]);

    await syncPlanCatalog();

    expect(db.tabla('plans').map((p) => p.id)).toContain('legacy');
  });

  it('pisa los límites de la fila existente con los del código', async () => {
    db.sembrar('plans', [{ id: 'pro', name: 'Otro', limits: { maxSeats: 1 }, position: 5, active: false }]);

    await syncPlanCatalog();

    const pro = db.tabla('plans').find((p) => p.id === 'pro')!;
    expect(pro.name).toBe('Pro');
    expect(pro.active).toBe(true);
    expect(pro.limits).toEqual(PLAN_CATALOG.find((p) => p.id === 'pro')!.limits);
  });
});
