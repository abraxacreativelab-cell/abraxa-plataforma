/** Números del paquete, en un solo lugar y con su razón escrita. */

/** Cuántos hilos trae la bandeja de un jalón. */
export const HILOS_POR_PAGINA = 100;
export const HILOS_MAXIMO = 300;

/** Cuántos mensajes trae el panel de conversación. */
export const MENSAJES_POR_HILO = 500;

/** Recorte del texto que se guarda como vista previa del hilo. */
export const LARGO_VISTA_PREVIA = 140;

/**
 * Timeout de una llamada al proveedor del canal.
 *
 * SIEMPRE hay timeout: una instancia de WhatsApp desconectada puede colgar la
 * petición ~60s, y eso bloquea el webhook que la disparó. Lo aprendió GARDEN
 * (src/crm/channels/evolution.ts:15-18).
 */
export const TIMEOUT_CANAL_MS = 8_000;
/** Subir media tarda más que mandar texto. */
export const TIMEOUT_MEDIA_MS = 30_000;

/**
 * Tope de caracteres que se le pasan al agente de un solo mensaje entrante.
 *
 * Un mensaje absurdamente largo por WhatsApp no debería poder inflar la
 * factura de tokens de un cliente. Se recorta y se anota en el log.
 */
export const MAX_ENTRADA_AGENTE = 4_000;
