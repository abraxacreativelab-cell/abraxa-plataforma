/**
 * La puerta del camino SIN sesión.
 *
 * Es la entrega que se mide en pesos: hoy suspendes una empresa por falta de
 * pago, se queda fuera del producto, y su WhatsApp sigue recibiendo mensajes y
 * su agente sigue contestando con nuestra tarjeta.
 *
 * `contextFor()` sí verifica el estado (services/context.ts:63-79), pero el
 * webhook no pasa por ahí: pasa por `contextoDeCanal()`, que arma el contexto
 * con la fila del canal y no puede mirar `app.tenants.status`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __setClientForTests, type AnyClient } from '@abraxa/db';
import { instalarDoble, sembrarTenant, type AlmacenFake } from './testing/siembra';
import {
  tenantIsLive,
  assertTenantLive,
  contextoDeSistema,
  contextoDeSistemaAunSuspendida,
} from './gate';

let almacen: AlmacenFake;
let restaurar: () => void;

beforeEach(() => {
  ({ almacen, restaurar } = instalarDoble());
});

afterEach(() => {
  restaurar();
  almacen.limpiar();
});

describe('tenantIsLive', () => {
  it('una empresa activa pasa', async () => {
    const { tenantId } = sembrarTenant(almacen, { slug: 'activa', ownerEmail: 'a@x.mx' });
    expect(await tenantIsLive(tenantId)).toEqual({ live: true });
  });

  it('★ una suspendida no pasa, Y DICE POR QUÉ', async () => {
    const { tenantId } = sembrarTenant(almacen, {
      slug: 'suspendida',
      ownerEmail: 'b@x.mx',
      status: 'suspended',
    });

    // El motivo llega a quien llama: es lo que le permite REGISTRAR por qué no
    // hizo nada, en vez de callarse.
    expect(await tenantIsLive(tenantId)).toEqual({ live: false, reason: 'suspended' });
  });

  it('una archivada se distingue de una suspendida', async () => {
    const { tenantId } = sembrarTenant(almacen, {
      slug: 'archivada',
      ownerEmail: 'c@x.mx',
      status: 'archived',
    });
    expect(await tenantIsLive(tenantId)).toEqual({ live: false, reason: 'archived' });
  });

  it('una empresa que no existe no pasa', async () => {
    expect(await tenantIsLive('00000000-0000-4000-8000-999999999999')).toEqual({
      live: false,
      reason: 'unknown',
    });
  });

  it('un tenantId vacío no pasa', async () => {
    expect(await tenantIsLive('')).toEqual({ live: false, reason: 'unknown' });
  });

  it('★ fail-closed: un error de base NO devuelve live', async () => {
    const roto = {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.reject(new Error('down')) }) }),
      }),
    };
    const quitar = __setClientForTests(roto as unknown as AnyClient);

    try {
      // Los dos errores no cuestan lo mismo: dejar pasar a un suspendido gasta
      // tokens en cada mensaje durante días sin que nadie lo note; frenar a uno
      // activo por un timeout se nota en minutos.
      expect(await tenantIsLive('cualquier-cosa')).toEqual({ live: false, reason: 'unknown' });
    } finally {
      quitar();
    }
  });
});

describe('assertTenantLive', () => {
  it('lanza 403 con el motivo para el envío SALIENTE', async () => {
    const { tenantId } = sembrarTenant(almacen, {
      slug: 'morosa',
      ownerEmail: 'd@x.mx',
      status: 'suspended',
    });

    await expect(assertTenantLive(tenantId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
      details: { reason: 'suspended' },
    });
  });

  it('★ es 403 y no 402: el problema no es el plan, es la cuenta', async () => {
    const { tenantId } = sembrarTenant(almacen, {
      slug: 'morosa2',
      ownerEmail: 'e@x.mx',
      status: 'suspended',
    });

    // Ofrecerle subir de plan a alguien suspendido por falta de pago es la
    // respuesta equivocada al problema que tiene.
    await expect(assertTenantLive(tenantId)).rejects.not.toMatchObject({ status: 402 });
  });

  it('no lanza si está activa', async () => {
    const { tenantId } = sembrarTenant(almacen, { slug: 'viva', ownerEmail: 'f@x.mx' });
    await expect(assertTenantLive(tenantId)).resolves.toBeUndefined();
  });
});

describe('contextoDeSistema', () => {
  it('arma un contexto acotado a la empresa, SIN identidad', async () => {
    const { tenantId } = sembrarTenant(almacen, { slug: 'la-empresa', ownerEmail: 'g@x.mx' });

    expect(await contextoDeSistema(tenantId)).toEqual({
      tenantId,
      tenantSlug: 'la-empresa',
      userEmail: null,
      role: null,
      areas: {},
    });
  });

  it('★ areas vacío: el contexto de sistema no autoriza NADA que dependa de quién pide', async () => {
    const { tenantId } = sembrarTenant(almacen, { slug: 'sin-persona', ownerEmail: 'h@x.mx' });
    const ctx = await contextoDeSistema(tenantId);

    const { hasArea } = await import('../middleware/rbac');
    expect(hasArea(ctx, 'ventas', 'view')).toBe(false);
    expect(hasArea(ctx, 'cualquiera', 'view')).toBe(false);
  });

  it('lanza si la empresa no está activa', async () => {
    const { tenantId } = sembrarTenant(almacen, {
      slug: 'apagada',
      ownerEmail: 'i@x.mx',
      status: 'suspended',
    });
    await expect(contextoDeSistema(tenantId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('contextoDeSistemaAunSuspendida', () => {
  it('★ SÍ arma contexto para una suspendida: guardar el mensaje es gratis', async () => {
    const { tenantId } = sembrarTenant(almacen, {
      slug: 'pausada',
      ownerEmail: 'j@x.mx',
      status: 'suspended',
    });

    // La línea se corta en el GASTO, no antes. Un sistema que tira los mensajes
    // de una empresa suspendida le hace perder ventas a alguien que a lo mejor
    // paga mañana.
    expect(await contextoDeSistemaAunSuspendida(tenantId)).toMatchObject({
      tenantId,
      tenantSlug: 'pausada',
      userEmail: null,
    });
  });

  it('devuelve null si la empresa no existe', async () => {
    expect(await contextoDeSistemaAunSuspendida('00000000-0000-4000-8000-111111111111')).toBeNull();
  });
});
