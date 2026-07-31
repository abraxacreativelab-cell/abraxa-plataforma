/**
 * Planes y cuotas.
 *
 * La regla que más importa aquí es aburrida y por eso se prueba: un límite
 * AUSENTE es ilimitado, no cero. Con la interpretación contraria, agregar un
 * límite nuevo al plan `pro` y olvidarlo en `free` deja a todos los clientes
 * del plan gratis sin poder crear nada, con un 409 que no explica de dónde
 * sale.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AlmacenFake } from '../testing/fake-postgrest';
import { instalarDoble, sembrarMiembro, sembrarTenant } from '../testing/seed';
import { contextFor } from './context';
import { assertQuota, assertSeatAvailable, availablePlans, limitsFor, quotaFor, seatsFor } from './plans';
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
});

describe('quotaFor', () => {
  it('calcula lo que queda', () => {
    expect(quotaFor({ maxContacts: 500 }, 'maxContacts', 120)).toEqual({
      key: 'maxContacts',
      limit: 500,
      used: 120,
      remaining: 380,
      exceeded: false,
    });
  });

  it('marca excedido al llegar al límite, no al pasarlo', () => {
    expect(quotaFor({ maxSeats: 2 }, 'maxSeats', 2).exceeded).toBe(true);
    expect(quotaFor({ maxSeats: 2 }, 'maxSeats', 1).exceeded).toBe(false);
  });

  it('★ un límite ausente es ILIMITADO, no cero', () => {
    expect(quotaFor({}, 'maxContacts', 999_999)).toMatchObject({
      limit: null,
      remaining: null,
      exceeded: false,
    });
  });

  it('nunca reporta un remaining negativo', () => {
    expect(quotaFor({ maxSeats: 2 }, 'maxSeats', 5).remaining).toBe(0);
  });
});

describe('límites del plan del contexto', () => {
  it('lee los del plan asignado', async () => {
    expect(await limitsFor(ctx)).toMatchObject({ maxSeats: 2, maxContacts: 500 });
  });

  it('funciona con un TenantContext pelón (sin el campo plan)', async () => {
    // Los otros paquetes programan contra ports.ts, que no incluye `plan`.
    const pelon = {
      tenantId: ctx.tenantId,
      tenantSlug: ctx.tenantSlug,
      userEmail: ctx.userEmail,
      role: ctx.role,
      areas: ctx.areas,
    };
    expect(await limitsFor(pelon)).toMatchObject({ maxSeats: 2 });
  });

  it('el catálogo lista los planes activos', async () => {
    expect((await availablePlans()).map((p) => p.id)).toEqual(['free', 'pro']);
  });
});

describe('assertQuota', () => {
  it('deja pasar cuando hay margen', async () => {
    expect((await assertQuota(ctx, 'maxContacts', 10)).exceeded).toBe(false);
  });

  it('lanza CONFLICT en un límite estructural', async () => {
    await expect(assertQuota(ctx, 'maxContacts', 500)).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
    });
  });

  it('lanza BUDGET_EXCEEDED en el gasto de IA', async () => {
    // H6 y H3 tienen que poder distinguir "se acabó el presupuesto" de
    // "no cabe una fila más".
    await expect(assertQuota(ctx, 'monthlyAiUsd', 5)).rejects.toMatchObject({
      code: 'BUDGET_EXCEEDED',
      status: 402,
    });
  });
});

describe('asientos', () => {
  it('cuenta las membresías reales de la empresa', async () => {
    expect(await seatsFor(ctx)).toMatchObject({ limit: 2, used: 1, remaining: 1 });
  });

  it('no cuenta los miembros de otra empresa', async () => {
    const otra = sembrarTenant(almacen, { slug: 'taqueria-primo', ownerEmail: 'beto@x.mx' });
    sembrarMiembro(almacen, otra.tenantId, 'mesero@x.mx', 'member');
    sembrarMiembro(almacen, otra.tenantId, 'otro@x.mx', 'member');

    expect((await seatsFor(ctx)).used).toBe(1);
  });

  it('las invitaciones pendientes NO consumen asiento', async () => {
    almacen.sembrar('invitations', {
      tenant_id: tenantId,
      email: 'pendiente@panaderia.mx',
      role: 'member',
      token_hash: 'a'.repeat(64),
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    });

    expect((await seatsFor(ctx)).used).toBe(1);
  });

  it('assertSeatAvailable pasa con margen y lanza sin él', async () => {
    await expect(assertSeatAvailable(ctx)).resolves.toBeUndefined();

    sembrarMiembro(almacen, tenantId, 'cajera@panaderia.mx', 'member');
    await expect(assertSeatAvailable(ctx)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('el plan pro da más margen', async () => {
    const fila = almacen.tabla('tenants').find((t) => t.id === tenantId);
    if (fila) fila.plan = 'pro';
    const conPro = await contextFor({
      userEmail: 'ana@panaderia.mx',
      tenantSlug: 'panaderia-lupita',
    });

    expect((await seatsFor(conPro)).limit).toBe(10);
  });
});
