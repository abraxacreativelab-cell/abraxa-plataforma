/**
 * CRITERIOS #5 y #6 del handoff.
 *
 *   #5  `requireArea('ventas','edit')` deja pasar a quien tiene `edit` o
 *       `admin`, y bloquea a quien tiene `view` o nada.
 *   #6  Un grant malformado en la base hace LANZAR, no otorgar acceso en
 *       silencio.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import type { AlmacenFake } from '../testing/fake-postgrest';
import { instalarDoble, sembrarMiembro, sembrarTenant } from '../testing/seed';
import {
  esAdminDelTenant,
  hasArea,
  loadAreaGrants,
  requireAnyArea,
  requireArea,
  requireAreaOperation,
  requireRole,
} from './rbac';
import type { AreaAccess, FullTenantContext } from '../types';

const ctx = (areas: Record<string, AreaAccess>, extra: Partial<FullTenantContext> = {}):
  FullTenantContext => ({
  tenantId: 'T1',
  tenantSlug: 'panaderia',
  tenantName: 'Panadería',
  tenantStatus: 'active',
  userEmail: 'quien@ejemplo.mx',
  role: 'member',
  areas,
  plan: 'free',
  isPlatformStaff: false,
  ...extra,
});

/** Un par (res, next) que registra qué pasó. */
function espias() {
  const res = {
    statusCode: 0,
    cuerpo: null as unknown,
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    json(b: unknown) {
      this.cuerpo = b;
      return this;
    },
  };
  const next = vi.fn();
  return { res: res as unknown as Response & typeof res, next: next as unknown as NextFunction };
}

const pedir = (contexto: FullTenantContext | undefined, metodo = 'GET') =>
  ({ tenant: contexto, method: metodo }) as unknown as Request;

