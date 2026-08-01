/**
 * ════════════════════════════════════════════════════════════════════════════
 *  La máquina de estados del área — PURA
 * ════════════════════════════════════════════════════════════════════════════
 *
 *      bloqueada ──(cumple requisitos)──▶ disponible
 *                                            │
 *                       (empieza el mini-onboarding)
 *                                            ▼
 *                                       en_progreso
 *                                            │
 *                      (termina, y hay un resultado visible)
 *                                            ▼
 *                                          activa
 *
 *  ── La decisión importante: esto NO retrocede ─────────────────────────────
 *
 *  Un área abierta no se vuelve a cerrar aunque el requisito deje de cumplirse.
 *  Si borra un contacto y baja de cinco, Servicio SIGUE abierta.
 *
 *  Es una decisión de producto y va en contra de lo que pediría la simetría:
 *  una máquina de estados "correcta" recalcularía en los dos sentidos. Pero
 *  quitarle un área que ya se ganó no le enseña nada — le quita algo que ya
 *  estaba usando, por un movimiento que ni siquiera relacionó con eso. El
 *  handoff pide que se sienta como avanzar en un juego, y en ningún juego te
 *  quitan un nivel por bajar de puntos.
 *
 *  Los requisitos abren; no cierran. Para cerrar hay una vía explícita
 *  (`lock`), que es del emprendedor y del panel de agencia, no del reloj.
 */
import type { AreaState, Evaluation } from './types';

/** Qué tan lejos llegó el área. Sirve para comparar sin repartir `switch`. */
export const RANGO_ESTADO: Record<AreaState, number> = {
  bloqueada: 0,
  disponible: 1,
  en_progreso: 2,
  activa: 3,
};

/** Ya se abrió alguna vez: no vuelve a bloquearse sola. */
export function estaAbierta(state: AreaState): boolean {
  return RANGO_ESTADO[state] >= RANGO_ESTADO.disponible;
}

/** ¿Se puede entrar? Las bloqueadas se ven, con candado, pero no se abren.
 *  Es la misma regla que `isNavigable` de H5, del otro lado del contrato. */
export function navegable(state: AreaState, access: unknown): boolean {
  return state !== 'bloqueada' && access !== null && access !== undefined;
}

/** El resultado de reconciliar un área contra las señales de ahora. */
export interface Transition {
  from: AreaState;
  to: AreaState;
  changed: boolean;
  /** `true` en el instante exacto en que se abre. Es lo que dispara el
   *  mini-onboarding y lo que hace que el mapa lo pueda celebrar. */
  justUnlocked: boolean;
}

const sinCambio = (state: AreaState): Transition => ({
  from: state,
  to: state,
  changed: false,
  justUnlocked: false,
});

/**
 * El estado que le toca al área, dado su estado actual y su evaluación.
 *
 * Es la única función que decide un desbloqueo, y no depende del reloj ni de
 * quién llame: la misma entrada da la misma salida. Por eso el criterio 2 del
 * handoff —*"cumplir un requisito desbloquea sola el área, sin que nadie
 * apriete nada"*— se prueba sin base de datos.
 */
export function reconcile(current: AreaState, evaluation: Evaluation): Transition {
  // Ya abierta: los requisitos no la tocan más, ni para bien ni para mal.
  if (estaAbierta(current)) return sinCambio(current);

  if (!evaluation.met) return sinCambio(current);

  return { from: current, to: 'disponible', changed: true, justUnlocked: true };
}

/** Empieza el mini-onboarding. Sólo desde `disponible`: no se puede tutorizar
 *  un área que todavía no se ha ganado. */
export function startOnboarding(current: AreaState): Transition {
  if (current !== 'disponible') return sinCambio(current);
  return { from: current, to: 'en_progreso', changed: true, justUnlocked: false };
}

/**
 * Termina el mini-onboarding y el área queda activa.
 *
 * Se admite también desde `disponible`: si el emprendedor se salta el tutorial
 * y se pone a trabajar, el área tiene que quedar activa igual. Bloquear la
 * salida detrás de un tutorial es exactamente el ERP que este producto no
 * quiere ser.
 */
export function completeOnboarding(current: AreaState): Transition {
  if (current !== 'en_progreso' && current !== 'disponible') return sinCambio(current);
  return { from: current, to: 'activa', changed: true, justUnlocked: false };
}
