#!/usr/bin/env node
/**
 * ════════════════════════════════════════════════════════════════════════════
 *  ownership-gate — el contrato de no colisión, en forma ejecutable.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  El 2026-07-30 se lanzaron cinco conversaciones a la vez sobre este repo y
 *  hubo dos colisiones reales el mismo día. Cuatro de ellas iban a crear cada
 *  una su propio `packages/db/ports.ts` y su propio `package.json` raíz.
 *
 *  Este guion es la razón por la que eso no vuelve a pasar. No pide permiso ni
 *  avisa: falla el PR diciendo QUÉ archivo se salió y DE QUIÉN es.
 *
 *  Cinco verificaciones:
 *    1. propiedad   — ningún archivo fuera de los globs del handoff
 *    2. migraciones — ningún NNN_ fuera de su bloque de 10
 *    3. lockfile    — sólo H1 lo mueve
 *    4. secretos    — ninguna llave en el diff
 *    5. migración sana — toda tabla nueva con tenant_id y RLS en el mismo archivo
 *
 *  Y aparte, `--check-overlap`, que revisa el mapa entero: que ningún archivo
 *  tenga dos dueños concurrentes y que ninguno se quede sin dueño.
 *
 *  Sin dependencias a propósito: corre antes de `npm ci`.
 *
 *  Uso:
 *    node scripts/ownership-gate.mjs [--handoff <rama>] [--base <ref>]
 *    node scripts/ownership-gate.mjs --check-overlap
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUTA_OWNERSHIP = join(RAIZ, '.ownership.json');

const R = { rojo: '[31m', verde: '[32m', ambar: '[33m', gris: '[90m', bold: '[1m', off: '[0m' };

const git = (...args) =>
  execFileSync('git', args, { cwd: RAIZ, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();

// ─────────────────────────────────────────────────────────────────────────────
// Globs → RegExp. Sin librerías: el gate tiene que correr sin node_modules.
// ─────────────────────────────────────────────────────────────────────────────
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') {
          i++;
          re += '(?:.*/)?'; // `**/` también casa con cero directorios
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

/** `true` si el archivo cae dentro del carril (respetando las exclusiones `!`). */
export function perteneceA(archivo, paths) {
  let dentro = false;
  for (const patron of paths) {
    const negado = patron.startsWith('!');
    const glob = negado ? patron.slice(1) : patron;
    if (globToRegExp(glob).test(archivo)) {
      if (negado) return false;
      dentro = true;
    }
  }
  return dentro;
}

const cargarOwnership = () => JSON.parse(readFileSync(RUTA_OWNERSHIP, 'utf8'));

/** Quién es dueño de un archivo. Devuelve la lista de handoffs que lo reclaman. */
export function duenosDe(archivo, ownership) {
  return Object.entries(ownership)
    .filter(([, cfg]) => perteneceA(archivo, cfg.paths))
    .map(([nombre]) => nombre);
}

