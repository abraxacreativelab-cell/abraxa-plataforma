'use client';

import * as React from 'react';
import {
  crearVoz,
  FalloDeVoz,
  SinMicrofono,
  type Grabacion,
  type Voz,
} from '@/src/voz/cliente';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  La voz del Ritual: narrar cada pregunta, dictar la respuesta, y CALLARSE.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  La tubería es de otro carril (`apps/web/src/voz/`, con su README). Aquí sólo
 *  se decide CUÁNDO habla y cuándo se calla, que es lo que separa una voz que
 *  acompaña de una que enfurece.
 *
 *  ── Las cuatro reglas ─────────────────────────────────────────────────────
 *
 *   1. **Narra la pregunta cuando aparece.** Sólo la última del agente, sólo
 *      una vez, y sólo si el invitado encendió la voz.
 *   2. **Se calla al primer indicio de que él quiere hablar o escribir.** Una
 *      tecla, el micrófono, mandar un mensaje: cualquiera corta la narración en
 *      el acto. Esperar a que termine de leer para poder contestar es la forma
 *      más rápida de que alguien apague la voz para siempre.
 *   3. **Degrada en silencio.** 402 (sin crédito), 501 (sin llave), 429 o un
 *      micrófono denegado NO producen un error en pantalla. La voz se apaga —
 *      definitivamente o por ese intento— y la entrevista sigue por escrito
 *      exactamente igual. El invitado no tiene por qué enterarse de que algo
 *      faltaba: la pregunta ya está escrita delante de él.
 *   4. **Es opcional y se recuerda.** Un interruptor visible, guardado en el
 *      navegador, que respeta `prefers-reduced-motion` — quien pidió menos
 *      movimiento tampoco pidió que le hablen — y que arranca APAGADO. Una
 *      página que se pone a hablar sola en una oficina es una página que se
 *      cierra.
 */

/** Dónde se recuerda la preferencia. Es del navegador, no del negocio. */
const LLAVE = 'abraxa.ritual.voz';

export type EstadoDeVoz = 'apagada' | 'encendida' | 'no-disponible';

export interface VozDelRitual {
  estado: EstadoDeVoz;
  /** `true` mientras el agente está leyendo. */
  narrando: boolean;
  /** `true` mientras se está grabando al invitado. */
  grabando: boolean;
  /** Segundos que lleva grabando. Para el contador del botón. */
  segundos: number;
  /** `true` si el navegador puede grabar. Si no, el micrófono ni se enseña. */
  puedeDictar: boolean;
  /** Enciende o apaga. Debe llamarse DESDE el clic: iOS lo exige. */
  alternar: () => void;
  /** Corta la narración. Idempotente y barato. */
  callar: () => void;
  /** Narra si la voz está encendida. Nunca lanza. */
  narrar: (texto: string) => void;
  /** Arranca el micrófono. Devuelve `false` si no se pudo (y ya lo dijo). */
  dictar: () => Promise<boolean>;
  /** Cierra el micrófono y devuelve lo transcrito, o `null`. */
  terminarDictado: () => Promise<string | null>;
  /** Tira lo grabado. */
  cancelarDictado: () => void;
  /**
   * Lo único que la voz puede poner en pantalla: por qué no se abrió el
   * micrófono. Y sólo eso, porque el invitado LO PIDIÓ y merece saber por qué
   * no pasó nada. Un fallo de narración jamás llega aquí.
   */
  avisoDelMicrofono: string | null;
  limpiarAviso: () => void;
}

function leerPreferencia(): boolean {
  try {
    return globalThis.localStorage?.getItem(LLAVE) === 'on';
  } catch {
    // Safari en modo privado lanza al tocar localStorage. No es motivo para
    // quedarse sin producto: se asume apagada.
    return false;
  }
}

function guardarPreferencia(encendida: boolean): void {
  try {
    globalThis.localStorage?.setItem(LLAVE, encendida ? 'on' : 'off');
  } catch {
    /* da igual: la sesión sigue funcionando, sólo no se recuerda */
  }
}

