/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Extracción DETERMINISTA de cifras desde un documento en markdown.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Portado de GARDEN `src/crm/pricing/service.ts:23-55` (`parsePricingDoc`).
 *  El handoff no lo menciona, y es la pieza que hace que toda la ingesta
 *  funcione SIN modelo: los números —lo único que de verdad no se puede
 *  alucinar— salen de un regex, no de un LLM.
 *
 *  Reconoce dos formas, que son como escribe la gente de verdad:
 *
 *      - onboarding_fee: $8,500 — se descuenta del primer pago
 *      - **Comisión** (comision_pct): 20% — sobre la base neta
 *      | concepto        | monto   | nota            |
 *      | costo_chapa     | $2,300  | por propiedad   |
 *
 *  ── Tres reglas que parecen detalles y no lo son ────────────────────────────
 *
 *  1. UN BULLET SIN CIFRA NO ES UN VALOR. `- Contacto: Karen` se descarta.
 *     Sin esta regla la bóveda se llena de basura y el emprendedor tiene que
 *     rechazar treinta borradores para encontrar los tres que importan.
 *
 *  2. UN RANGO NO TIENE VALOR ÚNICO. `de $400,000 a $600,000` se registra con
 *     `value = null` y la nota completa. Guardar 400000 a secas convertiría un
 *     rango en un precio, y ese precio acabaría en una cotización.
 *
 *  3. `TBD` / `pendiente` / `por definir` SE REGISTRAN SIN VALOR. Que el
 *     emprendedor vea la clave en su lista de pendientes es justo el punto:
 *     un hueco declarado vale más que una clave que nadie sabe que falta.
 *
 *  ── Dos cosas que aquí se arreglaron respecto a GARDEN ──────────────────────
 *
 *  A. GARDEN cortaba el valor en el primer `-` (`[^—|-]+?`), así que
 *     `- paquete: $1,500 - $2,000` capturaba sólo `$1,500`, la detección de
 *     rango no se disparaba y el valor quedaba registrado como 1500. Un rango
 *     convertido en precio, en silencio. Aquí la nota se separa sólo con raya
 *     (— o –), y el guion se queda dentro del valor para que el rango se
 *     detecte.
 *
 *  B. Se extraen también PORCENTAJES. `comision_pct: 20%` es tan determinista
 *     como un monto, y sacarlos del regex en vez de del modelo hace que la
 *     ingesta sin credenciales de IA siga entregando lo que más importa.
 */

export interface CifraExtraida {
  key: string;
  kind: 'money' | 'percent';
  value: number | null;
  currency: string;
  label: string | null;
  note: string | null;
  /** `true` si el documento dice explícitamente que está por definirse. */
  pendiente: boolean;
}

const CLAVE_VALIDA = /^[a-z][a-z0-9_]*$/;

