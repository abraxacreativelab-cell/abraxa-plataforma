/**
 * ════════════════════════════════════════════════════════════════════════════
 *  ¿Debe contestar la IA? — la función que cierra el hueco de GARDEN.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  En GARDEN `crm_threads.ai_enabled` está declarado en el tipo y no se lee en
 *  ningún lado: su ÚNICA aparición en todo el repo es `src/crm/types.ts:281`.
 *  Los bots viven en `garden.conversations` y la bandeja en `crm_threads`, y
 *  nunca se cableó el puente. Ésta es la línea que faltaba.
 *
 *  Es una función PURA, y eso es deliberado. La decisión de si el agente de un
 *  cliente contesta o se calla es la regla de negocio más cara de equivocar del
 *  producto: tiene que poder probarse entera, con reloj fijo y sin base de
 *  datos, en milisegundos y sin excusas.
 *
 *  El orden de las condiciones también es deliberado — va de lo más humano a lo
 *  más mecánico, para que el motivo que sale en el log sea el que de verdad le
 *  importa a quien lo lee. Si un humano tomó el hilo Y además es fuera de
 *  horario, la razón útil es que hay un humano.
 */
import type { BusinessHours } from '../types';
import { dentroDeHorario } from './hours';

export type RazonSilencio =
  /** Eco de algo que mandamos nosotros. */
  | 'eco_propio'
  /** El mensaje no trae texto: sólo media, una reacción, un acuse. */
  | 'sin_texto'
  /** Un humano tomó el hilo. La regla que no se negocia. */
  | 'humano_en_el_hilo'
  /** El emprendedor apagó la IA en este hilo. */
  | 'hilo_sin_ia'
  /** Pausa temporal todavía vigente. */
  | 'ia_en_pausa'
  /** El canal entero tiene la IA apagada. */
  | 'canal_sin_ia'
  /** Fuera del horario de atención, y el canal pidió silencio fuera de horario. */
  | 'fuera_de_horario'
  /** El canal no tiene agente asignado. */
  | 'sin_agente';

export type Decision = { responde: true } | { responde: false; razon: RazonSilencio };

export interface EntradaDecision {
  canal: {
    ai_enabled: boolean;
    agent_role: string | null;
    business_hours: BusinessHours | null | undefined;
    ai_outside_hours: boolean;
  };
  hilo: {
    ai_enabled: boolean;
    assigned_to: string | null;
    ai_paused_until: string | null;
  };
  mensaje: {
    /** El texto. Vacío o sólo espacios cuenta como sin texto. */
    body: string | null;
    /** Eco de un saliente nuestro. */
    fromMe?: boolean;
  };
}

/**
 * La decisión, y cuando es que no, POR QUÉ.
 *
 * La razón no es para el log: se guarda en `messages.ai_reason`. Un hilo donde
 * el agente no contestó y nadie sabe por qué es la clase de cosa que le hace
 * perder la confianza al emprendedor — y es lo que más caro sale de recuperar.
 */
export function decidirSiContesta(e: EntradaDecision, ahora: Date = new Date()): Decision {
  if (e.mensaje.fromMe) return { responde: false, razon: 'eco_propio' };

  if (!e.mensaje.body || e.mensaje.body.trim().length === 0) {
    return { responde: false, razon: 'sin_texto' };
  }

  // ── La regla que no se negocia ────────────────────────────────────────────
  // Un humano tomó el hilo → la IA se calla. Sin excepción, y antes que
  // cualquier otra condición: nada peor que el agente contestando encima de su
  // dueño.
  if (e.hilo.assigned_to) return { responde: false, razon: 'humano_en_el_hilo' };

  if (!e.hilo.ai_enabled) return { responde: false, razon: 'hilo_sin_ia' };

  if (pausaVigente(e.hilo.ai_paused_until, ahora)) {
    return { responde: false, razon: 'ia_en_pausa' };
  }

  if (!e.canal.ai_enabled) return { responde: false, razon: 'canal_sin_ia' };

  if (!e.canal.agent_role) return { responde: false, razon: 'sin_agente' };

  if (!e.canal.ai_outside_hours && !dentroDeHorario(e.canal.business_hours, ahora)) {
    return { responde: false, razon: 'fuera_de_horario' };
  }

  return { responde: true };
}

/**
 * ¿Sigue vigente la pausa?
 *
 * Una fecha ilegible se trata como SIN pausa. Es la elección menos mala: entre
 * un agente que contesta cuando quizá no debía y un agente que se calla para
 * siempre porque una fila quedó con basura, lo segundo se ve como "el producto
 * no funciona" y nadie sabe por dónde empezar a buscar.
 */
export function pausaVigente(hasta: string | null | undefined, ahora: Date): boolean {
  if (!hasta) return false;
  const t = Date.parse(hasta);
  if (!Number.isFinite(t)) return false;
  return t > ahora.getTime();
}

/** Qué se le dice al emprendedor. La razón sale en la UI del hilo. */
export const EXPLICACION: Record<RazonSilencio, string> = {
  eco_propio: 'Es un mensaje que salió de aquí.',
  sin_texto: 'El mensaje no traía texto que el agente pudiera leer.',
  humano_en_el_hilo: 'Tú tomaste esta conversación, así que el agente no se metió.',
  hilo_sin_ia: 'Tienes la IA apagada en esta conversación.',
  ia_en_pausa: 'La IA está en pausa en esta conversación.',
  canal_sin_ia: 'Tienes la IA apagada en este canal.',
  fuera_de_horario: 'Llegó fuera de tu horario de atención.',
  sin_agente: 'Este canal todavía no tiene un agente asignado.',
};
