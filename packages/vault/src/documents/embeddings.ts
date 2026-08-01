/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Embeddings de la biblioteca. OpenAI `text-embedding-3-small`, 1536 dims.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Portado de GARDEN `src/services/embeddings.ts`. Trae dos aprendizajes de
 *  campo que costaron dinero y que se conservan enteros:
 *
 *  1. CORTACIRCUITO. El 2026-07-28 la cuenta de OpenAI de GARDEN quedó en
 *     `insufficient_quota`. Cada escritura disparaba un POST condenado a 429 y
 *     una línea de ERROR. Un fallo de cuota no se cura en un segundo: tras un
 *     fallo duro (401/403/429) se deja de llamar a la API durante
 *     `COOLDOWN_MS` y se devuelve `null` de inmediato. Una tormenta de
 *     round-trips inútiles se convierte en una línea de log por ventana.
 *
 *  2. `null` ES UN RESULTADO LEGÍTIMO, NO UNA EXCEPCIÓN. Quien llama degrada,
 *     nunca pierde el dato: la ingesta guarda el trozo con `embedding NULL` y
 *     lo deja listo para backfill. Perder un documento del cliente porque un
 *     proveedor externo tosió sería mucho peor que guardarlo sin vector.
 *
 *  ── Y una decisión que parece un descuido y no lo es ────────────────────────
 *
 *  NO HAY PROVEEDOR DE RESPALDO, a propósito. Un embedding de otro modelo vive
 *  en OTRO espacio vectorial: mezclarlo en la misma columna envenenaría la
 *  búsqueda en silencio — filas que jamás casan con ninguna consulta y sin
 *  forma de distinguirlas de las buenas. Un hueco explícito y rellenable es
 *  mejor que una similitud que miente.
 *
 *  Se usa `fetch` directo en vez del SDK de `openai` por una razón boba pero
 *  real: es una petición, y así este paquete no gana una dependencia que el
 *  gate de propiedad no me deja instalar si algún día hace falta otra.
 */

import { SIGNIFICADO_EN_PAUSA } from '../copy';

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMS = 1536;

/** Cuánto se espera antes de reintentar tras un fallo de credencial o cuota. */
const COOLDOWN_MS = 10 * 60 * 1000;

/** "No lo vuelvas a intentar ya": credencial o cuota, no un hipo de red. */
const FALLOS_DUROS = new Set([401, 403, 429]);

const ENDPOINT = 'https://api.openai.com/v1/embeddings';

let cooldownHasta = 0;
let cooldownMotivo = '';

function apiKey(): string | undefined {
  // Se lee de `process.env` y no de `env()` de @abraxa/config a propósito:
  // `env()` valida el entorno COMPLETO y lanza si falta algo no relacionado.
  // Que la biblioteca deje de indexar porque no está configurado Stripe sería
  // absurdo.
  return process.env.OPENAI_API_KEY || undefined;
}

export function isEmbeddingsAvailable(): boolean {
  return !!apiKey() && Date.now() >= cooldownHasta;
}

/**
 * Estado del índice semántico. Tiene DOS textos y no es redundancia.
 *
 * `reason` es para diagnóstico —`/vault/health`, el runbook, las pruebas— y
 * dice la verdad técnica: `OPENAI_API_KEY ausente`, `HTTP 429: …`.
 *
 * `paraElCliente` es para la pantalla. Hasta el 2026-08-01 no existía, y
 * /direccion pintaba `reason` tal cual: el invitado del ensayo leyó
 * «La búsqueda por significado está en pausa (OPENAI_API_KEY ausente)».
 * Enseñarle a un cliente el nombre de una variable de entorno no le dice nada
 * y le dice demasiado a la vez.
 */
export function embeddingsStatus(): {
  ok: boolean;
  reason: string;
  paraElCliente: string;
  cooldownMs: number;
} {
  if (!apiKey()) {
    return {
      ok: false,
      reason: 'OPENAI_API_KEY ausente',
      paraElCliente: SIGNIFICADO_EN_PAUSA,
      cooldownMs: 0,
    };
  }
  const resta = cooldownHasta - Date.now();
  if (resta > 0) {
    return { ok: false, reason: cooldownMotivo, paraElCliente: SIGNIFICADO_EN_PAUSA, cooldownMs: resta };
  }
  return { ok: true, reason: '', paraElCliente: '', cooldownMs: 0 };
}

/** Reinicia el cortacircuito. Para las pruebas y para el backfill manual. */
export function resetEmbeddingsCooldown(): void {
  cooldownHasta = 0;
  cooldownMotivo = '';
}

function abrirCooldown(motivo: string): void {
  const primero = Date.now() >= cooldownHasta;
  cooldownHasta = Date.now() + COOLDOWN_MS;
  cooldownMotivo = motivo;
  // Una sola línea por ventana: el ruido fue parte del problema original.
  if (primero) {
    console.error(`[vault] embeddings en pausa ${COOLDOWN_MS / 60000} min — ${motivo}`);
  }
}

/** El vector de un texto, o `null`. NUNCA lanza. */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  const key = apiKey();
  if (!key) return null;
  if (Date.now() < cooldownHasta) return null;

  const contenido = String(text ?? '').trim();
  if (!contenido) return null;

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: contenido }),
    });

    if (!res.ok) {
      const detalle = await res.text().catch(() => '');
      if (FALLOS_DUROS.has(res.status)) abrirCooldown(`HTTP ${res.status}: ${detalle.slice(0, 200)}`);
      else console.error(`[vault] embeddings HTTP ${res.status}`);
      return null;
    }

    const json = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
    const vector = json.data?.[0]?.embedding ?? null;

    if (vector && vector.length !== EMBEDDING_DIMS) {
      // Un vector de otra dimensión no cabe en la columna y, peor, indicaría
      // que alguien cambió el modelo sin migrar lo ya indexado.
      console.error(
        `[vault] el embedding vino con ${vector.length} dimensiones y la columna espera ` +
          `${EMBEDDING_DIMS}. Se descarta: mezclar espacios vectoriales rompe la búsqueda.`,
      );
      return null;
    }

    if (vector && cooldownMotivo) {
      console.warn(
        '[vault] embeddings recuperados — corre el backfill para llenar los huecos ' +
          '(GET /vault/health dice cuántos quedan).',
      );
      cooldownMotivo = '';
    }
    return vector;
  } catch (e) {
    console.error(`[vault] embeddings falló: ${(e as Error).message}`);
    return null;
  }
}

/**
 * Cómo se manda un vector a PostgREST.
 *
 * `pgvector` acepta el literal `[0.1,0.2,…]`, y PostgREST castea texto→vector
 * en la llamada a la función. Mandar el arreglo de JS tal cual produce un
 * error de tipo poco claro del lado del servidor.
 */
export function toVectorLiteral(embedding: number[]): string {
  return JSON.stringify(embedding);
}
