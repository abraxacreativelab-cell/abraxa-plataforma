#!/usr/bin/env node
/**
 * check-rutas-heredadas.mjs — ninguna ruta de disco heredada puede volver al código que se ejecuta.
 *
 * EL DEFECTO QUE VIGILA. Hasta el 2026-09-01 este repo traía `/Volumes/FRAGUA/CLAUDE CODE` escrito a
 * mano en scripts, plists, prompts y ledgers ejecutables. Mientras ese disco estuvo montado nada
 * falló; el día que no lo esté, falla todo a la vez — y falla en silencio, porque una ruta que no
 * existe se lee como «no hace falta», no como «se movió».
 *
 * QUÉ CUENTA COMO CÓDIGO QUE SE EJECUTA. Por extensión (`.ts`, `.mjs`, `.sh`, `.py`, `.plist`,
 * `.yaml`, `.json`…) y, en Markdown, por LÍNEA: una línea `CHECK:` de un ledger de gates, una línea
 * dentro de un bloque de código, o una que empieza por un comando (`cd`, `node`, `bash`, `cp`,
 * `ssh`…). Un `CAMBIOS.md` que narra la ruta vieja es historia; un `GATES.md` que hace `cd` a ella
 * es código, aunque los dos sean `.md`.
 *
 * QUÉ EXIGE. Cero ocurrencias sin justificar. Lo que queda vivo se declara en `RUTAS-HEREDADAS.md`:
 *   · en código ejecutable, LÍNEA POR LÍNEA, identificada por el sha1 de la línea recortada;
 *   · en documentos, archivo por archivo con su CUENTA EXACTA.
 * Una cuenta que sube es una ruta nueva; una que baja es un allowlist podrido. Las dos son rojo.
 *
 * Uso:
 *   node scripts/check-rutas-heredadas.mjs            verifica (exit 1 si hay algo sin justificar)
 *   node scripts/check-rutas-heredadas.mjs --sellar   reescribe el esqueleto del allowlist
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// El allowlist vive en la raíz, salvo donde el repo tenga un contrato de propiedad que reserve
// la raíz a otro carril (PLATAFORMA): ahí vive en `docs/`, que es del mismo dueño que este
// script. Escribir en el árbol ajeno para colocar un archivo de gobierno sería romper la regla
// que el gate defiende.
const ALLOWLIST = [join(REPO, 'RUTAS-HEREDADAS.md'), join(REPO, 'docs', 'RUTAS-HEREDADAS.md')]
  .find((ruta) => existsSync(ruta)) ?? join(REPO, 'RUTAS-HEREDADAS.md');
const SELLAR = process.argv.includes('--sellar');

/** La ruta heredada. Es un dato, no una regla: el día que haya otra, se añade aquí. */
const HEREDADAS = ['/Volumes/FRAGUA'];

const EXT_EJECUTABLE = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.sh', '.bash', '.zsh',
  '.py', '.plist', '.yaml', '.yml', '.json', '.toml', '.sql', '.rb',
]);

const COMANDO = /^\s*(?:cd|export|source|\.|bash|sh|zsh|node|npx|npm|python3?|cp|mv|rm|rsync|ssh|scp|curl|git|launchctl|plutil|sed|awk|grep|rg|psql|pm2|caffeinate|open)\b/;

function sha(texto) {
  return createHash('sha1').update(texto).digest('hex').slice(0, 12);
}

