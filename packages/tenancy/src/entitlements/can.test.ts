/**
 * `can()` — el eje booleano, del lado de JavaScript.
 *
 * Aquí se prueba lo que vive en TypeScript: deny por defecto ante una respuesta
 * incompleta, fail-closed cuando la consulta revienta, el caché y su
 * invalidación, y la diferencia entre 402 y 403.
 *
 * La resolución de tres saltos y el vencimiento viven en SQL y se prueban
 * contra Postgres de verdad en `pg.test.ts` — ver el encabezado de
 * `testing/siembra.ts` para el reparto y por qué es así.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setClientForTests, type AnyClient } from '@abraxa/db';
import {
  instalarDoble,
  sembrarEfectivas,
  sembrarEfectivasSuspendida,
  sembrarTenant,
  type AlmacenFake,
} from './testing/siembra';
import { contextFor } from '../services/context';
import { can, assertEntitled, entitlementsFor, entitlementDetailsFor, invalidarEntitlements } from './can';
import { RAZON_NO_CONTRATADO } from './errores';
import { TTL_CACHE_ENTITLEMENTS_MS } from './config';
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
    plan: 'free',
  }));
  ctx = await contextFor({ userEmail: 'ana@panaderia.mx', tenantSlug: 'panaderia-lupita' });
});

afterEach(() => {
  restaurar();
  almacen.limpiar();
  vi.useRealTimers();
});

describe('deny por defecto', () => {
  it('★ una función que no está en el catálogo devuelve false', async () => {
    sembrarEfectivas(almacen, tenantId, { 'inbox.whatsapp': true });

    // Ni siquiera existe como llave: la vista no la devolvería nunca.
    expect(await can(ctx, 'inventada.que.no.existe')).toBe(false);
  });

  it('★ una función del catálogo que la vista no devolvió también es false', async () => {
    // Se siembra el catálogo a medias: `flows.publish` no tiene fila.
    almacen.sembrar('tenant_entitlements_effective', {
      tenant_id: tenantId,
      feature_key: 'inbox.whatsapp',
      label: 'WhatsApp',
      blurb: 'x',
      on_downgrade: 'pause',
      position: 10,
      granted: true,
      source: 'plan',
      override_expires_at: null,
      override_note: null,
    });

    expect(await can(ctx, 'inbox.whatsapp')).toBe(true);
    expect(await can(ctx, 'flows.publish')).toBe(false);
  });

  it('★ es al revés que un límite numérico ausente, y eso está documentado', async () => {
    // La asimetría deliberada: un límite ausente es ILIMITADO (plans.ts:10-14),
    // una función ausente está APAGADA. Se falla del lado que se descubre
    // rápido. Esta prueba existe para que cambiarla duela.
    const { quotaFor } = await import('../services/plans');
    expect(quotaFor({}, 'maxContacts', 999_999).exceeded).toBe(false); // ilimitado
    expect(await can(ctx, 'crm.pipelines')).toBe(false); // apagada
  });
});

describe('fail-closed', () => {
  it('★ si la consulta revienta, can() devuelve false — nunca true', async () => {
    // La forma imita a `tenantDb()`: `.from().select().eq()`. Si el doble
    // rechazara en `select()`, el fallo sería un TypeError al encadenar `.eq()`
    // y la prueba pasaría por la razón equivocada.
    const roto = {
      from: () => ({
        select: () => ({ eq: () => Promise.reject(new Error('la base se cayó')) }),
      }),
    };
    const quitar = __setClientForTests(roto as unknown as AnyClient);
    invalidarEntitlements();

    try {
      expect(await can(ctx, 'inbox.whatsapp')).toBe(false);
    } finally {
      quitar();
    }
  });

  it('un error de base tampoco concede por assertEntitled', async () => {
    const roto = {
      from: () => ({ select: () => ({ eq: () => Promise.reject(new Error('timeout')) }) }),
    };
    const quitar = __setClientForTests(roto as unknown as AnyClient);
    invalidarEntitlements();

    try {
      await expect(assertEntitled(ctx, 'inbox.whatsapp')).rejects.toMatchObject({ status: 402 });
    } finally {
      quitar();
    }
  });

  it('entitlementsFor SÍ propaga el error: la pantalla no puede pintar cero', async () => {
    const roto = {
      from: () => ({
        select: () => ({
          eq: () => Promise.resolve({ data: null, error: { message: 'boom' }, count: null }),
        }),
      }),
    };
    const quitar = __setClientForTests(roto as unknown as AnyClient);
    invalidarEntitlements();

    try {
      await expect(entitlementsFor(ctx)).rejects.toBeTruthy();
    } finally {
      quitar();
    }
  });
});

describe('el tenant no activo', () => {
  it('★ una empresa suspendida da false en TODAS las funciones', async () => {
    sembrarEfectivasSuspendida(almacen, tenantId);

    const todas = await entitlementsFor(ctx);
    expect(Object.values(todas).every((v) => v === false)).toBe(true);
    expect(Object.keys(todas).length).toBeGreaterThan(0); // que no pase por vacío
  });

  it('y lo dice: source = tenant_inactive, no "no contratado"', async () => {
    sembrarEfectivasSuspendida(almacen, tenantId);
    const detalle = await entitlementDetailsFor(ctx);
    expect(detalle.every((d) => d.source === 'tenant_inactive')).toBe(true);
  });
});

describe('402 contra 403', () => {
  it('★ una función no contratada responde 402, no 403', async () => {
    sembrarEfectivas(almacen, tenantId, { 'inbox.whatsapp': true });

    await expect(assertEntitled(ctx, 'flows.publish')).rejects.toMatchObject({
      status: 402,
      details: { reason: RAZON_NO_CONTRATADO, feature: 'flows.publish' },
    });
  });

  it('el 402 lleva el blurb, para que la pantalla de mejora diga qué se pierde', async () => {
    sembrarEfectivas(almacen, tenantId, {});

    await expect(assertEntitled(ctx, 'flows.publish')).rejects.toMatchObject({
      details: { blurb: expect.stringContaining('flujo') },
    });
  });

  it('una función contratada no lanza', async () => {
    sembrarEfectivas(almacen, tenantId, { 'flows.publish': true });
    await expect(assertEntitled(ctx, 'flows.publish')).resolves.toBeUndefined();
  });

  it('★ falta de PERMISO es 403 y sale por otro camino — no lo decide can()', async () => {
    // El 403 lo da el RBAC de H2 sobre el rol y las áreas; H16 no lo toca. La
    // prueba está aquí para fijar la frontera: confundirlos manda al
    // emprendedor a buscar un administrador que no existe, porque él ES el dueño.
    const { requireArea } = await import('../middleware/rbac');
    expect(typeof requireArea).toBe('function');

    sembrarEfectivas(almacen, tenantId, { 'flows.publish': true });
    // Tiene la función contratada: si algo le falta, ya no es un 402.
    expect(await can(ctx, 'flows.publish')).toBe(true);
  });
});

describe('caché', () => {
  it('no vuelve a consultar dentro del TTL', async () => {
    sembrarEfectivas(almacen, tenantId, { 'inbox.whatsapp': true });
    expect(await can(ctx, 'inbox.whatsapp')).toBe(true);

    // Se cambia el almacén por debajo. Sin caché, la segunda lectura lo vería.
    almacen.reemplazar('tenant_entitlements_effective', []);
    expect(await can(ctx, 'inbox.whatsapp')).toBe(true);
  });

  it('★ invalidarEntitlements() lo tira: un cliente que paga no espera un minuto', async () => {
    sembrarEfectivas(almacen, tenantId, { 'flows.publish': false });
    expect(await can(ctx, 'flows.publish')).toBe(false);

    almacen.reemplazar('tenant_entitlements_effective', []);
    sembrarEfectivas(almacen, tenantId, { 'flows.publish': true });

    expect(await can(ctx, 'flows.publish')).toBe(false); // todavía cacheado
    invalidarEntitlements(tenantId);
    expect(await can(ctx, 'flows.publish')).toBe(true); // ya no
  });

  it('el TTL vence solo', async () => {
    vi.useFakeTimers();
    sembrarEfectivas(almacen, tenantId, { 'flows.publish': false });
    expect(await can(ctx, 'flows.publish')).toBe(false);

    almacen.reemplazar('tenant_entitlements_effective', []);
    sembrarEfectivas(almacen, tenantId, { 'flows.publish': true });

    vi.advanceTimersByTime(TTL_CACHE_ENTITLEMENTS_MS + 1);
    expect(await can(ctx, 'flows.publish')).toBe(true);
  });

  it('★ el caché es POR EMPRESA: invalidar una no toca a la otra', async () => {
    const otra = sembrarTenant(almacen, { slug: 'taqueria-primo', ownerEmail: 'beto@x.mx' });
    const ctxOtra = await contextFor({ userEmail: 'beto@x.mx', tenantSlug: 'taqueria-primo' });

    sembrarEfectivas(almacen, tenantId, { 'flows.publish': true });
    sembrarEfectivas(almacen, otra.tenantId, { 'flows.publish': true });

    expect(await can(ctx, 'flows.publish')).toBe(true);
    expect(await can(ctxOtra, 'flows.publish')).toBe(true);

    almacen.reemplazar('tenant_entitlements_effective', []);
    invalidarEntitlements(tenantId);

    expect(await can(ctx, 'flows.publish')).toBe(false); // se releyó
    expect(await can(ctxOtra, 'flows.publish')).toBe(true); // sigue en caché
  });
});

describe('el detalle que pinta la pantalla', () => {
  it('viene ordenado por posición y con label, blurb y origen', async () => {
    sembrarEfectivas(almacen, tenantId, {
      'inbox.whatsapp': true,
      'crm.pipelines': { granted: true, source: 'override', note: 'cortesía de la venta' },
    });

    const detalle = await entitlementDetailsFor(ctx);
    expect(detalle.map((d) => d.position)).toEqual([...detalle.map((d) => d.position)].sort((a, b) => a - b));

    const embudos = detalle.find((d) => d.key === 'crm.pipelines');
    expect(embudos).toMatchObject({
      granted: true,
      source: 'override',
      note: 'cortesía de la venta',
      label: expect.any(String),
      blurb: expect.any(String),
    });
  });
});
