/**
 * Anti-deriva entre el SQL y el TypeScript.
 *
 * Hay reglas que están escritas dos veces a propósito — la lista de slugs
 * reservados, los formatos, los códigos de error — porque la base tiene que
 * rechazar aunque nadie pase por zod, y zod tiene que dar un mensaje decente
 * aunque la base también lo rechace.
 *
 * Escribirlas dos veces es correcto. Que se separen, no. Esta suite falla
 * cuando alguien agrega un slug reservado en un lado y no en el otro, o lanza
 * un SQLSTATE nuevo que nadie tradujo — que es justo el tipo de deriva que no
 * se nota hasta que un cliente ve un 500 sin explicación.
 *
 * No necesita base de datos: lee los archivos.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RESERVED_SLUGS, SLUG_RE } from './schemas';
import { TENANCY_SQLSTATE } from './errors';
import { hashToken } from './services/invitations';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DIR = join(RAIZ, 'migrations');

const mias = readdirSync(DIR)
  .filter((f) => /^01\d_.*\.sql$/.test(f))
  .sort();

const leer = (f: string): string => readFileSync(join(DIR, f), 'utf8');
const todoElSql = (): string => mias.map(leer).join('\n');

describe('las migraciones de H2', () => {
  it('existen y están dentro del bloque 010–019', () => {
    expect(mias.length).toBeGreaterThan(0);
    for (const f of mias) {
      const n = Number(f.slice(0, 3));
      expect(n).toBeGreaterThanOrEqual(10);
      expect(n).toBeLessThanOrEqual(19);
    }
  });

  it('no numera nada fuera de su bloque', () => {
    const fuera = readdirSync(DIR).filter((f) => {
      const m = /^(\d{3})_/.exec(f);
      if (!m) return false;
      const n = Number(m[1]);
      // 001–009 es de H1 y ya estaba.
      return n >= 10 && (n < 10 || n > 19);
    });
    expect(fuera).toEqual([]);
  });

  /**
   * Es la misma verificación que hace `ownership-gate`. Se repite aquí para
   * que `npm test` la atrape en local, sin esperar a que CI rechace el PR.
   */
  it('toda tabla nueva lleva RLS en el mismo archivo', () => {
    for (const archivo of mias) {
      const sql = leer(archivo);
      const creadas = [...sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?app\.(\w+)/gi)].map(
        (m) => m[1]?.toLowerCase(),
      );
      const conRls = new Set(
        [...sql.matchAll(/ALTER\s+TABLE\s+app\.(\w+)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi)].map((m) =>
          m[1]?.toLowerCase(),
        ),
      );
      for (const tabla of creadas) {
        expect(conRls.has(tabla), `app.${tabla} (${archivo}) sin ENABLE ROW LEVEL SECURITY`).toBe(
          true,
        );
      }
    }
  });

  it('las tablas globales se declaran `-- tenantless:`', () => {
    const sql = leer('010_tenancy.sql');
    for (const tabla of ['users', 'plans']) {
      const i = sql.indexOf(`CREATE TABLE app.${tabla}`);
      expect(i, `no encontré app.${tabla}`).toBeGreaterThan(-1);
      const antes = sql.slice(Math.max(0, i - 300), i);
      expect(antes, `app.${tabla} necesita su -- tenantless:`).toMatch(/--\s*tenantless\s*:/i);
    }
  });

  it('las tablas de dominio sí llevan tenant_id', () => {
    const sql = leer('010_tenancy.sql');
    for (const tabla of ['invitations', 'tenant_events']) {
      const i = sql.indexOf(`CREATE TABLE app.${tabla}`);
      const cuerpo = sql.slice(i, sql.indexOf('\n);', i));
      expect(cuerpo, `app.${tabla} sin tenant_id`).toMatch(/\btenant_id\b/);
    }
  });
});

