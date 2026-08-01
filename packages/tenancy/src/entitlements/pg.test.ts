/**
 * ════════════════════════════════════════════════════════════════════════════
 *  H16 contra Postgres DE VERDAD.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Aquí se prueba lo que ninguna prueba en memoria puede probar, porque no es
 * código de este paquete: es el comportamiento del motor.
 *
 *   · criterio #1  — deny por defecto en la resolución de la vista
 *   · criterio #2  — un override con granted=true CONCEDE
 *   · criterio #3  — un override con granted=false QUITA
 *   · criterio #4  — un `expires_at` vencido no concede, evaluado en SQL
 *   · criterio #5  — un tenant suspendido da false en TODAS las funciones
 *   · criterio #7  — LA PRUEBA QUE VALE DINERO: un job encolado con `pro` y
 *                    ejecutado tras bajar a `free` no corre y queda con motivo
 *   · criterio #8  — bajar de plan PAUSA y no borra
 *   · criterio #9  — subir restaura sólo lo que la baja pausó
 *   · criterio #10 — idempotencia: dos veces = un estado, UNA fila
 *   · criterio #12 — un tenant no ve los entitlements de otro, en SQL
 *   · criterio #13 — `starter` y `agency` ya se pueden asignar
 *   · criterio #14 — los dos presupuestos dicen el mismo número
 *
 * ── Cómo se corre ─────────────────────────────────────────────────────────
 *
 *     docker run -d --name pg -e POSTGRES_PASSWORD=postgres \
 *       -e POSTGRES_DB=abraxa_test -p 55432:5432 postgres:16-alpine
 *
 *     TENANCY_TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/abraxa_test \
 *       npm test -- packages/tenancy/src/entitlements/pg.test.ts
 *
 * Sin esa variable, la suite se SALTA con un aviso. No falla: pedirle una base
 * de datos a `npm test` haría que nadie lo corriera. Es la misma decisión y la
 * misma variable que usa `packages/tenancy/src/pg.test.ts` de H2 — dos suites
 * que piden dos bases distintas serían dos bases que nadie levanta.
 *
 * Aplica la 001 de H1, las 010–012 de H2, las 023–024 de H3 y las 130–132 de
 * H16 sobre una base limpia, así que también sirve de ensayo del despliegue: si
 * estas migraciones no aplican en orden sobre una base virgen, esto se entera
 * antes que producción.
 */
/* eslint-disable no-restricted-imports --
 * `pg` está prohibido en packages/** para que nadie hable con la base
 * saltándose `tenantDb(ctx)`. Este archivo es la excepción justificada, con el
 * mismo argumento que la escribió H2 en su propio pg.test.ts: no accede a datos
 * de dominio, levanta un esquema desde cero para verificar que las
 * restricciones, la vista y las funciones hacen lo que dicen. Es, literalmente,
 * la prueba de que la regla que prohíbe este import se sostiene abajo.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';

const URL_BASE = process.env.TENANCY_TEST_DATABASE_URL;
const hayBase = Boolean(URL_BASE);

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const migracion = (f: string): string => readFileSync(join(RAIZ, 'migrations', f), 'utf8');

let db: Client;

/**
 * La 001 de H1 asume Supabase: roles `anon`, `authenticated`, `service_role`,
 * `authenticator` y la extensión `vector`. En un Postgres pelón hay que
 * crearlos antes. No se toca la migración: se prepara el ambiente para que se
 * parezca al real. Calcado del prelludio de H2 por la misma razón.
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

const sinVector = (sql: string): string =>
  sql.replace(/CREATE EXTENSION IF NOT EXISTS vector[^;]*;/i, '');

/**
 * Las migraciones que H16 necesita, en el orden en que las aplica el runner.
 *
 * ── Por qué NO está la 023 ─────────────────────────────────────────────────
 *
 * `023_usage_ledger.sql` referencia `app.agent_definitions`, que crea la 020, y
 * la 020 arrastra el resto del árbol de H3. Aplicarla aquí obligaría a montar
 * medio paquete de agentes para probar entitlements.
 *
 * De H3 sólo hace falta la 024, y sólo por el criterio #14: es la que crea
 * `app.agent_plan_limits`, la segunda fuente del presupuesto que la 132
 * reconcilia. La 024 depende únicamente de `app.tenants`, que ya existe desde
 * la 001.
 *
 * Se descubrió corriendo esto de verdad: la lista traía la 023 y la suite entera
 * murió en `beforeAll` con `relation "app.agent_definitions" does not exist` —
 * 46 pruebas saltadas y ni un solo criterio demostrado. Una suite que no puede
 * levantar su esquema no falla ruidosamente: se salta, y "46 skipped" se lee
 * casi igual que "46 passed" de reojo.
 */
