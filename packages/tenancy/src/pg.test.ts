/**
 * ════════════════════════════════════════════════════════════════════════════
 *  La verificación contra Postgres DE VERDAD.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Aquí se prueba lo que ninguna prueba en memoria puede probar, porque no es
 * código de este paquete: es el comportamiento del motor.
 *
 *   · criterio #1 — atomicidad: si un paso falla, no queda NADA a medias
 *   · criterio #2 — idempotencia por slug, y el conflicto si el dueño es otro
 *   · criterio #6 — las restricciones rechazan datos malformados
 *   · criterio #7 — aceptar una invitación es atómico; una expirada se rechaza
 *   · RLS y privilegios: con el rol `anon`, `app.*` responde permission denied
 *
 * ── Cómo se corre ─────────────────────────────────────────────────────────
 *
 *     docker run -d --name pg -e POSTGRES_PASSWORD=postgres \
 *       -e POSTGRES_DB=abraxa_test -p 55432:5432 postgres:16-alpine
 *
 *     TENANCY_TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/abraxa_test \
 *       npm test -- packages/tenancy/src/pg.test.ts
 *
 * Sin esa variable, la suite se SALTA con un aviso. No falla: pedirle una base
 * de datos a `npm test` haría que nadie lo corriera.
 *
 * Aplica la 001 de H1 y las 010–012 de H2 sobre una base limpia, así que
 * también sirve de ensayo del despliegue: si estas migraciones no aplican en
 * orden sobre una base virgen, esto se entera antes que producción.
 */
/* eslint-disable no-restricted-imports --
 * `pg` está prohibido en packages/** para que nadie hable con la base
 * saltándose `tenantDb(ctx)`. Este archivo es la excepción justificada: no
 * accede a datos de dominio, levanta un esquema desde cero para verificar que
 * las restricciones y las funciones de las migraciones hacen lo que dicen.
 * Es, literalmente, la prueba de que la regla que prohíbe este import se
 * sostiene en la capa de abajo.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';

const URL_BASE = process.env.TENANCY_TEST_DATABASE_URL;
const hayBase = Boolean(URL_BASE);

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const migracion = (f: string): string => readFileSync(join(RAIZ, 'migrations', f), 'utf8');

let db: Client;

/**
 * La 001 de H1 asume Supabase: usa los roles `anon`, `authenticated`,
 * `service_role` y `authenticator`, y la extensión `vector`. En un Postgres
 * pelón hay que crearlos antes. No se toca la migración: se prepara el
 * ambiente para que se parezca al real.
 */
const PRELUDIO = `
  DO $$ BEGIN
    CREATE ROLE anon NOLOGIN;           EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN
    CREATE ROLE authenticated NOLOGIN;  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN
    CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN
    CREATE ROLE authenticator NOINHERIT LOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  GRANT anon, authenticated, service_role TO authenticator;
  CREATE SCHEMA IF NOT EXISTS extensions;
`;

/** La 001 pide `vector`, que no está en postgres:16-alpine y H2 no usa. */
const sinVector = (sql: string): string =>
  sql.replace(/CREATE EXTENSION IF NOT EXISTS vector[^;]*;/i, '');

