/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El navegador, como una interfaz de seis métodos.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  El cliente de voz no toca `window`, `navigator` ni `MediaRecorder` directo:
 *  pide lo que necesita a este objeto. Parece una vuelta de más y es lo que
 *  hace que las cuatro cosas que de verdad se rompen se puedan PROBAR sin un
 *  navegador de verdad:
 *
 *    · que en Safari se elija `audio/mp4` y en Chrome `audio/webm;codecs=opus`
 *    · que el permiso denegado dé un mensaje digno y no una excepción cruda
 *    · que `callar()` de verdad corte la descarga, y no sólo el sonido
 *    · que el micrófono se SUELTE al terminar (si no, el iPhone se queda con
 *      el punto naranja encendido y el invitado siente que lo están grabando)
 *
 *  Ninguna de las cuatro se puede probar contra el `window` real desde Node, y
 *  las cuatro se rompen en silencio. `navegadorReal()` lee los globales de
 *  forma PEREZOSA —dentro de las funciones, nunca al importar el módulo— para
 *  que este archivo se pueda importar en el servidor sin reventar.
 */

/** Lo que hace falta de un `<audio>`. */
export interface ElementoDeAudio {
  src: string;
  preload: string;
  autoplay: boolean;
  play(): Promise<void>;
  pause(): void;
  load(): void;
  removeAttribute(nombre: string): void;
  addEventListener(tipo: string, oyente: () => void): void;
  removeEventListener(tipo: string, oyente: () => void): void;
}

/** Lo que hace falta de un `MediaStream`. */
export interface StreamMinimo {
  getTracks(): { stop(): void }[];
}

/** Lo que hace falta de un `MediaRecorder`. */
export interface GrabadoraMinima {
  readonly mimeType: string;
  readonly state: string;
  start(intervaloMs?: number): void;
  stop(): void;
  ondataavailable: ((evento: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((evento: unknown) => void) | null;
}

export interface OpcionesDeGrabadora {
  mimeType?: string;
  audioBitsPerSecond?: number;
}

export interface Navegador {
  fetch: typeof globalThis.fetch;
  /** `false` fuera de https (y de localhost): sin contexto seguro no hay micrófono. */
  contextoSeguro(): boolean;
  /** `null` cuando el navegador no tiene MediaRecorder — un iPhone anterior a iOS 14.3. */
  formatoSoportado(mime: string): boolean | null;
  pedirMicrofono(restricciones: unknown): Promise<StreamMinimo>;
  crearGrabadora(stream: StreamMinimo, opciones: OpcionesDeGrabadora): GrabadoraMinima;
  crearAudio(): ElementoDeAudio;
  urlDeObjeto(blob: Blob): string;
  revocarUrl(url: string): void;
  ahora(): number;
}

interface GlobalDeNavegador {
  isSecureContext?: boolean;
  Audio?: new () => ElementoDeAudio;
  MediaRecorder?: {
    new (stream: unknown, opciones?: OpcionesDeGrabadora): GrabadoraMinima;
    isTypeSupported?: (mime: string) => boolean;
  };
  navigator?: { mediaDevices?: { getUserMedia(c: unknown): Promise<StreamMinimo> } };
  URL?: { createObjectURL(b: Blob): string; revokeObjectURL(u: string): void };
}

const g = (): GlobalDeNavegador => globalThis as unknown as GlobalDeNavegador;

/** El navegador de verdad. Todo se lee dentro de las funciones, nunca al importar. */
export function navegadorReal(): Navegador {
  return {
    fetch: (...args) => globalThis.fetch(...args),

    contextoSeguro: () => g().isSecureContext === true,

    formatoSoportado: (mime) => {
      const MR = g().MediaRecorder;
      if (!MR) return null;
      // Safari 14.0 tiene MediaRecorder pero no `isTypeSupported`. Devolver
      // `false` ahí haría creer que ningún formato sirve; devolver `true`
      // mentiría. `null` significa «no sé», y quien pregunta graba sin pedir
      // formato y lee el que salga.
      return typeof MR.isTypeSupported === 'function' ? MR.isTypeSupported(mime) : null;
    },

    pedirMicrofono: async (restricciones) => {
      const medios = g().navigator?.mediaDevices;
      if (!medios) throw new Error('sin-mediaDevices');
      return medios.getUserMedia(restricciones);
    },

    crearGrabadora: (stream, opciones) => {
      const MR = g().MediaRecorder;
      if (!MR) throw new Error('sin-MediaRecorder');
      return new MR(stream, opciones);
    },

    crearAudio: () => {
      const A = g().Audio;
      if (!A) throw new Error('sin-Audio');
      return new A();
    },

    urlDeObjeto: (blob) => {
      const U = g().URL;
      if (!U) throw new Error('sin-URL');
      return U.createObjectURL(blob);
    },

    revocarUrl: (url) => {
      g().URL?.revokeObjectURL(url);
    },

    ahora: () => Date.now(),
  };
}
