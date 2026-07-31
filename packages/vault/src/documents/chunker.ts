/**
 * Partir un documento en trozos que quepan en un embedding.
 *
 * Portado de GARDEN `src/memory/knowledge-loader.ts:14-38`. Es genérico y se
 * lleva casi tal cual; lo único que cambia es que aquí nunca devuelve un
 * arreglo vacío para un texto con contenido — un documento que se ingiere y
 * no genera ni un trozo desaparecería de la búsqueda sin avisar.
 *
 * Corta por párrafos, no por caracteres: partir a media frase produce trozos
 * cuyo embedding no representa ninguna idea completa, y la búsqueda semántica
 * empieza a devolver resultados que "casi" hablan del tema.
 */

/** ~4 caracteres por token. Suficiente para no pasarse del límite del modelo. */
const CHARS_POR_TOKEN = 4;

export function chunkText(text: string, maxTokens = 500): string[] {
  const limpio = String(text ?? '').trim();
  if (!limpio) return [];

  const maxChars = Math.max(1, maxTokens) * CHARS_POR_TOKEN;
  const chunks: string[] = [];
  let actual = '';

  const empujar = () => {
    const t = actual.trim();
    if (t) chunks.push(t);
    actual = '';
  };

  for (const parrafo of limpio.split(/\n\n+/)) {
    const p = parrafo.trim();
    if (!p) continue;

    // Un párrafo que no cabe en un trozo se parte por oraciones ANTES de
    // entrar. El umbral es el tamaño del trozo y no una constante aparte: con
    // una constante mayor, un contrato pegado como un solo párrafo de 1,000
    // caracteres salía como UN trozo de 1,000 aunque se hubieran pedido de 200
    // — y el embedding de ese trozo no representa ninguna idea en particular.
    const piezas = p.length > maxChars ? partirPorOraciones(p, maxChars) : [p];

    for (const pieza of piezas) {
      if (actual && actual.length + pieza.length + 2 > maxChars) empujar();
      actual = actual ? `${actual}\n\n${pieza}` : pieza;
    }
  }
  empujar();

  // Un texto con contenido siempre produce al menos un trozo.
  return chunks.length > 0 ? chunks : [limpio.slice(0, maxChars)];
}

function partirPorOraciones(parrafo: string, maxChars: number): string[] {
  const oraciones = parrafo.split(/(?<=[.!?¿¡:;])\s+/);
  const out: string[] = [];
  let actual = '';

  for (const o of oraciones) {
    if (actual && actual.length + o.length + 1 > maxChars) {
      out.push(actual.trim());
      actual = '';
    }
    // Una sola oración más larga que el límite se corta duro: es preferible a
    // devolver un trozo que el modelo va a truncar por su cuenta.
    if (o.length > maxChars) {
      if (actual) {
        out.push(actual.trim());
        actual = '';
      }
      for (let i = 0; i < o.length; i += maxChars) out.push(o.slice(i, i + maxChars));
      continue;
    }
    actual = actual ? `${actual} ${o}` : o;
  }
  if (actual.trim()) out.push(actual.trim());
  return out;
}