// ═══════════════════════════════════════════════════════════════════════════
describe('hasArea — deny por defecto', () => {
  it('sin contexto, no', () => {
    expect(hasArea(undefined, 'ventas')).toBe(false);
    expect(hasArea(null, 'ventas')).toBe(false);
  });

  it('sin el área otorgada, no', () => {
    expect(hasArea(ctx({}), 'ventas')).toBe(false);
    expect(hasArea(ctx({ finanzas: 'admin' }), 'ventas')).toBe(false);
  });

  it('respeta el orden view < edit < admin', () => {
    expect(hasArea(ctx({ ventas: 'view' }), 'ventas', 'view')).toBe(true);
    expect(hasArea(ctx({ ventas: 'view' }), 'ventas', 'edit')).toBe(false);
    expect(hasArea(ctx({ ventas: 'edit' }), 'ventas', 'edit')).toBe(true);
    expect(hasArea(ctx({ ventas: 'edit' }), 'ventas', 'admin')).toBe(false);
    expect(hasArea(ctx({ ventas: 'admin' }), 'ventas', 'admin')).toBe(true);
  });

  it('el comodín `*` cubre cualquier área (heredado de GARDEN)', () => {
    expect(hasArea(ctx({ '*': 'admin' }), 'lo-que-sea', 'admin')).toBe(true);
    expect(hasArea(ctx({ '*': 'view' }), 'ventas', 'edit')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('★ criterio #5 — requireArea("ventas","edit")', () => {
  it.each([
    ['edit', true],
    ['admin', true],
    ['view', false],
  ] as const)('con acceso %s → pasa: %s', (acceso, deberiaPasar) => {
    const { res, next } = espias();
    requireArea('ventas', 'edit')(pedir(ctx({ ventas: acceso })), res, next);

    expect(vi.mocked(next).mock.calls.length > 0).toBe(deberiaPasar);
    if (!deberiaPasar) expect(res.statusCode).toBe(403);
  });

  it('sin ningún acceso → 403', () => {
    const { res, next } = espias();
    requireArea('ventas', 'edit')(pedir(ctx({})), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('sin contexto → 401, no 403', () => {
    // La diferencia importa: 401 es "no pasaste por el middleware",
    // 403 es "pasaste y no te toca".
    const { res, next } = espias();
    requireArea('ventas', 'edit')(pedir(undefined), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});

describe('requireAnyArea y requireAreaOperation', () => {
  it('requireAnyArea basta con una', () => {
    const { res, next } = espias();
    requireAnyArea(['ventas', 'finanzas'], 'edit')(pedir(ctx({ finanzas: 'edit' })), res, next);
    expect(next).toHaveBeenCalled();
  });

  it('requireAnyArea con ninguna → 403', () => {
    const { res, next } = espias();
    requireAnyArea(['ventas', 'finanzas'], 'edit')(pedir(ctx({ rh: 'admin' })), res, next);
    expect(res.statusCode).toBe(403);
  });

  it('requireAreaOperation: GET exige view', () => {
    const { res, next } = espias();
    requireAreaOperation('ventas')(pedir(ctx({ ventas: 'view' }), 'GET'), res, next);
    expect(next).toHaveBeenCalled();
  });

  it('requireAreaOperation: POST exige edit', () => {
    const { res, next } = espias();
    requireAreaOperation('ventas')(pedir(ctx({ ventas: 'view' }), 'POST'), res, next);
    expect(res.statusCode).toBe(403);
  });

  it('requireAreaOperation: DELETE con edit sí pasa', () => {
    const { res, next } = espias();
    requireAreaOperation('ventas')(pedir(ctx({ ventas: 'edit' }), 'DELETE'), res, next);
    expect(next).toHaveBeenCalled();
  });
});

describe('requireRole', () => {
  it('deja pasar al rol permitido', () => {
    const { res, next } = espias();
    requireRole('owner', 'admin')(pedir(ctx({}, { role: 'admin' })), res, next);
    expect(next).toHaveBeenCalled();
  });

  it('bloquea al que no', () => {
    const { res, next } = espias();
    requireRole('owner', 'admin')(pedir(ctx({}, { role: 'member' })), res, next);
    expect(res.statusCode).toBe(403);
  });

  it('un rol nulo (sesión sin empresa) no pasa', () => {
    const { res, next } = espias();
    requireRole('owner')(pedir(ctx({}, { role: null })), res, next);
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('★ criterio #6 — un grant malformado LANZA', () => {
  let almacen: AlmacenFake;
  let restaurar: () => void;
  let tenantId: string;

  beforeEach(() => {
    ({ almacen, restaurar } = instalarDoble());
    ({ tenantId } = sembrarTenant(almacen, { slug: 'panaderia', ownerEmail: 'ana@x.mx' }));
    sembrarMiembro(almacen, tenantId, 'juan@x.mx', 'member', { ventas: 'view' });
  });

  afterEach(() => {
    restaurar();
    almacen.limpiar();
  });

  it('carga bien los grants válidos', async () => {
    expect(await loadAreaGrants(tenantId, 'juan@x.mx', false)).toEqual({ ventas: 'view' });
  });

  it('un access inválido en la base hace lanzar, NO se ignora', async () => {
    almacen.sembrar('area_grants', {
      tenant_id: tenantId,
      user_email: 'juan@x.mx',
      area_slug: 'finanzas',
      access: 'superusuario',
    });

    await expect(loadAreaGrants(tenantId, 'juan@x.mx', false)).rejects.toMatchObject({
      code: 'INTERNAL',
    });
  });

  it('un area_slug vacío también lanza', async () => {
    almacen.sembrar('area_grants', {
      tenant_id: tenantId,
      user_email: 'juan@x.mx',
      area_slug: '',
      access: 'view',
    });

    await expect(loadAreaGrants(tenantId, 'juan@x.mx', false)).rejects.toBeTruthy();
  });

  it('y al lanzar NO otorga nada: no hay resultado parcial que aprovechar', async () => {
    almacen.sembrar('area_grants', {
      tenant_id: tenantId,
      user_email: 'juan@x.mx',
      area_slug: 'finanzas',
      access: null,
    });

    const resultado = await loadAreaGrants(tenantId, 'juan@x.mx', false).catch(() => 'lanzó');
    expect(resultado).toBe('lanzó');
  });

  it('owner y admin no consultan la tabla: su acceso viene del rol', async () => {
    // Aunque haya basura en la tabla, el dueño entra a su empresa.
    almacen.sembrar('area_grants', {
      tenant_id: tenantId,
      user_email: 'ana@x.mx',
      area_slug: 'x',
      access: 'basura',
    });

    expect(await loadAreaGrants(tenantId, 'ana@x.mx', true)).toEqual({ '*': 'admin' });
  });

  it('sin correo, sin accesos', async () => {
    expect(await loadAreaGrants(tenantId, null, false)).toEqual({});
  });
});

describe('esAdminDelTenant', () => {
  it.each([
    ['owner', true],
    ['admin', true],
    ['member', false],
    ['viewer', false],
  ] as const)('%s → %s', (role, esperado) => {
    expect(esAdminDelTenant(role)).toBe(esperado);
  });

  it('null no es admin', () => {
    expect(esAdminDelTenant(null)).toBe(false);
  });
});
