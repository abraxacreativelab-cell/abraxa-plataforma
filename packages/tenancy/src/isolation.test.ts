/**
 * ════════════════════════════════════════════════════════════════════════════
 *  ★ CRITERIO #3 — el cliente A no puede leer los datos del cliente B.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Es la única garantía real de aislamiento entre clientes que paga. Todo lo
 * demás del handoff se puede arreglar en una semana mala; esto no: si un
 * cliente ve los datos de otro una sola vez, el producto se acabó.
 *
 * ── Por qué este archivo prueba algo y no se prueba a sí mismo ────────────
 *
 * El almacén de prueba es PERMISIVO: guarda las filas de las dos empresas
 * juntas y no esconde nada por su cuenta (ver testing/fake-postgrest.ts). Si
 * una consulta del código olvidara su filtro por empresa, recibiría las filas
 * del vecino y estas pruebas fallarían.
 *
 * Los datos se siembran directo en el almacén, sin pasar por `provision()`,
 * para que un bug de alta no pueda hacer que esto pase por la razón
 * equivocada.
 *
 * La verificación del SQL —RLS, permisos de `anon`, atomicidad— vive en
 * `pg.test.ts` y corre contra Postgres de verdad.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type PlatformError, tenantDb } from '@abraxa/db';
import type { AlmacenFake } from './testing/fake-postgrest';
import { instalarDoble, sembrarMiembro, sembrarTenant } from './testing/seed';
import { levantarApi, type ClientePrueba } from './testing/http';
import { contextFor, staffContextFor } from './services/context';
import { listMembers } from './services/memberships';
import { listInvitations } from './services/invitations';

const ANA = 'ana@panaderia.mx';
const BETO = 'beto@taqueria.mx';

/** El error que lanzó una promesa. Falla la prueba si no lanzó ninguno. */
async function errorDe(promesa: Promise<unknown>): Promise<PlatformError> {
  try {
    await promesa;
  } catch (e) {
    return e as PlatformError;
  }
  throw new Error('se esperaba que lanzara y no lanzó');
}

let almacen: AlmacenFake;
let restaurar: () => void;
let api: ClientePrueba;
let A: { tenantId: string; slug: string };
let B: { tenantId: string; slug: string };

beforeEach(async () => {
  ({ almacen, restaurar } = instalarDoble());

  A = sembrarTenant(almacen, { slug: 'panaderia-lupita', name: 'Panadería Lupita', ownerEmail: ANA });
  B = sembrarTenant(almacen, { slug: 'taqueria-el-primo', name: 'Taquería El Primo', ownerEmail: BETO });

  // Datos propios de cada una, para poder comprobar que no se cruzan.
  sembrarMiembro(almacen, A.tenantId, 'cajera@panaderia.mx', 'member', { ventas: 'edit' });
  sembrarMiembro(almacen, B.tenantId, 'mesero@taqueria.mx', 'member', { ventas: 'edit' });

  almacen.sembrar('invitations', {
    tenant_id: A.tenantId,
    email: 'nuevo@panaderia.mx',
    role: 'viewer',
    token_hash: 'a'.repeat(64),
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  });
  almacen.sembrar('invitations', {
    tenant_id: B.tenantId,
    email: 'nuevo@taqueria.mx',
    role: 'viewer',
    token_hash: 'b'.repeat(64),
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  });

  api = await levantarApi();
});

afterEach(async () => {
  await api.cerrar();
  restaurar();
  almacen.limpiar();
  delete process.env.PLATFORM_STAFF_EMAILS;
});

