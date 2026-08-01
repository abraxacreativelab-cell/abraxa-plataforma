/**
 * ════════════════════════════════════════════════════════════════════════════
 *  NARRAR — texto entra, audio sale, y empieza a sonar antes de terminar.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  `POST /voz/api/narrar`  `{ texto, voz? }`   →  audio en streaming
 *  `GET  /voz/api/narrar?texto=…&voz=ana`      →  el mismo audio
 *
 *  ── Por qué existen las DOS ────────────────────────────────────────────────
 *
 *  El POST es el camino programático: cuerpo largo, tipado, fácil de leer.
 *
 *  El GET existe por el iPhone, y no es una comodidad. En Safari de iOS no hay
 *  MediaSource Extensions, así que la ÚNICA forma de que un audio empiece a
 *  sonar antes de haberse descargado entero es dejar que el elemento `<audio>`
 *  haga él mismo la petición — y `<audio src>` sólo sabe hacer GET. Sin esta
 *  ruta, en la mitad de los dispositivos del evento la voz tardaría en arrancar
 *  lo que tarde la frase completa en generarse.
 *
 *  ── El streaming es de verdad ──────────────────────────────────────────────
 *
 *  El cuerpo de ElevenLabs se reenvía tal cual, trozo a trozo, sin esperar al
 *  final. Lo que hace este archivo por encima es ir guardando una copia en la
 *  caché MIENTRAS pasa: el invitado oye el primer byte en cuanto existe, y el
 *  siguiente invitado no vuelve a pagar la latencia.
 *
 *  Si el navegador corta a media frase —el invitado calló la voz, cerró la
 *  pestaña— NO se guarda nada: media narración cacheada es peor que ninguna,
 *  porque se serviría entera y cortada para siempre.
 *
 *  ── Lo que este archivo NO hace ────────────────────────────────────────────
 *
 *  Decidir qué se dice. El texto viene de quien llama. El Ritual es de H7 y no
 *  se toca desde aquí.
 */
import { CacheDeNarracion } from '../../../../../packages/auth/src/voz/cache';
import {
  configDeNarracion,
  vozValida,
  type Entorno,
} from '../../../../../packages/auth/src/voz/entorno';
import { FalloDeVoz } from '../../../../../packages/auth/src/voz/errores';
import {
  revisarTexto,
  TIMEOUT_NARRAR_MS,
  TOPE_TEXTO,
  TOPE_TEXTO_EN_URL,
} from '../../../../../packages/auth/src/voz/audio';
import {
  falloDeNarracion,
  peticionDeNarracion,
  tipoDeSalida,
} from '../../../../../packages/auth/src/voz/proveedores';
import { respuestaDeError, respuestaDeFallo, SIN_SESION } from './http';
import type { QuienEntra } from './sesion';

/**
 * La caché del proceso.
 *
 * Vive en el módulo a propósito: el `route.ts` importa este archivo una vez y
 * todas las peticiones comparten la misma instancia. Ver `cache.ts` para por
 * qué en memoria y no en Redis.
 */
const cacheDelProceso = new CacheDeNarracion();

export interface DepsDeNarrar {
  sesion: () => Promise<QuienEntra | null>;
  env?: Entorno;
  /** Inyectable para las pruebas. En producción es el `fetch` de Node 22. */
  fetch?: typeof globalThis.fetch;
  cache?: CacheDeNarracion;
}

/** El estado de la caché, para diagnóstico. No lo usa el producto. */
export function estadoDeCache(): ReturnType<CacheDeNarracion['estado']> {
  return cacheDelProceso.estado();
}

export async function manejarNarrar(req: Request, deps: DepsDeNarrar): Promise<Response> {
  try {
    const quien = await deps.sesion();
    if (!quien) return respuestaDeFallo(SIN_SESION());

    const { texto, voz } = await leerPeticion(req);
    const config = configDeNarracion(voz, deps.env);
    const cache = deps.cache ?? cacheDelProceso;
    const clave = CacheDeNarracion.clave(texto, config.voz, config.modelo, config.formato);

    const guardada = cache.obtener(clave);
    if (guardada) {
      // El caso que hace que la pregunta número doce suene en el milisegundo
      // cero. `content-length` va porque aquí sí se conoce, y con él el
      // `<audio>` puede buscar dentro del clip.
      return audio(guardada.bytes, guardada.tipo, {
        origen: 'cache',
        voz: config.voz,
        modelo: config.modelo,
        largo: guardada.bytes.byteLength,
      });
    }

    const cuerpo = await sintetizar(config, texto, deps.fetch ?? globalThis.fetch);

    return audio(
      envolverParaCache(
        cuerpo,
        (bytes) => cache.guardar(clave, bytes, tipoDeSalida(config.formato)),
        cache.topePorEntrada,
      ),
      tipoDeSalida(config.formato),
      { origen: 'elevenlabs', voz: config.voz, modelo: config.modelo },
    );
  } catch (e) {
    return respuestaDeError(e);
  }
}

// ─── Leer lo que pidieron ───────────────────────────────────────────────────

