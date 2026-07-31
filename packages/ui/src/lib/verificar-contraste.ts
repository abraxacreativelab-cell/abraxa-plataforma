/* eslint-disable no-console -- es un guion de reporte: su salida ES el entregable. */
/**
 * Criterio 3 del handoff, impreso.
 *
 *   npx tsx packages/ui/src/lib/verificar-contraste.ts
 *
 * Las pruebas de `color.test.ts` ya afirman esto, pero afirmar no es enseñar:
 * esto imprime el ratio real de cada caso contra las tres superficies del
 * sistema, para poder mirarlo en vez de confiar en un ✓ verde.
 *
 * Sale con código 1 si algo no cumple, así que también sirve en CI.
 */

import {
  AA_NORMAL,
  HARDEST_SURFACE,
  MIN_ACCENT_LUMINANCE,
  SURFACES,
  contrastBetween,
  ensureReadable,
  luminance,
  parseHex,
  readableOn,
  toTriplet,
} from './color';
import { AREA_ACCENTS, DEFAULT_ACCENT, resolveAccent } from './accent';

const fila = (n: number) => n.toFixed(2).padStart(6);

console.log('╔══════════════════════════════════════════════════════════════════════════╗');
console.log('║  CRITERIO 3 · accentVars() garantiza WCAG AA (≥ 4.5:1)                   ║');
console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

console.log('Superficies del sistema (leídas de styles.css por color.test.ts):');
for (const [nombre, s] of Object.entries(SURFACES)) {
  console.log(`  --${nombre.padEnd(11)} hsl(${toTriplet(s).padEnd(16)})  luminancia ${luminance(s).toFixed(5)}`);
}
console.log(`\n  Superficie más exigente: hsl(${toTriplet(HARDEST_SURFACE)})`);
console.log(`  Umbral DERIVADO de ella: ${MIN_ACCENT_LUMINANCE.toFixed(5)}`);
console.log(`  (GARDEN usaba 0.22 escrito a mano en un comentario)\n`);

console.log('─────────────────────────────────────────────────────────────────────────');
console.log('  LOS DOS CASOS QUE PIDE EL HANDOFF');
console.log('─────────────────────────────────────────────────────────────────────────');
console.log('  entrada    →  acento resultante      background   card    glass   AA');

const casos = [
  ['#333333', 'gris oscuro'],
  ['#ffff00', 'amarillo neón'],
  ['#000000', 'negro puro'],
  ['#0000ff', 'azul saturado'],
  ['#5b82e6', 'azul Mindcode'],
  ['#fff', 'hex de 3 dígitos'],
] as const;

let todoBien = true;

for (const [hex, nota] of casos) {
  const p = parseHex(hex);
  if (!p.ok) {
    console.log(`  ${hex.padEnd(10)} →  RECHAZADO (${p.reason})`);
    continue;
  }
  const acento = ensureReadable(p.hsl);
  const ratios = Object.values(SURFACES).map((s) => contrastBetween(acento, s));
  const pasa = ratios.every((r) => r >= AA_NORMAL);
  todoBien &&= pasa;
  console.log(
    `  ${hex.padEnd(10)} →  hsl(${toTriplet(acento).padEnd(17)})` +
      ratios.map(fila).join('  ') +
      `   ${pasa ? '✅' : '❌'}   ${nota}`,
  );
}

console.log('\n─────────────────────────────────────────────────────────────────────────');
console.log('  TEXTO SOBRE EL ACENTO (--primary-foreground, que GARDEN dejaba fijo)');
console.log('─────────────────────────────────────────────────────────────────────────');
for (const [hex] of casos) {
  const p = parseHex(hex);
  if (!p.ok) continue;
  const acento = ensureReadable(p.hsl);
  const r = contrastBetween(readableOn(acento), acento);
  todoBien &&= r >= AA_NORMAL;
  console.log(`  ${hex.padEnd(10)} →  ${fila(r)}:1   ${r >= AA_NORMAL ? '✅' : '❌'}`);
}

console.log('\n─────────────────────────────────────────────────────────────────────────');
console.log('  LOS SEIS ACENTOS POR ÁREA');
console.log('─────────────────────────────────────────────────────────────────────────');
for (const [area, hex] of Object.entries(AREA_ACCENTS)) {
  const { ratio, hsl } = resolveAccent(hex);
  todoBien &&= ratio >= AA_NORMAL;
  console.log(
    `  ${area.padEnd(11)} ${hex}  →  matiz ${hsl.h.toFixed(0).padStart(3)}°   ` +
      `${fila(ratio)}:1  ${ratio >= AA_NORMAL ? '✅' : '❌'}`,
  );
}
const { ratio: rDef } = resolveAccent(DEFAULT_ACCENT);
console.log(`  ${'(default)'.padEnd(11)} ${DEFAULT_ACCENT}  →  acromático   ${fila(rDef)}:1  ${rDef >= AA_NORMAL ? '✅' : '❌'}`);

console.log('\n─────────────────────────────────────────────────────────────────────────');
console.log('  BARRIDO EXHAUSTIVO · 4,096 colores × 3 superficies = 12,288 comprobaciones');
console.log('─────────────────────────────────────────────────────────────────────────');

const N = ['00','11','22','33','44','55','66','77','88','99','aa','bb','cc','dd','ee','ff'];
let comprobaciones = 0;
let fallos = 0;
let peor = { hex: '', ratio: Infinity };

for (const r of N)
  for (const g of N)
    for (const b of N) {
      const hex = `#${r}${g}${b}`;
      const p = parseHex(hex);
      if (!p.ok) { fallos++; continue; }
      const acento = ensureReadable(p.hsl);
      for (const s of Object.values(SURFACES)) {
        const ratio = contrastBetween(acento, s);
        comprobaciones++;
        if (ratio < AA_NORMAL) fallos++;
        if (ratio < peor.ratio) peor = { hex, ratio };
      }
    }

todoBien &&= fallos === 0;
console.log(`  comprobaciones: ${comprobaciones.toLocaleString('es-MX')}`);
console.log(`  fallos:         ${fallos}`);
console.log(`  peor caso:      ${peor.hex} con ${peor.ratio.toFixed(2)}:1`);

console.log(`\n${todoBien ? '✅ CRITERIO 3 CUMPLIDO' : '❌ CRITERIO 3 INCUMPLIDO'}\n`);
process.exit(todoBien ? 0 : 1);