// ═══════════════════════════════════════════════════════════════════════════
describe('★ contextFor — el 403 que sostiene todo', () => {
  it('la sesión de A pidiendo la empresa de B recibe 403', async () => {
    await expect(contextFor({ userEmail: ANA, tenantSlug: B.slug })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
  });

  it('la sesión de B pidiendo la empresa de A recibe 403', async () => {
    await expect(contextFor({ userEmail: BETO, tenantSlug: A.slug })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('cada quien sí entra a la suya', async () => {
    const ctxA = await contextFor({ userEmail: ANA, tenantSlug: A.slug });
    const ctxB = await contextFor({ userEmail: BETO, tenantSlug: B.slug });

    expect(ctxA.tenantId).toBe(A.tenantId);
    expect(ctxB.tenantId).toBe(B.tenantId);
    expect(ctxA.tenantId).not.toBe(ctxB.tenantId);
  });

  it('un miembro que no es dueño tampoco cruza', async () => {
    await expect(
      contextFor({ userEmail: 'cajera@panaderia.mx', tenantSlug: B.slug }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('una empresa que no existe da el MISMO error que una ajena (sin enumerar)', async () => {
    const ajena = await errorDe(contextFor({ userEmail: ANA, tenantSlug: B.slug }));
    const inexistente = await errorDe(
      contextFor({ userEmail: ANA, tenantSlug: 'no-existe-jamas' }),
    );

    // Si difirieran, probar slugs sería un directorio de clientes.
    expect(inexistente.status).toBe(ajena.status);
    expect(inexistente.message).toBe(ajena.message);
  });

  it('las mayúsculas del correo no abren una puerta paralela', async () => {
    const ctx = await contextFor({ userEmail: 'ANA@Panaderia.MX', tenantSlug: A.slug });
    expect(ctx.userEmail).toBe(ANA);

    await expect(
      contextFor({ userEmail: 'ANA@Panaderia.MX', tenantSlug: B.slug }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('revocar la membresía cierra la puerta de inmediato, sin caché', async () => {
    expect(await contextFor({ userEmail: ANA, tenantSlug: A.slug })).toBeTruthy();

    almacen.reemplazar(
      'memberships',
      almacen.tabla('memberships').filter((m) => m.user_email !== ANA),
    );

    await expect(contextFor({ userEmail: ANA, tenantSlug: A.slug })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('una empresa suspendida no abre ni para su dueño', async () => {
    const fila = almacen.tabla('tenants').find((t) => t.id === A.tenantId);
    if (fila) fila.status = 'suspended';

    await expect(contextFor({ userEmail: ANA, tenantSlug: A.slug })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('★ el staff de plataforma NO tiene bypass en la vía normal', () => {
  it('un correo de staff sigue recibiendo 403 por contextFor', async () => {
    // Éste es el bug que GARDEN tenía: `CRM_SUPER_ADMINS` entraba a cualquier
    // sub-cuenta por la ruta normal. Aquí la variable no abre nada.
    process.env.PLATFORM_STAFF_EMAILS = ANA;

    await expect(contextFor({ userEmail: ANA, tenantSlug: B.slug })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('la vía de staff está apagada por defecto', async () => {
    delete process.env.PLATFORM_STAFF_EMAILS;

    await expect(staffContextFor({ userEmail: ANA, tenantSlug: B.slug })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('encendida, entra pero queda marcada como staff', async () => {
    process.env.PLATFORM_STAFF_EMAILS = 'soporte@abraxa.club';

    const ctx = await staffContextFor({ userEmail: 'soporte@abraxa.club', tenantSlug: B.slug });
    expect(ctx.tenantId).toBe(B.tenantId);
    expect(ctx.isPlatformStaff).toBe(true);
  });

  it('y sigue sin dejar pasar a quien no está en la lista', async () => {
    process.env.PLATFORM_STAFF_EMAILS = 'soporte@abraxa.club';

    await expect(staffContextFor({ userEmail: ANA, tenantSlug: B.slug })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('★ los datos, con el contexto correcto, tampoco se cruzan', () => {
  it('tenantDb(ctxA) no devuelve una sola membresía de B', async () => {
    const ctxA = await contextFor({ userEmail: ANA, tenantSlug: A.slug });

    const { data } = await tenantDb(ctxA).from('memberships').select('*');
    const correos = (data as Array<{ user_email: string; tenant_id: string }>).map(
      (m) => m.user_email,
    );

    expect(correos).toContain(ANA);
    expect(correos).not.toContain(BETO);
    expect(correos).not.toContain('mesero@taqueria.mx');
    expect(
      (data as Array<{ tenant_id: string }>).every((m) => m.tenant_id === A.tenantId),
    ).toBe(true);
  });

  it('el almacén SÍ tiene los datos de las dos: el filtro es del código', async () => {
    // Sin esta comprobación, las de arriba podrían estar pasando porque el
    // doble esconde las filas ajenas — y entonces no probarían nada.
    expect(almacen.tabla('memberships').length).toBeGreaterThanOrEqual(4);
    expect(almacen.tabla('memberships').some((m) => m.tenant_id === B.tenantId)).toBe(true);
  });

  it('listMembers(ctxA) no incluye a nadie de B', async () => {
    const ctxA = await contextFor({ userEmail: ANA, tenantSlug: A.slug });
    const miembros = await listMembers(ctxA);
    const correos = miembros.map((m) => m.email);

    expect(correos.sort()).toEqual([ANA, 'cajera@panaderia.mx'].sort());
  });

  it('listInvitations(ctxA) no incluye las de B', async () => {
    const ctxA = await contextFor({ userEmail: ANA, tenantSlug: A.slug });
    const invitaciones = await listInvitations(ctxA);

    expect(invitaciones.map((i) => i.email)).toEqual(['nuevo@panaderia.mx']);
  });

  it('las áreas de A no se contaminan con los grants de B', async () => {
    sembrarMiembro(almacen, B.tenantId, ANA, 'viewer', { finanzas: 'admin' });

    // Ana ahora existe en las dos empresas. Su contexto en A no debe traer el
    // permiso de finanzas que tiene en B.
    sembrarMiembro(almacen, A.tenantId, 'contadora@panaderia.mx', 'member', { ventas: 'view' });
    const ctx = await contextFor({ userEmail: 'contadora@panaderia.mx', tenantSlug: A.slug });

    expect(ctx.areas).toEqual({ ventas: 'view' });
    expect(ctx.areas.finanzas).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('★ por HTTP real, que es como llega de verdad', () => {
  it('sesión de A + x-tenant-slug de B → 403 y CERO datos de B', async () => {
    const r = await api.pedir('GET', '/tenants/current', { email: ANA, slug: B.slug });

    expect(r.status).toBe(403);
    // Lo importante no es el código: es que en el cuerpo no viaje nada de B.
    expect(r.texto).not.toContain(B.tenantId);
    expect(r.texto).not.toContain('Taquería');
    expect(r.texto).not.toContain(BETO);
  });

  it('sesión de A + su propio slug → 200 con lo suyo', async () => {
    const r = await api.pedir('GET', '/tenants/current', { email: ANA, slug: A.slug });

    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ tenantId: A.tenantId, slug: A.slug, role: 'owner' });
  });

  it('GET /tenants/members con el slug ajeno → 403 sin filtrar miembros', async () => {
    const r = await api.pedir('GET', '/tenants/members', { email: ANA, slug: B.slug });

    expect(r.status).toBe(403);
    expect(r.texto).not.toContain('mesero@taqueria.mx');
  });

  it('DELETE de un miembro ajeno no lo toca', async () => {
    const antes = almacen.tabla('memberships').length;

    const r = await api.pedir('DELETE', '/tenants/members/mesero@taqueria.mx', {
      email: ANA,
      slug: A.slug,
    });

    // Ana es dueña de A, así que pasa el RBAC; pero el correo no es miembro
    // de SU empresa, y `tenantDb` no lo encuentra.
    expect(r.status).toBe(404);
    expect(almacen.tabla('memberships').length).toBe(antes);
    expect(
      almacen.tabla('memberships').some((m) => m.user_email === 'mesero@taqueria.mx'),
    ).toBe(true);
  });

  it('GET /tenants/mine sólo lista las empresas propias', async () => {
    const r = await api.pedir('GET', '/tenants/mine', { email: ANA });

    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ tenants: [{ slug: A.slug, role: 'owner' }] });
    expect(r.texto).not.toContain(B.slug);
  });

  it('sin el header de empresa no se adivina ninguna', async () => {
    const r = await api.pedir('GET', '/tenants/current', { email: ANA });
    expect(r.status).toBe(422);
  });

  it('sin correo de sesión no se entra', async () => {
    const r = await api.pedir('GET', '/tenants/current', { slug: A.slug });
    expect(r.status).toBe(401);
  });
});