function archivosRastreados() {
  const salida = execFileSync('git', ['ls-files', '-z'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return salida.split('\0').filter(Boolean);
}

// Este archivo y su allowlist quedan FUERA del barrido, y hay que decir por qué o parece un
// agujero: el guardia contiene la aguja —`HEREDADAS` es literalmente la ruta que persigue— y el
// allowlist la cita en cada motivo. Incluirlos convierte el gate en una tautología que se acusa a
// sí misma, y peor: cada fila nueva del allowlist cambiaría la cuenta del propio allowlist, así que
// no habría número estable que declarar. Lo que sí se comprueba es que la exclusión sea EXACTA —
// dos archivos con nombre propio, no un glob— para que nadie esconda nada bajo ella.
const EXCLUIDOS = new Set([
  'scripts/check-rutas-heredadas.mjs',
  'RUTAS-HEREDADAS.md',
  'docs/RUTAS-HEREDADAS.md',
]);

/** Devuelve las ocurrencias de un archivo, cada una con su línea y si esa línea se ejecuta. */
function ocurrencias(rutaRelativa) {
  if (EXCLUIDOS.has(rutaRelativa)) return [];
  const absoluta = join(REPO, rutaRelativa);
  if (!existsSync(absoluta)) return [];
  let contenido;
  try {
    const bytes = readFileSync(absoluta);
    if (bytes.includes(0)) return []; // binario
    contenido = bytes.toString('utf8');
  } catch { return []; }
  if (!HEREDADAS.some((h) => contenido.includes(h))) return [];

  const esMarkdown = extname(rutaRelativa).toLowerCase() === '.md';
  const ejecutablePorExtension = EXT_EJECUTABLE.has(extname(rutaRelativa).toLowerCase());
  const encontradas = [];
  let dentroDeCerca = false;
  for (const [indice, linea] of contenido.split('\n').entries()) {
    if (esMarkdown && /^\s*(?:```|~~~)/.test(linea)) dentroDeCerca = !dentroDeCerca;
    const cuantas = HEREDADAS.reduce(
      (total, h) => total + linea.split(h).length - 1, 0,
    );
    if (!cuantas) continue;
    const recortada = linea.trim();
    const lineaEjecutable = ejecutablePorExtension
      || (esMarkdown && (dentroDeCerca || /^(?:CHECK|EXPECT):/.test(recortada) || COMANDO.test(recortada)));
    for (let i = 0; i < cuantas; i += 1) {
      encontradas.push({
        archivo: rutaRelativa,
        numero: indice + 1,
        sha: sha(recortada),
        extracto: recortada.slice(0, 70),
        ejecutable: lineaEjecutable,
      });
    }
  }
  return encontradas;
}

// ── El allowlist ────────────────────────────────────────────────────────────────────────────────
function leerAllowlist() {
  const ejecutable = new Map(); // `${archivo}#${sha}` -> { motivo, clase }
  const historia = new Map();   // archivo -> { cuenta, motivo }
  if (!existsSync(ALLOWLIST)) return { ejecutable, historia };
  let seccion = null;
  for (const linea of readFileSync(ALLOWLIST, 'utf8').split('\n')) {
    if (/^##\s+Ejecutable/i.test(linea)) { seccion = 'ejecutable'; continue; }
    if (/^##\s+Historia/i.test(linea)) { seccion = 'historia'; continue; }
    if (!seccion || !linea.startsWith('|')) continue;
    const celdas = linea.split('|').slice(1, -1).map((c) => c.trim());
    if (celdas.length < 3 || /^-+$/.test(celdas[0]) || celdas[0] === 'archivo') continue;
    if (seccion === 'ejecutable') {
      const [archivo, shaLinea, clase, motivo = ''] = celdas;
      ejecutable.set(`${archivo}#${shaLinea}`, { clase, motivo });
    } else {
      const [archivo, cuenta, motivo = ''] = celdas;
      historia.set(archivo, { cuenta: Number(cuenta), motivo });
    }
  }
  return { ejecutable, historia };
}

// `correccion-pendiente` es para la ruta vieja citada DENTRO del diff que la corrige: el día que
// alguien aplique ese diff, la línea desaparece y el gate marca la fila como entrada muerta. Es la
// única clase que se espera que caduque sola.
const CLASES = new Set([
  'patron-guardia', 'comentario', 'prueba-guardia', 'dato-historico', 'correccion-pendiente',
]);

function motivoValido(motivo) {
  return Boolean(motivo) && !/^TODO\b/i.test(motivo) && motivo.length >= 12;
}

// ── Verificación ────────────────────────────────────────────────────────────────────────────────
const todas = archivosRastreados().flatMap(ocurrencias);
const porArchivo = new Map();
for (const o of todas) {
  if (!porArchivo.has(o.archivo)) porArchivo.set(o.archivo, []);
  porArchivo.get(o.archivo).push(o);
}

// UNA sola definición de «este archivo se justifica línea por línea», usada por el sellado, por la
// verificación y por la detección de entradas muertas. Tenerla tres veces fue un bug real: el
// generador producía un allowlist que el verificador rechazaba.
const ARCHIVOS_EJECUTABLES = new Set(
  [...porArchivo.entries()].filter(([, os]) => os.some((o) => o.ejecutable)).map(([a]) => a),
);

if (SELLAR) {
  const archivosEjecutables = ARCHIVOS_EJECUTABLES;
  const ejecutables = todas.filter((o) => archivosEjecutables.has(o.archivo));
  const documentos = [...porArchivo.entries()].filter(([archivo]) => !archivosEjecutables.has(archivo));
  const lineas = [
    '# Rutas heredadas que sobreviven, justificadas una por una',
    '',
    'Generado con `node scripts/check-rutas-heredadas.mjs --sellar` y REVISADO a mano: el generador',
    'pone las filas, el motivo lo pone una persona. Un motivo que diga `TODO` cuenta como no',
    'justificado y deja el gate en rojo.',
    '',
    '## Ejecutable — línea por línea',
    '',
    'Clases admitidas: `patron-guardia` (la ruta es el dato de una lista de archivo/denegación),',
    '`comentario` (prosa dentro de código que narra el defecto), `prueba-guardia` (una aserción que',
    'exige que la ruta NO se use), `correccion-pendiente` (la ruta citada dentro del diff que la',
    'corrige), `dato-historico` (un registro fechado).',
    '',
    '| archivo | sha | clase | motivo |',
    '|---|---|---|---|',
    ...ejecutables.map((o) => `| ${o.archivo} | ${o.sha} | TODO | TODO (línea ${o.numero}: \`${o.extracto.replace(/\|/g, '\\|')}\`) |`),
    '',
    '## Historia — archivo por archivo, con su cuenta exacta',
    '',
    '| archivo | ocurrencias | motivo |',
    '|---|---|---|',
    ...documentos.map(([archivo, os]) => `| ${archivo} | ${os.length} | TODO |`),
    '',
  ];
  writeFileSync(ALLOWLIST, lineas.join('\n'));
  process.stdout.write(`sellado ${ALLOWLIST}: ${ejecutables.length} líneas ejecutables, ${documentos.length} documentos\n`);
  process.exit(0);
}

const { ejecutable: permitidasEjecutables, historia: permitidosDocumentos } = leerAllowlist();
const problemas = [];
let ejecutableSinJustificar = 0;
let documentoSinJustificar = 0;

for (const [archivo, os] of porArchivo) {
  if (!ARCHIVOS_EJECUTABLES.has(archivo)) {
    const fila = permitidosDocumentos.get(archivo);
    if (!fila) {
      documentoSinJustificar += os.length;
      problemas.push(`documento sin declarar: ${archivo} (${os.length} ocurrencias)`);
    } else if (fila.cuenta !== os.length) {
      documentoSinJustificar += Math.abs(fila.cuenta - os.length);
      problemas.push(`la cuenta de ${archivo} cambió: el allowlist dice ${fila.cuenta}, el árbol tiene ${os.length}`);
    } else if (!motivoValido(fila.motivo)) {
      documentoSinJustificar += os.length;
      problemas.push(`documento sin motivo real: ${archivo}`);
    }
    continue;
  }
  for (const o of os) {
    const fila = permitidasEjecutables.get(`${archivo}#${o.sha}`);
    if (!fila) {
      ejecutableSinJustificar += 1;
      problemas.push(`línea ejecutable sin justificar: ${archivo}:${o.numero} → ${o.extracto}`);
    } else if (!CLASES.has(fila.clase)) {
      ejecutableSinJustificar += 1;
      problemas.push(`clase desconocida "${fila.clase}" en ${archivo}:${o.numero}`);
    } else if (!motivoValido(fila.motivo)) {
      ejecutableSinJustificar += 1;
      problemas.push(`línea ejecutable sin motivo real: ${archivo}:${o.numero}`);
    }
  }
}

// El allowlist podrido también es rojo: una entrada que ya no corresponde a nada enseña a confiar
// en un documento que dejó de describir el árbol.
let allowlistObsoleto = 0;
const shasVivos = new Set(
  todas.filter((o) => ARCHIVOS_EJECUTABLES.has(o.archivo)).map((o) => `${o.archivo}#${o.sha}`),
);
for (const clave of permitidasEjecutables.keys()) {
  if (!shasVivos.has(clave)) { allowlistObsoleto += 1; problemas.push(`entrada muerta en el allowlist: ${clave}`); }
}
for (const archivo of permitidosDocumentos.keys()) {
  if (!porArchivo.has(archivo)) { allowlistObsoleto += 1; problemas.push(`documento muerto en el allowlist: ${archivo}`); }
}

const nombreRepo = process.env.REPO_NOMBRE
  || execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: REPO, encoding: 'utf8' }).trim().split('/').pop();

process.stdout.write(
  `repo=${nombreRepo} ocurrencias=${todas.length} archivos=${porArchivo.size} `
  + `ejecutable_sin_justificar=${ejecutableSinJustificar} `
  + `documento_sin_justificar=${documentoSinJustificar} `
  + `allowlist_obsoleto=${allowlistObsoleto}\n`,
);
for (const p of problemas.slice(0, 40)) process.stderr.write(`  · ${p}\n`);
if (problemas.length > 40) process.stderr.write(`  · … y ${problemas.length - 40} más\n`);
process.exit(problemas.length ? 1 : 0);
