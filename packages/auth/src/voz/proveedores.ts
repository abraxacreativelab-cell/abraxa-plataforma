/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Cómo se le habla a ElevenLabs y a Whisper, y cómo se lee su «no».
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Todo esto es PURO: arma peticiones y traduce respuestas. No hace ni un
 *  `fetch`. Por eso los cuatro casos que de verdad importan —y los tres se han
 *  medido contra el proveedor real— se prueban en milisegundos y sin red:
 *
 *    · ElevenLabs con la factura sin pagar   (401 `payment_issue`)  MEDIDO HOY
 *    · OpenAI sin crédito                    (429 `insufficient_quota`) MEDIDO HOY
 *    · Groq con el archivo sin extensión     (400 `invalid_request_error`) MEDIDO HOY
 *    · el proveedor que no contesta          (timeout)
 *
 *  El primero y el segundo NO son hipótesis. El 2026-08-01, con las llaves de
 *  producción:
 *
 *    ElevenLabs POST /v1/text-to-speech/{voz}/stream
 *      → 401 {"detail":{"type":"payment_required","code":"payment_issue",
 *              "message":"Your subscription has a failed or incomplete payment…"}}
 *
 *    OpenAI POST /v1/audio/transcriptions
 *      → 429 {"error":{"code":"credit_balance_exhausted",
 *              "type":"insufficient_quota","message":"You have no credits remaining."}}
 *
 *  Los dos tienen que salir de aquí como `BUDGET_EXCEEDED` —402, no
 *  reintentable, definitivo— y no como «falló la voz». Es lo único que le
 *  permite a quien llama apagar la voz y seguir con el teclado sin que el
 *  invitado se entere de nada.
 *
 *  ── Por qué un 429 no siempre es un 429 ────────────────────────────────────
 *
 *  «Te pasaste de peticiones por minuto» y «se te acabó el saldo» viajan los dos
 *  como 429 en la API de OpenAI. La diferencia es todo: al primero se le espera
 *  dos segundos y se reintenta; al segundo se le reintenta mil veces y sigue
 *  diciendo que no. Se distinguen por `type`/`code` del cuerpo, no por el
 *  status, y por eso este archivo lee el cuerpo.
 */
import { FalloDeVoz } from './errores';
import type { ConfigDeDictado, ConfigDeNarracion } from './entorno';

// ═══════════════════════════════════════════════════════════════════════════
//  NARRAR
// ═══════════════════════════════════════════════════════════════════════════

export interface PeticionHttp {
  url: string;
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
  };
}

/**
 * La petición de síntesis, en STREAMING.
 *
 * El `/stream` del final no es cosmético: sin él ElevenLabs genera el audio
 * entero y lo manda de golpe, así que el primer sonido tarda lo que tarde la
 * frase completa. Con él, los primeros bytes salen mientras el modelo sigue
 * hablando, y ésa es toda la diferencia entre una voz que contesta y una que se
 * lo piensa.
 *
 * `voice_settings` está escrito para una entrevista: `stability` a la mitad
 * —más alto suena a locutor de aeropuerto, más bajo se vuelve inestable entre
 * frases— y `similarity_boost` alto para que la voz no se desdibuje.
 */
