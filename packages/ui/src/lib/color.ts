/**
 * ════════════════════════════════════════════════════════════════════════════
 *  color.ts — el motor de contraste
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Portado de GARDEN (`garden-os/lib/brand.ts:74-143`). El algoritmo de aclarado
 *  es el suyo y funciona: lo auditamos con un barrido exhaustivo y no falla ni
 *  un color. Lo que cambia es el manejo de los bordes, donde sí fallaba:
 *
 *   1. GARDEN sólo aceptaba `#rrggbb`. `#fff` —CSS perfectamente válido— caía
 *      al verde de Garden EN SILENCIO. Aquí se aceptan 3, 4, 6 y 8 dígitos.
 *   2. GARDEN devolvía `"NaN NaN% NaN%"` con basura de entrada, lo que produce
 *      CSS inválido y rompe el acento entero. Aquí se valida y se devuelve el
 *      MOTIVO, para que Ajustes pueda decir "ese color no sirve" en vez de
 *      pintar otro color y callarse.
 *   3. GARDEN comparaba contra el umbral mágico `0.22`, derivado a mano en un
 *      comentario. Aquí el umbral se CALCULA desde la luminancia real de la
 *      superficie más clara, y `color.test.ts` lee `styles.css` y verifica que
 *      las constantes de este archivo sigan cuadrando con los tokens. Si
 *      alguien aclara un token, la prueba falla en vez de romperse en silencio.
 *   4. El bucle de GARDEN podía salir por su tope (`l < 86`) sin haber cumplido
 *      el umbral. Pasaba de milagro. Aquí nunca se devuelve un color que no
 *      cumple: si el aclarado no alcanza, cae a un neutro que sí.
 *
 *  Nada de esto es cosmético: el emprendedor escribe su color de marca a mano
 *  en Ajustes, así que todo esto es entrada de usuario.
 */

// ════════════════════════════════════════════════════════════════════════════
// Tipos
// ════════════════════════════════════════════════════════════════════════════

export interface Hsl {
  /** 0-360 */
  h: number;
  /** 0-100 */
  s: number;
  /** 0-100 */
  l: number;
}

export type HexParse =
  | { ok: true; hsl: Hsl }
  | { ok: false; reason: 'vacio' | 'longitud' | 'no-hexadecimal' };

/** Por qué falló un color, en español y en una línea. Lo muestra Ajustes. */
export const HEX_ERROR: Record<Exclude<HexParse, { ok: true }>['reason'], string> = {
  vacio: 'Escribe un color, por ejemplo #34d399.',
  longitud: 'Un color hexadecimal lleva 3, 4, 6 u 8 dígitos. Por ejemplo #34d399.',
  'no-hexadecimal': 'Sólo se permiten dígitos del 0 al 9 y letras de la A a la F.',
};

// ════════════════════════════════════════════════════════════════════════════
// Superficies — deben cuadrar con los tokens de styles.css
// ════════════════════════════════════════════════════════════════════════════

/**
 * Las tres superficies sobre las que puede caer texto con el acento.
 * `color.test.ts` las lee de `styles.css` y falla si dejan de coincidir: es lo
 * que impide que la garantía de contraste se rompa sin que nadie se entere.
 */
export const SURFACES = {
  background: { h: 222, s: 28, l: 3.8 },
  card: { h: 221, s: 22, l: 6.5 },
  glass: { h: 221, s: 24, l: 8 },
} as const satisfies Record<string, Hsl>;

/** Texto pequeño sobre fondo: 4.5:1. La regla de WCAG 2.1 nivel AA. */
export const AA_NORMAL = 4.5;
/** Texto grande y elementos de interfaz: 3:1. */
export const AA_LARGE = 3;

// ════════════════════════════════════════════════════════════════════════════
// Conversión
// ════════════════════════════════════════════════════════════════════════════

/**
 * Hex → HSL. Acepta `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, con o sin `#`, en
 * cualquier caja. El canal alfa se ignora a propósito: un acento translúcido
 * no puede garantizar contraste porque depende de lo que tenga debajo.
 *
 * NO redondea. GARDEN redondeaba a enteros aquí y volvía a parsear con una
 * expresión regular; cada vuelta perdía precisión.
 */
export function parseHex(input: string): HexParse {
  const raw = String(input ?? '')
    .trim()
    .replace(/^#/, '')
    .toLowerCase();

  if (!raw) return { ok: false, reason: 'vacio' };
  if (!/^[0-9a-f]+$/.test(raw)) return { ok: false, reason: 'no-hexadecimal' };
  if (![3, 4, 6, 8].includes(raw.length)) return { ok: false, reason: 'longitud' };

  // #rgb y #rgba → #rrggbb / #rrggbbaa
  const full =
    raw.length <= 4
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;

  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;

  return { ok: true, hsl: rgbToHsl(r, g, b) };
}

/** r/g/b en 0-1. */
export function rgbToHsl(r: number, g: number, b: number): Hsl {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }

  return { h: h * 360, s: s * 100, l: l * 100 };
}

