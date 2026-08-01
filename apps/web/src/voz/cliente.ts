/**
 * ════════════════════════════════════════════════════════════════════════════
 *  LA VOZ, del lado del navegador. Lo único que H7 tiene que importar.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *      import { crearVoz } from '@/src/voz/cliente';
 *
 *      const voz = crearVoz();
 *
 *      // Una vez, DENTRO del clic que arranca el Ritual. Ver `desbloquear()`.
 *      await voz.desbloquear();
 *
 *      await voz.narrar('¿Cómo se llama tu negocio?');
 *
 *      const grabacion = await voz.grabar();
 *      // …el invitado habla…
 *      const { texto } = await grabacion.detener();
 *
 *  ── Las cuatro cosas que este archivo resuelve, y que no son obvias ────────
 *
 *  1. EL IPHONE. `SpeechRecognition` no existe en Safari de iOS, así que se
 *     graba con `MediaRecorder` y se transcribe en el servidor. Y el formato no
 *     es el mismo: Safari graba `audio/mp4`, Chrome `audio/webm;codecs=opus`.
 *     Los dos llegan bien al proveedor —medido: 376 ms y 447 ms contra Groq—
 *     porque el nombre del archivo se deriva del MIME en el servidor.
 *
 *  2. EL AUTOPLAY DE iOS. Un `audio.play()` que no nace de un gesto del
 *     invitado lo bloquea Safari, y la promesa se rechaza con
 *     `NotAllowedError`. Pero un elemento `<audio>` que YA sonó una vez dentro
 *     de un gesto queda desbloqueado para siempre. Por eso hay UN solo elemento
 *     reutilizado y un `desbloquear()` que se llama dentro del primer clic. Sin
 *     esto, en el evento la voz funcionaría en la laptop de Santiago y en
 *     ningún iPhone.
 *
 *  3. QUE SE PUEDA CALLAR. Una voz que no se puede interrumpir enfurece.
 *     `callar()` para el sonido Y suelta el `src`, que es lo que hace que el
 *     navegador ABANDONE la descarga: sin lo segundo, iOS se sigue bajando el
 *     audio entero aunque nadie lo oiga. `grabar()` llama a `callar()` solo:
 *     si el invitado empieza a hablar, la voz se calla.
 *
 *  4. QUE SIN MICRÓFONO NO PAREZCA ROTO. Si el invitado niega el permiso, sale
 *     un `SinMicrofono` con un motivo tipado y un mensaje que se puede enseñar
 *     tal cual. El teclado sigue ahí, y nadie tiene que sentir que algo se
 *     descompuso por haber dicho que no.
 *
 *  ── Lo que este archivo NO hace ────────────────────────────────────────────
 *
 *  Ni una pantalla, ni un botón, ni una línea del guion. Es la capa. Lo que se
 *  pregunta y cuándo es del Ritual (H7).
 */
import {
  falloDesdeCuerpo,
  FalloDeVoz,
} from '../../../../packages/auth/src/voz/errores';
import {
  TOPE_AUDIO_BYTES,
  TOPE_TEXTO,
  TOPE_TEXTO_EN_URL,
} from '../../../../packages/auth/src/voz/audio';
import {
  VOZ_POR_DEFECTO,
  type NombreDeVoz,
} from '../../../../packages/auth/src/voz/entorno';
import { navegadorReal, type Navegador } from './navegador';

export type { NombreDeVoz };
export { FalloDeVoz };

// ═══════════════════════════════════════════════════════════════════════════
//  El micrófono que no se pudo abrir
// ═══════════════════════════════════════════════════════════════════════════

export type MotivoSinMicrofono =
  /** El invitado dijo que no. Es una respuesta válida, no un error. */
  | 'denegado'
  /** No hay micrófono conectado. */
  | 'sin-microfono'
  /** La página no está en https. `getUserMedia` no existe fuera de contexto seguro. */
  | 'sin-https'
  /** El navegador no sabe grabar. Un iPhone anterior a iOS 14.3. */
  | 'no-soportado'
  /** Otra pestaña o app tiene el micrófono tomado. */
  | 'ocupado'
  | 'desconocido';

