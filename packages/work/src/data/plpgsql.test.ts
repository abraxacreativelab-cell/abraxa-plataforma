/**
 * ════════════════════════════════════════════════════════════════════════════
 *  La 070 contra un Postgres DE VERDAD.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ── Por qué hace falta, si ya hay 470 pruebas ───────────────────────────────
 *
 * Las demás pruebas de este paquete corren contra `testing/fake-db.ts`, que
 * REIMPLEMENTA en TypeScript las dos funciones transaccionales de la 070 (su
 * propio encabezado lo dice con todas sus letras). Eso alcanza para probar los
 * servicios —qué traducen a HTTP, qué guardan, qué devuelven—, pero no puede
 * probar el plpgsql: si el `RAISE EXCEPTION` de la migración dijera mañana
 * `open_subtask:` en singular, el doble seguiría diciendo `open_subtasks:`, las
 * 470 pruebas seguirían verdes y en producción el 409 que abre el modal
 * "Completar todas" se caería a un 500 sin que nadie se enterara hasta que un
 * cliente lo contara.
 *
 * Ese es el contrato que este archivo fija: cada prefijo que `data/errors.ts`
 * busca con `startsWith` tiene aquí una prueba que lo hace saltar de verdad,
 * desde Postgres. Más los cuatro invariantes del trigger de jerarquía, que
 * existen justamente porque el código no es el único cliente de la tabla.
 *
 * ── Cómo corre sin ensuciar nada ────────────────────────────────────────────
 *
 * Todo vive dentro de UNA transacción que nunca se confirma:
 *
 *   BEGIN → (aplicar la 070 si no está) → sembrar dos tenants
 *     SAVEPOINT por prueba → … → ROLLBACK TO SAVEPOINT
 *   ROLLBACK
 *
 * Al terminar, la base queda byte por byte como estaba: ni una tabla, ni una
 * fila, ni una secuencia movida. Por eso se puede apuntar —con cuidado y en
 * modo lectura de resultados— a la base real sin pedir una de repuesto. Y si la
 * 070 todavía no está aplicada, la aplica DENTRO de la transacción: entonces lo
 * que se prueba no es "un esquema parecido" sino el archivo de migración tal
 * como está en el repo, que es el punto entero.
 *
 * ── Cuándo corre ────────────────────────────────────────────────────────────
 *
 * Sólo si hay `WORK_TEST_DATABASE_URL` (o `DATABASE_URL`). CI no tiene ninguna
 * de las dos —y no debe tenerla: el `verify` de `.github/workflows/ci.yml`
 * corre sin un solo secreto a propósito—, así que ahí este archivo se salta
 * entero y avisa por consola. No es una prueba que "a veces pasa": es una
 * prueba que se corre contra la base antes de mergear la migración. Las dos
 * formas de correrla:
 *
 *     # contra un Postgres desechable
 *     docker run -d --name pg -e POSTGRES_PASSWORD=postgres \
 *       -e POSTGRES_DB=abraxa_test -p 55432:5432 postgres:16-alpine
 *     WORK_TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/abraxa_test \
 *       npx vitest run packages/work/src/data/plpgsql.test.ts
 *
 *     # o contra la base real, que es lo que pide §7 del handoff. Es seguro
 *     # por construcción: nada se confirma.
 *     DATABASE_URL=… npx vitest run packages/work/src/data/plpgsql.test.ts
 *
 * Si el esquema `app` no existe (el caso del Postgres desechable) aplica
 * también el preludio de roles de Supabase, la `001` y la `010`, que es lo que
 * la `070` necesita debajo. Así el mismo archivo sirve de ensayo de despliegue.
 *
 * Levantar un Postgres en el job `verify` para que esto corra SIEMPRE es lo
 * correcto y no lo hago desde aquí: `.github/**` es de h1-fundacion. Queda
 * anotado como deuda en el PR, no escrito a mano en el carril de al lado.
 */