const MIGRACIONES = [
  '001_foundation.sql',
  '010_tenancy.sql',
  '011_provision.sql',
  '012_invitations.sql',
  '024_agent_budgets.sql',
  '130_entitlements.sql',
  '131_plan_lifecycle.sql',
  '132_plan_catalog.sql',
];

interface Efecto {
  feature: string;
  action: 'paused' | 'readonly' | 'restored';
}

async function crearTenant(slug: string, plan = 'free', status = 'active'): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO app.tenants (slug, name, plan, status)
     VALUES ($1, $1, $2, $3) RETURNING id`,
    [slug, plan, status],
  );
  return rows[0]!.id;
}

/** La resolución tal cual la ve el producto: una fila de la vista. */
async function granted(tenantId: string, key: string): Promise<boolean | null> {
  const { rows } = await db.query<{ granted: boolean }>(
    `SELECT granted FROM app.tenant_entitlements_effective
      WHERE tenant_id = $1 AND feature_key = $2`,
    [tenantId, key],
  );
  return rows[0]?.granted ?? null;
}

async function aplicar(
  tenantId: string,
  plan: string,
  status: string,
  reason: string,
  actor: string | null = null,
): Promise<{ change_id: number | null; applied: boolean; effects: Efecto[] }> {
  const { rows } = await db.query(
    'SELECT * FROM app.apply_plan_change($1, $2, $3, $4, $5)',
    [tenantId, plan, status, reason, actor],
  );
  return rows[0] as { change_id: number | null; applied: boolean; effects: Efecto[] };
}

describe.skipIf(!hayBase)('H16 contra Postgres real', () => {
  beforeAll(async () => {
    db = new Client({ connectionString: URL_BASE });
    await db.connect();

    await db.query('DROP SCHEMA IF EXISTS app CASCADE');
    await db.query(PRELUDIO);

    for (const archivo of MIGRACIONES) {
      await db.query(sinVector(migracion(archivo)));
    }
  }, 120_000);

  afterAll(async () => {
    await db?.end();
  });

  beforeEach(async () => {
    // Se limpian los datos, no el esquema: aplicar nueve migraciones por caso
    // sería minutos de suite para probar lo mismo.
    await db.query('DELETE FROM app.plan_skips');
    await db.query('DELETE FROM app.feature_pauses');
    await db.query('DELETE FROM app.plan_changes');
    await db.query('DELETE FROM app.tenant_entitlements');
    await db.query('DELETE FROM app.memberships');
    await db.query('DELETE FROM app.area_grants');
    await db.query('DELETE FROM app.invitations');
    await db.query('DELETE FROM app.tenant_events');
    await db.query('DELETE FROM app.tenants');
    await db.query('DELETE FROM app.users');
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('el catálogo (criterio #13)', () => {
    it('★ starter y agency YA se pueden asignar sin violar tenants_plan_fkey', async () => {
      // Antes de la 132 esto era imposible: la 010 pone la FK contra app.plans,
      // que sólo tenía free y pro. Las dos filas de agent_plan_limits eran
      // código muerto que se veía vivo.
      await expect(crearTenant('con-starter', 'starter')).resolves.toBeTruthy();
      await expect(crearTenant('con-agency', 'agency')).resolves.toBeTruthy();
    });

    it('los cuatro planes están en el catálogo, ordenados', async () => {
      const { rows } = await db.query<{ id: string }>(
        'SELECT id FROM app.plans WHERE active ORDER BY position',
      );
      expect(rows.map((r) => r.id)).toEqual(['free', 'starter', 'pro', 'agency']);
    });

    it('un plan inventado sigue siendo imposible', async () => {
      await expect(crearTenant('con-inventado', 'inventado')).rejects.toThrow();
    });

    it('★ criterio #14: los dos presupuestos dicen el mismo número', async () => {
      const { rows } = await db.query('SELECT * FROM app.presupuesto_desalineado()');
      expect(rows).toEqual([]);
    });

    it('y en concreto: pro dice 100 en las dos tablas', async () => {
      const { rows } = await db.query<{ en_plans: string; en_engine: string }>(
        `SELECT (p.limits ->> 'monthlyAiUsd') AS en_plans,
                apl.monthly_budget_usd::text  AS en_engine
           FROM app.plans p JOIN app.agent_plan_limits apl ON apl.plan = p.id
          WHERE p.id = 'pro'`,
      );
      expect(Number(rows[0]!.en_plans)).toBe(100);
      expect(Number(rows[0]!.en_engine)).toBe(100);
    });

    it('las doce funciones están sembradas y ninguna se puede borrar por plan', async () => {
      const { rows } = await db.query<{ key: string; on_downgrade: string }>(
        'SELECT key, on_downgrade FROM app.features ORDER BY position',
      );
      expect(rows).toHaveLength(12);
      // No existe 'delete', y no es un olvido: pausar se deshace, borrar no.
      expect(rows.every((r) => ['pause', 'readonly', 'keep'].includes(r.on_downgrade))).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('la resolución de tres saltos', () => {
    it('★ criterio #1: deny por defecto — lo que no trae el plan está apagado', async () => {
      const t = await crearTenant('deny', 'free');

      expect(await granted(t, 'inbox.whatsapp')).toBe(true); // free sí lo trae
      expect(await granted(t, 'flows.publish')).toBe(false); // free no
      expect(await granted(t, 'crm.pipelines')).toBe(false);
    });

    it('una función que no existe en el catálogo no devuelve NADA (y por lo tanto es false)', async () => {
      const t = await crearTenant('sin-fila', 'pro');
      expect(await granted(t, 'inventada.que.no.existe')).toBeNull();
    });

    it('★ criterio #2: un override con granted=true CONCEDE lo que el plan no trae', async () => {
      const t = await crearTenant('cortesia', 'free');
      expect(await granted(t, 'crm.pipelines')).toBe(false);

      await db.query(
        `INSERT INTO app.tenant_entitlements (tenant_id, feature_key, granted, note)
         VALUES ($1, 'crm.pipelines', true, 'cortesia negociada en la venta')`,
        [t],
      );

      expect(await granted(t, 'crm.pipelines')).toBe(true);
    });

    it('★ criterio #3: un override con granted=false QUITA lo que el plan SÍ trae', async () => {
      const t = await crearTenant('abusiva', 'pro');
      expect(await granted(t, 'inbox.email')).toBe(true);

      // Es cómo se apaga una función a quien abusa de ella sin bajarle el plan
      // entero, que castigaría también lo que sí usa bien.
      await db.query(
        `INSERT INTO app.tenant_entitlements (tenant_id, feature_key, granted, note)
         VALUES ($1, 'inbox.email', false, 'apagado por envio masivo no solicitado')`,
        [t],
      );

      expect(await granted(t, 'inbox.email')).toBe(false);
    });

    it('★ criterio #4: un override VENCIDO no concede nada — y se evalúa en SQL', async () => {
      const t = await crearTenant('prueba-vencida', 'free');

      await db.query(
        `INSERT INTO app.tenant_entitlements (tenant_id, feature_key, granted, note, expires_at)
         VALUES ($1, 'crm.pipelines', true, 'prueba de 14 dias', now() - interval '1 second')`,
        [t],
      );

      // La comparación la hace `now()` de la base dentro de la vista. En
      // JavaScript, un proceso con el reloj corrido mantendría viva una prueba
      // terminada y nadie se enteraría.
      expect(await granted(t, 'crm.pipelines')).toBe(false);
    });

    it('…y uno VIGENTE sí concede', async () => {
      const t = await crearTenant('prueba-viva', 'free');
      await db.query(
        `INSERT INTO app.tenant_entitlements (tenant_id, feature_key, granted, note, expires_at)
         VALUES ($1, 'crm.pipelines', true, 'prueba de 14 dias', now() + interval '14 days')`,
        [t],
      );
      expect(await granted(t, 'crm.pipelines')).toBe(true);
    });

    it('★ el override vencido NO se borra: la nota sobrevive para poder explicarlo', async () => {
      const t = await crearTenant('nota-viva', 'free');
      await db.query(
        `INSERT INTO app.tenant_entitlements (tenant_id, feature_key, granted, note, expires_at)
         VALUES ($1, 'crm.pipelines', true, 'prueba pedida por soporte', now() - interval '1 day')`,
        [t],
      );

      const { rows } = await db.query<{ note: string }>(
        'SELECT note FROM app.tenant_entitlements WHERE tenant_id = $1',
        [t],
      );
      expect(rows[0]?.note).toBe('prueba pedida por soporte');
    });

    it('la nota es obligatoria y no se cumple con un punto', async () => {
      const t = await crearTenant('sin-nota', 'free');
      await expect(
        db.query(
          `INSERT INTO app.tenant_entitlements (tenant_id, feature_key, granted, note)
           VALUES ($1, 'crm.pipelines', true, '.')`,
          [t],
        ),
      ).rejects.toThrow();
    });

    it('★ criterio #5: un tenant SUSPENDIDO da false en TODAS, sin mirar el catálogo', async () => {
      const t = await crearTenant('morosa', 'agency', 'suspended');

      const { rows } = await db.query<{ granted: boolean; source: string }>(
        'SELECT granted, source FROM app.tenant_entitlements_effective WHERE tenant_id = $1',
        [t],
      );

      expect(rows).toHaveLength(12);
      expect(rows.every((r) => r.granted === false)).toBe(true);
      expect(rows.every((r) => r.source === 'tenant_inactive')).toBe(true);
    });

    it('…y ni siquiera un override vigente lo salva', async () => {
      const t = await crearTenant('morosa-con-trato', 'free', 'suspended');
      await db.query(
        `INSERT INTO app.tenant_entitlements (tenant_id, feature_key, granted, note)
         VALUES ($1, 'crm.pipelines', true, 'trato especial que no aplica hoy')`,
        [t],
      );
      expect(await granted(t, 'crm.pipelines')).toBe(false);
    });

    it('la vista dice DE DÓNDE salió cada respuesta', async () => {
      const t = await crearTenant('con-origen', 'free');
      await db.query(
        `INSERT INTO app.tenant_entitlements (tenant_id, feature_key, granted, note)
         VALUES ($1, 'crm.pipelines', true, 'cortesia de bienvenida')`,
        [t],
      );

      const { rows } = await db.query<{ feature_key: string; source: string }>(
        `SELECT feature_key, source FROM app.tenant_entitlements_effective
          WHERE tenant_id = $1 AND feature_key IN ('inbox.whatsapp','crm.pipelines','inbox.sms')`,
        [t],
      );
      const porLlave = Object.fromEntries(rows.map((r) => [r.feature_key, r.source]));
      expect(porLlave).toEqual({
        'inbox.whatsapp': 'plan',
        'crm.pipelines': 'override',
        'inbox.sms': 'none',
      });
    });

    it('★ criterio #12: la vista NO cruza empresas', async () => {
      const a = await crearTenant('empresa-a', 'free');
      const b = await crearTenant('empresa-b', 'agency');

      await db.query(
        `INSERT INTO app.tenant_entitlements (tenant_id, feature_key, granted, note)
         VALUES ($1, 'crm.pipelines', true, 'trato especial de la empresa b')`,
        [b],
      );

      expect(await granted(a, 'crm.pipelines')).toBe(false);
      expect(await granted(a, 'inbox.sms')).toBe(false);
      expect(await granted(b, 'inbox.sms')).toBe(true);

      const { rows } = await db.query(
        'SELECT 1 FROM app.tenant_entitlements_effective WHERE tenant_id = $1',
        [a],
      );
      expect(rows).toHaveLength(12); // las suyas y sólo las suyas
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('bajar de plan: PAUSAR, NUNCA BORRAR', () => {
    it('★ criterio #8: bajar pausa, y las filas siguen ahí', async () => {
      const t = await crearTenant('baja', 'pro');

      // Un trato especial y una pausa del usuario, para contarlos después.
      await db.query(
        `INSERT INTO app.tenant_entitlements (tenant_id, feature_key, granted, note)
         VALUES ($1, 'inbox.sms', true, 'sms concedido por la venta')`,
        [t],
      );
      await db.query(`SELECT app.set_user_pause($1, 'inbox.meta', '*', true, 'de vacaciones')`, [t]);

      const antes = await db.query('SELECT count(*)::int AS n FROM app.tenant_entitlements WHERE tenant_id = $1', [t]);

      const r = await aplicar(t, 'free', 'active', 'payment_failed');

      expect(r.applied).toBe(true);
      expect(r.effects.length).toBeGreaterThan(0);
      expect(r.effects.some((e) => e.feature === 'flows.publish' && e.action === 'paused')).toBe(true);
      expect(r.effects.some((e) => e.feature === 'crm.pipelines' && e.action === 'readonly')).toBe(true);

      // NADA se borró.
      const despues = await db.query('SELECT count(*)::int AS n FROM app.tenant_entitlements WHERE tenant_id = $1', [t]);
      expect(despues.rows[0]!.n).toBe(antes.rows[0]!.n);

      // Y las pausas quedaron registradas, no ejecutadas sobre nadie.
      const { rows: pausas } = await db.query<{ feature_key: string; paused_by: string }>(
        `SELECT feature_key, paused_by FROM app.feature_pauses
          WHERE tenant_id = $1 AND released_at IS NULL ORDER BY feature_key`,
        [t],
      );
      expect(pausas.some((p) => p.feature_key === 'flows.publish' && p.paused_by === 'plan')).toBe(true);
    });

    it('una función `keep` NO se pausa aunque se pierda', async () => {
      const t = await crearTenant('keep', 'pro');
      const r = await aplicar(t, 'free', 'active', 'cancel');

      // `flows.ai_assist` es `keep`: el plan free no lo trae, y aun así no
      // aparece en los efectos ni genera pausa.
      expect(r.effects.some((e) => e.feature === 'flows.ai_assist')).toBe(false);

      const { rows } = await db.query(
        `SELECT 1 FROM app.feature_pauses
          WHERE tenant_id = $1 AND feature_key = 'flows.ai_assist' AND released_at IS NULL`,
        [t],
      );
      expect(rows).toHaveLength(0);
    });

    it('la bitácora guarda los efectos resueltos en el momento del cambio', async () => {
      const t = await crearTenant('bitacora', 'pro');
      const r = await aplicar(t, 'free', 'active', 'cancel', 'staff@abraxa.club');

      const { rows } = await db.query<{ effects: Efecto[]; reason: string; actor: string }>(
        'SELECT effects, reason, actor FROM app.plan_changes WHERE id = $1',
        [r.change_id],
      );
      expect(rows[0]!.reason).toBe('cancel');
      expect(rows[0]!.actor).toBe('staff@abraxa.club');
      expect(rows[0]!.effects).toEqual(r.effects);
    });

    it('suspender apaga TODO lo pausable, incluido lo que free sí traía', async () => {
      const t = await crearTenant('a-suspender', 'pro');
      const r = await aplicar(t, 'pro', 'suspended', 'payment_failed');

      expect(r.effects.some((e) => e.feature === 'inbox.whatsapp' && e.action === 'paused')).toBe(true);
      expect(await granted(t, 'inbox.whatsapp')).toBe(false);
    });

    it('★ NO se pausa lo que la empresa nunca tuvo', async () => {
      // `inbox.sms` sólo está en `agency`. Un tenant `pro` que se suspende no
      // "pierde" SMS, porque nunca lo tuvo. Sin la foto de antes que toma
      // `apply_plan_change`, se le abriría una pausa igual — y el tercer bloque
      // de /ajustes/plan le diría "SMS pausado por tu plan" a alguien que nunca
      // contrató SMS. Eso no es un dato de más: es decirle que perdió algo que
      // no tenía.
      const t = await crearTenant('nunca-tuvo-sms', 'pro');
      await aplicar(t, 'pro', 'suspended', 'payment_failed');

      const { rows } = await db.query(
        `SELECT 1 FROM app.feature_pauses WHERE tenant_id = $1 AND feature_key = 'inbox.sms'`,
        [t],
      );
      expect(rows).toHaveLength(0);
    });

    it('…y reactivar deja CERO pausas vivas', async () => {
      const t = await crearTenant('sin-residuo', 'pro');
      await aplicar(t, 'pro', 'suspended', 'payment_failed');
      await aplicar(t, 'pro', 'active', 'checkout');

      const { rows } = await db.query(
        'SELECT feature_key FROM app.feature_pauses WHERE tenant_id = $1 AND released_at IS NULL',
        [t],
      );
      expect(rows).toEqual([]);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('★ EL CICLO COMPLETO: paga → deja de pagar → vuelve a pagar', () => {
    it('★ criterio #9: reactivar restaura SÓLO lo que la baja pausó', async () => {
      const t = await crearTenant('el-ciclo', 'pro');

      // 1 · El emprendedor pausa ÉL su Instagram, a propósito.
      await db.query(
        `SELECT app.set_user_pause($1, 'inbox.meta', '*', true, 'cerrado por vacaciones')`,
        [t],
      );

      // 2 · Deja de pagar.
      const baja = await aplicar(t, 'free', 'active', 'payment_failed');
      expect(baja.applied).toBe(true);
      expect(await granted(t, 'flows.publish')).toBe(false);

      const { rows: trasBaja } = await db.query<{ feature_key: string; paused_by: string }>(
        `SELECT feature_key, paused_by FROM app.feature_pauses
          WHERE tenant_id = $1 AND released_at IS NULL ORDER BY feature_key, paused_by`,
        [t],
      );
      // La suya sigue ahí, y ahora también las del plan.
      expect(trasBaja.some((p) => p.feature_key === 'inbox.meta' && p.paused_by === 'user')).toBe(true);
      expect(trasBaja.some((p) => p.feature_key === 'flows.publish' && p.paused_by === 'plan')).toBe(true);

      // 3 · Vuelve a pagar.
      const alta = await aplicar(t, 'pro', 'active', 'checkout');
      expect(alta.applied).toBe(true);
      expect(alta.effects.some((e) => e.feature === 'flows.publish' && e.action === 'restored')).toBe(true);

      // La función volvió…
      expect(await granted(t, 'flows.publish')).toBe(true);

      const { rows: trasAlta } = await db.query<{ feature_key: string; paused_by: string }>(
        `SELECT feature_key, paused_by FROM app.feature_pauses
          WHERE tenant_id = $1 AND released_at IS NULL`,
        [t],
      );

      // …y la pausa del PLAN se soltó.
      expect(trasAlta.some((p) => p.feature_key === 'flows.publish' && p.paused_by === 'plan')).toBe(false);

      // ★ …pero la que puso ÉL sigue exactamente donde estaba.
      // Encenderle de vuelta el Instagram que apagó a propósito es peor que no
      // reactivar nada: es el producto actuando a su nombre.
      expect(trasAlta.some((p) => p.feature_key === 'inbox.meta' && p.paused_by === 'user')).toBe(true);
    });

    it('la pausa liberada no se borra: queda su historia con quién la soltó', async () => {
      const t = await crearTenant('historia', 'pro');
      await aplicar(t, 'free', 'active', 'cancel');
      const alta = await aplicar(t, 'pro', 'active', 'checkout');

      const { rows } = await db.query<{ released_by: number; released_at: string }>(
        `SELECT released_by, released_at FROM app.feature_pauses
          WHERE tenant_id = $1 AND feature_key = 'flows.publish' AND paused_by = 'plan'`,
        [t],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.released_by).toBe(alta.change_id);
      expect(rows[0]!.released_at).toBeTruthy();
    });

    it('★ criterio #10: aplicar dos veces deja el mismo estado y UNA fila', async () => {
      const t = await crearTenant('idempotente', 'pro');

      const primera = await aplicar(t, 'free', 'active', 'payment_failed');
      const segunda = await aplicar(t, 'free', 'active', 'payment_failed');

      expect(primera.applied).toBe(true);
      expect(segunda.applied).toBe(false); // no había nada que aplicar
      expect(segunda.change_id).toBe(primera.change_id);
      expect(segunda.effects).toEqual(primera.effects);

      const { rows: cambios } = await db.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM app.plan_changes WHERE tenant_id = $1',
        [t],
      );
      expect(cambios[0]!.n).toBe(1);

      // Y tampoco pausó dos veces.
      const { rows: pausas } = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM app.feature_pauses
          WHERE tenant_id = $1 AND feature_key = 'flows.publish' AND released_at IS NULL`,
        [t],
      );
      expect(pausas[0]!.n).toBe(1);
    });

    it('★ dos webhooks IDÉNTICOS en paralelo: uno aplica, el otro no', async () => {
      /*
       * Stripe no reintenta sólo en serie. Dos entregas del mismo evento pueden
       * llegar a dos instancias de la API al mismo tiempo, y entonces la
       * idempotencia "lee el estado y decide" no alcanza: los dos leerían el
       * estado viejo y los dos escribirían bitácora.
       *
       * Lo que lo impide es el `FOR UPDATE` sobre la fila del tenant, que
       * serializa las dos transacciones. Esta prueba usa DOS conexiones reales
       * porque con una sola no hay concurrencia que probar.
       */
      const t = await crearTenant('carrera', 'pro');

      const a = new Client({ connectionString: URL_BASE });
      const b = new Client({ connectionString: URL_BASE });
      await a.connect();
      await b.connect();

      try {
        const [ra, rb] = await Promise.all([
          a.query(`SELECT * FROM app.apply_plan_change($1,'free','active','payment_failed',null)`, [t]),
          b.query(`SELECT * FROM app.apply_plan_change($1,'free','active','payment_failed',null)`, [t]),
        ]);

        const aplicados = [ra.rows[0].applied, rb.rows[0].applied];
        expect(aplicados.filter(Boolean)).toHaveLength(1);
      } finally {
        await a.end();
        await b.end();
      }

      const { rows: cambios } = await db.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM app.plan_changes WHERE tenant_id = $1',
        [t],
      );
      expect(cambios[0]!.n).toBe(1);

      const { rows: pausas } = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM app.feature_pauses
          WHERE tenant_id = $1 AND feature_key = 'flows.publish' AND released_at IS NULL`,
        [t],
      );
      expect(pausas[0]!.n).toBe(1);
    });

    it('los cinco motivos son válidos y uno inventado se rechaza', async () => {
      const t = await crearTenant('motivos', 'free');
      const MOTIVOS = ['checkout', 'payment_failed', 'cancel', 'staff', 'trial_end'];

      for (const [i, motivo] of MOTIVOS.entries()) {
        await expect(aplicar(t, i % 2 ? 'pro' : 'free', 'active', motivo)).resolves.toBeTruthy();
      }

      await expect(aplicar(t, 'pro', 'active', 'porque-si')).rejects.toThrow();
      await expect(aplicar(t, 'pro', 'zombi', 'staff')).rejects.toThrow();
    });

    it('bajar → subir → bajar SÍ son tres cambios reales, y quedan los tres', async () => {
      const t = await crearTenant('vaiven', 'pro');
      await aplicar(t, 'free', 'active', 'payment_failed');
      await aplicar(t, 'pro', 'active', 'checkout');
      await aplicar(t, 'free', 'active', 'payment_failed');

      const { rows } = await db.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM app.plan_changes WHERE tenant_id = $1',
        [t],
      );
      // Distinguir por ESTADO y no por una llave de idempotencia es lo que hace
      // que este caso salga bien solo.
      expect(rows[0]!.n).toBe(3);
    });

    it('reactivar a una empresa suspendida le devuelve todo lo de su plan', async () => {
      const t = await crearTenant('resucita', 'pro');
      await aplicar(t, 'pro', 'suspended', 'payment_failed');
      expect(await granted(t, 'inbox.whatsapp')).toBe(false);

      const alta = await aplicar(t, 'pro', 'active', 'checkout');
      expect(await granted(t, 'inbox.whatsapp')).toBe(true);
      expect(alta.effects.some((e) => e.action === 'restored')).toBe(true);

      const { rows } = await db.query(
        'SELECT 1 FROM app.feature_pauses WHERE tenant_id = $1 AND released_at IS NULL',
        [t],
      );
      expect(rows).toHaveLength(0);
    });

    it('un plan inexistente se rechaza antes de tocar nada', async () => {
      const t = await crearTenant('a-salvo', 'pro');
      await expect(aplicar(t, 'inventado', 'active', 'staff')).rejects.toThrow();

      const { rows } = await db.query<{ plan: string }>(
        'SELECT plan FROM app.tenants WHERE id = $1',
        [t],
      );
      expect(rows[0]!.plan).toBe('pro'); // intacto
    });

    it('una empresa que no existe se rechaza', async () => {
      await expect(
        aplicar('00000000-0000-4000-8000-000000000000', 'free', 'active', 'staff'),
      ).rejects.toThrow();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('★ criterio #7 — LA PRUEBA QUE VALE DINERO', () => {
    it('★ un job encolado con `pro` y ejecutado tras bajar a `free` NO corre, y queda con motivo', async () => {
      const t = await crearTenant('la-que-cuesta', 'pro');

      // ── Martes: se encola. En ese momento el plan SÍ incluye la función.
      expect(await granted(t, 'flows.publish')).toBe(true);
      const job = { id: 'job-del-martes', queue: 'flows.run', tenantId: t };

      // ── Miércoles: deja de pagar. Éste es el cambio que hoy nadie mira.
      const baja = await aplicar(t, 'free', 'active', 'payment_failed');
      expect(baja.applied).toBe(true);

      // ── Jueves: el worker saca el job. La verificación ocurre AHORA, con el
      //    plan de AHORA, que es todo el punto de §2.5. Antes de H16 esto
      //    corría igual, porque el único momento en que alguien miraba el plan
      //    era al encolar.
      const permitido = await granted(t, 'flows.publish');
      expect(permitido).toBe(false);

      if (!permitido) {
        await db.query(
          `INSERT INTO app.plan_skips (tenant_id, feature_key, queue, job_id, reason)
           VALUES ($1, 'flows.publish', $2, $3, 'feature_not_in_plan')`,
          [t, job.queue, job.id],
        );
      }

      // Y quedó constancia: un job que no hizo nada sin rastro es
      // indistinguible de un job que se perdió.
      const { rows } = await db.query<{ job_id: string; reason: string }>(
        'SELECT job_id, reason FROM app.plan_skips WHERE tenant_id = $1',
        [t],
      );
      expect(rows).toEqual([{ job_id: 'job-del-martes', reason: 'feature_not_in_plan' }]);
    });

    it('★ y el mismo job SÍ corre cuando vuelve a pagar — sin que nadie lo reencole', async () => {
      const t = await crearTenant('vuelve-a-correr', 'pro');
      await aplicar(t, 'free', 'active', 'payment_failed');
      expect(await granted(t, 'flows.publish')).toBe(false);

      await aplicar(t, 'pro', 'active', 'checkout');
      expect(await granted(t, 'flows.publish')).toBe(true);
    });

    it('un job de una empresa suspendida se distingue de uno sin plan', async () => {
      const t = await crearTenant('suspendida-con-job', 'pro', 'suspended');

      const { rows } = await db.query<{ status: string }>(
        'SELECT status FROM app.tenants WHERE id = $1',
        [t],
      );
      // `tenantIsLive()` mira esto y NO el catálogo: son dos respuestas
      // distintas para el cliente y dos pantallas distintas.
      expect(rows[0]!.status).toBe('suspended');
      expect(await granted(t, 'flows.publish')).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('las pausas del usuario', () => {
    it('pausar dos veces es pausar una vez', async () => {
      const t = await crearTenant('doble-pausa', 'pro');
      await db.query(`SELECT app.set_user_pause($1, 'inbox.meta', '*', true, 'una')`, [t]);
      await db.query(`SELECT app.set_user_pause($1, 'inbox.meta', '*', true, 'otra')`, [t]);

      const { rows } = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM app.feature_pauses
          WHERE tenant_id = $1 AND feature_key = 'inbox.meta'
            AND released_at IS NULL AND paused_by = 'user'`,
        [t],
      );
      expect(rows[0]!.n).toBe(1);
    });

    it('despausar suelta la del usuario y no toca la del plan', async () => {
      const t = await crearTenant('suelta', 'pro');
      await db.query(`SELECT app.set_user_pause($1, 'flows.publish', '*', true, 'pausado por mi')`, [t]);
      await aplicar(t, 'free', 'active', 'cancel'); // agrega la del plan

      await db.query(`SELECT app.set_user_pause($1, 'flows.publish', '*', false, null)`, [t]);

      const { rows } = await db.query<{ paused_by: string }>(
        `SELECT paused_by FROM app.feature_pauses
          WHERE tenant_id = $1 AND feature_key = 'flows.publish' AND released_at IS NULL`,
        [t],
      );
      expect(rows.map((r) => r.paused_by)).toEqual(['plan']);
    });

    it('una función que no existe se rechaza', async () => {
      const t = await crearTenant('sin-esa-funcion', 'pro');
      await expect(
        db.query(`SELECT app.set_user_pause($1, 'no.existe', '*', true, null)`, [t]),
      ).rejects.toThrow();
    });

    it('★ las dos pausas conviven sobre el mismo recurso — y eso es el criterio #9', async () => {
      const t = await crearTenant('conviven', 'pro');
      await db.query(`SELECT app.set_user_pause($1, 'flows.publish', '*', true, 'mia')`, [t]);
      await aplicar(t, 'free', 'active', 'cancel');

      const { rows } = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM app.feature_pauses
          WHERE tenant_id = $1 AND feature_key = 'flows.publish' AND released_at IS NULL`,
        [t],
      );
      // Si el índice único no incluyera `paused_by`, aquí habría una sola fila
      // y soltar la del plan encendería algo que el dueño apagó.
      expect(rows[0]!.n).toBe(2);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('RLS y privilegios', () => {
    it('las cinco tablas nuevas tienen RLS activo', async () => {
      const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
        `SELECT c.relname, c.relrowsecurity
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'app'
            AND c.relname IN ('features','plan_features','tenant_entitlements',
                              'plan_changes','feature_pauses','plan_skips')
          ORDER BY c.relname`,
      );
      expect(rows).toHaveLength(6);
      expect(rows.every((r) => r.relrowsecurity)).toBe(true);
    });

    it('con el rol anon, app.* responde permission denied', async () => {
      await db.query('SET ROLE anon');
      try {
        await expect(db.query('SELECT 1 FROM app.tenant_entitlements_effective')).rejects.toThrow();
      } finally {
        await db.query('RESET ROLE');
      }
    });

    it('★ service_role SÍ puede leer los siete objetos nuevos', async () => {
      /*
       * El otro lado del candado, y el que se olvida.
       *
       * Las tablas nuevas heredan el GRANT de la 001 por `ALTER DEFAULT
       * PRIVILEGES`, pero eso sólo aplica a lo que crea el MISMO rol que lo
       * declaró. Si el runner de migraciones cambiara de rol algún día, estas
       * siete quedarían sin permiso para el único rol con el que habla
       * PostgREST — y el síntoma sería un 500 en cada pantalla de plan, no un
       * error de despliegue.
       */
      const OBJETOS = [
        'features',
        'plan_features',
        'tenant_entitlements',
        'plan_changes',
        'feature_pauses',
        'plan_skips',
        'tenant_entitlements_effective',
      ];

      await db.query('SET ROLE service_role');
      try {
        for (const o of OBJETOS) {
          await expect(db.query(`SELECT 1 FROM app.${o} LIMIT 1`)).resolves.toBeTruthy();
        }
      } finally {
        await db.query('RESET ROLE');
      }
    });

    it('★ y puede EJECUTAR las tres funciones nuevas', async () => {
      const FUNCIONES = [
        'apply_plan_change(uuid,text,text,text,text)',
        'set_user_pause(uuid,text,text,boolean,text)',
        'presupuesto_desalineado()',
      ];

      for (const f of FUNCIONES) {
        const { rows } = await db.query<{ p: boolean }>(
          `SELECT has_function_privilege('service_role', 'app.${f}', 'EXECUTE') AS p`,
        );
        expect(rows[0]!.p).toBe(true);
      }
    });

    it('authenticated tampoco puede leer nada de esto', async () => {
      await db.query('SET ROLE authenticated');
      try {
        await expect(db.query('SELECT 1 FROM app.feature_pauses')).rejects.toThrow();
      } finally {
        await db.query('RESET ROLE');
      }
    });
  });
});

describe.skipIf(hayBase)('H16 contra Postgres real', () => {
  it('se salta sin TENANCY_TEST_DATABASE_URL', () => {
    // Sin base no se falla: pedirle una base de datos a `npm test` haría que
    // nadie lo corriera. El aviso está en el encabezado del archivo.
    expect(hayBase).toBe(false);
  });
});