/**
 * No se pudo abrir el micrófono, y se dice por qué.
 *
 * Los mensajes están escritos para enseñarse tal cual: ninguno culpa al
 * invitado y todos recuerdan que se puede escribir. Que alguien diga «no» al
 * micrófono no puede parecerse a que el producto se rompió.
 */
export class SinMicrofono extends Error {
  readonly motivo: MotivoSinMicrofono;

  constructor(motivo: MotivoSinMicrofono, mensaje: string, causa?: unknown) {
    super(mensaje, causa !== undefined ? { cause: causa } : undefined);
    this.name = 'SinMicrofono';
    this.motivo = motivo;
  }

  static es(e: unknown): e is SinMicrofono {
    return e instanceof SinMicrofono;
  }
}

const MENSAJES: Record<MotivoSinMicrofono, string> = {
  denegado:
    'Sin micrófono no pasa nada: escribe tu respuesta y seguimos igual. Si cambias de idea, ' +
    'el permiso se activa desde el candado de la barra de direcciones.',
  'sin-microfono':
    'No encontramos un micrófono conectado. Escribe tu respuesta y seguimos igual.',
  'sin-https':
    'El navegador sólo abre el micrófono en sitios seguros (https). Escribe tu respuesta y ' +
    'seguimos igual.',
  'no-soportado':
    'Este navegador no sabe grabar audio. Escribe tu respuesta y seguimos igual.',
  ocupado:
    'Otra aplicación está usando el micrófono. Ciérrala y vuelve a intentarlo, o escribe tu ' +
    'respuesta.',
  desconocido: 'No se pudo abrir el micrófono. Escribe tu respuesta y seguimos igual.',
};

/**
 * Traduce la excepción de `getUserMedia`.
 *
 * Los nombres son los del estándar y los manda el navegador, no nosotros. En
 * Safari algunos llegan con otro nombre (`SecurityError` en vez de
 * `NotAllowedError`), por eso se miran los dos.
 */
function motivoDe(e: unknown): MotivoSinMicrofono {
  const nombre = e instanceof Error ? e.name : '';
  const mensaje = e instanceof Error ? e.message : String(e);

  if (nombre === 'NotAllowedError' || nombre === 'PermissionDeniedError') return 'denegado';
  if (nombre === 'NotFoundError' || nombre === 'DevicesNotFoundError') return 'sin-microfono';
  if (nombre === 'NotReadableError' || nombre === 'TrackStartError') return 'ocupado';
  if (nombre === 'SecurityError') return 'sin-https';
  if (mensaje.includes('sin-MediaRecorder') || mensaje.includes('sin-mediaDevices')) {
    return 'no-soportado';
  }
  return 'desconocido';
}

// ═══════════════════════════════════════════════════════════════════════════
//  Formatos de grabación
// ═══════════════════════════════════════════════════════════════════════════

/**
 * En orden de preferencia.
 *
 * Chrome, Edge y Android dan el primero. Firefox el segundo o el tercero.
 * Safari —y por lo tanto TODOS los iPhone— sólo soporta `audio/mp4`, y por eso
 * está en la lista aunque nunca lo elija un navegador de escritorio.
 *
 * Que el iPhone caiga al final NO es un descuido: la lista se recorre entera y
 * `isTypeSupported` decide. Poner mp4 primero le daría a Chrome un contenedor
 * peor por nada.
 */
export const FORMATOS_PREFERIDOS: readonly string[] = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
];

/**
 * El mejor formato que este navegador sabe grabar, o `undefined`.
 *
 * `undefined` significa «no le digas nada al MediaRecorder y usa el que él
 * elija». Es el camino correcto en los Safari viejos que tienen MediaRecorder
 * pero no `isTypeSupported`: pedir un formato que no soporta lanza, y no pedir
 * ninguno siempre funciona.
 */
export function mejorFormato(nav: Navegador): string | undefined {
  for (const mime of FORMATOS_PREFERIDOS) {
    const soportado = nav.formatoSoportado(mime);
    if (soportado === null) return undefined; // no sabe: que elija él
    if (soportado) return mime;
  }
  return undefined;
}

