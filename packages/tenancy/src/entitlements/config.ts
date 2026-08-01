/**
 * Las dos constantes que se ajustan sin tocar lógica.
 */

/**
 * Cuánto vive el caché de entitlements.
 *
 * 60 s, el mismo orden de magnitud que el caché de presupuesto de H3
 * (`packages/agents/src/config.ts`). El desfase sólo puede ir en una dirección
 * incómoda —un cliente que acaba de pagar espera hasta un minuto— y para eso
 * está `invalidarEntitlements()`, que H10 llama al aplicar el cambio. El minuto
 * es el peor caso de un camino que en la práctica no se recorre.
 *
 * Al revés no hay riesgo: un cliente que dejó de pagar queda cortado por
 * `tenantIsLive()`, que NO pasa por este caché.
 */
export const TTL_CACHE_ENTITLEMENTS_MS = 60_000;

/**
 * Cuántas filas de bitácora de plan devuelve la pantalla por omisión.
 * Es historia, no una tabla de trabajo: veinte alcanzan para explicar cualquier
 * "¿por qué perdí esto?" y ninguna pantalla necesita paginar su plan.
 */
export const LIMITE_HISTORIAL_PLAN = 20;
