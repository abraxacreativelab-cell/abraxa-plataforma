#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Las migraciones de la bóveda, verificadas contra un Postgres DE VERDAD.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  `npm test` corre contra un doble en memoria porque CI no tiene base de
 *  datos, y una prueba que no corre en cada PR es documentación. Pero el doble
 *  no aplica los CHECK, ni las llaves foráneas, ni el RLS, ni sabe qué es un
 *  índice HNSW. Todo eso vive aquí.
 *
 *  No necesita credenciales ni tocar el proyecto compartido: levanta un
 *  contenedor `pgvector/pgvector:pg16`, le pone encima lo que Supabase da por
 *  hecho (los roles `anon`/`authenticated`/`service_role` y el schema
 *  `extensions`), aplica las migraciones 001 y 030–033 TAL CUAL, y corre las
 *  aserciones.
 *
 *      node packages/vault/sql-tests/run.mjs
 *
 *  Sale con != 0 en cuanto una aserción falla. Borra el contenedor al final,
 *  pase lo que pase. Con `--keep` lo deja vivo para poder hurgar:
 *
 *      psql postgres://postgres:verify@localhost:55432/postgres
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..', '..', '..');
const CONTENEDOR = 'abraxa-vault-sql-tests';
const IMAGEN = 'pgvector/pgvector:pg16';
const PUERTO = '55432';

const C = { rojo: '\x1b[31m', verde: '\x1b[32m', gris: '\x1b[90m', bold: '\x1b[1m', off: '\x1b[0m' };

/** Las migraciones que se aplican, en orden. La 001 es de H1 y va tal cual. */
const MIGRACIONES = [
  '001_foundation.sql',
  '030_vault_documents.sql',
  '031_vault_values.sql',
  '032_vault_knowledge.sql',
  '033_industry_templates.sql',
];

const docker = (args, opts = {}) =>
  spawnSync('docker', args, { encoding: 'utf8', ...opts });

const dockerOk = (args) => docker(args).status === 0;

function limpiar() {
  if (process.argv.includes('--keep')) {
    console.log(`${C.gris}--keep: el contenedor ${CONTENEDOR} sigue vivo en el puerto ${PUERTO}.${C.off}`);
    return;
  }
  docker(['rm', '-f', CONTENEDOR], { stdio: 'ignore' });
}

function main() {
  console.log(`${C.bold}Verificación SQL de la bóveda${C.off} ${C.gris}· ${IMAGEN}${C.off}\n`);

  if (!dockerOk(['info'])) {
    console.error(
      `${C.rojo}✖ El demonio de Docker no responde.${C.off}\n` +
        '  Enciéndelo y vuelve a intentar. Es lo único que hace falta: no se\n' +
        '  necesitan credenciales ni tocar el Supabase compartido.',
    );
    return 1;
  }

  for (const m of MIGRACIONES) {
    if (!existsSync(join(RAIZ, 'migrations', m))) {
      console.error(`${C.rojo}✖ falta migrations/${m}${C.off}`);
      return 1;
    }
  }

  docker(['rm', '-f', CONTENEDOR], { stdio: 'ignore' });

  process.stdout.write('  levantando Postgres … ');
  const arranque = docker([
    'run', '-d', '--name', CONTENEDOR,
    '-e', 'POSTGRES_PASSWORD=verify',
    '-p', `${PUERTO}:5432`,
    IMAGEN,
  ]);
  if (arranque.status !== 0) {
    console.log(`${C.rojo}falló${C.off}\n${arranque.stderr}`);
    return 1;
  }

  /**
   * Esperar a que la base esté DE VERDAD lista.
   *
   * `pg_isready` no sirve aquí y es una trampa conocida de la imagen oficial:
   * `initdb` levanta un servidor TEMPORAL para sembrar el cluster, lo apaga, y
   * recién entonces arranca el definitivo. En esa ventana `pg_isready` dice que
   * sí y la siguiente conexión se topa con «the database system is shutting
   * down».
   *
   * Por eso se pide una consulta real y se exigen tres seguidas: durante el
   * apagado intermedio es imposible encadenarlas.
   */
  const ESPERA_MAX_S = 300;
  const SEGUIDAS = 3;
  let buenas = 0;
  for (let i = 0; i < ESPERA_MAX_S && buenas < SEGUIDAS; i++) {
    const ok = dockerOk(['exec', CONTENEDOR, 'psql', '-U', 'postgres', '-tAc', 'select 1']);
    buenas = ok ? buenas + 1 : 0;
    if (buenas < SEGUIDAS) {
      if (i > 0 && i % 30 === 0) process.stdout.write(`${i}s… `);
      execFileSync('sleep', ['1']);
    }
  }
  if (buenas < SEGUIDAS) {
    console.log(`${C.rojo}no quedó estable en ${ESPERA_MAX_S} s${C.off}`);
    console.log(docker(['logs', '--tail', '20', CONTENEDOR]).stderr ?? '');
    return 1;
  }
  console.log(`${C.verde}ok${C.off}`);

  const copiar = (origen, destino) => docker(['cp', origen, `${CONTENEDOR}:${destino}`]);
  const psql = (archivo) =>
    docker(['exec', CONTENEDOR, 'psql', '-U', 'postgres', '-q', '-v', 'ON_ERROR_STOP=1', '-f', archivo]);

  copiar(join(AQUI, '00-bootstrap.sql'), '/tmp/00-bootstrap.sql');
  copiar(join(AQUI, 'assertions.sql'), '/tmp/assertions.sql');
  for (const m of MIGRACIONES) copiar(join(RAIZ, 'migrations', m), `/tmp/${m}`);

  process.stdout.write('  lo que Supabase da por hecho … ');
  const boot = psql('/tmp/00-bootstrap.sql');
  if (boot.status !== 0) {
    console.log(`${C.rojo}falló${C.off}\n${boot.stderr}`);
    return 1;
  }
  console.log(`${C.verde}ok${C.off}`);

  for (const m of MIGRACIONES) {
    process.stdout.write(`  ${m} … `);
    const r = psql(`/tmp/${m}`);
    if (r.status !== 0) {
      console.log(`${C.rojo}falló${C.off}\n${r.stderr}`);
      return 1;
    }
    console.log(`${C.verde}ok${C.off}`);
  }

  const r = psql('/tmp/assertions.sql');
  const salida = `${r.stdout}${r.stderr}`
    .split('\n')
    .filter((l) => /✔|✖|──|ASERCIONES/.test(l))
    .map((l) => l.replace(/^psql:[^:]*:\d+: NOTICE:\s{2}/, ''))
    .join('\n');
  console.log(salida);

  if (r.status !== 0) {
    console.error(`\n${C.rojo}${C.bold}✖ Una aserción de SQL falló.${C.off}`);
    return 1;
  }
  console.log(`\n${C.verde}${C.bold}✔ El esquema de la bóveda hace lo que dice.${C.off}`);
  return 0;
}

let codigo = 1;
try {
  codigo = main();
} catch (e) {
  console.error(`${C.rojo}✖ ${e.message}${C.off}`);
} finally {
  limpiar();
}
process.exit(codigo);