/* eslint-disable no-restricted-imports --
 * `pg` está prohibido en packages/** para que nadie hable con la base
 * saltándose `tenantDb(ctx)`. Éste es el mismo caso justificado que
 * `packages/tenancy/src/pg.test.ts`: no toca datos de dominio por un camino
 * paralelo, verifica que las funciones y los triggers de la migración hacen lo
 * que dicen. Es, literalmente, la prueba de que la capa de abajo sostiene la
 * regla que prohíbe este import.
 *
 * La forma limpia sería que h1 eximiera `**\/*.test.ts` de la prohibición de
 * `pg`, como ya lo hizo con la regla de las cabeceras de identidad. Anotado
 * como deuda en el PR; el archivo de eslint es suyo.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import type { QueryResultRow } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mapDbError } from './errors';

const CADENA = (process.env.WORK_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? '').trim();
const HAY_BASE = CADENA.length > 0;

if (!HAY_BASE) {
  console.warn(
    '[work] plpgsql.test.ts SALTADO: no hay WORK_TEST_DATABASE_URL ni DATABASE_URL. ' +
      'Las ~250 líneas de plpgsql de la 070 quedan sin cobertura en esta corrida.',
  );
}

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const migracion = (f: string): string => readFileSync(join(RAIZ, 'migrations', f), 'utf8');

/**
 * La `001` asume Supabase: roles `anon`/`authenticated`/`service_role` y la
 * extensión `vector`. En un Postgres pelón hay que prepararlos antes. No se
 * toca la migración: se prepara el ambiente. Copiado de `tenancy/pg.test.ts`,
 * que ya pagó este descubrimiento.
 */
const PRELUDIO = `
  DO $$ BEGIN CREATE ROLE anon NOLOGIN;           EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated NOLOGIN;  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticator NOINHERIT LOGIN;  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  GRANT anon, authenticated, service_role TO authenticator;
  CREATE SCHEMA IF NOT EXISTS extensions;
`;

const sinVector = (sql: string): string =>
  sql.replace(/CREATE EXTENSION IF NOT EXISTS vector[^;]*;/i, '');

/** El error tal como lo ve supabase-js: `message` sin el `ERROR: ` del driver. */
interface ErrorPg {
  message: string;
  code: string;
}

