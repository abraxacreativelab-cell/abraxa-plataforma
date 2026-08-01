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
 *
 * ── DOS NÚMEROS, NO UNO (auditoría 2026-07-31) ──────────────────────────────
 *
 * `unpriced` con costo 0 era honesto para la CONTABILIDAD y catastrófico para
 * el TOPE. `gastoDesde()` sumaba esos ceros, `verificarPresupuesto()` comparaba
 * 0 contra el límite del plan, y un tenant de $5 al mes podía quemar $500
 * reales sin que nada se encendiera: la única señal era un `log.warn` por
 * corrida. Un tope que no ve el gasto no es un tope.
 *
 * La salida NO es inventar un precio —ése es exactamente el pecado de GARDEN—
 * sino separar las dos preguntas, que nunca fueron la misma:
 *
 *   costUsd      ¿cuánto costó?          → 0 y marcado. Honesto, y como el
 *                                          ledger guarda los tokens crudos, se
 *                                          RECALCULA en cuanto haya precio.
 *   budgetedUsd  ¿cuánto cuenta al tope? → el PISO conservador. No pretende ser
 *                                          el costo; es la cota inferior de
 *                                          seguridad que impide que el tope se
 *                                          quede ciego.
 *
 * El piso falla hacia CARO a propósito: cortar el servicio antes de tiempo se
 * atiende con una llamada; una factura de $500 en un plan de $5, no.
 */
import type { ProviderName } from '@abraxa/db';
import type { CostoCalculado, RawUsage } from '../types';
import type { PricingRow } from './catalog';

const POR_MILLON = 1_000_000;

/**
 * El precio de piso: el MÁS CARO del catálogo sembrado (Fable 5, $10/$50 por
 * Mtok, migración 021:82).
 *
 * Se elige el más caro y no un promedio porque el piso sólo tiene un trabajo:
 * garantizar que el tope se dispare ANTES de que el gasto real lo rebase. Un
 * piso barato es un tope ciego con pasos extra.
 *
 * Si algún día se siembra un modelo más caro que Fable 5, la prueba de
 * `pricing/seeds.test.ts` lo detecta y obliga a subir este número.
 */
export const PRECIO_DE_PISO = {
  inputPerMtok: 10.0,
  outputPerMtok: 50.0,
  cacheWrite5mPerMtok: 12.5,
  cacheWrite1hPerMtok: 20.0,
  cacheReadPerMtok: 1.0,
} as const;

/** Tarifa mínima para aplicar la fórmula: sirve la fila real y sirve el piso. */
type Tarifa = Pick<
  PricingRow,
  'inputPerMtok' | 'outputPerMtok' | 'cacheReadPerMtok' | 'cacheWrite5mPerMtok' | 'cacheWrite1hPerMtok'
>;

/**
 * Los cuatro conceptos se cobran distinto y por eso se suman por separado: el
 * input no cacheado a precio pleno, la lectura de caché a ~0.1×, y la escritura
 * de caché MÁS CARA que el input (1.25× a 5 min, 2× a 1 h). Meter las dos
 * escrituras en un solo cubo sale mal para el TTL largo.
 */
function aplicar(usage: RawUsage, t: Tarifa): number {
  return (
    (usage.inputTokens * t.inputPerMtok +
      usage.outputTokens * t.outputPerMtok +
      usage.cacheReadTokens * t.cacheReadPerMtok +
      usage.cacheWrite5mTokens * t.cacheWrite5mPerMtok +
      usage.cacheWrite1hTokens * t.cacheWrite1hPerMtok) /
    POR_MILLON
  );
}

/**
 * Costo de una medición.
 *
 * @param usage    lo que devolvió el proveedor, en tokens
 * @param precio   la fila vigente, o `null` si el modelo no tiene precio
 * @param provider quién cobró. Sólo cambia el caso `unpriced`: un modelo
 *                 `local` no factura tokens, así que su piso es 0 de verdad.
 */
export function calcularCosto(
  usage: RawUsage,
  precio: PricingRow | null,
  provider: ProviderName = 'anthropic',
): CostoCalculado {
  // 1. El proveedor ya dijo cuánto costó. No hay nada que estimar.
  if (usage.providerCostUsd !== null) {
    const usd = redondear(usage.providerCostUsd);
    return { costUsd: usd, budgetedUsd: usd, source: 'provider', pricingId: null };
  }

  // 2. Sin precio capturado: el costo se registra en 0 y se MARCA —la fila con
  //    sus tokens no se pierde, así que en cuanto se capture el precio este
  //    renglón se recalcula hacia atrás—, pero contra el TOPE cuenta el piso.
  //    Ésa es la línea que evita que un modelo sin precio apague el presupuesto.
  if (!precio) {
    const piso = provider === 'local' ? 0 : redondear(aplicar(usage, PRECIO_DE_PISO));
    return { costUsd: 0, budgetedUsd: piso, source: 'unpriced', pricingId: null };
  }

  // 3. Tokens × precio vigente.
  const usd = redondear(aplicar(usage, precio));
  return { costUsd: usd, budgetedUsd: usd, source: 'priced', pricingId: precio.id };
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
