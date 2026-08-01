/**
 * ════════════════════════════════════════════════════════════════════════════
 *  accent.ts — el acento contextual por ÁREA
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  En GARDEN el acento se elegía por empresa del portafolio de ABRAXA. Aquí el
 *  emprendedor tiene UNA sola empresa, así que el acento distingue las ÁREAS de
 *  su negocio — y él puede sobrescribirlo con su color de marca.
 *
 *  `--primary`, `--accent`, `--ring` y `--glow` son UN MISMO token. Sobrescribir
 *  ese puñado de variables en un contenedor recolorea todo su subárbol: cada
 *  `text-primary`, `bg-primary`, `ring-*` y cada resplandor hereda solo. Por eso
 *  no hace falta un solo hex dentro de un componente.
 *
 *  Lo que NO está aquí, a propósito: success, warning, error e info. Son fijos.
 *  "Activo" no puede volverse rojo dentro de un área roja.
 */

import {
  AA_NORMAL,
  HARDEST_SURFACE,
  HEX_ERROR,
  type Hsl,
  contrastBetween,
  ensureReadable,
  parseHex,
  readableOn,
  toTriplet,
} from './color';

// ════════════════════════════════════════════════════════════════════════════
// La paleta por área
// ════════════════════════════════════════════════════════════════════════════

/**
 * Acento sugerido por área (handoff H5 §6). Son SUGERENCIAS: el color de marca
 * del emprendedor le gana a cualquiera de éstos.
 *
 * ── De dónde salen los slugs ────────────────────────────────────────────────
 *
 * No los inventamos: son los de `app.industry_templates.areas[].slug`, la
 * semilla que ya vive en la base (migración de H2) y con la que H11 va a
 * materializar el mapa de cada negocio. Los cinco giros sembrados usan entre
 * los siete: `ventas`, `marketing`, `operaciones`, `inventario`, `servicio`,
 * `finanzas` y `direccion`. Consultado en producción el 2026-08-01.
 *
 * `onboarding` y `rh` no están en esa semilla y se quedan: son del plan maestro
 * §5.3 y no cuestan nada tenerlos listos.
 *
 * Los nueve tonos están separados **más de 25° de matiz** y `accent.test.ts` lo
 * verifica: dos áreas que se ven del mismo color no distinguen nada. Los tonos
 * obvios de la tabla del handoff no cumplían —el cian de Servicio y la
 * esmeralda de Finanzas quedaban a 14°, indistinguibles en una barra lateral—
 * así que la paleta se redistribuyó conservando el nombre de cada color.
 *
 * Ninguno cae cerca del rojo a propósito: el rojo es el estado de error, que es
 * FIJO, y un área roja al lado de un fallo rojo no distingue nada.
 */
export const AREA_ACCENTS: Record<string, string> = {
  inventario: '#b5d651', // lima      ·  75°
  ventas: '#45d351', // verde crecimiento · 125°
  finanzas: '#1abc8c', // esmeralda ·  162°
  servicio: '#20c5ee', // cian      ·  192°
  onboarding: '#5d88ef', // azul    ·  222°
  rh: '#b38cf8', // violeta         ·  262°
  operaciones: '#db87e8', // orquídea · 292°
  marketing: '#eb7ac2', // rosa     ·  322°
  direccion: '#f5a524', // dorado    ·  37°
};

/**
 * El acento cuando no hay área ni marca: blanco luminoso frío.
 *
 * Es la ley visual leída al pie de la letra — *blanco luminoso primario, negro
 * frío, acento CONTEXTUAL*. Sin contexto no hay color: la interfaz arranca
 * acromática y se tiñe al entrar a un área o al fijar la marca. Además es el
 * único valor que no choca con ninguna de las seis áreas.
 */
export const DEFAULT_ACCENT = '#d2d8e0'; // 214.3° 18.4% 85.1% — casi neutro

// ════════════════════════════════════════════════════════════════════════════
// Las variables
// ════════════════════════════════════════════════════════════════════════════

/** Las variables CSS que recolorean un subárbol. */
export type AccentVars = Record<string, string>;