// ═══════════════════════════════════════════════════════════════════════════
//  La voz
// ═══════════════════════════════════════════════════════════════════════════

export interface OpcionesDeVoz {
  /** Prefijo de las rutas. Vacío = relativo al origen, que es lo correcto. */
  base?: string;
  /** La voz por defecto de esta instancia. `ana` si no se dice otra cosa. */
  voz?: NombreDeVoz;
  /** Inyectable para las pruebas. En el navegador, el navegador. */
  navegador?: Navegador;
  /** Cuántas narraciones se guardan en el navegador. Tope de piezas, no de bytes. */
  topeDePrecarga?: number;
}

export interface OpcionesDeNarrar {
  voz?: NombreDeVoz;
  /** Para cortar desde fuera. `callar()` hace lo mismo. */
  signal?: AbortSignal;
}

export interface OpcionesDeGrabar {
  /** Corta sola a los dos minutos. Un turno de entrevista más largo no es un turno. */
  topeMs?: number;
  /** Idioma que se le declara a Whisper. Español por defecto. */
  idioma?: string;
  /** Sesga el vocabulario: nombres propios, el giro del negocio. */
  contexto?: string;
  /** Se llama cuando la grabación se corta sola por el tope. */
  alCortarPorTiempo?: () => void;
}

export interface Transcripcion {
  texto: string;
  proveedor: string;
  modelo: string;
  ms: number;
  bytes: number;
  formato: string;
}

export interface Grabacion {
  /** Cierra, sube y transcribe. Suelta el micrófono pase lo que pase. */
  detener(): Promise<Transcripcion>;
  /** Tira lo grabado sin subir nada. Suelta el micrófono. */
  cancelar(): void;
  /** Cuánto lleva grabando, en ms. */
  duracion(): number;
  activa(): boolean;
}

export interface Voz {
  /**
   * Prepara el audio para iOS. Llámalo DENTRO de un clic o un toque.
   *
   * Es lo único de esta API que tiene que ocurrir dentro de un gesto del
   * invitado, y saltárselo se paga con «funciona en la laptop y en ningún
   * iPhone». No lanza nunca: si el navegador dice que no, la voz simplemente no
   * queda desbloqueada y `narrar()` lo dirá con un fallo tipado.
   */
  desbloquear(): Promise<void>;
  narrar(texto: string, opciones?: OpcionesDeNarrar): Promise<void>;
  /** Genera y guarda una narración sin reproducirla. La siguiente suena al instante. */
  precargar(texto: string, opciones?: OpcionesDeNarrar): Promise<void>;
  callar(): void;
  narrando(): boolean;
  grabar(opciones?: OpcionesDeGrabar): Promise<Grabacion>;
  grabando(): boolean;
  /** La URL del audio, por si H7 prefiere poner un `<audio src>` con su propio control. */
  urlDeNarrar(texto: string, voz?: NombreDeVoz): string;
  /** Suelta el micrófono y calla. Para el `useEffect` de desmontaje. */
  destruir(): void;
}

/**
 * 44 bytes: la cabecera de un WAV con cero muestras.
 *
 * Es lo que se reproduce en `desbloquear()`. No suena —no tiene una sola
 * muestra— y con eso basta: lo que desbloquea el elemento en iOS es la LLAMADA
 * a `play()` dentro del gesto, no que salga sonido.
 */
export const SILENCIO =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

/**
 * Las dos rutas del servidor.
 *
 * Llevan `/api/` EN MEDIO de la URL a propósito, y es load-bearing:
 * `esRutaDeDatos()` de `packages/auth/src/identidad.ts:82-85` decide 401-JSON
 * contra 307-al-login mirando si la ruta contiene `/api/`. Sin ese segmento, un
 * `fetch` sin sesión seguiría el 307, recibiría el HTML del login y reventaría
 * en `r.json()` con un error de sintaxis que no se parece a «no hay sesión».
 */
