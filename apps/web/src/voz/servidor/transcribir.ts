/**
 * ════════════════════════════════════════════════════════════════════════════
 *  DICTAR — audio entra, texto sale. Groq si se puede, OpenAI si no.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  `POST /api/voz/transcribir`  →  `{ texto, proveedor, modelo, ms }`
 *
 *  Acepta el audio de dos formas, y las dos por una razón:
 *
 *   · `multipart/form-data` con el campo `audio` — es lo que manda el cliente
 *     del navegador, y es lo que permite mandar además el idioma o un contexto.
 *   · el cuerpo CRUDO con `content-type: audio/…` — es lo que manda un `curl`
 *     de diagnóstico a las once de la noche, y no tener que armar un multipart
 *     a mano ahorra media hora exacta.
 *
 *  ── Por qué esto existe en vez de usar el micrófono del navegador ──────────
 *
 *  Porque `SpeechRecognition` NO EXISTE en el Safari de iPhone, y con un iPhone
 *  llega la mitad de los invitados. Grabar en el navegador y transcribir en el
 *  servidor es el único camino que funciona en los dos sitios.
 *
 *  ── Los topes no son opcionales ────────────────────────────────────────────
 *
 *  Un endpoint de transcripción sin tope es una factura ajena esperando a
 *  pasar. Hay tres: sesión obligatoria, 15 MB de audio y 45 segundos de espera.
 *  El de tamaño se comprueba ANTES de leer el cuerpo cuando el navegador manda
 *  `content-length`, para no cargar en memoria lo que se va a rechazar.
 */
import {
  configDeDictado,
  type Entorno,
  type ProveedorDeDictado,
} from '../../../../../packages/auth/src/voz/entorno';
import { FalloDeVoz } from '../../../../../packages/auth/src/voz/errores';
import {
  nombreDeArchivo,
  revisarAudio,
  TIMEOUT_DICTAR_MS,
  tipoBase,
  TOPE_AUDIO_BYTES,
} from '../../../../../packages/auth/src/voz/audio';
import {
  camposDeDictado,
  falloDeDictado,
  leerTranscripcion,
} from '../../../../../packages/auth/src/voz/proveedores';
import { respuestaDeError, respuestaDeFallo, respuestaJson, SIN_SESION } from './http';
import type { QuienEntra } from './sesion';

export interface DepsDeTranscribir {
  sesion: () => Promise<QuienEntra | null>;
  env?: Entorno;
  fetch?: typeof globalThis.fetch;
  ahora?: () => number;
}

export interface Transcripcion {
  texto: string;
  proveedor: ProveedorDeDictado;
  modelo: string;
  /** Lo que tardó el proveedor. En una entrevista hablada esto se mira. */
  ms: number;
  bytes: number;
  formato: string;
}

export async function manejarTranscribir(
  req: Request,
  deps: DepsDeTranscribir,
): Promise<Response> {
  const ahora = deps.ahora ?? (() => Date.now());

  try {
    const quien = await deps.sesion();
    if (!quien) return respuestaDeFallo(SIN_SESION());

    const url = new URL(req.url);
    const audio = await leerAudio(req);
    revisarAudio(audio.bytes.byteLength, audio.tipo);

    const config = configDeDictado(deps.env, proveedorPedido(url));
    const campos = camposDeDictado(config, {
      idioma: url.searchParams.get('idioma') ?? audio.idioma ?? undefined,
      contexto: audio.contexto ?? undefined,
    });

    const formulario = new FormData();
    // EL detalle que mata el dictado si se hace mal: el nombre TIENE que llevar
    // extensión. `FormData.append('file', blob)` sin nombre manda `blob`, y
    // Groq contesta 400 «file must be one of the following types».
    // Medido el 2026-08-01. Ver `packages/auth/src/voz/audio.ts`.
    const nombre = nombreDeArchivo(audio.tipo);
    // El `as BlobPart` no es pereza: en TypeScript 5.9 `Uint8Array` es genérico
    // sobre `ArrayBufferLike`, y `BlobPart` sólo acepta el respaldado por
    // `ArrayBuffer`. En tiempo de ejecución es el mismo búfer; el estrechamiento
    // es puramente de tipos.
    const parte = audio.bytes as unknown as BlobPart;
    formulario.append('file', new File([parte], nombre, { type: tipoBase(audio.tipo) }), nombre);
    formulario.append('model', campos.modelo);
    formulario.append('language', campos.idioma);
    formulario.append('response_format', campos.formatoDeRespuesta);
    if (campos.contexto) formulario.append('prompt', campos.contexto);

    const t0 = ahora();
    const respuesta = await pedirTranscripcion(config, formulario, deps.fetch ?? globalThis.fetch);
    const cuerpo = await respuesta.text();

    if (!respuesta.ok) throw falloDeDictado(config.proveedor, respuesta.status, cuerpo);

    const salida: Transcripcion = {
      texto: leerTranscripcion(cuerpo),
      proveedor: config.proveedor,
      modelo: config.modelo,
      ms: ahora() - t0,
      bytes: audio.bytes.byteLength,
      formato: tipoBase(audio.tipo),
    };

    return respuestaJson(salida);
  } catch (e) {
    return respuestaDeError(e);
  }
}