export function peticionDeNarracion(config: ConfigDeNarracion, texto: string): PeticionHttp {
  const url =
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(config.vozId)}/stream` +
    `?output_format=${encodeURIComponent(config.formato)}`;

  return {
    url,
    init: {
      method: 'POST',
      headers: {
        'xi-api-key': config.llave,
        'content-type': 'application/json',
        accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: texto,
        model_id: config.modelo,
        voice_settings: { stability: 0.45, similarity_boost: 0.8, use_speaker_boost: true },
      }),
    },
  };
}

/** El `content-type` que corresponde al formato pedido. */
export function tipoDeSalida(formato: string): string {
  if (formato.startsWith('mp3')) return 'audio/mpeg';
  if (formato.startsWith('opus')) return 'audio/ogg';
  if (formato.startsWith('pcm')) return 'audio/wave';
  if (formato.startsWith('ulaw') || formato.startsWith('alaw')) return 'audio/basic';
  return 'application/octet-stream';
}

/**
 * El «no» de ElevenLabs, traducido.
 *
 * La forma de su error es `{detail:{status|code, message}}`, y a veces `detail`
 * es una lista (las validaciones de FastAPI). Se lee con desconfianza: si viene
 * algo que no se reconoce, sale un `PROVIDER_ERROR` genérico con el status, que
 * es honesto, en vez de una interpretación inventada.
 */
export function falloDeNarracion(status: number, cuerpo: string): FalloDeVoz {
  const detalle = leerDetalleEleven(cuerpo);
  const etiqueta = `${detalle.code} ${detalle.message}`.toLowerCase();

  // El caso vivo hoy. Es 401 y no 402, que es justamente por lo que hay que
  // mirar el cuerpo: un 401 a secas se leería como «la llave está mal».
  if (
    etiqueta.includes('payment') ||
    etiqueta.includes('quota_exceeded') ||
    etiqueta.includes('quota exceeded') ||
    etiqueta.includes('insufficient') ||
    etiqueta.includes('credit')
  ) {
    return new FalloDeVoz(
      'BUDGET_EXCEEDED',
      'La cuenta de ElevenLabs no tiene la suscripción al corriente, así que la voz está ' +
        'apagada. No es un fallo del producto y no se arregla reintentando: hay que pagar ' +
        'la factura en elevenlabs.io.',
      { proveedor: 'elevenlabs' },
    );
  }

  if (status === 401 || status === 403) {
    return new FalloDeVoz(
      'PROVIDER_ERROR',
      'ElevenLabs rechazó la llave (ELEVENLABS_API_KEY). Mientras tanto, el texto sirve igual.',
      { proveedor: 'elevenlabs', status: 502 },
    );
  }

  if (status === 404) {
    return new FalloDeVoz(
      'PROVIDER_ERROR',
      'ElevenLabs no encuentra esa voz. Revisa ELEVENLABS_VOICE_ANA: el id de la voz va en ' +
        'la URL, y una voz borrada da 404.',
      { proveedor: 'elevenlabs', status: 502 },
    );
  }

  if (status === 422 || status === 400) {
    return new FalloDeVoz(
      'VALIDATION',
      `ElevenLabs no aceptó la petición: ${detalle.message || 'sin detalle'}`,
      { proveedor: 'elevenlabs' },
    );
  }

  if (status === 429) {
    return new FalloDeVoz(
      'RATE_LIMITED',
      'ElevenLabs está atendiendo demasiadas peticiones a la vez. Espera un momento.',
      { proveedor: 'elevenlabs' },
    );
  }

  return new FalloDeVoz(
    'PROVIDER_ERROR',
    `ElevenLabs contestó ${status}${detalle.message ? `: ${detalle.message}` : '.'}`,
    { proveedor: 'elevenlabs' },
  );
}

function leerDetalleEleven(cuerpo: string): { code: string; message: string } {
  try {
    const json = JSON.parse(cuerpo) as { detail?: unknown };
    const d = json.detail;

    if (typeof d === 'string') return { code: '', message: d };

    if (Array.isArray(d)) {
      const primero = d[0] as { msg?: unknown } | undefined;
      return { code: '', message: typeof primero?.msg === 'string' ? primero.msg : '' };
    }

    if (typeof d === 'object' && d !== null) {
      const o = d as Record<string, unknown>;
      const code = [o.code, o.status, o.type].find((x) => typeof x === 'string');
      return {
        code: typeof code === 'string' ? code : '',
        message: typeof o.message === 'string' ? o.message : '',
      };
    }
  } catch {
    // Un cuerpo que no es JSON —el HTML de un balanceador, por ejemplo— cae
    // aquí y sale por el genérico con su status. Es la verdad disponible.
  }
  return { code: '', message: '' };
}

// ═══════════════════════════════════════════════════════════════════════════
//  DICTAR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Español por defecto, y se manda EXPLÍCITO.
 *
 * Whisper detecta el idioma solo, y en un audio corto con ruido de fondo lo
 * detecta mal: una frase de tres palabras en español se transcribe en
 * portugués o en italiano con una seguridad total. Decírselo cuesta un campo
 * del formulario y quita ese fallo entero.
 */
export const IDIOMA_POR_DEFECTO = 'es';

export interface CamposDeDictado {
  modelo: string;
  idioma: string;
  formatoDeRespuesta: 'json';
  /** Sesga el vocabulario. En español mexicano ayuda con nombres y anglicismos. */
  contexto?: string;
}

export function camposDeDictado(
  config: ConfigDeDictado,
  opciones?: { idioma?: string; contexto?: string },
): CamposDeDictado {
  return {
    modelo: config.modelo,
    idioma: (opciones?.idioma ?? IDIOMA_POR_DEFECTO).trim() || IDIOMA_POR_DEFECTO,
    formatoDeRespuesta: 'json',
    ...(opciones?.contexto ? { contexto: opciones.contexto } : {}),
  };
}

/**
 * El «no» de Groq y de OpenAI, traducido.
 *
 * Los dos hablan el mismo dialecto —`{error:{message,type,code}}`— porque Groq
 * expone una API compatible con la de OpenAI. Eso es lo que hace que un solo
 * traductor sirva para los dos, y es la razón de que cambiar de proveedor sea
 * una variable de entorno y no un refactor.
 */
export function falloDeDictado(
  proveedor: string,
  status: number,
  cuerpo: string,
): FalloDeVoz {
  const { code, tipo, message } = leerErrorOpenAI(cuerpo);
  const etiqueta = `${code} ${tipo}`.toLowerCase();

  // El caso vivo hoy en OpenAI. Va ANTES del 429 genérico a propósito: los dos
  // llegan como 429 y sólo el cuerpo dice cuál de los dos es.
  if (
    etiqueta.includes('insufficient_quota') ||
    etiqueta.includes('credit_balance_exhausted') ||
    etiqueta.includes('billing')
  ) {
    return new FalloDeVoz(
      'BUDGET_EXCEEDED',
      `La cuenta de ${proveedor} se quedó sin crédito, así que el dictado está apagado. ` +
        'Reintentar no lo arregla: hay que recargar saldo. Escribiendo funciona igual.',
      { proveedor },
    );
  }

  if (status === 429) {
    return new FalloDeVoz(
      'RATE_LIMITED',
      `${proveedor} está recibiendo demasiadas peticiones. Espera unos segundos y vuelve a ` +
        'hablar.',
      { proveedor },
    );
  }

  if (status === 401 || status === 403) {
    return new FalloDeVoz(
      'PROVIDER_ERROR',
      `${proveedor} rechazó la llave. Revisa su variable de entorno en el VPS.`,
      { proveedor, status: 502 },
    );
  }

  if (status === 413) {
    return new FalloDeVoz('VALIDATION', 'El audio pesa más de lo que acepta el proveedor.', {
      proveedor,
    });
  }

  if (status === 400 || status === 422) {
    // Aquí cae el archivo sin extensión: «file must be one of the following
    // types: [flac mp3 mp4 …]». Se pasa el mensaje del proveedor tal cual
    // porque es literalmente el diagnóstico.
    return new FalloDeVoz(
      'VALIDATION',
      `${proveedor} no aceptó el audio${message ? `: ${message}` : '.'}`,
      { proveedor },
    );
  }

  return new FalloDeVoz(
    'PROVIDER_ERROR',
    `${proveedor} contestó ${status}${message ? `: ${message}` : '.'}`,
    { proveedor },
  );
}

function leerErrorOpenAI(cuerpo: string): { code: string; tipo: string; message: string } {
  try {
    const json = JSON.parse(cuerpo) as { error?: unknown };
    const e = json.error;
    if (typeof e === 'string') return { code: '', tipo: '', message: e };
    if (typeof e === 'object' && e !== null) {
      const o = e as Record<string, unknown>;
      return {
        code: typeof o.code === 'string' ? o.code : '',
        tipo: typeof o.type === 'string' ? o.type : '',
        message: typeof o.message === 'string' ? o.message : '',
      };
    }
  } catch {
    // Igual que arriba: lo que no es JSON sale por el genérico con su status.
  }
  return { code: '', tipo: '', message: '' };
}

/**
 * El texto de la transcripción, o un fallo si el proveedor devolvió 200 con
 * algo que no lo es.
 *
 * Un 200 con `{}` existe: pasa cuando el audio es puro silencio. Devolver
 * cadena vacía sería correcto y también inútil, porque quien llama la mandaría
 * al agente como si la persona no hubiera dicho nada. Decirlo es mejor.
 */
export function leerTranscripcion(cuerpo: string): string {
  let json: unknown;
  try {
    json = JSON.parse(cuerpo);
  } catch {
    throw new FalloDeVoz('PROVIDER_ERROR', 'La transcripción no vino en JSON.');
  }

  const texto =
    typeof json === 'object' && json !== null && 'text' in json
      ? (json as { text?: unknown }).text
      : undefined;

  if (typeof texto !== 'string') {
    throw new FalloDeVoz('PROVIDER_ERROR', 'La transcripción no traía texto.');
  }

  const limpio = texto.trim();
  if (limpio.length === 0) {
    throw new FalloDeVoz(
      'VALIDATION',
      'No se oyó nada en la grabación. Acércate al micrófono y vuelve a intentarlo.',
    );
  }

  return limpio;
}