async function leerPeticion(req: Request): Promise<{ texto: string; voz: ReturnType<typeof vozValida> }> {
  if (req.method === 'GET') {
    const url = new URL(req.url);
    return {
      texto: revisarTexto(url.searchParams.get('texto'), TOPE_TEXTO_EN_URL),
      voz: vozValida(url.searchParams.get('voz')),
    };
  }

  const cuerpo = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (cuerpo === null) {
    throw new FalloDeVoz('VALIDATION', 'El cuerpo tenía que ser JSON con `{ texto }`.');
  }

  return {
    texto: revisarTexto(cuerpo.texto, TOPE_TEXTO),
    voz: vozValida(cuerpo.voz),
  };
}

// ─── Hablar con ElevenLabs ──────────────────────────────────────────────────

async function sintetizar(
  config: ReturnType<typeof configDeNarracion>,
  texto: string,
  hacerFetch: typeof globalThis.fetch,
): Promise<ReadableStream<Uint8Array>> {
  const peticion = peticionDeNarracion(config, texto);

  // El timeout cubre TODA la síntesis, no sólo las cabeceras: un stream que se
  // queda a medias sin cerrar dejaría al invitado mirando un botón que gira
  // para siempre. `AbortSignal.timeout` es nativo en Node 22 — cero
  // dependencias, y se cancela solo cuando la respuesta termina.
  let respuesta: Response;
  try {
    respuesta = await hacerFetch(peticion.url, {
      ...peticion.init,
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_NARRAR_MS),
    });
  } catch (e) {
    const nombre = e instanceof Error ? e.name : '';
    const seAgoto = nombre === 'TimeoutError' || nombre === 'AbortError';
    throw new FalloDeVoz(
      'PROVIDER_ERROR',
      seAgoto
        ? `ElevenLabs no contestó en ${TIMEOUT_NARRAR_MS / 1000} segundos.`
        : 'No se pudo hablar con ElevenLabs.',
      { proveedor: 'elevenlabs', status: seAgoto ? 504 : 502, cause: e },
    );
  }

  if (!respuesta.ok) {
    // El cuerpo del error es pequeño y es EL diagnóstico: aquí es donde se
    // distingue «la factura no está pagada» de «la llave está mal».
    throw falloDeNarracion(respuesta.status, await respuesta.text().catch(() => ''));
  }

  if (!respuesta.body) {
    throw new FalloDeVoz('PROVIDER_ERROR', 'ElevenLabs contestó 200 sin audio.', {
      proveedor: 'elevenlabs',
    });
  }

  return respuesta.body;
}

// ─── Pasar y guardar a la vez ───────────────────────────────────────────────

/**
 * Reenvía el stream trozo a trozo y va acumulando una copia para la caché.
 *
 * Lo que NO hace es esperar: cada trozo sale hacia el navegador en cuanto
 * llega. La copia es un efecto secundario.
 *
 * Se acumula con un tope, y si se pasa se tira lo acumulado y se sigue
 * reenviando sin cachear. Un `push` sin tope sobre un stream que alguien
 * controla es una fuga de memoria con permiso.
 */
export function envolverParaCache(
  origen: ReadableStream<Uint8Array>,
  guardar: (bytes: Uint8Array) => void,
  topeAcumulado: number,
): ReadableStream<Uint8Array> {
  const lector = origen.getReader();
  let trozos: Uint8Array[] = [];
  let total = 0;
  let cacheable = true;

  return new ReadableStream<Uint8Array>({
    async pull(control) {
      try {
        const { done, value } = await lector.read();

        if (done) {
          if (cacheable && total > 0) guardar(unir(trozos, total));
          trozos = [];
          control.close();
          return;
        }

        control.enqueue(value);

        if (!cacheable) return;
        if (total + value.byteLength > topeAcumulado) {
          cacheable = false;
          trozos = [];
          total = 0;
          return;
        }
        trozos.push(value);
        total += value.byteLength;
      } catch (e) {
        trozos = [];
        control.error(e);
      }
    },

    cancel(motivo) {
      // El invitado calló la voz o cerró la pestaña. Media narración cacheada
      // se serviría entera y cortada para siempre, así que no se guarda.
      trozos = [];
      cacheable = false;
      return lector.cancel(motivo);
    },
  });
}

function unir(trozos: readonly Uint8Array[], total: number): Uint8Array {
  const salida = new Uint8Array(total);
  let offset = 0;
  for (const t of trozos) {
    salida.set(t, offset);
    offset += t.byteLength;
  }
  return salida;
}

// ─── La respuesta ───────────────────────────────────────────────────────────

interface MetaDeAudio {
  origen: 'cache' | 'elevenlabs';
  voz: string;
  modelo: string;
  largo?: number;
}

function audio(
  cuerpo: ReadableStream<Uint8Array> | Uint8Array,
  tipo: string,
  meta: MetaDeAudio,
): Response {
  const cabeceras: Record<string, string> = {
    'content-type': tipo,
    // `private`: es contenido detrás de sesión y ningún proxy compartido debe
    // guardarlo. `max-age`: el mismo `<audio src>` repetido en la pantalla no
    // vuelve a pedir nada.
    'cache-control': 'private, max-age=3600',
    'x-abraxa-voz': meta.origen,
    'x-abraxa-voz-voz': meta.voz,
    'x-abraxa-voz-modelo': meta.modelo,
  };
  if (meta.largo !== undefined) cabeceras['content-length'] = String(meta.largo);

  return new Response(cuerpo as BodyInit, { status: 200, headers: cabeceras });
}
