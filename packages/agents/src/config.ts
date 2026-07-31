/**
 * Constantes del motor de agentes.
 *
 * Todo lo que es secreto o depende del ambiente vive en `@abraxa/config` (H1) y
 * se lee de forma perezosa. Aquí sólo quedan las decisiones de diseño que no
 * cambian entre ambientes.
 */

/** Techo de vueltas del agent loop. Portado de GARDEN (core/agent-loop.ts:11). */
export const MAX_ITERACIONES = 10;

/** Tiempo máximo por tool antes de abortarla. */
export const TIMEOUT_TOOL_MS = 30_000;

/** Tiempo máximo de una llamada al proveedor. */
export const TIMEOUT_PROVEEDOR_MS = 120_000;

/** Cuántos mensajes de historial se cargan cuando el llamador no los manda. */
export const HISTORIAL_MAX_MENSAJES = 20;

/**
 * Límites de último recurso, cuando el tenant no tiene override y su plan no
 * está en `app.agent_plan_limits`.
 *
 * Deliberadamente TACAÑOS. Si la resolución de límites falla, el modo seguro es
 * gastar poco: un cliente que topa un límite bajo levanta la mano en minutos;
 * uno al que no se le aplicó ninguno aparece en la factura a fin de mes.
 */
export const LIMITES_POR_DEFECTO = {
  monthlyBudgetUsd: 5,
  requestsPerMinute: 10,
  maxOutputTokens: 4096,
} as const;

/**
 * Cuánto se confía en el conteo de tokens en memoria antes de volver a
 * preguntarle a la base cuánto lleva gastado el tenant este mes.
 *
 * No es sólo optimización: sin esto, cada mensaje entrante haría un SUM sobre
 * `usage_ledger` antes de siquiera hablarle al modelo.
 */
export const TTL_CACHE_PRESUPUESTO_MS = 30_000;

/** Cuánto se cachea una fila de precio antes de releerla. */
export const TTL_CACHE_PRECIOS_MS = 60_000;

/**
 * Versión de la API de Anthropic. Va en la cabecera `anthropic-version`.
 * Es la única versión estable de la Messages API.
 */
export const ANTHROPIC_VERSION = '2023-06-01';

export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
