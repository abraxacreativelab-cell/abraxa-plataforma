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
  /**
   * El dato que viene a llenar.
   *
   * Existe desde el 2026-08-01 y no es decoración: es lo que le permite a la
   * pantalla saber QUÉ se está preguntando ahora mismo sin adivinarlo del texto
   * del modelo. `primerFaltante()` la devuelve, `interview/ayudas.ts` la
   * traduce a botones y ejemplos, y el guion le dice al modelo esos mismos
   * botones. Una sola tabla manda en las tres puntas.
   */
  clave: string;
  /** Lo que se le dice al agente que le falta. En sus palabras, no en claves. */
  label: string;
  cumple(e: EstadoNegocio): boolean;
}

const lleno = (v: string | undefined): boolean => typeof v === 'string' && v.trim().length > 0;

/**
 * Qué exige cada fase para cerrar.
 *
 * Se leen de arriba abajo y el primer faltante es el que el guion prioriza, así
 * que el orden es el orden natural de la conversación. Desde el 2026-08-01 ese
 * orden además decide qué botones ve el invitado, así que mover una línea aquí
 * mueve la pantalla — a propósito.
 *
 * ── Lo esencial primero, y de un toque ────────────────────────────────────
 *
 * La fase 1 dejó de pedir cuatro frases y ahora pide tres botones y una
 * oración: categoría, cuántos son, a qué se dedica, en qué etapa va. Con eso
 * `synthesis/catalogo.ts` ya decide seis áreas con estados distintos —Equipo se
 * abre o se cierra con `equipo`, Finanzas con `etapa`— y por lo tanto abandonar
 * en el minuto uno ya deja algo construido.
 *
 * Lo que se movió de fase, y por qué:
 *   · `equipo`  gente → identidad   es un botón y cambia el mapa
 *   · `nicho`   identidad → modelo  es una frase pensada, y va del lado comercial
 *   · `tamano`  dejó de ser requisito (sigue guardándose; ver types.ts)
 */
const REQUISITOS: Record<Fase, Requisito[]> = {
  bienvenida: [
    { clave: 'agente', label: 'el nombre que le pone a su agente', cumple: (e) => lleno(e.agente) },
  ],

  identidad: [
    {
      clave: 'categoria',
      label: 'de qué es el negocio, en categoría gruesa (lo contesta con un botón)',
      cumple: (e) => lleno(e.categoria),
    },
    {
      clave: 'equipo',
      label: 'cuánta gente son hoy (solo él, 2 a 5, 6 a 20, más de 20)',
      cumple: (e) => lleno(e.equipo),
    },
    { clave: 'giro', label: 'a qué se dedica, en sus palabras', cumple: (e) => lleno(e.giro) },
    { clave: 'etapa', label: 'en qué etapa va el negocio', cumple: (e) => lleno(e.etapa) },
  ],

  modelo: [
    {
      clave: 'nicho',
      label: 'a quién le vende (su nicho o tipo de cliente)',
      cumple: (e) => lleno(e.nicho),
    },
    {
      clave: 'modelo_ingreso',
      label: 'cómo gana dinero exactamente',
      cumple: (e) => lleno(e.modeloIngreso),
    },
    { clave: 'ticket', label: 'cuánto cobra en promedio (su ticket)', cumple: (e) => lleno(e.ticket) },
    {
      clave: 'margen',
      label: 'qué margen le deja, aunque sea aproximado o un "no lo sé"',
      cumple: (e) => lleno(e.margen),
    },
    {
      clave: 'canales',
      label: 'por dónde le llegan los clientes hoy',
      cumple: (e) => (e.canales?.length ?? 0) > 0,
    },
  ],

  proceso: [
    {
      // Tres pasos es el mínimo con el que un recorrido es un recorrido y no
      // una anécdota: hay principio, medio y final que atacar en la fase 5.
      clave: 'recorrido',
      label: 'el recorrido de su cliente con al menos 3 pasos, de punta a punta',
      cumple: (e) => (e.recorrido?.length ?? 0) >= 3,
    },
    {
      clave: 'herramientas',
      label: 'con qué lo hace hoy (WhatsApp, Excel, libreta, lo que sea)',
      cumple: (e) => (e.herramientas?.length ?? 0) > 0,
    },
  ],

  gente: [
    {
      // Ya no pregunta CUÁNTOS son —eso se contestó con un botón en la fase 1—
      // sino lo que de verdad hay que pensar: quién hace qué, o qué soltaría
      // primero si pudiera pagarle a alguien. Ésa es la pregunta específica, y
      // por eso está en la fase 4 y no en la 1.
      clave: 'equipo_detalle',
      label: 'quién hace qué, o qué sería lo primero que soltaría si pudiera pagarle a alguien',
      cumple: (e) => lleno(e.equipoDetalle),
    },
  ],

  dolor: [
    {
      clave: 'dolores',
      label: 'al menos dos cosas que le roban tiempo o dinero',
      cumple: (e) => (e.dolores?.length ?? 0) >= 2,
    },
    {
      // El criterio #8 del handoff, convertido en condición de cierre.
      //
      // Sin esto la fase se degrada a "cuéntame tus problemas", que es una
      // encuesta. Lo que da el "wow" es que el agente ATAQUE el proceso que le
      // describieron y saque algo que el emprendedor no había pedido. Si no
      // salió ni uno, la fase no cerró — y el guion se lo dice al agente.
      clave: 'hito_del_diablo',
      label:
        'al menos un hueco que TÚ detectaste atacando su proceso y que él no había pedido',
      cumple: (e) => (e.hitos ?? []).some((h) => h.origen === 'abogado_del_diablo'),
    },
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
 * La clave del PRIMER dato que falta en esta fase, o `null` si ya no falta nada.
 *
 * Es la pregunta que el agente tiene enfrente ahora mismo: el guion le ordena
 * los faltantes en este mismo orden. La pantalla la usa para pintar los botones
 * de ese dato y no los de otro — sin leerle la mente al modelo ni analizar su
 * texto, que es como se rompen estas cosas.
 */
export function primerFaltante(fase: Fase, estado: EstadoNegocio): string | null {
  return REQUISITOS[fase].find((r) => !r.cumple(estado))?.clave ?? null;
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