// ─────────────────────────────────────────────────────────────────────────────
// Secretos. Patrones genéricos a propósito: ninguno casa con su propio texto.
// ─────────────────────────────────────────────────────────────────────────────
const PATRONES_SECRETO = [
  ['llave de OpenAI / Anthropic', /\bsk-[A-Za-z0-9_-]{20,}/],
  ['token de acceso de Supabase', /\bsbp_[A-Za-z0-9]{20,}/],
  ['secreto de webhook de Stripe', /\bwhsec_[A-Za-z0-9]{16,}/],
  ['llave secreta de Stripe', /\brk_live_[A-Za-z0-9]{16,}|\bsk_live_[A-Za-z0-9]{16,}/],
  ['token de GitHub', /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ['llave privada', /-----BEGIN [A-Z ]{0,20}PRIVATE KEY-----/],
  ['JWT (¿llave de Supabase?)', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{20,}\./],
  ['token de Slack', /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
];
/** Escotilla para fixtures y pruebas: escribe el marcador en la misma línea. */
const PERMISO_SECRETO = 'abraxa-allow-secret';

// ─────────────────────────────────────────────────────────────────────────────
// Migración sana: toda tabla nueva con tenant_id + RLS en el MISMO archivo.
// Es la regla que GARDEN rompió 145 veces. Aquí no depende de acordarse.
// ─────────────────────────────────────────────────────────────────────────────
export function revisarMigracion(sql, archivo) {
  const problemas = [];
  const lineas = sql.split('\n');
  const rlsActivo = new Set();

  for (const l of lineas) {
    const m = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?app\.("?)(\w+)\1\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.exec(l);
    if (m) rlsActivo.add(m[2].toLowerCase());
  }

  for (let i = 0; i < lineas.length; i++) {
    const m = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?app\.("?)(\w+)\1/i.exec(lineas[i]);
    if (!m) continue;
    const tabla = m[2].toLowerCase();

    // ¿Viene declarada como global? Hasta 3 líneas de comentario arriba.
    let exenta = false;
    for (let j = Math.max(0, i - 3); j < i; j++) {
      if (/--\s*tenantless\s*:/i.test(lineas[j])) exenta = true;
    }

    // Cuerpo de la definición, hasta el `);` que la cierra.
    let cuerpo = '';
    for (let j = i; j < lineas.length; j++) {
      cuerpo += lineas[j] + '\n';
      if (/^\s*\)\s*;/.test(lineas[j])) break;
    }

    if (!rlsActivo.has(tabla)) {
      problemas.push(
        `${archivo}: app.${tabla} se crea sin ENABLE ROW LEVEL SECURITY en el mismo archivo.\n` +
          `      Agrega:  ALTER TABLE app.${tabla} ENABLE ROW LEVEL SECURITY;`,
      );
    }
    if (!exenta && !/\btenant_id\b/i.test(cuerpo)) {
      problemas.push(
        `${archivo}: app.${tabla} no tiene columna tenant_id.\n` +
          `      Si de verdad es una tabla global (app.users, app.plans, app.billing_events…),\n` +
          `      decláralo poniendo justo antes del CREATE TABLE:  -- tenantless: <razón>`,
      );
    }
  }
  return problemas;
}

// ─────────────────────────────────────────────────────────────────────────────
function resolverHandoff(argv, ownership) {
  const iFlag = argv.indexOf('--handoff');
  const explicito = iFlag !== -1 ? argv[iFlag + 1] : null;
  const rama = explicito || process.env.GITHUB_HEAD_REF || git('rev-parse', '--abbrev-ref', 'HEAD');
  if (ownership[rama]) return { rama, cfg: ownership[rama] };

  console.error(`${R.rojo}${R.bold}✖ El gate no reconoce la rama '${rama}'.${R.off}

  Cada rama tiene que llamarse exactamente igual que su entrada en .ownership.json.
  Ramas válidas:
${Object.keys(ownership).map((k) => `    · ${k}`).join('\n')}

  Si esto es trabajo del orquestador (H0), abre el PR desde una rama con uno de
  esos nombres o pasa --handoff <rama>.`);
  process.exit(1);
}

function resolverBase(argv) {
  const iFlag = argv.indexOf('--base');
  if (iFlag !== -1) return argv[iFlag + 1];
  const base = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/main';
  try {
    return git('merge-base', base, 'HEAD');
  } catch {
    return git('rev-list', '--max-parents=0', 'HEAD').split('\n')[0];
  }
}

// ═════════════════════════════════════════════════════════════════════════════
function verificarPR(argv) {
  const ownership = cargarOwnership();
  const { rama, cfg } = resolverHandoff(argv, ownership);
  const base = resolverBase(argv);

  const cambiados = git('diff', '--name-only', '--diff-filter=ACMRTD', `${base}...HEAD`)
    .split('\n')
    .filter(Boolean);

  console.log(`${R.bold}ownership-gate${R.off} ${R.gris}·${R.off} ${cfg.label}`);
  console.log(`${R.gris}  rama ${rama} · base ${base.slice(0, 10)} · ${cambiados.length} archivo(s)${R.off}\n`);

  if (cambiados.length === 0) {
    console.log(`${R.ambar}Sin cambios contra la base. Nada que verificar.${R.off}`);
    return 0;
  }

  const fallas = [];

  // ── 1 y 2 · propiedad y migraciones ────────────────────────────────────────
  const [minMig, maxMig] = cfg.migrations ?? [null, null];

  for (const archivo of cambiados) {
    if (archivo === 'package-lock.json') continue; // regla 3, aparte

    if (archivo.startsWith('migrations/')) {
      const m = /^migrations\/(\d{3})_/.exec(archivo);
      if (!m) {
        // migrations/README.md y compañía siguen la regla de propiedad normal.
        if (!perteneceA(archivo, cfg.paths)) {
          fallas.push(`${archivo}\n      no es de ${rama}. ${atribuir(archivo, ownership, rama)}`);
        }
        continue;
      }
      const n = Number(m[1]);
      if (minMig === null) {
        fallas.push(
          `${archivo}\n      ${cfg.label} no tiene bloque de migraciones asignado. No creas ninguna.`,
        );
      } else if (n < minMig || n > maxMig) {
        const dueno = Object.entries(ownership).find(
          ([, c]) => c.migrations && n >= c.migrations[0] && n <= c.migrations[1],
        );
        fallas.push(
          `${archivo}\n      la migración ${m[1]} está fuera de tu bloque ` +
            `${String(minMig).padStart(3, '0')}–${String(maxMig).padStart(3, '0')}.` +
            (dueno ? ` Ese número es de ${dueno[0]} (${dueno[1].label}).` : ''),
        );
      }
      continue;
    }

    if (!perteneceA(archivo, cfg.paths)) {
      fallas.push(`${archivo}\n      no es de ${rama}. ${atribuir(archivo, ownership, rama)}`);
    }
  }

  // ── 3 · lockfile ───────────────────────────────────────────────────────────
  if (cambiados.includes('package-lock.json') && cfg.lockfile !== true) {
    fallas.push(
      `package-lock.json\n      sólo H1 mueve el lockfile. H1 instaló TODAS las dependencias por adelantado\n` +
        `      justo para que nadie tuviera que hacerlo. Si de verdad falta una, anótala en el PR\n` +
        `      y no la instales: dos ramas tocando el lockfile es un conflicto garantizado.`,
    );
  }

  // ── 4 · secretos ───────────────────────────────────────────────────────────
  const diff = git('diff', '--unified=0', `${base}...HEAD`);
  let archivoActual = '';
  for (const linea of diff.split('\n')) {
    if (linea.startsWith('+++ b/')) archivoActual = linea.slice(6);
    if (!linea.startsWith('+') || linea.startsWith('+++')) continue;
    if (linea.includes(PERMISO_SECRETO)) continue;
    for (const [etiqueta, patron] of PATRONES_SECRETO) {
      if (patron.test(linea)) {
        fallas.push(
          `${archivoActual}\n      posible ${etiqueta} en el diff. Los secretos viven en .env (gitignored).\n` +
            `      Si es un valor de prueba, ponle el marcador ${PERMISO_SECRETO} en la misma línea.`,
        );
        break;
      }
    }
  }

  // ── 5 · migración sana ─────────────────────────────────────────────────────
  for (const archivo of cambiados) {
    if (!/^migrations\/\d{3}_.*\.sql$/.test(archivo)) continue;
    const ruta = join(RAIZ, archivo);
    if (!existsSync(ruta)) continue; // borrado
    for (const p of revisarMigracion(readFileSync(ruta, 'utf8'), archivo)) fallas.push(p);
  }

  // ── veredicto ──────────────────────────────────────────────────────────────
  if (fallas.length === 0) {
    console.log(`${R.verde}✔ Dentro del carril.${R.off} Propiedad, migraciones, lockfile, secretos y RLS: en orden.`);
    return 0;
  }

  console.error(`${R.rojo}${R.bold}✖ ${fallas.length} problema(s):${R.off}\n`);
  for (const f of fallas) console.error(`  ${R.rojo}·${R.off} ${f}\n`);
  console.error(
    `${R.gris}El contrato completo está en CONTRIBUTING.md y en docs/handoffs/README.md.
Regla 1: escribe sólo en tu árbol. Regla 5: si necesitas algo de otro handoff,
usa su port en packages/db/ports.ts — no escribas su código.${R.off}`,
  );
  return 1;
}

function atribuir(archivo, ownership, ramaActual) {
  const otros = duenosDe(archivo, ownership).filter((d) => d !== ramaActual);
  if (otros.length === 0) {
    return 'No es de nadie todavía: anótalo en el PR para que H1 lo asigne en .ownership.json.';
  }
  return `Es de ${otros.map((o) => `${o} (${ownership[o].label})`).join(' y ')}.`;
}

// ═════════════════════════════════════════════════════════════════════════════
/** Revisa el mapa completo: sin dobles dueños concurrentes y sin huérfanos. */
function verificarSolapamiento() {
  const ownership = cargarOwnership();
  const archivos = git('ls-files').split('\n').filter(Boolean);

  const dobles = [];
  const huerfanos = [];

  for (const archivo of archivos) {
    if (archivo.startsWith('docs/') || archivo.startsWith('migrations/')) continue;
    const duenos = duenosDe(archivo, ownership);
    // H1 es el andamiador: crea archivos que después son de otro. Su solape es
    // legítimo porque mergea ANTES de que arranque nadie.
    const concurrentes = duenos.filter((d) => d !== 'h1-fundacion');
    if (concurrentes.length > 1) dobles.push(`${archivo}  →  ${concurrentes.join(', ')}`);
    if (duenos.length === 0) huerfanos.push(archivo);
  }

  console.log(`${R.bold}ownership-gate --check-overlap${R.off} ${R.gris}· ${archivos.length} archivos${R.off}\n`);

  if (dobles.length) {
    console.error(`${R.rojo}${R.bold}✖ Archivos con dos dueños concurrentes:${R.off}`);
    for (const d of dobles) console.error(`  · ${d}`);
    console.error('\n  Dos handoffs vivos apuntando al mismo archivo es un conflicto de merge programado.');
  }
  if (huerfanos.length) {
    console.error(`\n${R.rojo}${R.bold}✖ Archivos sin dueño:${R.off}`);
    for (const h of huerfanos) console.error(`  · ${h}`);
    console.error('\n  Nadie puede editarlos sin que falle su PR. Asígnalos en .ownership.json.');
  }
  if (dobles.length || huerfanos.length) return 1;

  console.log(`${R.verde}✔ Mapa de propiedad consistente.${R.off} Cada archivo con exactamente un dueño concurrente.`);
  return 0;
}

// ═════════════════════════════════════════════════════════════════════════════
const argv = process.argv.slice(2);
if (argv.includes('--check-overlap')) {
  process.exit(verificarSolapamiento());
} else if (process.argv[1] && process.argv[1].endsWith('ownership-gate.mjs')) {
  process.exit(verificarPR(argv));
}