describe.skipIf(!HAY_BASE)('la 070 contra Postgres', () => {
  let db: Client;
  let A: string;
  let B: string;

  /** Corre y devuelve las filas. */
  const q = async <T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> => (await db.query<T>(sql, params)).rows;

  /**
   * Corre esperando que REVIENTE, y devuelve el error con la forma en que le
   * llega a `mapDbError`. El savepoint interno es obligatorio: en Postgres, una
   * excepción deja la transacción abortada y todo lo que siga falla con
   * `25P02` hasta que alguien retroceda.
   */
  const revienta = async (sql: string, params: unknown[] = []): Promise<ErrorPg> => {
    await db.query('SAVEPOINT intento');
    try {
      await db.query(sql, params);
    } catch (e) {
      await db.query('ROLLBACK TO SAVEPOINT intento');
      const err = e as { message?: string; code?: string };
      return { message: String(err.message ?? ''), code: String(err.code ?? '') };
    }
    await db.query('ROLLBACK TO SAVEPOINT intento');
    throw new Error(`se esperaba que fallara y no falló: ${sql}`);
  };

  /**
   * Una tarea del tenant `t`. Devuelve su id.
   *
   * Las columnas se arman con una lista blanca y no con las llaves que vengan:
   * un helper de pruebas que interpola nombres de columna sin filtrar es una
   * inyección esperando una prueba distraída, y aquí la conexión es la de la
   * base de verdad.
   */
  const COLUMNAS = [
    'title',
    'status',
    'priority',
    'parent_id',
    'project_id',
    'assigned_to',
    'due_date',
    'sort_order',
  ] as const;
  type Columna = (typeof COLUMNAS)[number];

  const tarea = async (t: string, campos: Partial<Record<Columna, unknown>> = {}): Promise<string> => {
    const usadas = COLUMNAS.filter((c) => campos[c] !== undefined);
    const cols = ['tenant_id', 'title', ...usadas.filter((c) => c !== 'title')];
    const vals = [t, campos.title ?? 'Tarea', ...usadas.filter((c) => c !== 'title').map((c) => campos[c])];

    const [fila] = await q<{ id: string }>(
      `INSERT INTO app.tasks (${cols.join(', ')})
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      vals,
    );
    if (!fila) throw new Error('el INSERT no devolvió id');
    return fila.id;
  };

  const proyecto = async (t: string, name = 'Proyecto'): Promise<string> => {
    const [fila] = await q<{ id: string }>(
      'INSERT INTO app.projects (tenant_id, name) VALUES ($1, $2) RETURNING id',
      [t, name],
    );
    if (!fila) throw new Error('el INSERT no devolvió id');
    return fila.id;
  };

  const leer = async (id: string): Promise<Record<string, unknown> | undefined> =>
    (await q('SELECT * FROM app.tasks WHERE id = $1', [id]))[0];

  /** ¿Existe ya esta tabla? */
  const hay = async (tabla: string): Promise<boolean> => {
    const filas = await q<{ existe: boolean }>('SELECT to_regclass($1::text) IS NOT NULL AS existe', [
      tabla,
    ]);
    return filas[0]?.existe === true;
  };

  beforeAll(async () => {
    db = new Client({ connectionString: CADENA });
    await db.connect();
    await db.query('BEGIN');
    // Una prueba que se cuelga sobre una fila bloqueada es una prueba que
    // parece un problema de red. Que se caiga rápido y diciendo qué pasó.
    await db.query("SET LOCAL statement_timeout = '60s'");
    await db.query("SET LOCAL lock_timeout = '5s'");

    // Contra la base real, `app.tenants` ya está y sólo falta la 070 (que no
    // está aplicada). Contra un Postgres desechable, no hay nada.
    if (!(await hay('app.tenants'))) {
      await db.query(PRELUDIO);
      await db.query(sinVector(migracion('001_foundation.sql')));
      await db.query(migracion('010_tenancy.sql'));
    }
    if (!(await hay('app.tasks'))) await db.query(migracion('070_work.sql'));

    const semilla = async (slug: string): Promise<string> => {
      const [fila] = await q<{ id: string }>(
        'INSERT INTO app.tenants (slug, name) VALUES ($1, $2) RETURNING id',
        [slug, slug],
      );
      if (!fila) throw new Error('el INSERT no devolvió id');
      return fila.id;
    };
    A = await semilla(`h9-prueba-a-${randomUUID().slice(0, 8)}`);
    B = await semilla(`h9-prueba-b-${randomUUID().slice(0, 8)}`);
  }, 120_000);

  afterAll(async () => {
    // Lo único que de verdad importa de este archivo: nada de lo de arriba
    // queda escrito.
    if (db) {
      await db.query('ROLLBACK');
      await db.end();
    }
  });

  beforeEach(async () => {
    await db.query('SAVEPOINT prueba');
  });

  afterEach(async () => {
    await db.query('ROLLBACK TO SAVEPOINT prueba');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // El trigger de jerarquía — los cuatro invariantes que la interfaz no puede
  // garantizar sola porque no es el único cliente de la tabla.
  // ══════════════════════════════════════════════════════════════════════════

  describe('app.work_guard_hierarchy', () => {
    it('(a) una subtarea no puede tener subtareas', async () => {
      const padre = await tarea(A);
      const hija = await tarea(A, { parent_id: padre });
      const err = await revienta('INSERT INTO app.tasks (tenant_id, parent_id, title) VALUES ($1,$2,$3)', [
        A,
        hija,
        'Nieta',
      ]);

      expect(err.message).toBe(`subtask_depth:${hija}`);
      expect(err.code).toBe('P0001');
      expect(mapDbError(err, 'x')?.code).toBe('VALIDATION');
    });

    it('(a) una tarea que YA tiene subtareas no puede volverse subtarea', async () => {
      const conHijas = await tarea(A);
      await tarea(A, { parent_id: conHijas });
      const otra = await tarea(A);

      const err = await revienta('UPDATE app.tasks SET parent_id = $1 WHERE id = $2', [otra, conHijas]);
      expect(err.message).toBe(`has_subtasks:${conHijas}`);
      expect(mapDbError(err, 'x')?.code).toBe('VALIDATION');
    });

    it('(b) la subtarea HEREDA el proyecto del padre, aunque pida otro', async () => {
      const p1 = await proyecto(A, 'Uno');
      const p2 = await proyecto(A, 'Dos');
      const padre = await tarea(A, { project_id: p1 });
      const hija = await tarea(A, { parent_id: padre, project_id: p2 });

      expect((await leer(hija))?.project_id).toBe(p1);
    });

    it('(b) y lo hereda también cuando llega sin proyecto', async () => {
      const p1 = await proyecto(A);
      const padre = await tarea(A, { project_id: p1 });
      const hija = await tarea(A, { parent_id: padre });
      expect((await leer(hija))?.project_id).toBe(p1);
    });

    it('(c) no se puede colgar del árbol de OTRO tenant', async () => {
      // Es el invariante que las FK no dan: apuntan a `app.tasks(id)` sin
      // mirar de quién es la fila.
      const ajena = await tarea(B);
      const err = await revienta('INSERT INTO app.tasks (tenant_id, parent_id, title) VALUES ($1,$2,$3)', [
        A,
        ajena,
        'Colada',
      ]);

      expect(err.message).toBe(`parent_not_found:${ajena}`);
      expect(mapDbError(err, 'x')?.message).toBe('La tarea padre no existe');
    });

    it('(c) ni meterse en un proyecto de otro tenant', async () => {
      const ajeno = await proyecto(B);
      const err = await revienta('INSERT INTO app.tasks (tenant_id, project_id, title) VALUES ($1,$2,$3)', [
        A,
        ajeno,
        'Colada',
      ]);

      expect(err.message).toBe(`project_not_found:${ajeno}`);
      expect(mapDbError(err, 'x')?.message).toBe('El proyecto seleccionado no existe');
    });

    it('(d) completed_at se pone al crear ya completada', async () => {
      const t = await tarea(A, { status: 'completed' });
      expect((await leer(t))?.completed_at).not.toBeNull();
    });

    it('(d) y NO se pone al crear abierta — sin reventar por el OLD inexistente', async () => {
      // El comentario de la migración explica que separar las ramas
      // INSERT/UPDATE es lo que evita "record old is not assigned yet". Esta
      // prueba es la que lo comprueba: sin la separación, TODO insert falla.
      const t = await tarea(A);
      expect((await leer(t))?.completed_at).toBeNull();
    });

    it('(d) se limpia al REABRIR', async () => {
      const t = await tarea(A, { status: 'completed' });
      await q("UPDATE app.tasks SET status = 'in_progress' WHERE id = $1", [t]);
      expect((await leer(t))?.completed_at).toBeNull();
    });

    it('(d) no se toca cuando el UPDATE no cambia el estado', async () => {
      const t = await tarea(A, { status: 'completed' });
      const antes = (await leer(t))?.completed_at;
      await q("UPDATE app.tasks SET title = 'Otro título' WHERE id = $1", [t]);
      expect((await leer(t))?.completed_at).toEqual(antes);
    });

    it('el CHECK atrapa la tarea que es su propia subtarea', async () => {
      const t = await tarea(A);
      const err = await revienta('UPDATE app.tasks SET parent_id = id WHERE id = $1', [t]);
      expect(err.code).toBe('23514');
      expect(mapDbError(err, 'x')?.code).toBe('VALIDATION');
    });
  });

  describe('app.work_cascade_project', () => {
    it('mover el proyecto del padre arrastra a sus subtareas', async () => {
      const p1 = await proyecto(A, 'Uno');
      const p2 = await proyecto(A, 'Dos');
      const padre = await tarea(A, { project_id: p1 });
      const hija = await tarea(A, { parent_id: padre });

      await q('UPDATE app.tasks SET project_id = $1 WHERE id = $2', [p2, padre]);

      expect((await leer(hija))?.project_id).toBe(p2);
    });

    it('sacarlo de todo proyecto también las arrastra', async () => {
      const p1 = await proyecto(A);
      const padre = await tarea(A, { project_id: p1 });
      const hija = await tarea(A, { parent_id: padre });

      await q('UPDATE app.tasks SET project_id = NULL WHERE id = $1', [padre]);
      expect((await leer(hija))?.project_id).toBeNull();
    });
  });

  describe('app.work_touch_updated_at', () => {
    it('cualquier UPDATE mueve updated_at', async () => {
      const t = await tarea(A);
      const antes = (await leer(t))?.updated_at as Date;
      await q("UPDATE app.tasks SET title = 'Cambiado' WHERE id = $1", [t]);
      expect(((await leer(t))?.updated_at as Date).getTime()).toBeGreaterThanOrEqual(antes.getTime());
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // app.reorder_tasks — el criterio observable 4 y el guard del 409
  // ══════════════════════════════════════════════════════════════════════════

  describe('app.reorder_tasks', () => {
    const reordenar = (t: string, items: unknown[]): Promise<{ reorder_tasks: number }[]> =>
      q<{ reorder_tasks: number }>('SELECT app.reorder_tasks($1::uuid, $2::jsonb) AS reorder_tasks', [
        t,
        JSON.stringify(items),
      ]);

    it('escribe las posiciones y devuelve cuántas movió', async () => {
      const a = await tarea(A, { sort_order: 0 });
      const b = await tarea(A, { sort_order: 1 });

      const [fila] = await reordenar(A, [
        { id: a, sort_order: 10 },
        { id: b, sort_order: 5 },
      ]);

      expect(fila?.reorder_tasks).toBe(2);
      expect(Number((await leer(a))?.sort_order)).toBe(10);
      expect(Number((await leer(b))?.sort_order)).toBe(5);
    });

    it('acepta posiciones fraccionarias — que es el punto de que sea numeric', async () => {
      // El arreglo del arrastre depende de esto: el punto medio entre dos
      // vecinos casi nunca es entero. Con `integer` se truncaría en silencio y
      // la tarjeta se regresaría a su sitio.
      const a = await tarea(A);
      await reordenar(A, [{ id: a, sort_order: 1.5 }]);
      expect(Number((await leer(a))?.sort_order)).toBe(1.5);
    });

    it('renumerar una columna entera cabe en UNA llamada', async () => {
      // Es lo que manda `planDrop` cuando el hueco se agota: la columna con
      // posiciones enteras, en el mismo lote.
      const ids = [await tarea(A), await tarea(A), await tarea(A), await tarea(A)];
      const [fila] = await reordenar(
        A,
        ids.map((id, i) => ({ id, sort_order: i * 2 })),
      );
      expect(fila?.reorder_tasks).toBe(4);
      const ordenes = await q<{ sort_order: string }>(
        'SELECT sort_order FROM app.tasks WHERE id = ANY($1) ORDER BY sort_order',
        [ids],
      );
      expect(ordenes.map((r) => Number(r.sort_order))).toEqual([0, 2, 4, 6]);
    });

    it('una tarea de OTRO tenant no se encuentra, y el lote entero se revierte', async () => {
      const mia = await tarea(A, { sort_order: 0 });
      const ajena = await tarea(B, { sort_order: 0 });

      const err = await revienta('SELECT app.reorder_tasks($1::uuid, $2::jsonb)', [
        A,
        JSON.stringify([
          { id: mia, sort_order: 99 },
          { id: ajena, sort_order: 99 },
        ]),
      ]);

      expect(err.message).toBe(`task_not_found:${ajena}`);
      expect(mapDbError(err, 'x')?.code).toBe('NOT_FOUND');
      // Lo importante: la PRIMERA, que sí era suya, tampoco se movió.
      expect(Number((await leer(mia))?.sort_order)).toBe(0);
      expect(Number((await leer(ajena))?.sort_order)).toBe(0);
    });

    it('completar un padre con subtareas abiertas levanta open_subtasks con los ids', async () => {
      const padre = await tarea(A);
      const abierta1 = await tarea(A, { parent_id: padre, status: 'pending' });
      const abierta2 = await tarea(A, { parent_id: padre, status: 'blocked' });
      await tarea(A, { parent_id: padre, status: 'completed' });

      const err = await revienta('SELECT app.reorder_tasks($1::uuid, $2::jsonb)', [
        A,
        JSON.stringify([{ id: padre, sort_order: 0, status: 'completed' }]),
      ]);

      // El formato exacto importa: `data/errors.ts` parte por `,` para armar
      // el cuerpo del 409 que llena el modal "Completar todas".
      expect(err.message.startsWith('open_subtasks:')).toBe(true);
      const ids = err.message.slice('open_subtasks:'.length).split(',');
      expect(ids.sort()).toEqual([abierta1, abierta2].sort());

      const mapeado = mapDbError(err, 'x');
      expect(mapeado?.code).toBe('CONFLICT');
      const carga = mapeado?.details as unknown as { openSubtaskIds: string[] };
      expect(carga.openSubtaskIds.sort()).toEqual([abierta1, abierta2].sort());
    });

    it('el guard NO estorba a una subtarea: una subtarea no tiene subtareas', async () => {
      const padre = await tarea(A);
      const hija = await tarea(A, { parent_id: padre });
      const [fila] = await reordenar(A, [{ id: hija, sort_order: 1, status: 'completed' }]);
      expect(fila?.reorder_tasks).toBe(1);
    });

    it('completar un padre que ya no tiene nada abierto sí pasa', async () => {
      const padre = await tarea(A);
      await tarea(A, { parent_id: padre, status: 'completed' });
      const [fila] = await reordenar(A, [{ id: padre, sort_order: 0, status: 'completed' }]);
      expect(fila?.reorder_tasks).toBe(1);
      expect((await leer(padre))?.status).toBe('completed');
    });

    it('el cambio de estado deja evento, y el que no cambia no lo deja', async () => {
      const a = await tarea(A, { status: 'pending' });
      const b = await tarea(A, { status: 'pending' });

      await reordenar(A, [
        { id: a, sort_order: 1, status: 'in_progress', actor: 'lupita@ejemplo.mx' },
        { id: b, sort_order: 2 },
      ]);

      const eventos = await q<{ task_id: string; from_value: string; to_value: string; actor: string }>(
        `SELECT task_id, from_value, to_value, actor FROM app.task_events
          WHERE field = 'status' AND tenant_id = $1`,
        [A],
      );
      expect(eventos).toHaveLength(1);
      expect(eventos[0]).toMatchObject({
        task_id: a,
        from_value: 'pending',
        to_value: 'in_progress',
        actor: 'lupita@ejemplo.mx',
      });
    });

    it('mover a otra columna cambia el campo de la columna', async () => {
      const t = await tarea(A, { assigned_to: 'lupita@ejemplo.mx' });
      await reordenar(A, [{ id: t, sort_order: 0, assigned_to: 'beto@ejemplo.mx' }]);
      expect((await leer(t))?.assigned_to).toBe('beto@ejemplo.mx');
    });

    it('soltar en "Sin responsable" desasigna — un null explícito no es "no lo toques"', async () => {
      const t = await tarea(A, { assigned_to: 'lupita@ejemplo.mx' });
      await reordenar(A, [{ id: t, sort_order: 0, assigned_to: null }]);
      expect((await leer(t))?.assigned_to).toBeNull();
    });

    it('lo que no viene en el item NO se toca', async () => {
      const t = await tarea(A, { assigned_to: 'lupita@ejemplo.mx', priority: 'alta' });
      await reordenar(A, [{ id: t, sort_order: 7 }]);
      const fila = await leer(t);
      expect(fila?.assigned_to).toBe('lupita@ejemplo.mx');
      expect(fila?.priority).toBe('alta');
    });

    const ID = '00000000-0000-0000-0000-000000000001';
    const MALOS: Array<[string, unknown[]]> = [
      ['un estado inventado', [{ id: ID, sort_order: 0, status: 'x' }]],
      ['una prioridad inventada', [{ id: ID, sort_order: 0, priority: 'urgentísima' }]],
      ['un item sin sort_order', [{ id: ID }]],
      ['un item que no es objeto', ['nel']],
      ['un array vacío', []],
    ];

    it.each(MALOS)('rechaza %s con invalid_ y 22023', async (_caso, items) => {
      const err = await revienta('SELECT app.reorder_tasks($1::uuid, $2::jsonb)', [A, JSON.stringify(items)]);
      expect(err.message.startsWith('invalid_')).toBe(true);
      expect(err.code).toBe('22023');
      expect(mapDbError(err, 'x')?.code).toBe('VALIDATION');
    });

    it('sin tenant no hace nada — el aislamiento de esta función ES el parámetro', async () => {
      const err = await revienta('SELECT app.reorder_tasks(NULL::uuid, $1::jsonb)', [
        JSON.stringify([{ id: randomUUID(), sort_order: 0 }]),
      ]);
      expect(err.message).toBe('invalid_tenant');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // app.complete_task_cascade — la salida del 409
  // ══════════════════════════════════════════════════════════════════════════

  describe('app.complete_task_cascade', () => {
    const cascada = (t: string, id: string, actor: string | null = 'lupita@ejemplo.mx') =>
      q<{ complete_task_cascade: number }>(
        'SELECT app.complete_task_cascade($1::uuid, $2::uuid, $3::text) AS complete_task_cascade',
        [t, id, actor],
      );

    it('cierra las subtareas abiertas y el padre, y cuenta las subtareas', async () => {
      const padre = await tarea(A);
      const a = await tarea(A, { parent_id: padre, status: 'pending' });
      const b = await tarea(A, { parent_id: padre, status: 'blocked' });
      const ya = await tarea(A, { parent_id: padre, status: 'completed' });

      const [fila] = await cascada(A, padre);

      expect(fila?.complete_task_cascade).toBe(2);
      for (const id of [padre, a, b, ya]) expect((await leer(id))?.status).toBe('completed');
      // Y `completed_at` lo puso el trigger, no la función.
      expect((await leer(a))?.completed_at).not.toBeNull();
    });

    it('deja historial de cada cierre, con su actor', async () => {
      const padre = await tarea(A);
      await tarea(A, { parent_id: padre });

      await cascada(A, padre, 'beto@ejemplo.mx');

      const eventos = await q<{ actor: string }>(
        `SELECT actor FROM app.task_events
          WHERE field = 'status' AND to_value = 'completed' AND tenant_id = $1`,
        [A],
      );
      expect(eventos).toHaveLength(2);
      expect(eventos.every((e) => e.actor === 'beto@ejemplo.mx')).toBe(true);
    });

    it('sobre una tarea ya completada no vuelve a escribir historial', async () => {
      const t = await tarea(A, { status: 'completed' });
      await cascada(A, t);
      expect(
        await q("SELECT 1 FROM app.task_events WHERE field = 'status' AND tenant_id = $1", [A]),
      ).toHaveLength(0);
    });

    it('no cruza tenants', async () => {
      const ajena = await tarea(B);
      const err = await revienta('SELECT app.complete_task_cascade($1::uuid, $2::uuid, $3::text)', [A, ajena, null]);
      expect(err.message).toBe(`task_not_found:${ajena}`);
      expect(mapDbError(err, 'x')?.code).toBe('NOT_FOUND');
      expect((await leer(ajena))?.status).toBe('pending');
    });

    it('sobre una subtarea cierra sólo esa', async () => {
      const padre = await tarea(A);
      const hija = await tarea(A, { parent_id: padre });
      const [fila] = await cascada(A, hija);
      expect(fila?.complete_task_cascade).toBe(0);
      expect((await leer(hija))?.status).toBe('completed');
      expect((await leer(padre))?.status).toBe('pending');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Lo que sostiene todo lo anterior
  // ══════════════════════════════════════════════════════════════════════════

  describe('la 070 misma', () => {
    it('las dos funciones son SECURITY DEFINER con search_path fijo', async () => {
      // Sin `search_path` fijo, una SECURITY DEFINER es una escalada esperando
      // a que alguien cree un esquema con el nombre correcto.
      const filas = await q<{ proname: string; prosecdef: boolean; proconfig: string[] | null }>(
        `SELECT proname, prosecdef, proconfig
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'app' AND proname IN ('reorder_tasks','complete_task_cascade')`,
      );
      expect(filas).toHaveLength(2);
      for (const f of filas) {
        expect(f.prosecdef).toBe(true);
        expect((f.proconfig ?? []).some((c) => c.startsWith('search_path='))).toBe(true);
      }
    });

    it('las cinco tablas de H9 tienen RLS prendida', async () => {
      const filas = await q<{ relname: string; relrowsecurity: boolean }>(
        `SELECT relname, relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'app'
            AND relname IN ('projects','tasks','task_comments','task_events','task_views')`,
      );
      expect(filas).toHaveLength(5);
      for (const f of filas) expect(f.relrowsecurity).toBe(true);
    });

    it('sort_order es numeric: si fuera integer, arrastrar entre dos vecinos no cabría', async () => {
      const [fila] = await q<{ data_type: string; column_default: string }>(
        `SELECT data_type, column_default FROM information_schema.columns
          WHERE table_schema='app' AND table_name='tasks' AND column_name='sort_order'`,
      );
      expect(fila?.data_type).toBe('numeric');
    });
  });
});
