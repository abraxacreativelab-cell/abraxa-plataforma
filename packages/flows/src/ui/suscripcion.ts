/**
 * ════════════════════════════════════════════════════════════════════════════
 *  `suscribirseACorrida` — LA ÚNICA función que sabe cómo llegan los datos.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  La pantalla ve una corrida avanzar paso por paso. Cómo se entera es
 *  problema de este archivo y de ningún otro: el panel recibe fotos por un
 *  callback y no tiene forma de saber si vienen de un `fetch`, de un socket o
 *  de una prueba. Ése es el criterio #3, y por eso se puede sustituir esta
 *  función entera en una prueba y la UI ni se inmuta.
 *
 *  ── Por qué polling de 1 segundo y no SSE ─────────────────────────────────
 *
 *  Porque el SSE de hoy sería mentira. `apps/api` y `apps/worker` son DOS
 *  PROCESOS distintos (dos entradas, dos builds): quien ejecuta los pasos es
 *  el worker y quien tendría el SSE abierto es la API. Un `EventEmitter` en
 *  proceso pasaría todas las pruebas y no emitiría un solo evento en
 *  producción. Y no hay `LISTEN`/`NOTIFY` cableado ni Realtime configurado en
 *  ningún lado del repo.
 *
 *  Un segundo se ve "en vivo" para un humano y funciona de verdad. Son 10×
 *  más rápido que el polling de 10 s de GARDEN, que se siente muerto.
 *
 *  El día que exista `LISTEN`/`NOTIFY`, cambia ESTE archivo y nada más.
 *
 *  ── Las dos cosas que apagan el reloj, que es donde esto se cae ───────────
 *
 *  1. **La corrida terminó.** Un intervalo que sigue pidiendo una corrida
 *     cerrada es una petición por segundo, para siempre, por cada pestaña.
 *  2. **La pestaña está oculta.** Una pestaña olvidada un fin de semana son
 *     ~170 000 peticiones y una factura de Supabase que nadie sabe explicar.
 *     Al volver a mostrarse pide de inmediato, sin esperar el siguiente tic:
 *     lo primero que ve el usuario ya está al día.
 *
 *  Todo lo de afuera —el reloj, la visibilidad, la petición— entra por
 *  parámetros. Así esto se prueba con un reloj falso, en milisegundos, sin
 *  navegador y sin red.
 */
import type { RunSnapshot } from '../types';
import { esTerminal } from '../types';

/** Cómo se pide una foto. En el navegador es un `fetch`; en las pruebas, no. */
export interface FuenteDeCorrida {
  (runId: string): Promise<RunSnapshot>;
}

/** Un temporizador cualquiera. `setTimeout` cumple; un reloj falso también. */
export interface Reloj {
  programar(fn: () => void, ms: number): unknown;
  cancelar(id: unknown): void;
}

export interface Visibilidad {
  visible(): boolean;
  /** Se suscribe a los cambios y devuelve cómo desuscribirse. */
  alCambiar(cb: () => void): () => void;
}

export interface OpcionesDeSuscripcion {
  pedir: FuenteDeCorrida;
  intervaloMs?: number;
  reloj?: Reloj;
  visibilidad?: Visibilidad;
  /** Se llama con cada error. La UI decide si lo pinta. */
  alFallar?: (err: unknown) => void;
  /** Se llama UNA vez cuando la corrida llega a un estado terminal. */
  alTerminar?: (foto: RunSnapshot) => void;
}

/** El reloj de verdad. */
const RELOJ_REAL: Reloj = {
  programar: (fn, ms) => setTimeout(fn, ms),
  cancelar: (id) => {
    clearTimeout(id as ReturnType<typeof setTimeout>);
  },
};

/**
 * Siempre visible. Es el valor por defecto fuera del navegador (y en las
 * pruebas): sin `document`, "oculto" no significa nada.
 */
const SIEMPRE_VISIBLE: Visibilidad = {
  visible: () => true,
  alCambiar: () => () => undefined,
};

/**
 * Cuánto se espera tras un error, creciendo: 1s, 2s, 4s… hasta 15s.
 *
 * Sin esto, una API caída recibe una petición por segundo desde cada pestaña
 * abierta — justo cuando menos puede con ellas.
 */
function esperaTrasFallo(fallosSeguidos: number, base: number): number {
  return Math.min(base * 2 ** fallosSeguidos, 15_000);
}

/**
 * Empieza a seguir una corrida. Devuelve cómo dejar de seguirla.
 *
 * Llamar a la función devuelta es seguro en cualquier momento: cancela el
 * temporizador, se desuscribe de la visibilidad y descarta cualquier respuesta
 * que llegue tarde. Un callback que se dispara después de que el componente se
 * desmontó es un error de React y un dato pintado sobre una pantalla que ya no
 * existe.
 */
export function suscribirseACorrida(
  runId: string,
  alRecibir: (foto: RunSnapshot) => void,
  opciones: OpcionesDeSuscripcion,
): () => void {
  const intervalo = opciones.intervaloMs ?? 1000;
  const reloj = opciones.reloj ?? RELOJ_REAL;
  const visibilidad = opciones.visibilidad ?? SIEMPRE_VISIBLE;

  let vivo = true;
  let temporizador: unknown = null;
  let fallosSeguidos = 0;
  let enVuelo = false;

  const cancelarTemporizador = (): void => {
    if (temporizador !== null) {
      reloj.cancelar(temporizador);
      temporizador = null;
    }
  };

  const programar = (ms: number): void => {
    cancelarTemporizador();
    if (!vivo) return;
    temporizador = reloj.programar(() => {
      temporizador = null;
      void tic();
    }, ms);
  };

  const tic = async (): Promise<void> => {
    if (!vivo || enVuelo) return;

    // La pestaña está oculta: no se pide nada y no se reprograma. El reloj lo
    // vuelve a arrancar el evento de visibilidad, no un tic en vacío.
    if (!visibilidad.visible()) return;

    enVuelo = true;
    try {
      const foto = await opciones.pedir(runId);
      if (!vivo) return; // llegó tarde: la suscripción ya se canceló
      fallosSeguidos = 0;
      alRecibir(foto);

      if (esTerminal(foto.run.status)) {
        // Terminó. Se apaga sola: nadie tiene que acordarse de apagarla.
        vivo = false;
        cancelarTemporizador();
        opciones.alTerminar?.(foto);
        return;
      }
      programar(intervalo);
    } catch (err) {
      if (!vivo) return;
      fallosSeguidos += 1;
      opciones.alFallar?.(err);
      programar(esperaTrasFallo(fallosSeguidos, intervalo));
    } finally {
      enVuelo = false;
    }
  };

  const desuscribirVisibilidad = visibilidad.alCambiar(() => {
    if (!vivo) return;
    if (visibilidad.visible()) {
      // Al volver, la foto de inmediato: lo primero que se ve ya está al día.
      void tic();
    } else {
      cancelarTemporizador();
    }
  });

  // La primera foto sale ya, sin esperar el primer tic.
  void tic();

  return () => {
    vivo = false;
    cancelarTemporizador();
    desuscribirVisibilidad();
  };
}