export const RUTA_NARRAR = '/voz/api/narrar';
export const RUTA_TRANSCRIBIR = '/voz/api/transcribir';

export function crearVoz(opciones: OpcionesDeVoz = {}): Voz {
  const nav = opciones.navegador ?? navegadorReal();
  const base = (opciones.base ?? '').replace(/\/+$/, '');
  const vozPorDefecto = opciones.voz ?? VOZ_POR_DEFECTO;
  const topeDePrecarga = opciones.topeDePrecarga ?? 12;

  /** UN solo elemento, reutilizado. Ver el punto 2 de la cabecera. */
  let elemento: ElementoDeAudioInterno | null = null;
  let desbloqueado = false;

  /** Narraciones ya descargadas, por clave `voz|texto`. */
  const precargadas = new Map<string, Blob>();

  let cortarNarracion: (() => void) | null = null;
  let grabacionViva: GrabacionInterna | null = null;

  interface ElementoDeAudioInterno {
    el: ReturnType<Navegador['crearAudio']>;
    urlViva: string | null;
  }

  function audio(): ElementoDeAudioInterno {
    if (!elemento) {
      const el = nav.crearAudio();
      el.preload = 'auto';
      el.autoplay = false;
      elemento = { el, urlViva: null };
    }
    return elemento;
  }

  function soltarUrl(a: ElementoDeAudioInterno): void {
    if (a.urlViva) {
      nav.revocarUrl(a.urlViva);
      a.urlViva = null;
    }
  }

  function urlDeNarrar(texto: string, voz?: NombreDeVoz): string {
    const parametros = new URLSearchParams({ texto, voz: voz ?? vozPorDefecto });
    return `${base}${RUTA_NARRAR}?${parametros.toString()}`;
  }

  const clave = (texto: string, voz: NombreDeVoz): string => `${voz}|${texto}`;

  function guardarPrecarga(k: string, blob: Blob): void {
    if (precargadas.has(k)) precargadas.delete(k);
    precargadas.set(k, blob);
    // Tope simple por piezas: lo que entró primero sale primero. En un guion,
    // eso es la pregunta que ya se hizo.
    while (precargadas.size > topeDePrecarga) {
      const vieja = precargadas.keys().next();
      if (vieja.done) break;
      precargadas.delete(vieja.value);
    }
  }

  /** Pide el audio entero y lo devuelve como Blob. Errores tipados. */
  async function bajarNarracion(texto: string, voz: NombreDeVoz): Promise<Blob> {
    const largo = texto.length;
    const usaPost = largo > TOPE_TEXTO_EN_URL;

    if (largo > TOPE_TEXTO) {
      throw new FalloDeVoz(
        'VALIDATION',
        `El texto tiene ${largo} caracteres y el tope son ${TOPE_TEXTO}.`,
      );
    }

    const respuesta = await nav.fetch(usaPost ? `${base}${RUTA_NARRAR}` : urlDeNarrar(texto, voz), {
      method: usaPost ? 'POST' : 'GET',
      ...(usaPost
        ? {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ texto, voz }),
          }
        : {}),
      // Next parchea `fetch` y le pone caché por defecto. Aquí no hay datos de
      // nadie, pero una respuesta cacheada de un endpoint con sesión es un mal
      // hábito que en otro archivo sirve los datos de una persona a otra.
      cache: 'no-store',
    });

    if (!respuesta.ok) throw await falloDeRespuesta(respuesta);
    return respuesta.blob();
  }

  async function falloDeRespuesta(respuesta: Response): Promise<FalloDeVoz> {
    const cuerpo = await respuesta.json().catch(() => null);
    return falloDesdeCuerpo(cuerpo, respuesta.status);
  }

  function callar(): void {
    const pendiente = cortarNarracion;
    cortarNarracion = null;
    if (pendiente) pendiente();
  }

  async function reproducir(fuente: string, esObjeto: boolean, signal?: AbortSignal): Promise<void> {
    const a = audio();

    await new Promise<void>((resolver, rechazar) => {
      let terminado = false;

      const limpiar = (): void => {
        a.el.removeEventListener('ended', alTerminar);
        a.el.removeEventListener('error', alFallar);
        signal?.removeEventListener('abort', alCortar);
      };

      const alTerminar = (): void => {
        if (terminado) return;
        terminado = true;
        limpiar();
        cortarNarracion = null;
        if (esObjeto) soltarUrl(a);
        resolver();
      };

      const alFallar = (): void => {
        if (terminado) return;
        terminado = true;
        limpiar();
        cortarNarracion = null;
        if (esObjeto) soltarUrl(a);
        // El `<audio>` no dice POR QUÉ falló: sólo dispara `error`. Se le
        // pregunta al servidor, que sí lo sabe y lo dice tipado. Es una
        // petición extra y sólo ocurre cuando ya falló.
        diagnosticar(fuente, esObjeto).then(rechazar, rechazar);
      };

      const alCortar = (): void => {
        if (terminado) return;
        terminado = true;
        limpiar();
        // Se limpia AQUÍ y no sólo en `callar()`. Lo encontró una prueba: por
        // `callar()` se limpiaba antes de llamar a esta función, pero por un
        // `AbortSignal` nadie lo hacía, así que `narrando()` seguía diciendo
        // que sí para siempre y la siguiente narración creía tener que cortar
        // algo que ya no existía.
        cortarNarracion = null;
        detenerElemento(a, esObjeto);
        resolver(); // Callar no es un error: es lo que pidió el invitado.
      };

      cortarNarracion = alCortar;

      a.el.addEventListener('ended', alTerminar);
      a.el.addEventListener('error', alFallar);
      signal?.addEventListener('abort', alCortar);

      a.el.src = fuente;
      if (esObjeto) a.urlViva = fuente;

      void a.el.play().catch((e: unknown) => {
        if (terminado) return;
        terminado = true;
        limpiar();
        cortarNarracion = null;
        if (esObjeto) soltarUrl(a);
        rechazar(
          new FalloDeVoz(
            'PROVIDER_ERROR',
            desbloqueado
              ? 'El navegador no dejó sonar el audio.'
              : 'El navegador bloquea el sonido hasta que el invitado toca algo. Llama a ' +
                '`desbloquear()` dentro del primer clic.',
            { cause: e },
          ),
        );
      });
    });
  }

  function detenerElemento(a: ElementoDeAudioInterno, esObjeto: boolean): void {
    a.el.pause();
    // Soltar el `src` es lo que hace que el navegador ABANDONE la descarga. Sin
    // esto iOS se sigue bajando el audio entero aunque nadie lo oiga.
    a.el.removeAttribute('src');
    a.el.load();
    if (esObjeto) soltarUrl(a);
  }

  async function diagnosticar(fuente: string, esObjeto: boolean): Promise<FalloDeVoz> {
    if (esObjeto) {
      return new FalloDeVoz('PROVIDER_ERROR', 'El navegador no pudo reproducir el audio.');
    }
    try {
      const respuesta = await nav.fetch(fuente, { cache: 'no-store' });
      if (!respuesta.ok) return falloDeRespuesta(respuesta);
    } catch {
      // Sin red no hay diagnóstico. Se dice lo que se sabe.
    }
    return new FalloDeVoz('PROVIDER_ERROR', 'El navegador no pudo reproducir el audio.');
  }

  // ─── La API ──────────────────────────────────────────────────────────────

  return {
    urlDeNarrar,

    async desbloquear(): Promise<void> {
      try {
        const a = audio();
        a.el.src = SILENCIO;
        await a.el.play();
        a.el.pause();
        desbloqueado = true;
      } catch {
        // El navegador dijo que no. No es un error que valga la pena enseñar:
        // `narrar()` lo dirá con un mensaje que sí se entiende.
        desbloqueado = false;
      }
    },

    async narrar(texto: string, op: OpcionesDeNarrar = {}): Promise<void> {
      callar();

      const voz = op.voz ?? vozPorDefecto;
      const listo = precargadas.get(clave(texto, voz));

      if (listo) {
        // Instantáneo: ya está en el navegador. Es lo que hace que la primera
        // pregunta suene en el milisegundo cero.
        await reproducir(nav.urlDeObjeto(listo), true, op.signal);
        return;
      }

      if (texto.length > TOPE_TEXTO_EN_URL) {
        // No cabe en la URL: se baja por POST y se reproduce como Blob. Se
        // pierde el arranque progresivo, y es el precio correcto — un texto de
        // ochocientos caracteres en una entrevista ya es un monólogo.
        const blob = await bajarNarracion(texto, voz);
        await reproducir(nav.urlDeObjeto(blob), true, op.signal);
        return;
      }

      // El camino bueno: el `<audio>` hace él la petición y empieza a sonar en
      // cuanto tiene los primeros bytes. Es la única forma de arranque
      // progresivo que funciona en iPhone.
      await reproducir(urlDeNarrar(texto, voz), false, op.signal);
    },

    async precargar(texto: string, op: OpcionesDeNarrar = {}): Promise<void> {
      const voz = op.voz ?? vozPorDefecto;
      const k = clave(texto, voz);
      if (precargadas.has(k)) return;
      guardarPrecarga(k, await bajarNarracion(texto, voz));
    },

    callar,

    narrando: () => cortarNarracion !== null,

    grabando: () => grabacionViva !== null && grabacionViva.activa(),

    async grabar(op: OpcionesDeGrabar = {}): Promise<Grabacion> {
      // Barge-in: si el invitado va a hablar, la voz se calla. Y de paso el
      // micrófono no graba a la agente hablando encima.
      callar();

      if (grabacionViva?.activa()) grabacionViva.cancelar();

      if (!nav.contextoSeguro()) {
        throw new SinMicrofono('sin-https', MENSAJES['sin-https']);
      }

      let stream: Awaited<ReturnType<Navegador['pedirMicrofono']>>;
      try {
        stream = await nav.pedirMicrofono({
          audio: {
            // Los tres importan en una sala con gente: sin cancelación de eco,
            // el micrófono se graba a la propia agente hablando.
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch (e) {
        const motivo = motivoDe(e);
        throw new SinMicrofono(motivo, MENSAJES[motivo], e);
      }

      const soltar = (): void => {
        for (const pista of stream.getTracks()) pista.stop();
      };

      const formato = mejorFormato(nav);
      let grabadora: ReturnType<Navegador['crearGrabadora']>;
      try {
        grabadora = nav.crearGrabadora(stream, {
          ...(formato ? { mimeType: formato } : {}),
          // 32 kbps de opus es voz limpia y un minuto pesa 240 KB. Subir más
          // sólo hace la subida más lenta en la red del evento.
          audioBitsPerSecond: 32_000,
        });
      } catch (e) {
        soltar();
        const motivo = motivoDe(e);
        throw new SinMicrofono(motivo === 'desconocido' ? 'no-soportado' : motivo, MENSAJES[motivo === 'desconocido' ? 'no-soportado' : motivo], e);
      }

      const grabacion = new GrabacionInterna(nav, grabadora, soltar, base, op);
      grabacionViva = grabacion;
      grabacion.arrancar();
      return grabacion;
    },

    destruir(): void {
      callar();
      grabacionViva?.cancelar();
      grabacionViva = null;
      if (elemento) {
        detenerElemento(elemento, true);
        elemento = null;
      }
      precargadas.clear();
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  La grabación
// ═══════════════════════════════════════════════════════════════════════════

class GrabacionInterna implements Grabacion {
  private readonly trozos: Blob[] = [];
  private readonly inicio: number;
  private cerrada = false;
  private bytes = 0;
  private alarma: ReturnType<typeof setTimeout> | null = null;
  private cerrar: (() => void) | null = null;

  constructor(
    private readonly nav: Navegador,
    private readonly grabadora: ReturnType<Navegador['crearGrabadora']>,
    private readonly soltarMicrofono: () => void,
    private readonly base: string,
    private readonly op: OpcionesDeGrabar,
  ) {
    this.inicio = nav.ahora();
  }

  arrancar(): void {
    this.grabadora.ondataavailable = (evento): void => {
      if (evento.data && evento.data.size > 0) {
        this.trozos.push(evento.data);
        this.bytes += evento.data.size;
        // Tope duro del lado del navegador: nada que pase de aquí se sube
        // siquiera. El servidor tiene el suyo, pero cortar antes ahorra una
        // subida de quince megas por la red del evento.
        if (this.bytes >= TOPE_AUDIO_BYTES) this.pararGrabadora();
      }
    };

    this.grabadora.onstop = (): void => {
      const fin = this.cerrar;
      this.cerrar = null;
      if (fin) fin();
    };

    this.grabadora.onerror = (): void => {
      const fin = this.cerrar;
      this.cerrar = null;
      if (fin) fin();
    };

    // Trozos de un segundo: si algo se cae a la mitad, se conserva casi todo,
    // y `ondataavailable` puede vigilar el tamaño mientras se graba.
    this.grabadora.start(1000);

    const topeMs = this.op.topeMs ?? 120_000;
    this.alarma = setTimeout(() => {
      this.op.alCortarPorTiempo?.();
      this.pararGrabadora();
    }, topeMs);
  }

  private pararGrabadora(): void {
    if (this.alarma) {
      clearTimeout(this.alarma);
      this.alarma = null;
    }
    try {
      if (this.grabadora.state !== 'inactive') this.grabadora.stop();
    } catch {
      // Una grabadora que ya se paró sola. No hay nada que hacer.
    }
  }

  activa(): boolean {
    return !this.cerrada;
  }

  duracion(): number {
    return this.nav.ahora() - this.inicio;
  }

  cancelar(): void {
    if (this.cerrada) return;
    this.cerrada = true;
    this.pararGrabadora();
    this.trozos.length = 0;
    // SIEMPRE. Si el micrófono no se suelta, el iPhone deja el punto naranja
    // encendido y el invitado siente que lo están grabando.
    this.soltarMicrofono();
  }

  async detener(): Promise<Transcripcion> {
    if (this.cerrada) {
      throw new FalloDeVoz('VALIDATION', 'Esta grabación ya se había cerrado.');
    }
    this.cerrada = true;

    try {
      await new Promise<void>((resolver) => {
        this.cerrar = resolver;
        this.pararGrabadora();
        // Si la grabadora ya estaba parada, `onstop` no vuelve a dispararse.
        if (this.grabadora.state === 'inactive' && this.cerrar) {
          this.cerrar = null;
          resolver();
        }
      });

      const tipo = this.grabadora.mimeType || 'audio/webm';
      const blob = new Blob(this.trozos, { type: tipo });

      if (blob.size === 0) {
        throw new FalloDeVoz(
          'VALIDATION',
          'No se grabó nada. Puede que se haya cortado antes de tiempo: mantén el botón un ' +
            'momento más mientras hablas.',
        );
      }

      return await this.subir(blob);
    } finally {
      this.soltarMicrofono();
    }
  }

  private async subir(blob: Blob): Promise<Transcripcion> {
    const formulario = new FormData();
    // El nombre lleva extensión porque el servidor la vuelve a derivar del
    // MIME, pero un nombre honesto ayuda a leer un log. La extensión REAL la
    // pone el servidor: ver `packages/auth/src/voz/audio.ts`.
    formulario.append('audio', blob, 'grabacion');
    if (this.op.idioma) formulario.append('idioma', this.op.idioma);
    if (this.op.contexto) formulario.append('contexto', this.op.contexto);

    const respuesta = await this.nav.fetch(`${this.base}${RUTA_TRANSCRIBIR}`, {
      method: 'POST',
      body: formulario,
      cache: 'no-store',
    });

    if (!respuesta.ok) {
      const cuerpo = await respuesta.json().catch(() => null);
      throw falloDesdeCuerpo(cuerpo, respuesta.status);
    }

    const datos = (await respuesta.json()) as Transcripcion;
    if (typeof datos?.texto !== 'string') {
      throw new FalloDeVoz('PROVIDER_ERROR', 'La transcripción no vino con texto.');
    }
    return datos;
  }
}
