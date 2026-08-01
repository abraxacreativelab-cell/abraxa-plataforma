/**
 * El ciclo de vida del plan, del lado de JavaScript.
 *
 * `apply_plan_change` es una función de plpgsql (migración 131) porque toca
 * cuatro tablas y tiene que ser todo o nada. El doble de H2 se niega a
 * implementar funciones de base en JavaScript **a propósito**
 * (`fake-postgrest.ts:337-347`): si las implementara, estas pruebas estarían
 * verificando esa reimplementación y no el SQL que corre en producción.
 *
 * Así que aquí se prueba lo único que vive en TypeScript —el mapeo de la
 * respuesta y la invalidación del caché— y el comportamiento real (pausar,
 * restaurar sólo lo del plan, idempotencia) está en `pg.test.ts` contra
 * Postgres de verdad. Los criterios #8, #9 y #10 se demuestran allá.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  instalarDoble,
  sembrarEfectivas,
  sembrarPausa,
  sembrarTenant,
  type AlmacenFake,
} from './testing/siembra';
import { contextFor } from '../services/context';
import { applyPlanChange, pausesFor, isPaused, planHistoryFor } from './lifecycle';
import { can } from './can';
import type { FullTenantContext } from '../types';

let almacen: AlmacenFake;
let restaurar: () => void;
let ctx: FullTenantContext;
let tenantId: string;

beforeEach(async () => {
  ({ almacen, restaurar } = instalarDoble());
  ({ tenantId } = sembrarTenant(almacen, {
    slug: 'panaderia-lupita',
    ownerEmail: 'ana@panaderia.mx',
    plan: 'pro',
  }));
  ctx = await contextFor({ userEmail: 'ana@panaderia.mx', tenantSlug: 'panaderia-lupita' });
});

afterEach(() => {
  restaurar();
  almacen.limpiar();
});

describe('applyPlanChange — la traducción', () => {
  it('devuelve los efectos que reportó la base', async () => {
    almacen.registrarRpc('apply_plan_change', () => [
      {
        change_id: 7,
        applied: true,
        effects: [
          { feature: 'flows.publish', action: 'paused' },
          { feature: 'crm.pipelines', action: 'readonly' },
        ],
      },
    ]);

    expect(await applyPlanChange({
      tenantId,
      toPlan: 'free',
      toStatus: 'active',
      reason: 'cancel',
    })).toEqual({
      changeId: 7,
      applied: true,
      effects: [
        { feature: 'flows.publish', action: 'paused' },
        { feature: 'crm.pipelines', action: 'readonly' },
      ],
    });
  });

  it('★ applied=false cuando no había nada que aplicar', async () => {
    // Es la señal de idempotencia que H10 necesita para distinguir "ya estaba
    // hecho" de "lo hice yo" sin comparar estados a mano.
    almacen.registrarRpc('apply_plan_change', () => [
      { change_id: 7, applied: false, effects: [] },
    ]);

    expect(await applyPlanChange({
      tenantId,
      toPlan: 'free',
      toStatus: 'active',
      reason: 'cancel',
    })).toMatchObject({ applied: false, changeId: 7 });
  });

  it('★ tira el caché SIEMPRE, incluso cuando applied es false', async () => {
    sembrarEfectivas(almacen, tenantId, { 'flows.publish': false });
    expect(await can(ctx, 'flows.publish')).toBe(false); // queda cacheado

    almacen.reemplazar('tenant_entitlements_effective', []);
    sembrarEfectivas(almacen, tenantId, { 'flows.publish': true });
    almacen.registrarRpc('apply_plan_change', () => [
      { change_id: 8, applied: false, effects: [] },
    ]);

    await applyPlanChange({ tenantId, toPlan: 'pro', toStatus: 'active', reason: 'checkout' });

    // Sin esto, un cliente que acaba de pagar vería "no contratado" hasta un
    // minuto más — que es la primera impresión de haber pagado.
    expect(await can(ctx, 'flows.publish')).toBe(true);
  });

  it('traduce el error de la base a un PlatformError legible', async () => {
    almacen.registrarRpc('apply_plan_change', () => {
      const e = new Error('El plan "inventado" no existe en el catálogo.') as Error & { code: string };
      e.code = 'ABX31';
      throw e;
    });

    await expect(
      applyPlanChange({ tenantId, toPlan: 'inventado', toStatus: 'active', reason: 'staff' }),
    ).rejects.toMatchObject({ message: expect.stringContaining('inventado') });
  });

  it('tolera una respuesta sin efectos sin romperse', async () => {
    almacen.registrarRpc('apply_plan_change', () => [{ change_id: null, applied: false }]);

    expect(await applyPlanChange({
      tenantId,
      toPlan: 'free',
      toStatus: 'active',
      reason: 'cancel',
    })).toEqual({ changeId: null, applied: false, effects: [] });
  });
});

describe('las pausas, como las lee el producto', () => {
  it('pausesFor trae las vivas con quién las puso', async () => {
    sembrarPausa(almacen, tenantId, { feature: 'flows.publish', pausedBy: 'plan' });
    sembrarPausa(almacen, tenantId, { feature: 'inbox.meta', pausedBy: 'user', note: 'de vacaciones' });

    const vivas = await pausesFor(ctx);
    expect(vivas).toHaveLength(2);
    expect(vivas.find((p) => p.featureKey === 'flows.publish')?.pausedBy).toBe('plan');
    expect(vivas.find((p) => p.featureKey === 'inbox.meta')).toMatchObject({
      pausedBy: 'user',
      note: 'de vacaciones',
      resourceRef: '*',
    });
  });

  it('no trae las liberadas', async () => {
    almacen.sembrar('feature_pauses', {
      id: 99,
      tenant_id: tenantId,
      feature_key: 'flows.publish',
      resource_ref: '*',
      paused_by: 'plan',
      note: null,
      created_at: '2026-07-01T00:00:00.000Z',
      released_at: '2026-07-15T00:00:00.000Z',
    });

    expect(await pausesFor(ctx)).toHaveLength(0);
  });

  it('isPaused: una pausa de toda la función cubre cualquier recurso', async () => {
    sembrarPausa(almacen, tenantId, { feature: 'flows.publish', pausedBy: 'plan', resourceRef: '*' });

    expect(await isPaused(ctx, 'flows.publish', 'flujo-123')).toBe(true);
    expect(await isPaused(ctx, 'inbox.meta', 'flujo-123')).toBe(false);
  });

  it('isPaused: una pausa de un recurso concreto no cubre a los demás', async () => {
    sembrarPausa(almacen, tenantId, {
      feature: 'flows.publish',
      pausedBy: 'user',
      resourceRef: 'flujo-123',
    });

    expect(await isPaused(ctx, 'flows.publish', 'flujo-123')).toBe(true);
    expect(await isPaused(ctx, 'flows.publish', 'flujo-456')).toBe(false);
  });
});

describe('la bitácora', () => {
  it('sale del más reciente al más viejo', async () => {
    almacen.sembrar('plan_changes', [
      {
        id: 1, tenant_id: tenantId, from_plan: 'free', to_plan: 'pro',
        from_status: 'active', to_status: 'active', reason: 'checkout',
        actor: 'ana@panaderia.mx', effects: [], created_at: '2026-06-01T00:00:00.000Z',
      },
      {
        id: 2, tenant_id: tenantId, from_plan: 'pro', to_plan: 'free',
        from_status: 'active', to_status: 'active', reason: 'payment_failed',
        actor: null, effects: [{ feature: 'flows.publish', action: 'paused' }],
        created_at: '2026-07-01T00:00:00.000Z',
      },
    ]);

    const historial = await planHistoryFor(ctx);
    expect(historial.map((h) => h.id)).toEqual([2, 1]);
    expect(historial[0]?.effects).toEqual([{ feature: 'flows.publish', action: 'paused' }]);
    expect(historial[0]?.reason).toBe('payment_failed');
  });

  it('un cambio sin efectos registrados no revienta la lectura', async () => {
    almacen.sembrar('plan_changes', {
      id: 3, tenant_id: tenantId, from_plan: null, to_plan: 'free',
      from_status: null, to_status: 'active', reason: 'staff',
      actor: null, effects: null, created_at: '2026-07-05T00:00:00.000Z',
    });

    expect((await planHistoryFor(ctx))[0]?.effects).toEqual([]);
  });
});
