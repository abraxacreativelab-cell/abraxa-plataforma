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

/**
 * Cuánto se calla la IA cuando el dueño contesta desde SU PROPIO teléfono.
 *
 * ── El caso ────────────────────────────────────────────────────────────────
 *
 * La regla #1 del paquete no se negocia: «un humano escribe en el hilo → la IA
 * se calla». Se cumplía sólo por la vía de la bandeja (`enviarEnHilo` llena
 * `assigned_to`). Pero el camino MÁS común no es ése: el emprendedor tiene el
 * teléfono en la mano, ve la conversación en WhatsApp y contesta ahí. Ese
 * mensaje vuelve por el webhook como un eco `fromMe`, y hasta hoy no tocaba
 * nada del hilo — así que al siguiente «¿y con IVA?» del cliente el agente
 * contestaba encima de su dueño, posiblemente contradiciendo el precio que
 * acababa de dar.
 *
 * ── Por qué una PAUSA y no `assigned_to` ───────────────────────────────────
 *
 * Es la elección conservadora y reversible, y coincide con el criterio que ya
 * está escrito en `pausarIA()`:
 *
 *   · El eco NO trae identidad. `assigned_to` guarda el correo del humano que
 *     tomó el hilo, y desde WhatsApp no se sabe cuál es. Llenarlo con un
 *     centinela ('phone', el número de la línea) le muestra al emprendedor un
 *     "tomado por" que no significa nada.
 *   · Una pausa vence sola. `assigned_to` no: dejaría el hilo callado para
 *     siempre a menos que alguien se acuerde de liberarlo desde la bandeja —
 *     y nadie se acuerda. Ese es exactamente el fallo que `pausarIA()` describe
 *     como "el hilo se queda muerto y el emprendedor concluye que el producto
 *     no sirve".
 *   · Es reversible: si Santiago prefiere simetría estricta con el handoff, se
 *     cambia por `assigned_to` en dos líneas y la prueba sigue midiendo lo
 *     mismo (que la IA se calla).
 *
 * Una hora cubre de sobra el ida y vuelta inmediato, que es la ventana en la
 * que el agente puede contradecir a su dueño.
 */
export const MINUTOS_PAUSA_POR_ECO_HUMANO = 60;

/**
 * Cuántos salientes SIN confirmar se miran para decidir si un eco es nuestro.
 *
 * En un hilo sano son cero o uno: el marcador que `enviarEnHilo` dejó y que
 * todavía no tiene su `external_id`. El tope existe para que un hilo con
 * basura acumulada —envíos que fallaron a medias, un driver que nunca devuelve
 * id— no convierta una comprobación de milisegundos en un escaneo.
 */
export const MAX_SALIENTES_EN_VUELO = 20;

/**
 * Cuántos ids caben en un `.in(…)` antes de partirlo en lotes.
 *
 * PostgREST manda los filtros en la QUERY STRING. Un canal con seis meses de
 * operación tiene ~800 hilos, y 800 UUIDs son ~30 KB de URL: por encima de lo
 * que aceptan nginx y PostgREST por defecto. La petición no devuelve "demasiado
 * largo", devuelve un 414 que el código de arriba lee como "no hay mensajes" —
 * exactamente la clase de pérdida silenciosa que se supone que estamos
 * cerrando. Cien uuids son ~3.7 KB: holgado.
 */
export const IDS_POR_LOTE = 100;