/** Monto con separadores de miles o decimales: `1,234.50` · `1 234` · `99.9`. */
const MONTO = /\$?\s*(\d{1,3}(?:[,\s]\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)/;

/** Porcentaje explícito: `20%`, `20 %`, `20 por ciento`. */
const PORCENTAJE = /(\d+(?:[.,]\d+)?)\s*(?:%|por\s?ciento)/i;

const PENDIENTE = /\btbd\b|pendiente|por\s+definir|por\s+confirmar|\?\?/i;

/**
 * Bullet: `- clave: valor — nota` con etiqueta opcional en negritas.
 * La nota se separa SÓLO con raya larga o corta (— –). Ver nota A arriba.
 */
const BULLET =
  /^\s*[-*]\s*(?:\*\*(.+?)\*\*\s*)?\(?([a-záéíóúñü0-9_ ]+?)\)?\s*:\s*([^—–|]+?)(?:\s*[—–]\s*(.+))?\s*$/i;

/** Fila de tabla markdown: `| clave | valor | nota |`. */
const FILA_TABLA = /^\s*\|\s*([a-záéíóúñü0-9_ *]+?)\s*\|\s*([^|]+?)\s*\|(?:\s*([^|]*?)\s*\|)?\s*$/i;

/** Separador de tabla (`|---|---|`) y encabezados: no son datos. */
const SEPARADOR_TABLA = /^[-\s:|]+$/;
const ENCABEZADO_TABLA = /\b(clave|concepto|key|campo|item|descripci[óo]n)\b/i;

export function parsePricingDoc(content: string): CifraExtraida[] {
  const out: CifraExtraida[] = [];
  const vistas = new Set<string>();

  const registrar = (
    claveCruda: string,
    valorCrudo: string,
    notaCruda?: string,
    etiquetaCruda?: string,
  ): void => {
    const key = normalizarClave(claveCruda);
    if (!key || !CLAVE_VALIDA.test(key) || vistas.has(key)) return;

    const valor = String(valorCrudo ?? '').trim();
    if (!valor) return;

    const pendiente = PENDIENTE.test(valor);
    const rango = esRango(valor);

    // Porcentaje primero: "20%" también casa con el regex de monto, y un
    // porcentaje registrado como dinero produce "$20" en un contrato.
    const mPct = valor.match(PORCENTAJE);
    if (mPct?.[1] && !rango && !pendiente) {
      const n = Number(mPct[1].replace(',', '.'));
      if (Number.isFinite(n)) {
        vistas.add(key);
        out.push({
          key,
          kind: 'percent',
          value: n,
          currency: 'MXN',
          label: etiquetaCruda?.trim() || null,
          note: notaCruda?.trim() || null,
          pendiente: false,
        });
        return;
      }
    }

    const mMonto = valor.match(MONTO);
    let value: number | null = null;
    if (!pendiente && !rango && mMonto?.[1]) {
      const n = Number(mMonto[1].replace(/[,\s]/g, ''));
      if (Number.isFinite(n)) value = n;
    }

    // Regla 1: sin cifra, sin rango y sin declararse pendiente, no es un valor.
    if (value === null && !pendiente && !rango) return;

    vistas.add(key);
    out.push({
      key,
      kind: 'money',
      value,
      currency: /\busd\b|us\$/i.test(valor) ? 'USD' : 'MXN',
      label: etiquetaCruda?.trim() || null,
      // Un rango o un pendiente pierden el número, así que el texto original
      // se conserva: es la única pista que le queda al emprendedor.
      note: notaCruda?.trim() || (value === null ? valor : null),
      pendiente,
    });
  };

  for (const linea of String(content ?? '').split('\n')) {
    const bullet = linea.match(BULLET);
    if (bullet?.[2] && bullet[3]) {
      registrar(bullet[2], bullet[3], bullet[4], bullet[1]);
      continue;
    }

    if (SEPARADOR_TABLA.test(linea)) continue;
    const fila = linea.match(FILA_TABLA);
    if (fila?.[1] && fila[2] && !ENCABEZADO_TABLA.test(fila[1])) {
      registrar(fila[1].replace(/\*/g, ''), fila[2], fila[3]);
    }
  }

  return out;
}

/**
 * Un rango declarado: dos cifras unidas por "a", "entre…y", "hasta" o guion.
 * Se comprueba que haya DOS cifras de verdad; si no, `de 1 a 3 días` con una
 * sola cifra no debería descalificar al valor.
 */
function esRango(valor: string): boolean {
  const cifras = valor.match(/\$?\s*\d[\d,\s.]*/g) ?? [];
  if (cifras.length < 2) return false;
  return /\b(a|entre|hasta|y)\b|[-–—]/i.test(valor);
}

/** `Costo de Chapa` → `costo_de_chapa`. Sin acentos: la clave va en plantillas. */
export function normalizarClave(texto: string): string {
  return String(texto ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    // Marcas diacríticas combinantes: NFD ya separó la tilde de la letra, así
    // que quitarlas convierte á→a y ñ→n de un golpe.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_\s]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/** `costo_chapa` → `Costo chapa`. Etiqueta por defecto cuando el doc no da una. */
export function etiquetaDesdeClave(key: string): string {
  const t = key.replace(/_/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
