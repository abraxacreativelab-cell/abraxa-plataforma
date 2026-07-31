/**
 * Invitaciones — la capa de TypeScript.
 *
 * El criterio #7 ("una aceptada crea usuario + membresía + grants; una
 * expirada se rechaza") se cumple dentro de `app.accept_invitation()` y se
 * verifica contra Postgres real en `pg.test.ts`. Aquí se prueba lo que decide
 * TypeScript: que el token nunca se guarde en claro, que el correo salga de la
 * sesión y no del formulario, y que no se pueda invitar a un dueño.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AlmacenFake } from '../testing/fake-postgrest';
import { instalarDoble, sembrarMiembro, sembrarTenant } from '../testing/seed';
import { contextFor } from './context';
import {
  acceptInvitation,
  createInvitation,
  hashToken,
  listInvitations,
  revokeInvitation,
  urlDeInvitacion,
} from './invitations';
import type { FullTenantContext } from '../types';

const ANA = 'ana@panaderia.mx';

let almacen: AlmacenFake;
let restaurar: () => void;
let ctx: FullTenantContext;
let tenantId: string;

beforeEach(async () => {
  ({ almacen, restaurar } = instalarDoble());
  ({ tenantId } = sembrarTenant(almacen, {
    slug: 'panaderia-lupita',
    ownerEmail: ANA,
    plan: 'pro',
  }));
  ctx = await contextFor({ userEmail: ANA, tenantSlug: 'panaderia-lupita' });
});

afterEach(() => {
  restaurar();
  almacen.limpiar();
});

// ═══════════════════════════════════════════════════════════════════════════
describe('★ el token nunca se guarda en claro', () => {
  it('la fila guarda el hash, no el token', async () => {
    const inv = await createInvitation(ctx, { email: 'nuevo@panaderia.mx', role: 'member' });

    const fila = almacen.tabla('invitations')[0];
    expect(fila?.token_hash).toBe(hashToken(inv.token));
    expect(fila?.token_hash).not.toBe(inv.token);

    // El token en claro no aparece por ningún lado de la fila.
    expect(JSON.stringify(fila)).not.toContain(inv.token);
  });

  it('el token se devuelve una vez, y listInvitations ya no lo tiene', async () => {
    await createInvitation(ctx, { email: 'nuevo@panaderia.mx' });

    const pendientes = await listInvitations(ctx);
    expect(pendientes).toHaveLength(1);
    expect(JSON.stringify(pendientes)).not.toMatch(/token/i);
  });

  it('el hash es sha256 hex de 64 caracteres', async () => {
    const inv = await createInvitation(ctx, { email: 'nuevo@panaderia.mx' });
    expect(hashToken(inv.token)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('dos invitaciones nunca comparten token', async () => {
    const a = await createInvitation(ctx, { email: 'uno@panaderia.mx' });
    const b = await createInvitation(ctx, { email: 'dos@panaderia.mx' });
    expect(a.token).not.toBe(b.token);
  });
});

describe('crear una invitación', () => {
  it('devuelve el enlace listo para mandar', async () => {
    const inv = await createInvitation(ctx, { email: 'nuevo@panaderia.mx', role: 'viewer' });
    expect(inv.acceptUrl).toBe(urlDeInvitacion(inv.token));
    expect(inv.acceptUrl).toContain(inv.token.replace(/[^A-Za-z0-9_-]/g, ''));
  });

  it('normaliza el correo invitado', async () => {
    const inv = await createInvitation(ctx, { email: '  NUEVO@Panaderia.MX ' });
    expect(inv.email).toBe('nuevo@panaderia.mx');
  });

  it('rol por defecto: member', async () => {
    const inv = await createInvitation(ctx, { email: 'nuevo@panaderia.mx' });
    expect(inv.role).toBe('member');
  });

  it('NO se puede invitar como dueño', async () => {
    await expect(
      createInvitation(ctx, { email: 'nuevo@panaderia.mx', role: 'owner' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('no se invita a quien ya es miembro', async () => {
    sembrarMiembro(almacen, tenantId, 'cajera@panaderia.mx', 'member');
    await expect(
      createInvitation(ctx, { email: 'cajera@panaderia.mx' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('reinvitar reemite sobre la misma fila y cambia el token', async () => {
    const primera = await createInvitation(ctx, { email: 'nuevo@panaderia.mx', role: 'viewer' });
    const segunda = await createInvitation(ctx, { email: 'nuevo@panaderia.mx', role: 'admin' });

    expect(almacen.tabla('invitations')).toHaveLength(1);
    expect(segunda.token).not.toBe(primera.token);
    expect(segunda.role).toBe('admin');
    // El token viejo deja de servir: su hash ya no está en la tabla.
    expect(almacen.tabla('invitations')[0]?.token_hash).toBe(hashToken(segunda.token));
  });

  it('la vigencia por defecto es de 7 días', async () => {
    const inv = await createInvitation(ctx, { email: 'nuevo@panaderia.mx' });
    const dias = (new Date(inv.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(dias).toBeGreaterThan(6.9);
    expect(dias).toBeLessThan(7.1);
  });

  it('rechaza una vigencia absurda', async () => {
    await expect(
      createInvitation(ctx, { email: 'nuevo@panaderia.mx', expiresInDays: 3650 }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('rechaza un área con acceso inválido', async () => {
    await expect(
      createInvitation(ctx, {
        email: 'nuevo@panaderia.mx',
        areas: { ventas: 'superusuario' as never },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('avisa cuando el plan se quedó sin asientos', async () => {
    // El plan free trae 2 asientos: dueño + uno.
    const chica = sembrarTenant(almacen, {
      slug: 'taller-chico',
      ownerEmail: 'due@taller.mx',
      plan: 'free',
    });
    sembrarMiembro(almacen, chica.tenantId, 'uno@taller.mx', 'member');
    const ctxChica = await contextFor({ userEmail: 'due@taller.mx', tenantSlug: 'taller-chico' });

    await expect(
      createInvitation(ctxChica, { email: 'tres@taller.mx' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('listar y revocar', () => {
  it('marca como expiradas las que ya vencieron', async () => {
    almacen.sembrar('invitations', {
      tenant_id: tenantId,
      email: 'vieja@panaderia.mx',
      role: 'viewer',
      token_hash: 'c'.repeat(64),
      expires_at: new Date(Date.now() - 86_400_000).toISOString(),
    });

    const [inv] = await listInvitations(ctx);
    expect(inv?.expired).toBe(true);
  });

  it('no lista las ya aceptadas', async () => {
    almacen.sembrar('invitations', {
      tenant_id: tenantId,
      email: 'ya@panaderia.mx',
      role: 'viewer',
      token_hash: 'd'.repeat(64),
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      accepted_at: new Date().toISOString(),
    });

    expect(await listInvitations(ctx)).toHaveLength(0);
  });

  it('revocar la borra', async () => {
    const inv = await createInvitation(ctx, { email: 'nuevo@panaderia.mx' });
    expect(await revokeInvitation(ctx, inv.id)).toBe(true);
    expect(await listInvitations(ctx)).toHaveLength(0);
  });

  it('revocar una que no existe devuelve false', async () => {
    expect(await revokeInvitation(ctx, 'no-existe')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('★ aceptar — el correo sale de la sesión, no del formulario', () => {
  beforeEach(() => {
    almacen.registrarRpc('accept_invitation', (args) => [
      {
        tenant_id: tenantId,
        tenant_slug: 'panaderia-lupita',
        role: 'member',
        _recibido: args,
      },
    ]);
  });

  it('manda a la base el HASH, jamás el token', async () => {
    const token = 'un-token-de-prueba-suficientemente-largo';
    await acceptInvitation({ token, userEmail: 'nuevo@panaderia.mx' });

    const args = almacen.llamadasRpc[0]?.args ?? {};
    expect(args.p_token_hash).toBe(hashToken(token));
    expect(JSON.stringify(args)).not.toContain(token);
  });

  it('normaliza el correo de la sesión antes de compararlo', async () => {
    await acceptInvitation({
      token: 'un-token-de-prueba-suficientemente-largo',
      userEmail: '  NUEVO@Panaderia.MX ',
    });
    expect(almacen.llamadasRpc[0]?.args.p_email).toBe('nuevo@panaderia.mx');
  });

  it('un token vacío ni siquiera llega a la base', async () => {
    await expect(
      acceptInvitation({ token: '', userEmail: 'nuevo@panaderia.mx' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(almacen.llamadasRpc).toHaveLength(0);
  });

  it('un correo de sesión inválido tampoco', async () => {
    await expect(
      acceptInvitation({ token: 'un-token-de-prueba-suficientemente-largo', userEmail: 'nada' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(almacen.llamadasRpc).toHaveLength(0);
  });

  it('traduce ABX06 (expirada o de otro) a 409', async () => {
    almacen.registrarRpc('accept_invitation', () => {
      throw Object.assign(new Error('La invitación expiró.'), { code: 'ABX06' });
    });

    await expect(
      acceptInvitation({
        token: 'un-token-de-prueba-suficientemente-largo',
        userEmail: 'nuevo@panaderia.mx',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
  });

  it('traduce ABX03 (no existe) a 404', async () => {
    almacen.registrarRpc('accept_invitation', () => {
      throw Object.assign(new Error('La invitación no existe.'), { code: 'ABX03' });
    });

    await expect(
      acceptInvitation({
        token: 'un-token-de-prueba-suficientemente-largo',
        userEmail: 'nuevo@panaderia.mx',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('traduce ABX04 (sin asientos) a 409', async () => {
    almacen.registrarRpc('accept_invitation', () => {
      throw Object.assign(new Error('sin asientos'), { code: 'ABX04' });
    });

    await expect(
      acceptInvitation({
        token: 'un-token-de-prueba-suficientemente-largo',
        userEmail: 'nuevo@panaderia.mx',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