export interface AccentResult {
  /** `false` si el hex venía mal. Las variables igual sirven: caen al default. */
  ok: boolean;
  /** Mensaje en español listo para mostrar, si `ok` es `false`. */
  error: string | null;
  vars: AccentVars;
  /** El acento ya legible, por si algo necesita el color y no la variable. */
  hsl: Hsl;
  /** Contraste real contra la superficie más exigente. Para pruebas y para
   *  que Ajustes pueda enseñar "este color se lee 6.2 a 1". */
  ratio: number;
}

/**
 * Convierte un color en el juego de variables del acento, **garantizando que se
 * lee**: si el hex es muy oscuro para texto pequeño sobre el fondo frío, se
 * aclara hasta cumplir 4.5:1. Si alguien pone amarillo neón, el texto sigue
 * siendo legible.
 *
 * Devuelve además el motivo cuando el color no era válido, para que la pantalla
 * de Ajustes lo diga en vez de pintar otro color sin avisar (que es lo que
 * hacía GARDEN).
 */
export function resolveAccent(input: string | null | undefined): AccentResult {
  const parsed = parseHex(input ?? '');

  const [hsl, ok, error] = parsed.ok
    ? [parsed.hsl, true, null]
    : [(parseHex(DEFAULT_ACCENT) as { ok: true; hsl: Hsl }).hsl, false, HEX_ERROR[parsed.reason]];

  const legible = ensureReadable(hsl, AA_NORMAL);
  const triplet = toTriplet(legible);
  const sobre = toTriplet(readableOn(legible));

  return {
    ok,
    error,
    hsl: legible,
    ratio: contrastBetween(legible, HARDEST_SURFACE),
    vars: {
      // Los cuatro son EL MISMO token. Cambiar uno solo desincroniza el sistema.
      '--primary': triplet,
      '--accent': triplet,
      '--ring': triplet,
      '--glow': triplet,
      // Texto encima del acento. GARDEN lo dejaba fijo; aquí se elige el que
      // más contraste dé, así ningún color de marca deja un botón ilegible.
      '--primary-foreground': sobre,
      '--accent-foreground': sobre,
      // El hex original, sin aclarar, para superficies que no llevan texto
      // (puntos, gráficas, chips grandes). Ahí sí se respeta la marca tal cual.
      '--accent-raw': parsed.ok ? normalizeHex(input ?? '') : DEFAULT_ACCENT,
    },
  };
}

/** Atajo cuando sólo hacen falta las variables. */
export function accentVars(input: string | null | undefined): AccentVars {
  return resolveAccent(input).vars;
}

/**
 * El acento que le toca a un área, con la precedencia del producto:
 *
 *   marca del emprendedor  →  color sugerido del área  →  blanco luminoso
 *
 * La marca gana siempre: si él eligió su color, el producto es de su color en
 * todas partes. Los tonos por área sólo existen mientras no haya marca.
 */
export function accentForArea(
  areaSlug: string | null | undefined,
  brandOverride?: string | null,
): AccentResult {
  if (brandOverride) {
    const marca = resolveAccent(brandOverride);
    if (marca.ok) return marca;
    // Marca inválida: no se rompe la interfaz, se sigue con el área y el motivo
    // viaja para que Ajustes lo muestre.
    const area = resolveAccent(AREA_ACCENTS[areaSlug ?? ''] ?? DEFAULT_ACCENT);
    return { ...area, ok: false, error: marca.error };
  }
  return resolveAccent(AREA_ACCENTS[areaSlug ?? ''] ?? DEFAULT_ACCENT);
}

// ════════════════════════════════════════════════════════════════════════════
// Interno
// ════════════════════════════════════════════════════════════════════════════

/** `#ABC` → `#aabbcc`. Para que `--accent-raw` sea siempre un hex de 6 dígitos. */
function normalizeHex(input: string): string {
  const raw = input.trim().replace(/^#/, '').toLowerCase();
  const full =
    raw.length <= 4
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  return `#${full.slice(0, 6)}`;
}