/** ¿Este navegador pidió menos movimiento? Entonces tampoco pidió que le hablen. */
function pidioCalma(): boolean {
  try {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}

/** ¿Se puede grabar aquí? Sin esto el botón del micrófono sería una promesa falsa. */
function sePuedeGrabar(): boolean {
  try {
    const md = (globalThis.navigator as Navigator | undefined)?.mediaDevices;
    return typeof md?.getUserMedia === 'function' && typeof globalThis.MediaRecorder === 'function';
  } catch {
    return false;
  }
}

export function useVozDelRitual(opciones: { contexto?: string } = {}): VozDelRitual {
  const contexto = opciones.contexto ?? '';

  const voz = React.useRef<Voz | null>(null);
  const grabacion = React.useRef<Grabacion | null>(null);
  const yaNarrado = React.useRef<string | null>(null);

  const [estado, setEstado] = React.useState<EstadoDeVoz>('apagada');
  const [narrando, setNarrando] = React.useState(false);
  const [grabando, setGrabando] = React.useState(false);
  const [segundos, setSegundos] = React.useState(0);
  const [puedeDictar, setPuedeDictar] = React.useState(false);
  const [avisoDelMicrofono, setAviso] = React.useState<string | null>(null);

  // Se resuelve en el cliente y no en el render del servidor: `localStorage` y
  // `matchMedia` no existen allá, y leerlos en el render rompería la hidratación.
  React.useEffect(() => {
    setPuedeDictar(sePuedeGrabar());
    if (leerPreferencia() && !pidioCalma()) {
      // Encendida de sesiones anteriores. NO se narra todavía: iOS exige que el
      // primer sonido nazca de un gesto, así que el desbloqueo espera al primer
      // toque de esta sesión. Ver `alternar` y `desbloquearConGesto`.
      setEstado('encendida');
    }
  }, []);

  const instancia = React.useCallback((): Voz => {
    voz.current ??= crearVoz();
    return voz.current;
  }, []);

  // ── Callar ────────────────────────────────────────────────────────────────
  const callar = React.useCallback((): void => {
    voz.current?.callar();
    setNarrando(false);
  }, []);

  /**
   * El desbloqueo de iOS, colgado del PRIMER gesto de la sesión.
   *
   * Safari de iPhone bloquea cualquier audio que no nazca de un toque, y un
   * elemento que ya sonó una vez dentro de un gesto queda libre para siempre.
   * Como la preferencia puede venir encendida de ayer, hay que enganchar el
   * primer toque de HOY o la voz no sonaría nunca en iPhone — sin un solo error
   * y sin nada en la consola, que es el peor modo de fallo posible.
   */
  const desbloqueado = React.useRef(false);
  React.useEffect(() => {
    if (estado !== 'encendida' || desbloqueado.current) return;

    const abrir = (): void => {
      if (desbloqueado.current) return;
      desbloqueado.current = true;
      void instancia().desbloquear();
    };

    globalThis.addEventListener?.('pointerdown', abrir, { once: true, passive: true });
    globalThis.addEventListener?.('keydown', abrir, { once: true });
    return () => {
      globalThis.removeEventListener?.('pointerdown', abrir);
      globalThis.removeEventListener?.('keydown', abrir);
    };
  }, [estado, instancia]);

  // ── El interruptor ────────────────────────────────────────────────────────
  const alternar = React.useCallback((): void => {
    setEstado((previo) => {
      if (previo === 'no-disponible') return previo;

      const siguiente: EstadoDeVoz = previo === 'encendida' ? 'apagada' : 'encendida';
      guardarPreferencia(siguiente === 'encendida');

      if (siguiente === 'encendida') {
        // ESTO corre dentro del clic, que es lo único que iOS acepta.
        desbloqueado.current = true;
        void instancia().desbloquear();
      } else {
        voz.current?.callar();
        setNarrando(false);
      }

      return siguiente;
    });
  }, [instancia]);

  // ── Narrar ────────────────────────────────────────────────────────────────
  const narrar = React.useCallback(
    (texto: string): void => {
      if (estado !== 'encendida') return;

      const limpio = texto.trim();
      if (!limpio) return;
      // Recargar la página no puede hacer que relea lo mismo, y un re-render
      // tampoco. Se narra un texto UNA vez.
      if (yaNarrado.current === limpio) return;
      yaNarrado.current = limpio;

      setNarrando(true);
      void instancia()
        .narrar(limpio)
        .catch((e: unknown) => {
          // ── Aquí es donde la voz degrada, y por eso no hay `setError` ────
          //
          // 402 sin crédito en ElevenLabs, 501 sin llave en este despliegue,
          // 429 de más peticiones: los tres se ven igual desde la silla del
          // invitado —no sonó— y ninguno le impide contestar, porque la
          // pregunta está escrita delante de él. Un recuadro rojo diciendo
          // "BUDGET_EXCEEDED" convertiría un detalle invisible en un producto
          // roto.
          if (FalloDeVoz.es(e) && e.definitivo) {
            // No hay nada que reintentar hasta que alguien toque el servidor.
            // Se apaga para la sesión y ni siquiera se vuelve a pedir.
            setEstado('no-disponible');
            guardarPreferencia(false);
          }
        })
        .finally(() => setNarrando(false));
    },
    [estado, instancia],
  );

  // ── Dictar ────────────────────────────────────────────────────────────────
  const dictar = React.useCallback(async (): Promise<boolean> => {
    setAviso(null);
    // Si el agente está leyendo, se calla: el micrófono no se puede grabar a sí
    // mismo. (`grabar()` también lo hace, pero la pantalla tiene que reflejarlo.)
    callar();

    try {
      grabacion.current = await instancia().grabar({
        contexto,
        alCortarPorTiempo: () => setGrabando(false),
      });
      setGrabando(true);
      setSegundos(0);
      return true;
    } catch (e) {
      // El ÚNICO fallo de voz que se le enseña al invitado, porque él lo pidió
      // explícitamente y se quedaría esperando. Los mensajes vienen redactados
      // del cliente de voz: ninguno lo culpa y todos recuerdan que puede
      // escribir.
      if (SinMicrofono.es(e)) setAviso(e.message);
      else setAviso('No se pudo abrir el micrófono. Escribe tu respuesta y seguimos igual.');
      setGrabando(false);
      return false;
    }
  }, [callar, contexto, instancia]);

  // El contador del botón. Sin él, grabar se siente como si no estuviera
  // pasando nada — y la gente suelta el botón antes de terminar la frase.
  React.useEffect(() => {
    if (!grabando) return;
    const reloj = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => clearInterval(reloj);
  }, [grabando]);

  const terminarDictado = React.useCallback(async (): Promise<string | null> => {
    const viva = grabacion.current;
    grabacion.current = null;
    setGrabando(false);
    setSegundos(0);
    if (!viva) return null;

    try {
      const { texto } = await viva.detener();
      const limpio = texto.trim();
      if (!limpio) {
        setAviso('No alcancé a oír nada. Prueba otra vez o escríbelo.');
        return null;
      }
      return limpio;
    } catch (e) {
      // 429, el proveedor caído, o un audio de cero bytes. Todos terminan
      // igual: se le devuelve el turno al teclado, sin drama.
      const mensaje =
        FalloDeVoz.es(e) && e.reintentable
          ? 'No alcancé a transcribirlo. Prueba otra vez o escríbelo.'
          : 'No pude pasar tu audio a texto. Escríbelo y seguimos igual.';
      setAviso(mensaje);
      return null;
    }
  }, []);

  const cancelarDictado = React.useCallback((): void => {
    grabacion.current?.cancelar();
    grabacion.current = null;
    setGrabando(false);
    setSegundos(0);
  }, []);

  // Soltar el micrófono al salir de la pantalla. Sin esto el punto rojo del
  // navegador se queda encendido, que es la forma más rápida de que alguien
  // desconfíe del producto.
  React.useEffect(() => {
    return () => {
      voz.current?.destruir();
      voz.current = null;
    };
  }, []);

  return {
    estado,
    narrando,
    grabando,
    segundos,
    puedeDictar,
    alternar,
    callar,
    narrar,
    dictar,
    terminarDictado,
    cancelarDictado,
    avisoDelMicrofono,
    limpiarAviso: React.useCallback(() => setAviso(null), []),
  };
}
