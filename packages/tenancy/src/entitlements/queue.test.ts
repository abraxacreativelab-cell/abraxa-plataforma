/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Verificar AL EJECUTAR — la mecánica.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * El ciclo completo con el cambio de plan REAL entre el encolado y la ejecución
 * (criterio #7) está en `pg.test.ts`, contra Postgres, porque el cambio de plan
 * es SQL. Aquí se prueba lo que vive en JavaScript: las tres puertas, su orden,
 * que no lance, y que deje constancia.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  instalarDoble,
  sembrarEfectivas,
  sembrarEfectivasSuspendida,
  sembrarTenant,
  type AlmacenFake,
} from './testing/siembra';
import { withEntitlement, withLiveTenant } from './queue';
import { invalidarEntitlements } from './can';
import type { SkipReason } from './catalogo';

let almacen: AlmacenFake;
let restaurar: () => void;

const omisiones = (tenantId?: string): Array<Record<string, unknown>> =>
  almacen.tabla('plan_skips').filter((f) => !tenantId || f.tenant_id === tenantId);

beforeEach(() => {
  ({ almacen, restaurar } = instalarDoble());
});

afterEach(() => {
  restaurar();
  almacen.limpiar();
});

describe('withEntitlement', () => {
  it('corre el handler cuando la empresa está viva y tiene la función', async () => {
    const { tenantId } = sembrarTenant(almacen, { slug: 'panaderia', ownerEmail: 'a@x.mx', plan: 'pro' });
    sembrarEfectivas(almacen, tenantId, { 'flows.publish': true });

    let corrio = 0;
    const handler = withEntitlement('flows.publish', async (_job, ctx) => {
      corrio += 1;
      expect(ctx.tenantId).toBe(tenantId);
    });

    await handler({ id: 'job-1', name: 'flows.run', data: { tenantId } });
    expect(corrio).toBe(1);
    expect(omisiones()).toHaveLength(0);
  });

  it('★ NO corre si la función no está en el plan, y deja el motivo', async () => {
    const { tenantId } = sembrarTenant(almacen, { slug: 'gratis', ownerEmail: 'b@x.mx', plan: 'free' });
    sembrarEfectivas(almacen, tenantId, { 'inbox.whatsapp': true });

    let corrio = 0;
    const vistos: SkipReason[] = [];
    const handler = withEntitlement(
      'flows.publish',
      async () => {
        corrio += 1;
      },
      { queue: 'flows.run', onSkip: (i) => vistos.push(i.reason) },
    );

    await handler({ id: 'job-2', data: { tenantId } });

    expect(corrio).toBe(0);
    expect(vistos).toEqual(['feature_not_in_plan']);
    expect(omisiones(tenantId)).toMatchObject([
      { feature_key: 'flows.publish', queue: 'flows.run', job_id: 'job-2', reason: 'feature_not_in_plan' },
    ]);
  });

  it('★ NO LANZA: un handler que lanza hace que pg-boss reintente en bucle', async () => {
    const { tenantId } = sembrarTenant(almacen, { slug: 'gratis2', ownerEmail: 'c@x.mx' });
    sembrarEfectivas(almacen, tenantId, {});

    const handler = withEntitlement('flows.publish', async () => {
      throw new Error('no debería llegar aquí');
    });

    // Reintentar un job que no se puede correr porque el cliente no paga es
    // hacer la misma consulta cada pocos minutos hasta agotar los reintentos y
    // dejarlo en `failed` — que se lee como "el sistema está roto" cuando lo
    // que pasa es que el sistema funcionó.
    await expect(handler({ id: 'job-3', data: { tenantId } })).resolves.toBeUndefined();
  });

  it('★ una empresa suspendida se reporta como SUSPENDIDA, no como "no contratado"', async () => {
    const { tenantId } = sembrarTenant(almacen, {
      slug: 'morosa',
      ownerEmail: 'd@x.mx',
      plan: 'pro',
      status: 'suspended',
    });
    sembrarEfectivasSuspendida(almacen, tenantId);

    let corrio = 0;
    await withEntitlement(
      'flows.publish',
      async () => {
        corrio += 1;
      },
      { queue: 'flows.run' },
    )({ id: 'job-4', data: { tenantId } });

    expect(corrio).toBe(0);
    // El orden de las puertas importa: un tenant suspendido da false en TODAS
    // las funciones, así que sin verificar la empresa ANTES que la función,
    // toda suspensión se reportaría como una función no contratada — y el
    // emprendedor vería la pantalla de mejora de plan cuando su problema es un
    // pago.
    expect(omisiones(tenantId)).toMatchObject([{ reason: 'tenant_suspended' }]);
  });

  it('una archivada se distingue de una suspendida', async () => {
    const { tenantId } = sembrarTenant(almacen, {
      slug: 'ida',
      ownerEmail: 'e@x.mx',
      status: 'archived',
    });
    sembrarEfectivasSuspendida(almacen, tenantId);

    await withEntitlement('flows.publish', async () => undefined)({ id: 'j', data: { tenantId } });
    expect(omisiones(tenantId)).toMatchObject([{ reason: 'tenant_archived' }]);
  });

  it('un job sin empresa se omite y no revienta el worker', async () => {
    let corrio = 0;
    const vistos: SkipReason[] = [];
    await withEntitlement(
      'flows.publish',
      async () => {
        corrio += 1;
      },
      { onSkip: (i) => vistos.push(i.reason) },
    )({ id: 'huerfano' });

    expect(corrio).toBe(0);
    expect(vistos).toEqual(['tenant_unknown']);
  });

  it('acepta las tres formas en que los carriles encolan el tenant', async () => {
    const { tenantId } = sembrarTenant(almacen, { slug: 'formas', ownerEmail: 'f@x.mx', plan: 'pro' });
    sembrarEfectivas(almacen, tenantId, { 'flows.publish': true });

    let corrio = 0;
    const handler = withEntitlement('flows.publish', async () => {
      corrio += 1;
    });

    await handler({ tenantId });
    await handler({ tenant_id: tenantId });
    await handler({ data: { tenantId } });

    expect(corrio).toBe(3);
  });

  it('★ la omisión se registra en la empresa correcta, no en otra', async () => {
    const a = sembrarTenant(almacen, { slug: 'empresa-a', ownerEmail: 'g@x.mx' });
    const b = sembrarTenant(almacen, { slug: 'empresa-b', ownerEmail: 'h@x.mx' });
    sembrarEfectivas(almacen, a.tenantId, {});
    sembrarEfectivas(almacen, b.tenantId, { 'flows.publish': true });

    await withEntitlement('flows.publish', async () => undefined)({ id: 'x', data: { tenantId: a.tenantId } });

    expect(omisiones(a.tenantId)).toHaveLength(1);
    expect(omisiones(b.tenantId)).toHaveLength(0);
  });

  it('★ verifica con el plan de AHORA, no con el de cuando se encoló', async () => {
    const { tenantId } = sembrarTenant(almacen, { slug: 'cambiante', ownerEmail: 'i@x.mx', plan: 'pro' });
    sembrarEfectivas(almacen, tenantId, { 'flows.publish': true });

    let corridas = 0;
    const handler = withEntitlement('flows.publish', async () => {
      corridas += 1;
    });

    // Se "encola" con plan pro y corre: bien.
    await handler({ id: 'martes', data: { tenantId } });
    expect(corridas).toBe(1);

    // Baja de plan entre el encolado y la ejecución del siguiente.
    almacen.reemplazar('tenant_entitlements_effective', []);
    sembrarEfectivas(almacen, tenantId, { 'inbox.whatsapp': true });
    invalidarEntitlements(tenantId);

    await handler({ id: 'jueves', data: { tenantId } });
    expect(corridas).toBe(1); // no corrió
    expect(omisiones(tenantId)).toMatchObject([{ job_id: 'jueves', reason: 'feature_not_in_plan' }]);
  });
});

describe('withLiveTenant', () => {
  it('deja pasar a una empresa activa sin exigir función', async () => {
    const { tenantId } = sembrarTenant(almacen, { slug: 'nocturna', ownerEmail: 'j@x.mx' });

    let corrio = 0;
    await withLiveTenant(async () => {
      corrio += 1;
    })({ data: { tenantId } });

    expect(corrio).toBe(1);
  });

  it('frena a una suspendida y lo registra sin función asociada', async () => {
    const { tenantId } = sembrarTenant(almacen, {
      slug: 'nocturna2',
      ownerEmail: 'k@x.mx',
      status: 'suspended',
    });

    let corrio = 0;
    await withLiveTenant(
      async () => {
        corrio += 1;
      },
      { queue: 'resumen.nocturno' },
    )({ data: { tenantId } });

    expect(corrio).toBe(0);
    expect(omisiones(tenantId)).toMatchObject([
      { queue: 'resumen.nocturno', reason: 'tenant_suspended', feature_key: null },
    ]);
  });
});
