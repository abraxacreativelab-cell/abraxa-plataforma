/**
 * La capa de datos. Dos cosas que sólo se ven aquí:
 *
 *   · La idempotencia del webhook vive en el `UNIQUE (stripe_event_id)`, no en
 *     un SELECT-luego-INSERT: se inserta primero y se pregunta después.
 *   · `syncPlanCatalog` NUNCA borra. Un plan que desaparece de `app.plans` se
 *     lleva por delante el `REFERENCES` de toda suscripción que lo use.
 *
 * Aquí VIVÍA `slugOcupado`, con su prueba de fail-closed. Se fue con el defecto
 * que provocaba: preguntar si la fila existe no es la pregunta correcta —la
 * correcta es de quién es— y por eso el reproceso de un pago creaba una segunda
 * empresa. Quien decide ahora es `app.provision_tenant`; ver `service.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformError, __setClientForTests } from '@abraxa/db';
import { resetEnvCache } from '@abraxa/config';
import { FakeDb } from './pruebas/fake-db';
import { PLAN_CATALOG } from './catalog';
import {
  asegurarPlanDelTenant,
  guardarSuscripcion,
  marcarError,
  marcarProcesado,
  registrarEvento,
  syncPlanCatalog,
} from './store';

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
      yaProcesado: false,
    });
    expect(await registrarEvento({ stripeEventId: 'evt_1', type: 't', payload: {} })).toEqual({
      duplicado: true,
      yaProcesado: false,
    });
    expect(db.tabla('billing_events')).toHaveLength(1);
  });

  it('un duplicado de algo YA TERMINADO se distingue de uno a medias', async () => {
    // La diferencia entre "no lo vuelvas a mandar" y "hay que reintentarlo".
    await registrarEvento({ stripeEventId: 'evt_hecho', type: 't', payload: {} });
    await marcarProcesado('evt_hecho');

    expect(await registrarEvento({ stripeEventId: 'evt_hecho', type: 't', payload: {} })).toEqual({
      duplicado: true,
      yaProcesado: true,
    });
  });

  it('si no se puede leer el estado del duplicado, LANZA en vez de suponer', async () => {
    await registrarEvento({ stripeEventId: 'evt_5', type: 't', payload: {} });

    // El INSERT choca (23505) y la lectura del estado falla.
    db.fallarEnLectura = { tabla: 'billing_events', mensaje: 'timeout' };

    await expect(
      registrarEvento({ stripeEventId: 'evt_5', type: 't', payload: {} }),
    ).rejects.toMatchObject({ retryable: true });
  });

  it('un fallo real de la base LANZA y es reintentable', async () => {
    db.fallarEn = { tabla: 'billing_events', mensaje: 'timeout' };
    await expect(
      registrarEvento({ stripeEventId: 'evt_2', type: 't', payload: {} }),
    ).rejects.toMatchObject({ code: 'INTERNAL', retryable: true });
  });
});

describe('guardarSuscripcion', () => {
  const BASE = {
    tenantId: 'T1',
    planId: 'pro',
    status: 'active',
    monto: 25,
    moneda: 'usd',
    stripeCustomerId: 'cus_1',
    stripeSubscriptionId: null,
    currentPeriodEnd: null,
  };

  it('reintentar actualiza la misma fila en vez de duplicar el cobro', async () => {
    await guardarSuscripcion(BASE);
    await guardarSuscripcion({ ...BASE, monto: 40 });

    const filas = db.tabla('subscriptions');
    expect(filas).toHaveLength(1);
    expect(filas[0]!.amount).toBe(40);
  });

  it('la moneda se escribe junto a la cifra', async () => {
    await guardarSuscripcion({ ...BASE, monto: 500, moneda: 'mxn' });

    expect(db.tabla('subscriptions')[0]!).toMatchObject({ amount: 500, currency: 'mxn' });
  });

  it('una cifra sin moneda es un dato que miente: se rechaza antes de escribirla', async () => {
    // El CHECK de la migración dice lo mismo. Esto es no llegar hasta él con
    // el pago ya cobrado y un mensaje de Postgres por toda explicación.
    await expect(guardarSuscripcion({ ...BASE, monto: 25, moneda: null })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    expect(db.tabla('subscriptions')).toHaveLength(0);
  });

  it('sin cifra y sin moneda sí se puede: es una suscripción sin monto conocido', async () => {
    await guardarSuscripcion({ ...BASE, monto: null, moneda: null });

    expect(db.tabla('subscriptions')[0]!).toMatchObject({ amount: null, currency: null });
  });

  it('un fallo LANZA para que el webhook no devuelva 200', async () => {
    db.fallarEn = { tabla: 'subscriptions', mensaje: 'no hay conexión' };
    await expect(guardarSuscripcion({ ...BASE, monto: 1 })).rejects.toThrow(PlatformError);
  });
});

describe('asegurarPlanDelTenant', () => {
  /*
   * El hallazgo C del PR #11: `provision()` da de alta en `free` y el port no
   * tiene por dónde pedirle otro plan, así que el que paga se quedaba ahí.
   * Esto lo sube después de que el pago está confirmado.
   */

  it('sube el plan de la empresa que acaba de pagar', async () => {
    db.sembrar('tenants', [{ id: 'T1', slug: 'panaderia-lupita', plan: 'free' }]);

    await asegurarPlanDelTenant('T1', 'pro');

    expect(db.tabla('tenants')[0]!.plan).toBe('pro');
  });

  it('correrlo dos veces deja lo mismo — el reproceso de un webhook lo repite', async () => {
    db.sembrar('tenants', [{ id: 'T1', slug: 'panaderia-lupita', plan: 'free' }]);

    await asegurarPlanDelTenant('T1', 'pro');
    await asegurarPlanDelTenant('T1', 'pro');

    expect(db.tabla('tenants')[0]!.plan).toBe('pro');
  });

  it('no toca a las demás empresas', async () => {
    db.sembrar('tenants', [
      { id: 'T1', slug: 'panaderia-lupita', plan: 'free' },
      { id: 'T2', slug: 'otra', plan: 'free' },
    ]);

    await asegurarPlanDelTenant('T1', 'pro');

    expect(db.tabla('tenants').find((t) => t.id === 'T2')!.plan).toBe('free');
  });

  it('un fallo LANZA y es reintentable: pagar y quedarse en free no es un 200', async () => {
    db.sembrar('tenants', [{ id: 'T1', slug: 'panaderia-lupita', plan: 'free' }]);
    db.fallarEn = { tabla: 'tenants', mensaje: 'no hay conexión' };

    await expect(asegurarPlanDelTenant('T1', 'pro')).rejects.toMatchObject({
      code: 'INTERNAL',
      retryable: true,
    });
  });

  it('un plan que no está en el catálogo NO se escribe', async () => {
    // `app.tenants.plan` tiene FOREIGN KEY contra `app.plans`: un plan
    // inventado revienta el UPDATE con el pago ya cobrado. Se corta antes.
    db.sembrar('tenants', [{ id: 'T1', slug: 'panaderia-lupita', plan: 'free' }]);

    await expect(asegurarPlanDelTenant('T1', 'enterprise')).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    expect(db.tabla('tenants')[0]!.plan).toBe('free');
  });
});

describe('marcarError', () => {
  it('anota el motivo y suma un intento', async () => {
    await registrarEvento({ stripeEventId: 'evt_3', type: 't', payload: {} });

    await marcarError('evt_3', 'primera falla');
    await marcarError('evt_3', 'segunda falla');

    const e = db.tabla('billing_events')[0]!;
    expect(e.error).toBe('segunda falla');
    expect(e.attempts).toBe(2);
  });

  it('recorta un motivo gigante en vez de reventar la columna', async () => {
    await registrarEvento({ stripeEventId: 'evt_4', type: 't', payload: {} });
    await marcarError('evt_4', 'x'.repeat(5000));
    expect(String(db.tabla('billing_events')[0]!.error)).toHaveLength(2000);
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
