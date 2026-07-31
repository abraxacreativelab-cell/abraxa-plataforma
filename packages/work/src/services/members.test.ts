import { afterEach, describe, expect, it } from 'vitest';
import { PlatformError, __clearPorts, registerPort } from '@abraxa/db';
import type { TenancyPort, TenantContext } from '@abraxa/db';
import { listMembers } from './members';

const ctx: TenantContext = {
  tenantId: '00000000-0000-0000-0000-0000000000aa',
  tenantSlug: 'panaderia-lupita',
  userEmail: 'lupita@ejemplo.mx',
  role: 'owner',
  areas: {},
};

/** Doble de H2. La regla 5 del contrato en la práctica: se programa contra la
 *  interfaz, no contra el paquete, y en las pruebas se mete un doble. */
function tenancyFalso(impl: Partial<TenancyPort>): TenancyPort {
  const noImplementado = () => {
    throw new Error('el doble no implementa esto');
  };
  return {
    provision: noImplementado,
    contextFor: noImplementado,
    canSignIn: noImplementado,
    primaryTenantSlugFor: noImplementado,
    listMembers: noImplementado,
    ...impl,
  } as TenancyPort;
}

afterEach(() => __clearPorts());

describe('sin H2 todavía', () => {
  it('degrada a la persona que está mirando y lo DICE', async () => {
    // `degraded` viaja hasta la pantalla porque "estás solo" y "no pudimos leer
    // tu equipo" no son la misma frase.
    expect(await listMembers(ctx)).toEqual({
      members: [{ email: 'lupita@ejemplo.mx', name: null }],
      degraded: true,
    });
  });

  it('sin sesión no inventa a nadie', async () => {
    expect(await listMembers({ ...ctx, userEmail: null })).toEqual({ members: [], degraded: true });
  });
});

describe('con H2 registrado', () => {
  it('trae el equipo de verdad, ordenado por nombre', async () => {
    registerPort(
      'tenancy',
      tenancyFalso({
        listMembers: async () => [
          { email: 'zulema@ejemplo.mx', name: 'Zulema', role: 'member' },
          { email: 'ana@ejemplo.mx', name: 'Ana', role: 'admin' },
          { email: 'lupita@ejemplo.mx', name: null, role: 'owner' },
        ],
      }),
    );

    const { members, degraded } = await listMembers(ctx);
    expect(degraded).toBe(false);
    expect(members.map((m) => m.email)).toEqual([
      'ana@ejemplo.mx',
      'lupita@ejemplo.mx', // sin nombre: se ordena por su correo
      'zulema@ejemplo.mx',
    ]);
  });

  it('si la lectura del equipo falla, la pantalla de tareas NO se cae', async () => {
    registerPort(
      'tenancy',
      tenancyFalso({
        listMembers: async () => {
          throw new PlatformError('INTERNAL', 'se cayó la base');
        },
      }),
    );

    const { members, degraded } = await listMembers(ctx);
    expect(degraded).toBe(true);
    expect(members).toEqual([{ email: 'lupita@ejemplo.mx', name: null }]);
  });
});