/** HSL → r/g/b en 0-1. */
export function hslToRgb({ h, s, l }: Hsl): [number, number, number] {
  const S = s / 100;
  const L = l / 100;
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = L - c / 2;

  let rgb: [number, number, number];
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];

  return [rgb[0] + m, rgb[1] + m, rgb[2] + m];
}

/** El triplet que consume una variable CSS: `"158 64% 52%"`. */
export function toTriplet({ h, s, l }: Hsl): string {
  const round = (n: number) => Math.round(n * 10) / 10;
  return `${round(((h % 360) + 360) % 360)} ${round(s)}% ${round(l)}%`;
}

/**
 * HSL → `#rrggbb`.
 *
 * Hace falta donde un token CSS no se puede usar: la etiqueta `<meta name=
 * "theme-color">`, un lienzo, una gráfica en SVG. Son los pocos sitios donde un
 * hex es inevitable, y por eso conviene DERIVARLO del token en vez de
 * escribirlo a mano y que se desincronice.
 */
export function toHex(hsl: Hsl): string {
  return `#${hslToRgb(hsl)
    .map((v) =>
      Math.round(Math.min(1, Math.max(0, v)) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

// ════════════════════════════════════════════════════════════════════════════
// Contraste — WCAG 2.1
// ════════════════════════════════════════════════════════════════════════════

/** Luminancia relativa según WCAG 2.1. */
export function luminance(hsl: Hsl): number {
  const [r, g, b] = hslToRgb(hsl);
  const channel = (v: number) => {
    const u = Math.min(1, Math.max(0, v));
    return u <= 0.03928 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Razón de contraste entre dos luminancias. De 1:1 a 21:1. */
export function contrastRatio(a: number, b: number): number {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

/** Razón de contraste entre dos colores. */
export function contrastBetween(a: Hsl, b: Hsl): number {
  return contrastRatio(luminance(a), luminance(b));
}

/**
 * Luminancia mínima que necesita un color CLARO para dar `ratio` sobre un fondo
 * de luminancia `bg`. Esto es lo que en GARDEN era el `0.22` hardcodeado.
 */
export function minLuminanceOver(bg: number, ratio: number = AA_NORMAL): number {
  return ratio * (bg + 0.05) - 0.05;
}

/**
 * La superficie más exigente del sistema: la más clara de todas, porque es la
 * que menos contraste deja. Si el acento se lee sobre ésta, se lee sobre todas.
 */
export const HARDEST_SURFACE: Hsl = Object.values(SURFACES).reduce((peor, s) =>
  luminance(s) > luminance(peor) ? s : peor,
);

/** El umbral, derivado — no escrito a mano. */
export const MIN_ACCENT_LUMINANCE = minLuminanceOver(luminance(HARDEST_SURFACE), AA_NORMAL);

// ════════════════════════════════════════════════════════════════════════════
// La garantía
// ════════════════════════════════════════════════════════════════════════════

/** Neutro de rescate: gris claro. Sólo se usa si aclarar no bastó, lo cual no
 *  debería pasar nunca — pero devolver algo ilegible sí sería un defecto. */
const RESCATE: Hsl = { h: 0, s: 0, l: 78 };

/**
 * Sube la luminosidad hasta que el color se lea sobre la superficie más
 * exigente. Es el bucle de GARDEN, con tres diferencias: pasos de 0.5 en vez de
 * 2 (para no aclarar de más y perder el color de marca), tope en 95, y la
 * garantía **verificada** al salir en vez de asumida.
 *
 * Nunca devuelve un color que no cumple.
 */
export function ensureReadable(
  hsl: Hsl,
  ratio: number = AA_NORMAL,
  surface: Hsl = HARDEST_SURFACE,
): Hsl {
  const objetivo = minLuminanceOver(luminance(surface), ratio);
  const salida = { ...hsl };

  while (luminance(salida) < objetivo && salida.l < 95) {
    salida.l = Math.min(95, salida.l + 0.5);
  }

  // La verificación que GARDEN no hacía. Un color que sale del bucle por el
  // tope y no cumple es un fallo silencioso de accesibilidad.
  return luminance(salida) >= objetivo ? salida : RESCATE;
}

/**
 * El color de texto que se lee SOBRE un acento dado: casi negro o casi blanco,
 * el que gane. GARDEN dejaba `--primary-foreground` fijo en casi negro; con
 * todos los acentos que produce `ensureReadable` funciona, pero por casualidad,
 * no por diseño. Aquí se elige.
 */
export function readableOn(fondo: Hsl): Hsl {
  const casiNegro: Hsl = { h: 222, s: 47, l: 5 };
  const casiBlanco: Hsl = { h: 210, s: 30, l: 98 };
  return contrastBetween(casiNegro, fondo) >= contrastBetween(casiBlanco, fondo)
    ? casiNegro
    : casiBlanco;
}
