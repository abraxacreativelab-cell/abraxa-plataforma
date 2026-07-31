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
 *
 *  ── Sobre la moneda ─────────────────────────────────────────────────────────
 *
 *  `$1,200 USD` y `$1,200` no son el mismo número: a 18 pesos por dólar, la
 *  diferencia entre uno y otro son veinte mil pesos en una cotización. Por eso
 *  la moneda se DETECTA y viaja con la cifra hasta la base — no se asume.
 *
 *  Se detecta en dos niveles, y en este orden:
 *
 *    1. En el propio valor: `- deposito: $1,200 USD`.
 *    2. En una DECLARACIÓN EXPLÍCITA del documento: una línea que diga
 *       «Moneda: USD» o «Todos los precios están en dólares».
 *
 *  El segundo nivel es a propósito estrecho. Bastaría con buscar "USD" en
 *  cualquier parte del documento para que un «el proveedor nos cobra en USD»
 *  perdido en un párrafo convirtiera TODA la lista de precios a dólares. Un
 *  falso positivo aquí envenena la bóveda entera; un falso negativo sólo deja
 *  el valor en la moneda por defecto, que es la correcta el 99% de las veces.
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

// ─── Moneda ──────────────────────────────────────────────────────────────────

/** Lo que se asume cuando el documento no dice otra cosa. */
export const MONEDA_POR_DEFECTO = 'MXN';

/**
 * Cómo escribe la gente cada moneda. El orden importa: se evalúa de arriba
 * abajo y gana la primera que case.
 *
 * `$` a secas NO está en ninguna lista: en México significa pesos y en medio
 * mundo significa dólares, así que por sí solo no es evidencia de nada.
 */
const MONEDAS: ReadonlyArray<readonly [string, RegExp]> = [
  // `dlls` y `dls` son como se escribe en una cotización mexicana de verdad.
  ['USD', /\busd\b|\bus\s?\$|\bdlls?\b|\bd[oó]lar(?:es)?\b/i],
  ['EUR', /€|\beur\b|\beuros?\b/i],
  ['MXN', /\bmxn\b|\bmx\s?\$|\bpesos?\b/i],
];

/** Código ISO de 3 letras de la moneda que declara un texto. */
export function detectarMoneda(texto: string, porDefecto = MONEDA_POR_DEFECTO): string {
  const t = String(texto ?? '');
  for (const [codigo, re] of MONEDAS) if (re.test(t)) return codigo;
  return porDefecto;
}

/**
 * La moneda que el DOCUMENTO declara para todo, si es que lo declara.
 *
 * Sólo dos formas, las dos inequívocas: un encabezado tipo `Moneda: USD` o una
 * frase que diga que los precios están en tal moneda. Cualquier otra mención
 * suelta se ignora — ver la nota de arriba sobre por qué.
 */
const DECLARACION_MONEDA: readonly RegExp[] = [
  // Un encabezado o un bullet: `Moneda: USD`, `- Divisa: dólares`.
  /^[-*>#\s]*(?:moneda|divisa|currency)\s*:\s*([^\n]{1,24})$/im,
  // Una frase, en la misma línea: «Todos los precios están en dólares».
  /\b(?:precios?|montos?|tarifas?|cifras?|cantidades|todos?)\b[^.\n]{0,40}?\ben\s+([^\n.,;]{2,24})/i,
];

export function monedaDeclarada(contenido: string): string | null {
  const texto = String(contenido ?? '');
  for (const re of DECLARACION_MONEDA) {
    const m = texto.match(re);
    if (!m?.[1]) continue;
    const codigo = detectarMoneda(m[1], '');
    if (codigo) return codigo;
  }
  return null;
}

export function parsePricingDoc(content: string): CifraExtraida[] {
  const out: CifraExtraida[] = [];
  const vistas = new Set<string>();

  // La moneda del documento entero, si la declara. Es sólo el punto de partida:
  // un valor que trae la suya («$99 USD» en una lista en pesos) la pisa.
  const monedaDelDoc = monedaDeclarada(content) ?? MONEDA_POR_DEFECTO;

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
          // Un porcentaje no tiene moneda. Va la del documento para que la
          // columna —que es NOT NULL— no mienta con un valor arbitrario.
          value: n,
          currency: monedaDelDoc,
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
      // La del valor gana sobre la del documento; la del documento sobre MXN.
      //
      // La NOTA no se mira a propósito, aunque «$1,200 — dólares» exista: la
      // nota es prosa libre y «ya no cobramos en dólares» marcaría el valor
      // como USD. Entre no detectar una moneda y detectar la equivocada, la
      // segunda es la que acaba en una cotización con un cero de más.
      currency: detectarMoneda(valor, monedaDelDoc),
      label: etiquetaCruda?.trim() || null,
      // Un rango o un pendiente pierden el número, así que el texto original se
      // conserva — TAMBIÉN cuando el bullet traía nota propia, que es donde
      // esto fallaba. `de $800 a $900 — según el caso` se guardaba como «según
      // el caso» a secas: el rango desaparecía y con él la única pista que le
      // queda al emprendedor para saber qué número escribir. La regla 2 de
      // arriba promete «la nota completa»; esto es cumplirla.
      note:
        value === null
          ? [valor, notaCruda?.trim()].filter(Boolean).join(' — ')
          : notaCruda?.trim() || null,
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
 *
 * Se exporta porque `values/service.ts` la reusa para explicarle al emprendedor
 * POR QUÉ no se puede aceptar una propuesta sin cifra: «que es un rango, no un
 * precio» se entiende; «propuesta inválida» no.
 */
export function esRango(valor: string): boolean {
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
