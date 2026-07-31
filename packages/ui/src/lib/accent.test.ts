/**
 * Criterios 2 y 4 del handoff H5:
 *
 *   2. «Cambiar el acento de un área recolorea toda la subárbol sin tocar un
 *       solo hex.»
 *   4. «Los estados semánticos no cambian con el acento: `success` sigue verde
 *       dentro de un área roja.»
 *
 * El último bloque va más lejos y verifica la regla sobre el CÓDIGO FUENTE: si
 * alguien mete un hex o un color crudo de la paleta de Tailwind en un
 * componente, esta prueba falla y lo nombra. Es la regla que GARDEN escribió y
 * después incumplió en su propio `badge.tsx`.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AA_NORMAL, SURFACES, contrastBetween, parseHex } from './color';
import { AREA_ACCENTS, DEFAULT_ACCENT, accentForArea, accentVars, resolveAccent } from './accent';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SRC = join(AQUI, '..');
const STYLES = readFileSync(join(SRC, 'styles.css'), 'utf8');

/** Los cuatro tokens que SON el acento. Cambiar uno solo desincroniza todo. */
const TOKENS_DE_ACENTO = ['--primary', '--accent', '--ring', '--glow'];

/** Los que JAMÁS deben aparecer en el acento. */
const TOKENS_SEMANTICOS = [
  '--color-success',
  '--color-success-fg',
  '--color-success-bg',
  '--color-success-border',
  '--color-warning',
  '--color-warning-fg',
  '--color-warning-bg',
  '--color-warning-border',
  '--color-error',
  '--color-error-fg',
  '--color-error-bg',
  '--color-error-border',
  '--color-info',
  '--color-info-fg',
  '--color-info-bg',
  '--color-info-border',
];

// ════════════════════════════════════════════════════════════════════════════

describe('el acento es UN token — criterio 2', () => {
  it('los cuatro tokens salen con el mismo valor', () => {
    const vars = accentVars('#e5484d');
    const valores = TOKENS_DE_ACENTO.map((t) => vars[t]);
    expect(new Set(valores).size).toBe(1);
  });

  it('recolorear un área no toca ningún otro token de superficie', () => {
    const vars = accentVars('#22d3ee');
    for (const prohibido of ['--background', '--foreground', '--card', '--border', '--muted']) {
      expect(vars[prohibido]).toBeUndefined();
    }
  });

  it('el valor es un triplet HSL, no un hex — así lo hereda todo el subárbol', () => {
    for (const token of TOKENS_DE_ACENTO) {
      expect(accentVars('#4ade80')[token]).toMatch(/^[\d.]+ [\d.]+% [\d.]+%$/);
    }
  });
});

describe('los estados semánticos NO siguen al acento — criterio 4', () => {
  it('accentVars no emite ni uno solo de los 16 tokens semánticos', () => {
    // Un área roja (Rito, en el ejemplo original de GARDEN) no puede volver
    // rojo el "activo".
    const enAreaRoja = accentVars('#e5484d');
    for (const token of TOKENS_SEMANTICOS) {
      expect(enAreaRoja[token], `${token} no puede venir del acento`).toBeUndefined();
    }
  });

  it('los 16 tokens semánticos están definidos en :root', () => {
    const root = STYLES.slice(STYLES.indexOf(':root'), STYLES.indexOf('}', STYLES.indexOf(':root')));
    for (const token of TOKENS_SEMANTICOS) {
      expect(root, `falta ${token} en :root`).toContain(`${token}:`);
    }
  });

  it('ningún bloque [data-accent] redefine un token semántico', () => {
    // Si algún día alguien mete los semánticos bajo el scope del acento, aquí se
    // cae la prueba antes de que "activo" se vuelva rojo en producción.
    const bloques = STYLES.match(/\[data-accent\][^{]*\{[^}]*\}/g) ?? [];
    for (const bloque of bloques) {
      for (const token of TOKENS_SEMANTICOS) {
        expect(bloque, `[data-accent] no puede tocar ${token}`).not.toContain(token);
      }
    }
  });

  it('success sigue siendo verde y error sigue siendo rojo', () => {
    const hue = (nombre: string) => {
      const m = STYLES.match(new RegExp(`--color-${nombre}:\\s*([\\d.]+)`));
      return m ? Number(m[1]) : NaN;
    };
    expect(hue('success')).toBeGreaterThan(90); // verde
    expect(hue('success')).toBeLessThan(180);
    expect(hue('warning')).toBeGreaterThan(20); // ámbar
    expect(hue('warning')).toBeLessThan(60);
    const error = hue('error'); // rojo: cerca de 0 o de 360
    expect(error < 20 || error > 340).toBe(true);
  });
});