describe.skipIf(!hayBase)('Postgres real', () => {
  beforeAll(async () => {
    db = new Client({ connectionString: URL_BASE });
    await db.connect();

    await db.query('DROP SCHEMA IF EXISTS app CASCADE');
    await db.query(PRELUDIO);
    await db.query(sinVector(migracion('001_foundation.sql')));
    await db.query(migracion('010_tenancy.sql'));
    await db.query(migracion('011_provision.sql'));
    await db.query(migracion('012_invitations.sql'));
  }, 60_000);

  afterAll(async () => {
    if (db) await db.end();
  });

  beforeEach(async () => {
    await db.query('DELETE FROM app.tenant_events');
    await db.query('DELETE FROM app.invitations');
    await db.query('DELETE FROM app.area_grants');
    await db.query('DELETE FROM app.memberships');
    await db.query('DELETE FROM app.tenants');
    await db.query('DELETE FROM app.users');
  });

  const alta = (slug: string, nombre: string, correo: string, plan = 'free') =>
    db.query('SELECT * FROM app.provision_tenant($1,$2,$3,$4,$5)', [
      slug,
      nombre,
      correo,
      null,
      plan,
    ]);

  // ═════════════════════════════════════════════════════════════════════════
  describe('★ criterio #1 — el alta es todo o nada', () => {
    it('crea las cinco cosas en una sola llamada', async () => {
      const { rows } = await alta('panaderia-lupita', 'Panadería Lupita', 'ana@panaderia.mx');
      const id = rows[0].tenant_id;

      expect(rows[0].created).toBe(true);

      const u = await db.query('SELECT * FROM app.users WHERE email=$1', ['ana@panaderia.mx']);
      const t = await db.query('SELECT * FROM app.tenants WHERE id=$1', [id]);
      const m = await db.query('SELECT * FROM app.memberships WHERE tenant_id=$1', [id]);
      const g = await db.query('SELECT * FROM app.area_grants WHERE tenant_id=$1', [id]);

      expect(u.rowCount).toBe(1);
      expect(t.rows[0].plan).toBe('free');
      expect(m.rows[0].role).toBe('owner');
      expect(g.rows[0]).toMatchObject({ area_slug: '*', access: 'admin' });
    });

    it('deja el evento tenant_provisioned en el outbox', async () => {
      const { rows } = await alta('panaderia-lupita', 'Panadería Lupita', 'ana@panaderia.mx');

      const e = await db.query('SELECT * FROM app.tenant_events WHERE tenant_id=$1', [
        rows[0].tenant_id,
      ]);
      expect(e.rows[0].type).toBe('tenant_provisioned');
      expect(e.rows[0].payload).toMatchObject({ slug: 'panaderia-lupita', ownerEmail: 'ana@panaderia.mx' });
      expect(e.rows[0].delivered_at).toBeNull();
    });

    it('si un paso falla, NO queda nada a medias', async () => {
      // Un plan inexistente truena en la validación, después de que el
      // usuario "ya se habría insertado" en una versión no transaccional.
      await expect(
        alta('panaderia-lupita', 'Panadería Lupita', 'ana@panaderia.mx', 'plan-que-no-existe'),
      ).rejects.toThrow();

      for (const tabla of ['users', 'tenants', 'memberships', 'area_grants', 'tenant_events']) {
        const r = await db.query(`SELECT count(*)::int AS n FROM app.${tabla}`);
        expect(r.rows[0].n, `quedó basura en app.${tabla}`).toBe(0);
      }
    });

    it('un correo inválido tampoco deja rastro', async () => {
      await expect(alta('panaderia-lupita', 'X', 'no-es-un-correo')).rejects.toThrow();
      const r = await db.query('SELECT count(*)::int AS n FROM app.users');
      expect(r.rows[0].n).toBe(0);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  describe('★ criterio #2 — idempotencia por slug', () => {
    it('dos altas iguales devuelven el mismo tenant y no duplican', async () => {
      const a = await alta('panaderia-lupita', 'Panadería Lupita', 'ana@panaderia.mx');
      const b = await alta('panaderia-lupita', 'Panadería Lupita', 'ana@panaderia.mx');

      expect(b.rows[0].tenant_id).toBe(a.rows[0].tenant_id);
      expect(a.rows[0].created).toBe(true);
      expect(b.rows[0].created).toBe(false);

      const t = await db.query('SELECT count(*)::int AS n FROM app.tenants');
      const m = await db.query('SELECT count(*)::int AS n FROM app.memberships');
      expect(t.rows[0].n).toBe(1);
      expect(m.rows[0].n).toBe(1);
    });

    it('el correo con otras mayúsculas sigue siendo el mismo dueño', async () => {
      const a = await alta('panaderia-lupita', 'Panadería Lupita', 'ana@panaderia.mx');
      const b = await alta('panaderia-lupita', 'Panadería Lupita', 'ANA@Panaderia.MX');
      expect(b.rows[0].tenant_id).toBe(a.rows[0].tenant_id);
    });

    it('★ pero si el dueño es OTRO, es conflicto — no se entrega la empresa ajena', async () => {
      await alta('panaderia-lupita', 'Panadería Lupita', 'ana@panaderia.mx');

      await expect(
        alta('panaderia-lupita', 'Otra Cosa', 'intruso@otro.mx'),
      ).rejects.toMatchObject({ code: 'ABX01' });
    });

    it('y el intento fallido no cambia nada de la empresa existente', async () => {
      const a = await alta('panaderia-lupita', 'Panadería Lupita', 'ana@panaderia.mx');
      await alta('panaderia-lupita', 'Secuestrada', 'intruso@otro.mx').catch(() => null);

      const t = await db.query('SELECT name FROM app.tenants WHERE id=$1', [a.rows[0].tenant_id]);
      const m = await db.query('SELECT user_email FROM app.memberships WHERE tenant_id=$1', [
        a.rows[0].tenant_id,
      ]);
      expect(t.rows[0].name).toBe('Panadería Lupita');
      expect(m.rows.map((r) => r.user_email)).toEqual(['ana@panaderia.mx']);
      expect(await db.query('SELECT count(*)::int AS n FROM app.users')).toMatchObject({
        rows: [{ n: 1 }],
      });
    });

    it('dos altas concurrentes del mismo slug no crean dos empresas', async () => {
      // Es como reintenta Stripe: el mismo webhook dos veces, a la vez.
      const [a, b] = await Promise.all([
        alta('panaderia-lupita', 'Panadería Lupita', 'ana@panaderia.mx'),
        alta('panaderia-lupita', 'Panadería Lupita', 'ana@panaderia.mx'),
      ]);

      expect(a.rows[0].tenant_id).toBe(b.rows[0].tenant_id);
      const t = await db.query('SELECT count(*)::int AS n FROM app.tenants');
      expect(t.rows[0].n).toBe(1);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  describe('★ criterio #6 — la base rechaza lo malformado', () => {
    let tenantId: string;

    beforeEach(async () => {
      const { rows } = await alta('panaderia-lupita', 'Panadería Lupita', 'ana@panaderia.mx');
      tenantId = rows[0].tenant_id;
    });

    it('un access inválido no se puede ni insertar', async () => {
      await expect(
        db.query(
          'INSERT INTO app.area_grants (tenant_id,user_email,area_slug,access) VALUES ($1,$2,$3,$4)',
          [tenantId, 'ana@panaderia.mx', 'ventas', 'superusuario'],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('un rol inválido tampoco', async () => {
      await expect(
        db.query('INSERT INTO app.memberships (tenant_id,user_email,role) VALUES ($1,$2,$3)', [
          tenantId,
          'ana@panaderia.mx',
          'dios',
        ]),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('★ un correo con mayúsculas no puede crear un usuario sombra', async () => {
      await expect(
        db.query('INSERT INTO app.users (email) VALUES ($1)', ['ANA@Panaderia.MX']),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('una membresía de un usuario inexistente se rechaza', async () => {
      await expect(
        db.query('INSERT INTO app.memberships (tenant_id,user_email,role) VALUES ($1,$2,$3)', [
          tenantId,
          'fantasma@x.mx',
          'member',
        ]),
      ).rejects.toMatchObject({ code: '23503' });
    });

    it('no puede haber dos dueños', async () => {
      await db.query('INSERT INTO app.users (email) VALUES ($1)', ['otro@panaderia.mx']);
      await expect(
        db.query('INSERT INTO app.memberships (tenant_id,user_email,role) VALUES ($1,$2,$3)', [
          tenantId,
          'otro@panaderia.mx',
          'owner',
        ]),
      ).rejects.toMatchObject({ code: '23505' });
    });

    it('un slug reservado se rechaza', async () => {
      await expect(alta('api', 'Intento', 'otro@x.mx')).rejects.toMatchObject({ code: '23514' });
    });

    it('un slug con mayúsculas se normaliza antes de guardarse', async () => {
      const { rows } = await alta('Taqueria-EL-Primo', 'Taquería', 'beto@taqueria.mx');
      const t = await db.query('SELECT slug FROM app.tenants WHERE id=$1', [rows[0].tenant_id]);
      expect(t.rows[0].slug).toBe('taqueria-el-primo');
    });

    it('un plan que no está en el catálogo no se puede asignar', async () => {
      await expect(
        db.query('UPDATE app.tenants SET plan=$1 WHERE id=$2', ['inventado', tenantId]),
      ).rejects.toMatchObject({ code: '23503' });
    });

    it('un token de invitación sin hashear se rechaza', async () => {
      await expect(
        db.query(
          'INSERT INTO app.invitations (tenant_id,email,role,token_hash,expires_at) VALUES ($1,$2,$3,$4,now()+interval \'7 days\')',
          [tenantId, 'nuevo@x.mx', 'member', 'token-en-claro'],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('un mapa de áreas con un acceso inválido se rechaza', async () => {
      await expect(
        db.query(
          'INSERT INTO app.invitations (tenant_id,email,role,areas,token_hash,expires_at) VALUES ($1,$2,$3,$4,$5,now()+interval \'7 days\')',
          [tenantId, 'nuevo@x.mx', 'member', { ventas: 'dios' }, 'a'.repeat(64)],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  describe('★ criterio #7 — invitaciones', () => {
    let tenantId: string;

    const invitar = (
      email: string,
      role = 'member',
      areas: Record<string, string> = {},
      dias = 7,
      hash = 'a'.repeat(64),
    ) =>
      db.query(
        `INSERT INTO app.invitations (tenant_id,email,role,areas,token_hash,expires_at)
         VALUES ($1,$2,$3,$4,$5, now() + ($6 || ' days')::interval) RETURNING *`,
        [tenantId, email, role, JSON.stringify(areas), hash, String(dias)],
      );

    beforeEach(async () => {
      const { rows } = await alta('panaderia-lupita', 'Panadería Lupita', 'ana@panaderia.mx', 'pro');
      tenantId = rows[0].tenant_id;
    });

    it('aceptada: crea usuario + membresía + grants, y la quema', async () => {
      const hash = 'b'.repeat(64);
      await invitar('nuevo@panaderia.mx', 'member', { ventas: 'edit', finanzas: 'view' }, 7, hash);

      const { rows } = await db.query('SELECT * FROM app.accept_invitation($1,$2,$3)', [
        hash,
        'nuevo@panaderia.mx',
        'Persona Nueva',
      ]);

      expect(rows[0]).toMatchObject({ tenant_slug: 'panaderia-lupita', role: 'member' });

      const u = await db.query('SELECT * FROM app.users WHERE email=$1', ['nuevo@panaderia.mx']);
      const m = await db.query('SELECT * FROM app.memberships WHERE user_email=$1', [
        'nuevo@panaderia.mx',
      ]);
      const g = await db.query(
        'SELECT area_slug, access FROM app.area_grants WHERE user_email=$1 ORDER BY area_slug',
        ['nuevo@panaderia.mx'],
      );
      const inv = await db.query('SELECT accepted_at FROM app.invitations WHERE token_hash=$1', [
        hash,
      ]);

      expect(u.rows[0].name).toBe('Persona Nueva');
      expect(m.rows[0].role).toBe('member');
      expect(g.rows).toEqual([
        { area_slug: 'finanzas', access: 'view' },
        { area_slug: 'ventas', access: 'edit' },
      ]);
      expect(inv.rows[0].accepted_at).not.toBeNull();
    });

    it('★ una expirada se rechaza', async () => {
      const hash = 'c'.repeat(64);
      await invitar('tarde@panaderia.mx', 'member', {}, -1, hash);

      await expect(
        db.query('SELECT * FROM app.accept_invitation($1,$2,$3)', [hash, 'tarde@panaderia.mx', null]),
      ).rejects.toMatchObject({ code: 'ABX06' });
    });

    it('una expirada no deja membresía a medias', async () => {
      const hash = 'c'.repeat(64);
      await invitar('tarde@panaderia.mx', 'member', { ventas: 'edit' }, -1, hash);
      await db
        .query('SELECT * FROM app.accept_invitation($1,$2,$3)', [hash, 'tarde@panaderia.mx', null])
        .catch(() => null);

      const m = await db.query('SELECT count(*)::int AS n FROM app.memberships WHERE user_email=$1', [
        'tarde@panaderia.mx',
      ]);
      const g = await db.query('SELECT count(*)::int AS n FROM app.area_grants WHERE user_email=$1', [
        'tarde@panaderia.mx',
      ]);
      expect(m.rows[0].n).toBe(0);
      expect(g.rows[0].n).toBe(0);
    });

    it('no se puede usar dos veces', async () => {
      const hash = 'd'.repeat(64);
      await invitar('nuevo@panaderia.mx', 'member', {}, 7, hash);
      await db.query('SELECT * FROM app.accept_invitation($1,$2,$3)', [
        hash,
        'nuevo@panaderia.mx',
        null,
      ]);

      await expect(
        db.query('SELECT * FROM app.accept_invitation($1,$2,$3)', [hash, 'nuevo@panaderia.mx', null]),
      ).rejects.toMatchObject({ code: 'ABX06' });
    });

    it('★ el token no es una llave al portador: otro correo no la puede usar', async () => {
      const hash = 'e'.repeat(64);
      await invitar('destinatario@panaderia.mx', 'admin', {}, 7, hash);

      await expect(
        db.query('SELECT * FROM app.accept_invitation($1,$2,$3)', [hash, 'intruso@otro.mx', null]),
      ).rejects.toMatchObject({ code: 'ABX06' });

      const m = await db.query('SELECT count(*)::int AS n FROM app.memberships WHERE user_email=$1', [
        'intruso@otro.mx',
      ]);
      expect(m.rows[0].n).toBe(0);
    });

    it('una que no existe da 404, no 409', async () => {
      await expect(
        db.query('SELECT * FROM app.accept_invitation($1,$2,$3)', [
          'f'.repeat(64),
          'quien@sea.mx',
          null,
        ]),
      ).rejects.toMatchObject({ code: 'ABX03' });
    });

    it('★ sin asientos en el plan, no se puede aceptar', async () => {
      await db.query('UPDATE app.tenants SET plan=$1 WHERE id=$2', ['free', tenantId]);
      // free = 2 asientos. Dueño + uno = lleno.
      await db.query('INSERT INTO app.users (email) VALUES ($1)', ['uno@panaderia.mx']);
      await db.query('INSERT INTO app.memberships (tenant_id,user_email,role) VALUES ($1,$2,$3)', [
        tenantId,
        'uno@panaderia.mx',
        'member',
      ]);

      const hash = '9'.repeat(64);
      await invitar('tres@panaderia.mx', 'member', {}, 7, hash);

      await expect(
        db.query('SELECT * FROM app.accept_invitation($1,$2,$3)', [hash, 'tres@panaderia.mx', null]),
      ).rejects.toMatchObject({ code: 'ABX04' });
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  describe('bajas', () => {
    let tenantId: string;

    beforeEach(async () => {
      const { rows } = await alta('panaderia-lupita', 'Panadería Lupita', 'ana@panaderia.mx', 'pro');
      tenantId = rows[0].tenant_id;
      await db.query('INSERT INTO app.users (email) VALUES ($1)', ['cajera@panaderia.mx']);
      await db.query('INSERT INTO app.memberships (tenant_id,user_email,role) VALUES ($1,$2,$3)', [
        tenantId,
        'cajera@panaderia.mx',
        'member',
      ]);
      await db.query(
        'INSERT INTO app.area_grants (tenant_id,user_email,area_slug,access) VALUES ($1,$2,$3,$4)',
        [tenantId, 'cajera@panaderia.mx', 'ventas', 'edit'],
      );
    });

    it('se lleva membresía, grants e invitaciones', async () => {
      await db.query(
        `INSERT INTO app.invitations (tenant_id,email,role,token_hash,expires_at)
         VALUES ($1,$2,'member',$3, now()+interval '7 days')`,
        [tenantId, 'cajera@panaderia.mx', '7'.repeat(64)],
      );

      const { rows } = await db.query('SELECT app.remove_member($1,$2) AS ok', [
        tenantId,
        'cajera@panaderia.mx',
      ]);
      expect(rows[0].ok).toBe(true);

      for (const [tabla, col] of [
        ['memberships', 'user_email'],
        ['area_grants', 'user_email'],
        ['invitations', 'email'],
      ] as const) {
        const r = await db.query(
          `SELECT count(*)::int AS n FROM app.${tabla} WHERE ${col}=$1 AND tenant_id=$2`,
          ['cajera@panaderia.mx', tenantId],
        );
        expect(r.rows[0].n, `quedó algo en app.${tabla}`).toBe(0);
      }
    });

    it('★ no se puede quitar al dueño', async () => {
      await expect(
        db.query('SELECT app.remove_member($1,$2)', [tenantId, 'ana@panaderia.mx']),
      ).rejects.toMatchObject({ code: 'ABX05' });

      const m = await db.query('SELECT count(*)::int AS n FROM app.memberships WHERE role=$1', [
        'owner',
      ]);
      expect(m.rows[0].n).toBe(1);
    });

    it('quitar a quien no está devuelve false, no revienta', async () => {
      const { rows } = await db.query('SELECT app.remove_member($1,$2) AS ok', [
        tenantId,
        'nadie@x.mx',
      ]);
      expect(rows[0].ok).toBe(false);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  describe('★ RLS y privilegios — el schema está cerrado', () => {
    beforeEach(async () => {
      await alta('panaderia-lupita', 'Panadería Lupita', 'ana@panaderia.mx');
    });

    it.each([
      'tenants',
      'memberships',
      'area_grants',
      'users',
      'plans',
      'invitations',
      'tenant_events',
    ])('con el rol anon, app.%s responde permission denied', async (tabla) => {
      await db.query('BEGIN');
      await db.query('SET LOCAL ROLE anon');

      await expect(db.query(`SELECT * FROM app.${tabla}`)).rejects.toMatchObject({ code: '42501' });

      await db.query('ROLLBACK');
    });

    it('anon tampoco puede escribir', async () => {
      await db.query('BEGIN');
      await db.query('SET LOCAL ROLE anon');
      await expect(
        db.query("INSERT INTO app.users (email) VALUES ('cuela@x.mx')"),
      ).rejects.toMatchObject({ code: '42501' });
      await db.query('ROLLBACK');
    });

    it('todas las tablas de app tienen RLS activo', async () => {
      const { rows } = await db.query(`
        SELECT c.relname, c.relrowsecurity
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'app' AND c.relkind = 'r'
      `);
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect(r.relrowsecurity, `app.${r.relname} sin RLS`).toBe(true);
      }
    });
  });
});

describe.skipIf(hayBase)('Postgres real (saltada)', () => {
  it('avisa cómo correrla', () => {
    console.warn(
      '\n  ⚠ pg.test.ts no corrió: falta TENANCY_TEST_DATABASE_URL.\n' +
        '    Verifica atomicidad, idempotencia, restricciones y RLS contra Postgres real.\n' +
        '    docker run -d --name pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=abraxa_test \\\n' +
        '      -p 55432:5432 postgres:16-alpine\n' +
        '    TENANCY_TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/abraxa_test npm test\n',
    );
    expect(hayBase).toBe(false);
  });
});
