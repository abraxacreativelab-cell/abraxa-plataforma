/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Las condiciones de cierre — el criterio #6, en una sola función.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  «Una fase no avanza si faltan sus datos de cierre, aunque la conversación
 *  fluya.»
 *
 *  Eso es lo que hace que el Ritual sirva de algo. Un modelo cálido y bien
 *  educado cierra fases cuando la charla se siente bien, y una charla que se
 *  siente bien puede terminar sin que nadie haya dicho cuánto cobra. GARDEN ya
 *  lo tenía resuelto así (state-machine.ts:19-44: cada fase exige datos
 *  concretos, no "sensación de que ya") y es lo mejor de su motor.
 *
 *  Por eso `[FASE_COMPLETA:x]` es una PETICIÓN del modelo, no una orden. Aquí
 *  se decide. Si falta algo, la fase no se mueve y el guion de la siguiente
 *  vuelta le dice al agente exactamente qué le falta preguntar — que es mucho
 *  mejor que ignorarlo en silencio y dejar que insista al azar.
 */
import type { EstadoNegocio, Fase } from '../types';

/** Un requisito de cierre: cómo se llama para el humano y cómo se verifica. */
interface Requisito {
  /** Lo que se le dice al agente que le falta. En sus palabras, no en claves. */
  label: string;
  cumple(e: EstadoNegocio): boolean;
}

const lleno = (v: string | undefined): boolean => typeof v === 'string' && v.trim().length > 0;

/**
 * Qué exige cada fase para cerrar.
 *
 * Se leen de arriba abajo y el primer faltante es el que el guion prioriza, así
 * que el orden es el orden natural de la conversación.
 */
const REQUISITOS: Record<Fase, Requisito[]> = {
  bienvenida: [
    { label: 'el nombre que le pone a su agente', cumple: (e) => lleno(e.agente) },
  ],

  identidad: [
    { label: 'a qué se dedica el negocio (el giro)', cumple: (e) => lleno(e.giro) },
    { label: 'a quién le vende (su nicho o tipo de cliente)', cumple: (e) => lleno(e.nicho) },
    { label: 'en qué etapa va el negocio', cumple: (e) => lleno(e.etapa) },
    { label: 'de qué tamaño es hoy (clientes, ventas o volumen)', cumple: (e) => lleno(e.tamano) },
  ],

  modelo: [
    { label: 'cómo gana dinero exactamente', cumple: (e) => lleno(e.modeloIngreso) },
    { label: 'cuánto cobra en promedio (su ticket)', cumple: (e) => lleno(e.ticket) },
    { label: 'qué margen le deja, aunque sea aproximado', cumple: (e) => lleno(e.margen) },
    {
      label: 'por dónde le llegan los clientes hoy',
      cumple: (e) => (e.canales?.length ?? 0) > 0,
    },
  ],

  proceso: [
    {
      // Tres pasos es el mínimo con el que un recorrido es un recorrido y no
      // una anécdota: hay principio, medio y final que atacar en la fase 4.
      label: 'el recorrido de su cliente con al menos 3 pasos, de punta a punta',
      cumple: (e) => (e.recorrido?.length ?? 0) >= 3,
    },
    {
      label: 'con qué lo hace hoy (WhatsApp, Excel, libreta, lo que sea)',
      cumple: (e) => (e.herramientas?.length ?? 0) > 0,
    },
  ],

  dolor: [
    {
      label: 'al menos dos cosas que le roban tiempo o dinero',
      cumple: (e) => (e.dolores?.length ?? 0) >= 2,
    },
    {
      // El criterio #8 del handoff, convertido en condición de cierre.
      //
      // Sin esto la fase 4 se degrada a "cuéntame tus problemas", que es una
      // encuesta. Lo que da el "wow" es que el agente ATAQUE el proceso que le
      // describieron y saque algo que el emprendedor no había pedido. Si no
      // salió ni uno, la fase no cerró — y el guion se lo dice al agente.
      label:
        'al menos un hueco que TÚ detectaste atacando su proceso y que él no había pedido',
      cumple: (e) => (e.hitos ?? []).some((h) => h.origen === 'abogado_del_diablo'),
    },
  ],

  gente: [
    { label: 'si trabaja solo, con equipo o va a contratar', cumple: (e) => lleno(e.equipo) },
  ],

  // La síntesis no la cierra la conversación: la cierra el motor cuando el mapa
  // quedó persistido. Ver session/ritual.ts.
  sintesis: [],
};

/** Lo que le falta a una fase para poder cerrar. Vacío = puede avanzar. */
export function faltantesDe(fase: Fase, estado: EstadoNegocio): string[] {
  return REQUISITOS[fase].filter((r) => !r.cumple(estado)).map((r) => r.label);
}

/**
 * ¿La fase reúne sus datos de cierre?
 *
 * Ojo con lo que NO recibe: la petición del modelo. No entra en la decisión a
 * propósito.
 */
export function puedeCerrar(fase: Fase, estado: EstadoNegocio): boolean {
  return faltantesDe(fase, estado).length === 0;
}

/** Todos los requisitos de una fase, cumplidos o no. Lo usa el guion. */
export function requisitosDe(fase: Fase): string[] {
  return REQUISITOS[fase].map((r) => r.label);
}
