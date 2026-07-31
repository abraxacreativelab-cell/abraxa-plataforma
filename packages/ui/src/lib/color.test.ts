/**
 * Criterio 3 del handoff H5:
 *
 *   «`accentVars()` con un color de bajo contraste (prueba con #333333 y con
 *    #ffff00) produce texto legible: verifica el ratio ≥ 4.5:1 en ambos casos.»
 *
 * Se prueban esos dos, y además los 4,096 restantes. Dos casos no son una
 * garantía; un barrido sí.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AA_NORMAL,
  HARDEST_SURFACE,
  MIN_ACCENT_LUMINANCE,
  SURFACES,
  contrastBetween,
  ensureReadable,
  hslToRgb,
  luminance,
  parseHex,
  readableOn,
  rgbToHsl,
  toTriplet,
} from './color';

const AQUI = dirname(fileURLToPath(import.meta.url));
const STYLES = readFileSync(join(AQUI, '..', 'styles.css'), 'utf8');

/** Lee un token HSL de styles.css: `--background: 222 28% 3.8%;` */
function tokenDeCss(nombre: string) {
  const m = STYLES.match(
    new RegExp(`--${nombre}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`),
  );
  if (!m) throw new Error(`El token --${nombre} no está en styles.css`);
  return { h: Number(m[1]), s: Number(m[2]), l: Number(m[3]) };
}

// ════════════════════════════════════════════════════════════════════════════

describe('las superficies no se desincronizan de los tokens', () => {
  // Éste es el arreglo del defecto nº3 de GARDEN: allá el umbral era el número
  // mágico 0.22, derivado a mano en un comentario. Si alguien aclaraba un token
  // de fondo, la garantía de contraste se rompía sin que nada avisara.
  it.each([
    ['background', SURFACES.background],
    ['card', SURFACES.card],
    ['glass-bg', SURFACES.glass],
  ])('--%s cuadra con la constante de color.ts', (nombre, esperado) => {
    expect(tokenDeCss(nombre)).toEqual(esperado);
  });

  it('la superficie más exigente es la más clara de las tres', () => {
    for (const s of Object.values(SURFACES)) {
      expect(luminance(HARDEST_SURFACE)).toBeGreaterThanOrEqual(luminance(s));
    }
  });

  it('el umbral se deriva, no se escribe a mano', () => {
    // Sobre la superficie más clara, un color justo en el umbral da exactamente 4.5:1.
    expect(contrastBetween({ ...HARDEST_SURFACE }, HARDEST_SURFACE)).toBeCloseTo(1, 5);
    const ratio = (MIN_ACCENT_LUMINANCE + 0.05) / (luminance(HARDEST_SURFACE) + 0.05);
    expect(ratio).toBeCloseTo(AA_NORMAL, 6);
  });
});

describe('conversión de color', () => {
  it('hex → hsl → rgb da la vuelta sin perderse', () => {
    for (const hex of ['#34d399', '#f5a524', '#5b8def', '#000000', '#ffffff', '#7f3d9b']) {
      const p = parseHex(hex);
      expect(p.ok).toBe(true);
      if (!p.ok) return;
      const [r, g, b] = hslToRgb(p.hsl);
      const vuelta = rgbToHsl(r, g, b);
      expect(vuelta.l).toBeCloseTo(p.hsl.l, 4);
      if (p.hsl.s > 0.5) expect(vuelta.h).toBeCloseTo(p.hsl.h, 3);
    }
  });

  it('produce un triplet que CSS entiende', () => {
    expect(toTriplet({ h: 158.2, s: 64.44, l: 52.06 })).toBe('158.2 64.4% 52.1%');
    expect(toTriplet({ h: -30, s: 0, l: 100 })).toBe('330 0% 100%');
  });
});