// ─── Leer el audio ──────────────────────────────────────────────────────────

interface AudioSubido {
  bytes: Uint8Array;
  tipo: string;
  idioma?: string;
  contexto?: string;
}

async function leerAudio(req: Request): Promise<AudioSubido> {
  if (req.method !== 'POST') {
    throw new FalloDeVoz('VALIDATION', 'La transcripción se pide con POST y el audio en el cuerpo.');
  }

  // Antes de leer un solo byte. El navegador siempre manda `content-length` en
  // un `fetch` con FormData; un cuerpo troceado sin él cae al tope de después,
  // y nginx no deja pasar de 25 MB de todos modos.
  const anunciado = Number(req.headers.get('content-length') ?? '');
  if (Number.isFinite(anunciado) && anunciado > TOPE_AUDIO_BYTES) {
    revisarAudio(anunciado, null); // lanza el VALIDATION con el mensaje bueno
  }

  const contentType = req.headers.get('content-type') ?? '';

  if (contentType.toLowerCase().includes('multipart/form-data')) {
    const formulario = await req.formData().catch(() => {
      throw new FalloDeVoz('VALIDATION', 'El formulario no se pudo leer.');
    });

    // `audio` es el nombre del cliente; `file` es el que escribe cualquiera que
    // haya copiado un ejemplo de OpenAI. Aceptar los dos ahorra un tropiezo.
    const campo = formulario.get('audio') ?? formulario.get('file');
    if (!(campo instanceof Blob)) {
      throw new FalloDeVoz(
        'VALIDATION',
        'Falta el campo `audio` del formulario, o no traía un archivo.',
      );
    }

    const idioma = formulario.get('idioma');
    const contexto = formulario.get('contexto');

    return {
      bytes: new Uint8Array(await campo.arrayBuffer()),
      // Safari a veces manda el Blob sin tipo. Se cae a webm igual que en
      // `extensionDeAudio`, y el proveedor sniffea el contenido.
      tipo: campo.type || 'audio/webm',
      ...(typeof idioma === 'string' && idioma.trim() ? { idioma: idioma.trim() } : {}),
      ...(typeof contexto === 'string' && contexto.trim() ? { contexto: contexto.trim() } : {}),
    };
  }

  const crudo = await req.arrayBuffer();
  return { bytes: new Uint8Array(crudo), tipo: contentType || 'audio/webm' };
}

/**
 * `?proveedor=openai` para diagnóstico, y sólo eso.
 *
 * Está detrás de sesión y no cambia qué datos se ven: sirve para comprobar en
 * vivo, desde el VPS, si el respaldo funciona. Un valor desconocido se ignora
 * en vez de fallar — nadie debe quedarse sin dictar por escribir mal un
 * parámetro de diagnóstico.
 */
function proveedorPedido(url: URL): ProveedorDeDictado | undefined {
  const pedido = url.searchParams.get('proveedor');
  return pedido === 'groq' || pedido === 'openai' ? pedido : undefined;
}

// ─── Hablar con el proveedor ────────────────────────────────────────────────

async function pedirTranscripcion(
  config: ReturnType<typeof configDeDictado>,
  formulario: FormData,
  hacerFetch: typeof globalThis.fetch,
): Promise<Response> {
  try {
    return await hacerFetch(config.url, {
      method: 'POST',
      // El `content-type` con su `boundary` lo pone `fetch` solo a partir del
      // FormData. Escribirlo a mano rompe el multipart de una forma que el
      // proveedor reporta como «archivo corrupto».
      headers: { authorization: `Bearer ${config.llave}` },
      body: formulario,
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_DICTAR_MS),
    });
  } catch (e) {
    const nombre = e instanceof Error ? e.name : '';
    const seAgoto = nombre === 'TimeoutError' || nombre === 'AbortError';
    throw new FalloDeVoz(
      'PROVIDER_ERROR',
      seAgoto
        ? `${config.proveedor} no contestó en ${TIMEOUT_DICTAR_MS / 1000} segundos. Escribe lo ` +
          'que ibas a decir y seguimos.'
        : `No se pudo hablar con ${config.proveedor}.`,
      { proveedor: config.proveedor, status: seAgoto ? 504 : 502, cause: e },
    );
  }
}
