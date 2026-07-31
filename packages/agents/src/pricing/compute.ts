/**
 * Tokens reales → costo en USD.
 *
 * El reparto que este archivo sostiene:
 *
 *   · los TOKENS son medición   — vienen de `usage` en la respuesta del
 *                                 proveedor, jamás de una estimación
 *   · el PRECIO es un dato      — vive en `app.model_pricing`, versionado
 *   · el COSTO es una proyección— se calcula aquí, y se puede volver a calcular
 *
 * Ese último punto es el que GARDEN no tiene. Su fila guarda un número ya
 * cocinado; cuando el número está mal no queda nada con qué rehacerlo, y un
 * costo equivocado se ve idéntico a uno correcto.
 *
 * Los tres caminos posibles, y ninguno inventa un precio:
 *
 *   provider  el proveedor reportó el costo real (OpenRouter). Se usa tal cual.
 *   priced    tokens × la fila de precio vigente.
 *   unpriced  no hay precio capturado para ese modelo. Se registra en 0 y se
 *             MARCA. GARDEN, en su lugar, aplicaba un fallback silencioso de
 *             {input: 1.0, output: 3.0} a cualquier modelo desconocido — que es
 *             cómo se puede estar cobrando mal durante meses sin enterarse.
 */
import type { CostoCalculado, RawUsage } from '../types';
import type { PricingRow } from './catalog';

const POR_MILLON = 1_000_000;

/**
 * Costo de una medición.
 *
 * @param usage  lo que devolvió el proveedor, en tokens
 * @param precio la fila vigente, o `null` si el modelo no tiene precio
 */
export function calcularCosto(usage: RawUsage, precio: PricingRow | null): CostoCalculado {
  // 1. El proveedor ya dijo cuánto costó. No hay nada que estimar.
  if (usage.providerCostUsd !== null) {
    return { costUsd: redondear(usage.providerCostUsd), source: 'provider', pricingId: null };
  }

  // 2. Sin precio capturado: se registra el consumo con costo 0 y la marca.
  //    La fila con sus tokens NO se pierde, así que en cuanto se capture el
  //    precio, este renglón se puede recalcular hacia atrás.
  if (!precio) {
    return { costUsd: 0, source: 'unpriced', pricingId: null };
  }

  // 3. Tokens × precio vigente.
  //
  //    Los cuatro conceptos se cobran distinto y por eso se suman por separado:
  //    el input no cacheado a precio pleno, la lectura de caché a ~0.1×, y la
  //    escritura de caché MÁS CARA que el input (1.25× a 5 min, 2× a 1 h).
  //    Meter las dos escrituras en un solo cubo sale mal para el TTL largo.
  const usd =
    (usage.inputTokens * precio.inputPerMtok +
      usage.outputTokens * precio.outputPerMtok +
      usage.cacheReadTokens * precio.cacheReadPerMtok +
      usage.cacheWrite5mTokens * precio.cacheWrite5mPerMtok +
      usage.cacheWrite1hTokens * precio.cacheWrite1hPerMtok) /
    POR_MILLON;

  return { costUsd: redondear(usd), source: 'priced', pricingId: precio.id };
}

/**
 * A 6 decimales, que es la precisión de `numeric(12,6)` en el ledger.
 *
 * Se redondea aquí y no al escribir para que el número que devuelve el port sea
 * exactamente el que quedó guardado. Que la API reporte un costo y la base
 * tenga otro, aunque difieran en el sexto decimal, es la clase de discrepancia
 * que hace perder una tarde cuando la suma no cuadra.
 */
function redondear(usd: number): number {
  return Math.round(usd * 1e6) / 1e6;
}

/**
 * Lo que HABRÍA costado sin caché, para poder cuantificar el ahorro.
 *
 * Sirve para el criterio #4: no basta con ver `cache_read_tokens > 0`, conviene
 * poder decir cuántos dólares representa. Los tokens leídos de caché se
 * recotizan a precio pleno de input, que es lo que se habría pagado por ellos.
 */
export function costoSinCache(usage: RawUsage, precio: PricingRow | null): number {
  if (!precio) return 0;
  const tokensDeEntrada = usage.inputTokens + usage.cacheReadTokens + usage.cacheWrite5mTokens + usage.cacheWrite1hTokens;
  const usd =
    (tokensDeEntrada * precio.inputPerMtok + usage.outputTokens * precio.outputPerMtok) / POR_MILLON;
  return redondear(usd);
}