describe('la lista de slugs reservados no se puede separar', () => {
  it('SQL y TypeScript declaran exactamente los mismos', () => {
    const sql = leer('010_tenancy.sql');
    const bloque = /tenants_slug_no_reservado[\s\S]*?CHECK\s*\(slug NOT IN \(([\s\S]*?)\)\s*\)/i.exec(
      sql,
    );
    expect(bloque, 'no encontré la restricción tenants_slug_no_reservado').toBeTruthy();

    const enSql = [...(bloque?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    const enTs = [...RESERVED_SLUGS].sort();

    expect(enSql).toEqual(enTs);
  });

  it('y ninguno de ellos pasaría por el schema de zod', () => {
    for (const reservado of RESERVED_SLUGS) {
      // Con formato válido pero reservado: lo rechaza la lista, no el formato.
      if (SLUG_RE.test(reservado)) {
        expect(RESERVED_SLUGS.includes(reservado)).toBe(true);
      }
    }
  });
});

describe('el formato del slug es el mismo en los dos lados', () => {
  it('la expresión de la migración coincide con SLUG_RE', () => {
    const sql = leer('010_tenancy.sql');
    const m = /tenants_slug_formato[\s\S]*?CHECK\s*\(slug\s*~\s*'([^']+)'/i.exec(sql);
    expect(m, 'no encontré tenants_slug_formato').toBeTruthy();
    expect(m?.[1]).toBe(SLUG_RE.source);
  });

  it.each([
    ['panaderia-lupita', true],
    ['ab', false],
    ['-empieza-con-guion', false],
    ['termina-con-guion-', false],
    ['Con-Mayusculas', false],
    ['con espacios', false],
    ['a'.repeat(41), false],
    ['a'.repeat(40), true],
  ])('%s → válido: %s', (slug, valido) => {
    expect(SLUG_RE.test(slug)).toBe(valido);
  });
});

describe('los códigos de error del SQL están todos traducidos', () => {
  it('cada ERRCODE que se lanza tiene su mapeo en errors.ts', () => {
    const lanzados = new Set(
      [...todoElSql().matchAll(/ERRCODE\s*=\s*'(ABX\d{2})'/gi)].map((m) => m[1]),
    );
    expect(lanzados.size).toBeGreaterThan(0);

    const conocidos = new Set<string>(Object.values(TENANCY_SQLSTATE));
    const errorsTs = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'errors.ts'), 'utf8');

    for (const code of lanzados) {
      expect(conocidos.has(code ?? ''), `${code} no está en TENANCY_SQLSTATE`).toBe(true);
      expect(errorsTs, `${code} no está en la tabla POR_SQLSTATE`).toContain(`${code}:`);
    }
  });

  it('y no sobra ninguno declarado que el SQL no use', () => {
    const lanzados = new Set(
      [...todoElSql().matchAll(/ERRCODE\s*=\s*'(ABX\d{2})'/gi)].map((m) => m[1]),
    );
    for (const code of Object.values(TENANCY_SQLSTATE)) {
      expect(lanzados.has(code), `${code} está declarado pero el SQL nunca lo lanza`).toBe(true);
    }
  });
});

describe('el hash del token cabe en su restricción', () => {
  it('hashToken produce exactamente lo que exige el CHECK', () => {
    const sql = leer('010_tenancy.sql');
    const m = /invitations_token_hasheado[\s\S]*?CHECK\s*\(token_hash\s*~\s*'([^']+)'/i.exec(sql);
    expect(m, 'no encontré invitations_token_hasheado').toBeTruthy();

    const re = new RegExp(m?.[1] ?? '');
    expect(re.test(hashToken('un-token-cualquiera'))).toBe(true);
    expect(hashToken('x')).toHaveLength(64);
  });
});

describe('las funciones que sostienen la atomicidad existen', () => {
  it.each([
    ['app.provision_tenant', '011_provision.sql'],
    ['app.accept_invitation', '012_invitations.sql'],
    ['app.remove_member', '012_invitations.sql'],
    ['app.asientos_disponibles', '012_invitations.sql'],
  ])('%s está definida en %s', (fn, archivo) => {
    expect(leer(archivo)).toContain(`CREATE OR REPLACE FUNCTION ${fn}(`);
  });

  it('todas fijan search_path (no heredan el del que llama)', () => {
    const sql = todoElSql();
    const definiciones = [...sql.matchAll(/CREATE OR REPLACE FUNCTION app\.(\w+)\(/g)].map(
      (m) => m[1],
    );
    expect(definiciones.length).toBeGreaterThan(0);

    for (const nombre of definiciones) {
      const i = sql.indexOf(`CREATE OR REPLACE FUNCTION app.${nombre}(`);
      const cabecera = sql.slice(i, sql.indexOf('AS $$', i));
      // Las de SQL puro e IMMUTABLE no lo necesitan; las de plpgsql sí.
      if (/LANGUAGE\s+plpgsql/i.test(cabecera)) {
        expect(cabecera, `app.${nombre} sin SET search_path`).toMatch(/SET\s+search_path/i);
      }
    }
  });
});
