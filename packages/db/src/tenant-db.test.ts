import { describe, expect, it } from 'vitest';
import type { TenantContext } from '../ports';
import { stampTenant, stripTenant, tenantDb } from './tenant-db';
import { PlatformError } from './errors';

const ctx = (tenantId: string): TenantContext => ({
  tenantId,
  tenantSlug: 'panaderia-lupita',
  userEmail: 'lupita@ejemplo.mx',
  role: 'owner',
  areas: { ventas: 'admin' },
});

describe('stampTenant', () => {
  it('estampa el tenant en cada fila', () => {
    expect(stampTenant([{ a: 1 }, { a: 2 }], 'T1')).toEqual([
      { a: 1, tenant_id: 'T1' },
      { a: 2, tenant_id: 'T1' },
    ]);
  });

  it('acepta una fila suelta', () => {
    expect(stampTenant({ a: 1 }, 'T1')).toEqual([{ a: 1, tenant_id: 'T1' }]);
  });

  it('PISA un tenant_id ajeno que venga en el payload', () => {
    // El caso que importa: un cuerpo de la red intentando escribir en otra empresa.
    expect(stampTenant({ a: 1, tenant_id: 'EL-DE-OTRO' }, 'T1')).toEqual([
      { a: 1, tenant_id: 'T1' },
    ]);
  });
});

describe('stripTenant', () => {
  it('no deja mudar una fila de empresa en un UPDATE', () => {
    expect(stripTenant({ nombre: 'x', tenant_id: 'EL-DE-OTRO' })).toEqual({ nombre: 'x' });
  });

  it('deja el resto del patch intacto', () => {
    expect(stripTenant({ nombre: 'x', activo: false })).toEqual({ nombre: 'x', activo: false });
  });
});

describe('tenantDb', () => {
  it('lanza FORBIDDEN si el contexto no trae tenantId', () => {
    const malo = { ...ctx('T1'), tenantId: '' };
    expect(() => tenantDb(malo)).toThrow(PlatformError);
    try {
      tenantDb(malo);
    } catch (e) {
      expect((e as PlatformError).code).toBe('FORBIDDEN');
    }
  });

  it('expone el tenantId del contexto', () => {
    // No toca la red: sólo comprueba que el alcance queda fijado al construir.
    expect(tenantDb(ctx('T1')).tenantId).toBe('T1');
  });
});
