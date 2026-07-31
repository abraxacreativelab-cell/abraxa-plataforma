/**
 * Los pocos literales de color que NO pueden ser una variable CSS, verificados
 * contra el token del que salieron.
 *
 * Son dos, y los dos se desincronizarían en silencio: el `themeColor` de la
 * metadata de Next —que se serializa a un `<meta>` antes de que exista una hoja
 * de estilos— y el `--primary` por defecto de `:root`, que tiene que ser el
 * mismo color que `DEFAULT_ACCENT` o se ve un parpadeo antes de hidratar.
 *
 * Es la misma idea que la del umbral de contraste: si el valor se deriva de
 * otro, que lo verifique una prueba y no un comentario.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseHex, toHex, toTriplet } from './color';
import { DEFAULT_ACCENT } from './accent';

const AQUI = dirname(fileURLToPath(import.meta.url));
const STYLES = readFileSync(join(AQUI, '..', 'styles.css'), 'utf8');
const LAYOUT = readFileSync(
  join(AQUI, '..', '..', '..', '..', 'apps', 'web', 'app', 'layout.tsx'),
  'utf8',
);

function token(nombre: string) {
  const m = STYLES.match(new RegExp(`--${nombre}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`));
  if (!m) throw new Error(`El token --${nombre} no está en styles.css`);
  return { h: Number(m[1]), s: Number(m[2]), l: Number(m[3]) };
}

describe('themeColor de la metadata', () => {
  it('es exactamente el hex de --background', () => {
    const enLayout = LAYOUT.match(/themeColor:\s*'(#[0-9a-fA-F]{6})'/)?.[1];
    expect(enLayout, 'no se encontró themeColor en apps/web/app/layout.tsx').toBeTruthy();
    expect(enLayout!.toLowerCase()).toBe(toHex(token('background')));
  });
});

describe('el acento por defecto de :root', () => {
  it('es exactamente el HSL de DEFAULT_ACCENT', () => {
    const p = parseHex(DEFAULT_ACCENT);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(toTriplet(token('primary'))).toBe(toTriplet(p.hsl));
  });

  it('los cuatro tokens del acento arrancan sincronizados', () => {
    const valores = ['primary', 'accent', 'ring', 'glow'].map((n) => toTriplet(token(n)));
    expect(new Set(valores).size).toBe(1);
  });

  it('--accent-raw es el mismo color, en hex', () => {
    const raw = STYLES.match(/--accent-raw:\s*(#[0-9a-f]{6})/i)?.[1];
    expect(raw?.toLowerCase()).toBe(DEFAULT_ACCENT.toLowerCase());
  });
});

describe('toHex', () => {
  it('da la vuelta completa desde un hex', () => {
    for (const hex of ['#000000', '#ffffff', '#45d351', '#f5a524', '#1abc8c']) {
      const p = parseHex(hex);
      expect(p.ok).toBe(true);
      if (!p.ok) return;
      expect(toHex(p.hsl)).toBe(hex);
    }
  });
});