describe('la paleta por área', () => {
  it('las seis áreas tienen acento y todos se leen', () => {
    for (const [area, hex] of Object.entries(AREA_ACCENTS)) {
      const { vars, ratio, ok } = resolveAccent(hex);
      expect(ok, `${area}: ${hex} no es un hex válido`).toBe(true);
      expect(ratio, `${area} da ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_NORMAL);
      expect(vars['--primary']).toBeTruthy();
    }
  });

  it('las cuatro áreas de v1 están declaradas', () => {
    for (const area of ['ventas', 'direccion', 'onboarding', 'servicio']) {
      expect(AREA_ACCENTS[area]).toBeTruthy();
    }
  });

  it('ningún par de áreas se ve del mismo color', () => {
    // Dos áreas indistinguibles no distinguen nada. 25° de matiz es el mínimo
    // que se aprecia de un vistazo en una barra lateral.
    const tonos = Object.entries(AREA_ACCENTS).map(([area, hex]) => {
      const p = parseHex(hex);
      if (!p.ok) throw new Error(`${area}: hex inválido`);
      return { area, h: p.hsl.h };
    });

    tonos.forEach((a, i) => {
      for (const b of tonos.slice(i + 1)) {
        const bruto = Math.abs(a.h - b.h);
        const distancia = Math.min(bruto, 360 - bruto);
        expect(
          distancia,
          `${a.area} y ${b.area} están a ${distancia.toFixed(0)}° de matiz`,
        ).toBeGreaterThan(25);
      }
    });
  });

  it('el acento por defecto es acromático — sin contexto no hay color', () => {
    const p = parseHex(DEFAULT_ACCENT);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.hsl.s).toBeLessThan(30);
    expect(contrastBetween(p.hsl, SURFACES.glass)).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});

describe('precedencia: marca del emprendedor → área → acromático', () => {
  it('la marca le gana al color del área', () => {
    const conMarca = accentForArea('ventas', '#e5484d');
    const sinMarca = accentForArea('ventas');
    expect(conMarca.vars['--primary']).not.toBe(sinMarca.vars['--primary']);
    expect(conMarca.vars['--accent-raw']).toBe('#e5484d');
  });

  it('sin marca manda el área', () => {
    expect(accentForArea('servicio').vars['--primary']).toBe(
      resolveAccent(AREA_ACCENTS.servicio).vars['--primary'],
    );
  });

  it('sin marca y sin área queda el acromático', () => {
    expect(accentForArea(null).vars['--primary']).toBe(
      resolveAccent(DEFAULT_ACCENT).vars['--primary'],
    );
    expect(accentForArea('un-area-que-no-existe').vars['--primary']).toBe(
      resolveAccent(DEFAULT_ACCENT).vars['--primary'],
    );
  });

  it('una marca inválida no rompe la interfaz, pero sí se reporta', () => {
    // GARDEN pintaba verde y se callaba. Aquí se sigue con el color del área y
    // el motivo viaja para que Ajustes lo muestre.
    const r = accentForArea('ventas', '#zzzzzz');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('0 al 9');
    expect(r.vars['--primary']).toBe(resolveAccent(AREA_ACCENTS.ventas).vars['--primary']);
  });

  it.each(['', '   ', '#12345', 'azul', '#'])('la basura %j nunca produce CSS inválido', (basura) => {
    const vars = accentVars(basura);
    for (const token of TOKENS_DE_ACENTO) {
      expect(vars[token]).toMatch(/^[\d.]+ [\d.]+% [\d.]+%$/);
      expect(vars[token]).not.toContain('NaN');
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// La regla, aplicada al código fuente
// ════════════════════════════════════════════════════════════════════════════

function archivosFuente(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) return archivosFuente(ruta);
    return /\.tsx?$/.test(e.name) && !e.name.endsWith('.test.ts') ? [ruta] : [];
  });
}

describe('cero hex en los componentes', () => {
  const componentes = archivosFuente(join(SRC, 'components'));

  it('hay componentes que revisar', () => {
    expect(componentes.length).toBeGreaterThan(10);
  });

  it('ningún componente lleva un color hexadecimal', () => {
    const infractores: string[] = [];
    for (const ruta of componentes) {
      const fuente = readFileSync(ruta, 'utf8');
      for (const [i, linea] of fuente.split('\n').entries()) {
        // Se ignoran los comentarios: nombrar un hex al explicar algo está bien.
        if (/^\s*(\/\/|\*|\/\*)/.test(linea)) continue;
        const m = linea.match(/#[0-9a-fA-F]{3,8}\b/);
        if (m) infractores.push(`${relative(SRC, ruta)}:${i + 1} → ${m[0]}`);
      }
    }
    expect(infractores).toEqual([]);
  });

  it('ningún componente usa un color crudo de la paleta de Tailwind', () => {
    // El defecto exacto de GARDEN: `badge.tsx` definía `success` por token pero
    // `warning` e `info` con `amber-500` y `sky-500` crudos. Los tokens
    // semánticos existían y no se usaban.
    const PALETA =
      '(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)';
    const patron = new RegExp(`\\b(bg|text|border|ring|from|to|via|fill|stroke)-${PALETA}-\\d{2,3}\\b`);

    const infractores: string[] = [];
    for (const ruta of componentes) {
      const fuente = readFileSync(ruta, 'utf8');
      for (const [i, linea] of fuente.split('\n').entries()) {
        if (/^\s*(\/\/|\*|\/\*)/.test(linea)) continue;
        const m = linea.match(patron);
        if (m) infractores.push(`${relative(SRC, ruta)}:${i + 1} → ${m[0]}`);
      }
    }
    expect(infractores).toEqual([]);
  });
});

describe('toda animación respeta prefers-reduced-motion — criterio 8', () => {
  it('cada @keyframes de styles.css tiene su bloque de reducción', () => {
    const keyframes = [...STYLES.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
    expect(keyframes.length).toBeGreaterThan(0);

    const reduce = STYLES.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)/g) ?? [];
    expect(reduce.length).toBeGreaterThan(0);

    // La red global: `animation: none` para todo lo que anime, dentro del media query.
    const bloqueGlobal = STYLES.slice(STYLES.indexOf('prefers-reduced-motion'));
    expect(bloqueGlobal).toMatch(/animation[^;]*none|animation-duration/);
  });
});
