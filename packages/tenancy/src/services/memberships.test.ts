/**
 * Miembros, roles y áreas.
 *
 * Además de lo obvio, se prueban las tres reglas que impiden que una empresa
 * se quede sin nadie que la administre — la que le faltaba a GARDEN.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AlmacenFake } from '../testing/fake-postgrest';
import { instalarDoble, sembrarMiembro, sembrarTenant } from '../testing/seed';
import { contextFor } from './context';
import { listMembers, removeMember, setAreas, setRole, upsertMember } from './memberships';
import type { FullTenantContext } from '../types';

const ANA = 'ana@panaderia.mx';
const CAJERA = 'cajera@panaderia.mx';

let almacen: AlmacenFake;
let restaurar: () => void;
let ctx: FullTenantContext;
let tenantId: string;

beforeEach(async () => {
  ({ almacen, restaurar } = instalarDoble());
  ({ tenantId } = sembrarTenant(almacen, {
    slug: 'panaderia-lupita',
    name: 'Panadería Lupita',
    ownerEmail: ANA,
    plan: 'pro',
  }));
  sembrarMiembro(almacen, tenantId, CAJERA, 'member', { ventas: 'edit' });
  ctx = await contextFor({ userEmail: ANA, tenantSlug: 'panaderia-lupita' });
});

afterEach(() => {
  restaurar();
  almacen.limpiar();
});

describe('listar', () => {
  it('trae rol, áreas y nombre', async () => {
    const miembros = await listMembers(ctx);
    const cajera = miembros.find((m) => m.email === CAJERA);

    expect(miembros).toHaveLength(2);
    expect(cajera).toMatchObject({ role: 'member', areas: { ventas: 'edit' } });
  });

  it('el dueño aparece con su grant total', async () => {
    const ana = (await listMembers(ctx)).find((m) => m.email === ANA);
    expect(ana).toMatchObject({ role: 'owner', areas: { '*': 'admin' } });
  });
});

describe('cambiar rol', () => {
  it('cambia el de un miembro normal', async () => {
    expect(await setRole(ctx, CAJERA, 'admin')).toEqual({ email: CAJERA, role: 'admin' });
  });

  it('★ NO deja asignar owner', async () => {
    await expect(setRole(ctx, CAJERA, 'owner')).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('★ NO deja cambiarle el rol al dueño', async () => {
    await expect(setRole(ctx, ANA, 'viewer')).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rechaza un rol inventado', async () => {
    await expect(setRole(ctx, CAJERA, 'dios')).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('a quien no es miembro, 404', async () => {
    await expect(setRole(ctx, 'nadie@x.mx', 'member')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('áreas', () => {
  it('reemplaza el mapa completo (se puede quitar un permiso)', async () => {
    await setAreas(ctx, CAJERA, { areas: { finanzas: 'view' } });

    const cajera = (await listMembers(ctx)).find((m) => m.email === CAJERA);
    expect(cajera?.areas).toEqual({ finanzas: 'view' });
    expect(cajera?.areas.ventas).toBeUndefined();
  });

  it('un mapa vacío deja a la persona sin accesos', async () => {
    await setAreas(ctx, CAJERA, { areas: {} });
    const cajera = (await listMembers(ctx)).find((m) => m.email === CAJERA);
    expect(cajera?.areas).toEqual({});
  });

  it('rechaza un acceso inválido', async () => {
    await expect(setAreas(ctx, CAJERA, { areas: { ventas: 'dios' } })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('y el rechazo no borra lo que ya tenía', async () => {
    await setAreas(ctx, CAJERA, { areas: { ventas: 'dios' } }).catch(() => null);
    const cajera = (await listMembers(ctx)).find((m) => m.email === CAJERA);
    expect(cajera?.areas).toEqual({ ventas: 'edit' });
  });

  it('el cambio se refleja en el contexto de esa persona', async () => {
    await setAreas(ctx, CAJERA, { areas: { finanzas: 'admin' } });
    const suyo = await contextFor({ userEmail: CAJERA, tenantSlug: 'panaderia-lupita' });
    expect(suyo.areas).toEqual({ finanzas: 'admin' });
  });
});

describe('dar de baja', () => {
  beforeEach(() => {
    // La baja real ocurre en `app.remove_member()`; aquí sólo se prueban las
    // reglas de TypeScript que la anteceden.
    almacen.registrarRpc('remove_member', () => true);
  });

  it('★ no puedes quitarte a ti mismo', async () => {
    await expect(removeMember(ctx, ANA)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('a quien no es miembro, 404 — y no llega a la base', async () => {
    await expect(removeMember(ctx, 'nadie@x.mx')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(almacen.llamadasRpc).toHaveLength(0);
  });

  it('a un miembro real, sí', async () => {
    expect(await removeMember(ctx, CAJERA)).toEqual({ email: CAJERA, removed: true });
    expect(almacen.llamadasRpc[0]?.args).toMatchObject({
      p_tenant_id: tenantId,
      p_email: CAJERA,
    });
  });
});

describe('alta directa', () => {
  it('crea el usuario antes que la membresía (el orden de la FK)', async () => {
    await upsertMember(ctx, 'nuevo@panaderia.mx', 'viewer');

    expect(almacen.tabla('users').some((u) => u.email === 'nuevo@panaderia.mx')).toBe(true);
    expect(
      almacen.tabla('memberships').some((m) => m.user_email === 'nuevo@panaderia.mx'),
    ).toBe(true);
  });

  it('normaliza el correo', async () => {
    const r = await upsertMember(ctx, '  NUEVO@Panaderia.MX ', 'viewer');
    expect(r.email).toBe('nuevo@panaderia.mx');
  });

  it('no deja tocar al dueño', async () => {
    await expect(upsertMember(ctx, ANA, 'viewer')).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('repetirla cambia el rol sin duplicar la membresía', async () => {
    await upsertMember(ctx, 'nuevo@panaderia.mx', 'viewer');
    await upsertMember(ctx, 'nuevo@panaderia.mx', 'admin');

    const suyas = almacen
      .tabla('memberships')
      .filter((m) => m.user_email === 'nuevo@panaderia.mx');
    expect(suyas).toHaveLength(1);
    expect(suyas[0]?.role).toBe('admin');
  });
});