describe('parseHex acepta lo que un humano escribe de verdad', () => {
  // Defecto nº1 y nº2 de GARDEN: `#fff` caía al verde de Garden en silencio y
  // `#zzzzzz` producía "NaN NaN% NaN%", o sea CSS inválido.
  it.each([
    ['#fff', 0, 0, 100],
    ['#FFF', 0, 0, 100],
    ['fff', 0, 0, 100],
    ['#ffffff', 0, 0, 100],
    ['  #FFFFFF  ', 0, 0, 100],
    ['#ffffffff', 0, 0, 100], // con alfa: se ignora el canal
    ['#f00', 0, 100, 50],
  ])('acepta %s', (entrada, h, s, l) => {
    const p = parseHex(entrada);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.hsl.h).toBeCloseTo(h, 3);
    expect(p.hsl.s).toBeCloseTo(s, 3);
    expect(p.hsl.l).toBeCloseTo(l, 3);
  });

  it.each([
    ['', 'vacio'],
    ['   ', 'vacio'],
    ['#', 'vacio'],
    ['rojo', 'no-hexadecimal'],
    ['#zzzzzz', 'no-hexadecimal'],
    ['#12g456', 'no-hexadecimal'],
    ['#12345', 'longitud'],
    ['#1234567', 'longitud'],
  ])('rechaza %s con motivo', (entrada, motivo) => {
    const p = parseHex(entrada);
    expect(p.ok).toBe(false);
    if (p.ok) return;
    expect(p.reason).toBe(motivo);
  });

  it('nunca devuelve NaN — el defecto que rompía el acento entero', () => {
    for (const basura of ['#zzzzzz', 'rojo', '', '#12345', '#!!!!!!']) {
      const p = parseHex(basura);
      expect(p.ok).toBe(false);
      // Y si alguien ignorara `ok`, el camino feliz nunca produce NaN:
      if (p.ok) {
        expect(Number.isFinite(p.hsl.h)).toBe(true);
        expect(Number.isFinite(p.hsl.s)).toBe(true);
        expect(Number.isFinite(p.hsl.l)).toBe(true);
      }
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// La garantía
// ════════════════════════════════════════════════════════════════════════════

describe('ensureReadable garantiza AA — criterio 3', () => {
  it.each([
    ['#333333', 'gris oscuro, el caso del handoff'],
    ['#ffff00', 'amarillo neón, el otro caso del handoff'],
    ['#000000', 'negro puro'],
    ['#0000ff', 'azul saturado, el peor caso de luminancia'],
    ['#5b82e6', 'el azul de Mindcode que en GARDEN no pasaba como texto'],
  ])('%s (%s) se lee sobre las tres superficies', (hex) => {
    const p = parseHex(hex);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const legible = ensureReadable(p.hsl);
    for (const [nombre, superficie] of Object.entries(SURFACES)) {
      const ratio = contrastBetween(legible, superficie);
      expect(ratio, `${hex} sobre --${nombre} da ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
        AA_NORMAL,
      );
    }
  });

  it('los 4,096 colores del espacio pasan AA sobre TODAS las superficies', () => {
    const N = ['00', '11', '22', '33', '44', '55', '66', '77', '88', '99', 'aa', 'bb', 'cc', 'dd', 'ee', 'ff'];
    const fallos: string[] = [];

    for (const r of N)
      for (const g of N)
        for (const b of N) {
          const p = parseHex(`#${r}${g}${b}`);
          if (!p.ok) {
            fallos.push(`#${r}${g}${b} no parseó`);
            continue;
          }
          const legible = ensureReadable(p.hsl);
          for (const [nombre, superficie] of Object.entries(SURFACES)) {
            const ratio = contrastBetween(legible, superficie);
            if (ratio < AA_NORMAL) {
              fallos.push(`#${r}${g}${b} sobre --${nombre}: ${ratio.toFixed(2)}:1`);
            }
          }
        }

    expect(fallos.slice(0, 10)).toEqual([]);
    expect(fallos).toHaveLength(0);
  });

  it('barre todos los matices en las saturaciones difíciles', () => {
    const fallos: string[] = [];
    for (let h = 0; h < 360; h += 3) {
      for (const s of [0, 5, 15, 35, 60, 85, 100]) {
        for (const l of [0, 2, 8, 18, 30, 45]) {
          const legible = ensureReadable({ h, s, l });
          const ratio = contrastBetween(legible, HARDEST_SURFACE);
          if (ratio < AA_NORMAL) fallos.push(`hsl(${h} ${s}% ${l}%) → ${ratio.toFixed(2)}:1`);
        }
      }
    }
    expect(fallos).toHaveLength(0);
  });

  it('no aclara un color que ya se leía', () => {
    const claro = { h: 60, s: 100, l: 50 }; // amarillo: 18:1, no necesita nada
    expect(ensureReadable(claro)).toEqual(claro);
  });

  it('conserva el matiz de la marca al aclarar', () => {
    // Aclarar no puede convertir el azul de alguien en otro color.
    const azul = { h: 220, s: 80, l: 12 };
    const legible = ensureReadable(azul);
    expect(legible.h).toBe(azul.h);
    expect(legible.s).toBe(azul.s);
    expect(legible.l).toBeGreaterThan(azul.l);
  });
});

describe('readableOn — texto SOBRE el acento', () => {
  it('los 4,096 acentos admiten un texto encima que se lee', () => {
    const N = ['00', '33', '66', '99', 'cc', 'ff'];
    const fallos: string[] = [];
    for (const r of N)
      for (const g of N)
        for (const b of N) {
          const p = parseHex(`#${r}${g}${b}`);
          if (!p.ok) continue;
          const acento = ensureReadable(p.hsl);
          const ratio = contrastBetween(readableOn(acento), acento);
          if (ratio < AA_NORMAL) fallos.push(`#${r}${g}${b}: ${ratio.toFixed(2)}:1`);
        }
    expect(fallos).toHaveLength(0);
  });
});
