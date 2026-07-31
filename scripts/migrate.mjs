#!/usr/bin/env node
/**
 * Runner de migraciones.
 *
 * Aplica en orden los `migrations/NNN_*.sql` que faltan, cada uno dentro de su
 * propia transacción, y lleva el libro en `app.schema_migrations`.
 *
 * Dos cosas que hace y por las que existe:
 *   · Verifica el checksum de lo ya aplicado. Si alguien edita una migración
 *     que ya corrió en producción, se entera aquí y no seis semanas después
 *     cuando el esquema de un ambiente no coincide con el del otro.
 *   · Es repetible e idempotente: correrlo dos veces no hace nada la segunda.
 *
 * Uso:
 *   npm run migrate            aplica lo pendiente
 *   npm run migrate:status     sólo informa
 *   node scripts/migrate.mjs --dry-run
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(RAIZ, 'migrations');
const R = { rojo: '\x1b[31m', verde: '\x1b[32m', ambar: '\x1b[33m', gris: '\x1b[90m', off: '\x1b[0m' };

function cargarEnv() {
  if (process.env.DATABASE_URL) return;
  const archivo = join(RAIZ, '.env');
  if (!existsSync(archivo)) return;
  for (const linea of readFileSync(archivo, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(linea);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const listar = () =>
  readdirSync(DIR)
    .filter((f) => /^\d{3}_.*\.sql$/.test(f))
    .sort()
    .map((f) => {
      const sql = readFileSync(join(DIR, f), 'utf8');
      return {
        version: Number(f.slice(0, 3)),
        name: f,
        sql,
        checksum: createHash('sha256').update(sql).digest('hex').slice(0, 16),
      };
    });

async function aplicadas(client) {
  try {
    const { rows } = await client.query(
      'select version, name, checksum, applied_at from app.schema_migrations order by version',
    );
    return new Map(rows.map((r) => [r.version, r]));
  } catch (e) {
    // 42P01 = la tabla no existe todavía: la crea la 001.
    if (e.code === '42P01' || e.code === '3F000') return new Map();
    throw e;
  }
}

async function main() {
  cargarEnv();
  const soloEstado = process.argv.includes('--status');
  const ensayo = process.argv.includes('--dry-run');

  if (!process.env.DATABASE_URL) {
    console.error(
      `${R.rojo}✖ Falta DATABASE_URL.${R.off}\n  Copia .env.example a .env y pon la cadena del session pooler de Supabase.`,
    );
    process.exit(1);
  }

  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const archivos = listar();
    const yaEstan = await aplicadas(client);

    // Un cambio en una migración ya aplicada es una divergencia de esquema.
    for (const m of archivos) {
      const previa = yaEstan.get(m.version);
      if (previa && previa.checksum !== m.checksum) {
        console.error(
          `${R.rojo}✖ ${m.name} cambió después de aplicarse${R.off} ` +
            `(${previa.checksum} → ${m.checksum}).\n` +
            `  Una migración aplicada es historia, no borrador. Escribe una nueva en tu bloque.`,
        );
        process.exit(1);
      }
    }

    const pendientes = archivos.filter((m) => !yaEstan.has(m.version));

    console.log(
      `${R.gris}${archivos.length} migración(es) · ${yaEstan.size} aplicada(s) · ${pendientes.length} pendiente(s)${R.off}\n`,
    );
    for (const m of archivos) {
      const p = yaEstan.get(m.version);
      console.log(
        p
          ? `  ${R.verde}✔${R.off} ${m.name} ${R.gris}${new Date(p.applied_at).toISOString().slice(0, 16).replace('T', ' ')}${R.off}`
          : `  ${R.ambar}·${R.off} ${m.name} ${R.gris}pendiente${R.off}`,
      );
    }

    if (soloEstado || pendientes.length === 0) return;
    if (ensayo) {
      console.log(`\n${R.ambar}--dry-run: no se aplicó nada.${R.off}`);
      return;
    }

    console.log('');
    for (const m of pendientes) {
      process.stdout.write(`  aplicando ${m.name} … `);
      await client.query('begin');
      try {
        await client.query(m.sql);
        await client.query(
          'insert into app.schema_migrations (version, name, checksum) values ($1,$2,$3)',
          [m.version, m.name, m.checksum],
        );
        await client.query('commit');
        console.log(`${R.verde}ok${R.off}`);
      } catch (e) {
        await client.query('rollback');
        console.log(`${R.rojo}falló${R.off}\n\n  ${e.message}\n`);
        process.exit(1);
      }
    }
    console.log(`\n${R.verde}✔ ${pendientes.length} migración(es) aplicada(s).${R.off}`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(`${R.rojo}✖${R.off}`, e.message);
  process.exit(1);
});
