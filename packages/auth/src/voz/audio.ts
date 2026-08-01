/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Los topes, y la extensión del archivo — que es la trampa que mata el dictado.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  ── La trampa, medida ──────────────────────────────────────────────────────
 *
 *  Groq y OpenAI validan el formato del audio por la EXTENSIÓN DEL NOMBRE DE
 *  ARCHIVO, no por el `content-type`. Comprobado el 2026-08-01 contra Groq con
 *  el mismo webm/opus tres veces:
 *
 *     `audio.webm`  → 200, transcripción correcta, 447 ms
 *     `audio`       → 400 «file must be one of the following types:
 *                     [flac mp3 mp4 mpeg mpga m4a ogg opus wav webm]», 90 ms
 *     `audio.wav`   → 200, transcripción correcta (o sea: la extensión es una
 *                     PUERTA, no la verdad; el contenido lo sniffean aparte)
 *
 *  Y `FormData.append('file', blob)` sin tercer argumento manda el nombre
 *  `blob`, sin extensión. O sea: el camino por defecto, el que escribiría
 *  cualquiera, da 400 en el evento y el mensaje del proveedor no menciona la
 *  palabra «nombre» por ningún lado.
 *
 *  Por eso el nombre se DERIVA del MIME aquí, en una función con pruebas, en
 *  vez de escribirse a mano en el handler.
 *
 *  ── Los dos formatos que llegan de verdad ──────────────────────────────────
 *
 *  Chrome y Android graban `audio/webm;codecs=opus`. Safari —y por lo tanto
 *  TODOS los iPhone— graba `audio/mp4`. Los dos tienen que llegar bien, y los
 *  dos llegan: medidos contra Groq, 447 ms y 376 ms.
 */
import { FalloDeVoz } from './errores';

/**
 * Tope de audio: 15 MB.
 *
 * Tres razones, en orden de importancia:
 *
 *  1. Un endpoint de transcripción sin tope es la factura de otro. Con sesión
 *     obligatoria el riesgo baja, pero un invitado con una pestaña abierta y un
 *     script mal escrito sigue pudiendo subir un disco duro.
 *  2. nginx corta en 25 MB EXACTOS (medido por bisección contra producción:
 *     25 MiB pasan, 26 MiB dan 413 de nginx). Un tope por debajo hace que el
 *     413 sea NUESTRO, en JSON tipado, en vez de la página HTML de nginx que
 *     revienta el `await r.json()` del cliente.
 *  3. 15 MB de opus a 32 kbps son casi cuarenta minutos. Un turno de entrevista
 *     que dura cuarenta minutos no es un turno.
 */
export const TOPE_AUDIO_BYTES = 15 * 1024 * 1024;

/**
 * Tope de texto a narrar: 2000 caracteres.
 *
 * Una pregunta del Ritual son 100–300. Dos mil son unos dos minutos de audio, y
 * a los dos minutos ya nadie está escuchando: está esperando a que se calle.
 */
export const TOPE_TEXTO = 2000;

/**
 * Tope de texto cuando viene por GET, en la URL: 700 caracteres.
 *
 * Existe porque el `<audio src>` del navegador —la ÚNICA forma de que el sonido
 * empiece antes de que termine de generarse en iPhone— sólo sabe hacer GET, y
 * el texto tiene que caber en la URL.
 *
 * El número sale de la cuenta del PEOR caso, no del típico: nginx acepta una
 * línea de petición de 8 KB por defecto (`large_client_header_buffers 4 8k`), y
 * un carácter puede escaparse hasta a nueve bytes (`’` → `%E2%80%99`). 700 × 9
 * son 6300, más la ruta y el resto de los parámetros: cabe con kilobyte y medio
 * de sobra. Con el típico —español casi todo ASCII— son unos 750 bytes.
 *
 * Pasarse no es un error del invitado: es que quien llama eligió el camino que
 * no era. Por eso el mensaje dice cuál es el otro.
 */
export const TOPE_TEXTO_EN_URL = 700;

/** Cuánto se espera a que ElevenLabs empiece a mandar audio. */
export const TIMEOUT_NARRAR_MS = 30_000;

/**
 * Cuánto se espera a una transcripción.
 *
 * Groq contesta en menos de medio segundo; OpenAI, cuando tiene crédito, en
 * unos segundos. Cuarenta y cinco es «algo se colgó», no «va lento».
 */
export const TIMEOUT_DICTAR_MS = 45_000;

/**
 * MIME → extensión que los proveedores aceptan.
 *
 * La lista de aceptados es la que devuelve Groq en su propio 400:
 * flac, mp3, mp4, mpeg, mpga, m4a, ogg, opus, wav, webm.
 *
 * El MIME que manda `MediaRecorder` lleva parámetros —`audio/webm;codecs=opus`—
 * así que se compara sólo la parte de antes del `;`, en minúsculas.
 */
