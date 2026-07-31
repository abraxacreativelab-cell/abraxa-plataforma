/**
 * ════════════════════════════════════════════════════════════════════════════
 *  ¿Vale la pena pedir caché para este prompt? — el criterio #4.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Debajo del mínimo del modelo, el caché NO se crea. Sin error y sin aviso: la
 *  respuesta llega igual y la única señal es la factura.
 *
 *  Tres cosas que hay que tener claras antes de "arreglarlo" alargando prompts,
 *  y que la redacción común del problema se salta:
 *
 *  1. EL MÍNIMO APLICA AL PREFIJO COMPLETO, no al system prompt solo.
 *     El orden de render es `tools → system → messages`, así que las
 *     definiciones de tools cuentan. Un sub-agente con seis tools puede pasar
 *     el mínimo sin tocar una coma del prompt. Por eso `estimarTokensPrefijo()`
 *     mide los dos.
 *
 *  2. FALLAR EL CACHÉ NO "TRIPLICA" EL COSTO.
 *     Sin caché pagas 1.0× de input en cada llamada. Con caché pagas 1.25× la
 *     primera y 0.1× las siguientes. Lo que se pierde es el ahorro de ~90%: la
 *     llamada repetida termina costando ~10× lo que costaría cacheada. Importa
 *     saberlo para reconocer el síntoma correcto cuando la factura no cuadre.
 *
 *  3. EL MÍNIMO NO CRECE CON LA GENERACIÓN.
 *     Va de 512 en Opus 5 a 4,096 en Haiku 4.5. No se infiere del nombre; está
 *     tabulado en `capabilities.ts`.
 *
 *  ── Sobre estimar ──────────────────────────────────────────────────────────
 *
 *  La estimación de abajo decide si vale la pena PEDIR el caché. No es la
 *  verificación: ésa es `cache_read_input_tokens > 0` medido contra la API real
 *  (`src/bin/measure-cache.ts`). Estimar y medir son cosas distintas, y
 *  confundirlas es el error que este handoff viene a no repetir.
 *
 *  La estimación se equivoca hacia arriba a propósito (ver `estimarTokens`):
 *  pedir caché de más cuesta 1.25× una vez; pedirlo de menos tira el 90% de
 *  ahorro en todas las llamadas siguientes.
 */
import { capsFor } from '../capabilities';
import type { ProviderName } from '@abraxa/db';
import type { ToolSpec } from '../providers/types';

/**
 * Tokens aproximados de un texto.
 *
 * Regla de ~3.5 caracteres por token: más apretada que el clásico 4 porque el
 * español acentuado y el JSON de los esquemas tokenizan peor que la prosa en
 * inglés. Sobreestimar aquí es el error barato.
 *
 * Para la cuenta exacta está `messages.count_tokens` de la API, que necesita
 * llave y una llamada de red — demasiado caro para una decisión que se toma en
 * cada mensaje. `src/bin/measure-cache.ts` sí la usa, que es donde se necesita
 * el número exacto.
 */
export function estimarTokens(texto: string): number {
  return Math.ceil(texto.length / 3.5);
}

/**
 * Tokens del prefijo cacheable: tools + system, en orden de render.
 *
 * El JSON de las tools se serializa igual que va al cuerpo porque eso es lo que
 * el modelo tokeniza. Sumar sólo el nombre y la descripción subestimaría —
 * `input_schema` suele ser lo más pesado de una tool.
 */
export function estimarTokensPrefijo(system: string, tools: ToolSpec[]): number {
  const jsonTools = tools.length > 0 ? JSON.stringify(tools) : '';
  return estimarTokens(jsonTools) + estimarTokens(system);
}

export interface DecisionCache {
  /** Si se le pide caché al proveedor en esta llamada. */
  pedirCache: boolean;
  tokensEstimados: number;
  minimoDelModelo: number;
  /** Explicación para el log y para el guion de medición. */
  razon: string;
}

/**
 * Decide si pedir caché para un prompt.
 *
 * Pedirlo cuando no alcanza el mínimo no da error, simplemente no cachea. Aun
 * así no se pide: dejar rastro en el log de que un prompt se quedó corto es lo
 * que convierte un costo invisible en un pendiente accionable.
 */
export function decidirCache(
  system: string,
  tools: ToolSpec[],
  model: string,
  provider: ProviderName = 'anthropic',
): DecisionCache {
  const caps = capsFor(model, provider);
  const tokens = estimarTokensPrefijo(system, tools);
  const minimo = caps.cacheMinTokens;

  if (tokens >= minimo) {
    return {
      pedirCache: true,
      tokensEstimados: tokens,
      minimoDelModelo: minimo,
      razon: `prefijo ~${tokens} tok ≥ mínimo ${minimo} de ${model}`,
    };
  }

  return {
    pedirCache: false,
    tokensEstimados: tokens,
    minimoDelModelo: minimo,
    razon:
      `prefijo ~${tokens} tok < mínimo ${minimo} de ${model}: no cachea. ` +
      `Recuerda que el mínimo cubre tools + system, así que registrarle tools ` +
      `a este agente puede bastar para cruzarlo sin alargar el prompt.`,
  };
}