const EXTENSIONES: Record<string, string> = {
  'audio/webm': 'webm',
  'video/webm': 'webm', // Chrome a veces etiqueta así un MediaRecorder sólo-audio.
  'audio/ogg': 'ogg',
  'application/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/mp4': 'm4a', // Safari, iPhone incluido.
  'video/mp4': 'mp4',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
};

/**
 * El tipo base, sin parámetros y en minúsculas. `Audio/WEBM;codecs=opus` → `audio/webm`.
 *
 * El `?? ''` no es defensivo de más: con `noUncheckedIndexedAccess`, `split()[0]`
 * es `string | undefined` para el compilador aunque en tiempo de ejecución
 * `split` nunca devuelva un arreglo vacío. Y con una cadena vacía de entrada,
 * devolver `''` es lo correcto: cae al respaldo de `extensionDe`.
 */
export function tipoBase(mime: string): string {
  return (mime.split(';')[0] ?? '').trim().toLowerCase();
}

/**
 * La extensión que hay que ponerle al archivo para que el proveedor lo acepte.
 *
 * Si el MIME no se reconoce se cae a `webm` en vez de fallar: es lo que graban
 * Chrome y Android, es lo más probable, y el proveedor sniffea el contenido de
 * todos modos (medido: un webm llamado `.wav` transcribe perfecto). Fallar aquí
 * convertiría «el navegador etiquetó raro» en «no se pudo transcribir», que es
 * peor y además mentira.
 */
export function extensionDeAudio(mime: string | undefined | null): string {
  if (!mime) return 'webm';
  return EXTENSIONES[tipoBase(mime)] ?? 'webm';
}

/** El nombre con el que se sube. Nunca sin extensión: sin ella es un 400 seguro. */
export function nombreDeArchivo(mime: string | undefined | null): string {
  return `audio.${extensionDeAudio(mime)}`;
}

/**
 * Revisa el audio antes de gastar un solo milisegundo de proveedor.
 *
 * Los tres casos son distintos y se dicen distinto: vacío (el micrófono no
 * capturó nada, que en iPhone pasa cuando se corta la grabación demasiado
 * rápido), demasiado grande, y sin tipo. Un único «audio inválido» obligaría a
 * quien llama a adivinar cuál de los tres.
 */
export function revisarAudio(bytes: number, mime: string | undefined | null): void {
  if (bytes <= 0) {
    throw new FalloDeVoz(
      'VALIDATION',
      'No llegó nada de audio. Puede que la grabación se haya cortado antes de capturar ' +
        'una sola muestra; inténtalo otra vez hablando un momento más.',
    );
  }
  if (bytes > TOPE_AUDIO_BYTES) {
    throw new FalloDeVoz(
      'VALIDATION',
      `El audio pesa ${(bytes / 1024 / 1024).toFixed(1)} MB y el tope son ` +
        `${TOPE_AUDIO_BYTES / 1024 / 1024} MB. Grábalo en trozos más cortos.`,
    );
  }
  if (mime && !EXTENSIONES[tipoBase(mime)]) {
    // No se lanza: se avisa por el camino de la extensión por defecto. Ver arriba.
    return;
  }
}

/**
 * Revisa y normaliza el texto a narrar.
 *
 * Recorta, porque un texto que es sólo espacios genera un audio de silencio que
 * se paga igual. Y colapsa los saltos de línea: el modelo los lee como pausas
 * largas y una pregunta con formato de markdown suena a alguien leyendo un
 * documento en voz alta, que es justo lo contrario de una entrevista.
 */
export function revisarTexto(bruto: unknown, tope = TOPE_TEXTO): string {
  if (typeof bruto !== 'string') {
    throw new FalloDeVoz('VALIDATION', 'Falta `texto`, y tiene que ser una cadena.');
  }

  const texto = bruto.replace(/\s+/g, ' ').trim();

  if (texto.length === 0) {
    throw new FalloDeVoz('VALIDATION', 'El texto a narrar venía vacío.');
  }
  if (texto.length > tope) {
    throw new FalloDeVoz(
      'VALIDATION',
      tope === TOPE_TEXTO_EN_URL
        ? `El texto tiene ${texto.length} caracteres y por la URL sólo caben ${tope}. ` +
          'Mándalo por POST, que acepta hasta ' +
          `${TOPE_TEXTO}.`
        : `El texto tiene ${texto.length} caracteres y el tope son ${tope}.`,
    );
  }

  return texto;
}
