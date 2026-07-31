/**
 * ════════════════════════════════════════════════════════════════════════════
 *  EL MOTOR, sin base y sin cola. Funciones puras.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Aquí vive TODA la lógica que decide qué pasa con una corrida: el fence de
 *  idempotencia, el tope anti-bucle, la elección de rama, la pausa cuando el
 *  canal se cae y el cierre. Ni una línea habla con Postgres, con pg-boss ni
 *  con la red.
 *
 *  ── Por qué está partido así ───────────────────────────────────────────────
 *
 *  Porque es lo único que hace que estos criterios se puedan probar hoy:
 *
 *      #5 · reintentar un paso fallido no duplica el mensaje ya enviado
 *      #6 · si el canal se cae a media corrida, el flujo pausa y reanuda
 *
 *  No hay `DATABASE_URL`, no hay llaves de WhatsApp y el schema `pgboss` no
 *  existe en la base. Si la decisión viviera enredada con el acceso a datos
 *  —como en GARDEN, donde `executeStep` hace las dos cosas en la misma
 *  función— probar esto exigiría una base viva, y en CI no hay ninguna. Se
 *  probaría "cuando haya entorno", que es como no probarlo.
 *
 *  `ejecutarPaso` (../engine/step.ts) es quien carga, ejecuta y guarda;
 *  `registerQueue()` sólo lo envuelve. Esta capa es el cerebro y no sabe que
 *  existe ninguno de los dos.
 */
import type { FlowDefinition, FlowNode, NodeResult, RunStatus, StepStatus } from '../types';

/**
 * El tope anti-bucle. El validador ya prohíbe los ciclos, así que esto es la
 * segunda red: cubre un grafo guardado antes de una versión del validador, o
 * una corrida que se reanuda muchas veces.
 *
 * 100 y no 1000: son 100 acciones REALES sobre el cliente de alguien.
 */
export const MAX_PASOS = 100;

/** Lo que el motor sabe de una corrida en el instante de decidir. */
export interface EstadoDeCorrida {
  runId: string;
  status: RunStatus;
  /** El puntero guardado. Es la verdad de en qué nodo va la corrida. */
  currentNode: string | null;
  /** El nodo que ESTE job pide ejecutar. */
  nodeId: string;
  /** Cuántos pasos lleva registrados la corrida. */
  pasosDados: number;
  definition: FlowDefinition;
  /** `true` si ya hay un paso `ok` de este nodo en esta corrida. */
  nodoYaCompletado: boolean;
}

export type Antes =
  | { accion: 'ejecutar'; nodo: FlowNode }
  /** Ni se ejecuta ni se cierra: este job no debe existir. */
  | { accion: 'ignorar'; razon: string }
  | { accion: 'terminar'; status: Extract<RunStatus, 'completed' | 'error'>; razon: string };

/**
 * ¿Este job debe ejecutar su nodo?
 *
 * ── El fence de idempotencia, que es el corazón del criterio #5 ────────────
 *
 * `currentNode` es la verdad. Si el job apunta a otro nodo, es un reintento
 * viejo de pg-boss sobre un paso ya superado — el caso típico: el envío salió
 * bien, encolar el siguiente falló, y la cola reintentó el actual. Ejecutarlo
 * mandaría el mensaje por segunda vez. Se ignora.
 *
 * Y si el nodo ya tiene un paso `ok` registrado, tampoco se re-ejecuta: eso
 * cierra la ventana "el proceso murió entre mandar el mensaje y avanzar el
 * puntero". El índice único parcial de la migración 061 es el árbitro final;
 * esto evita gastar el envío antes de llegar a él.
 */
export function decidirAntes(e: EstadoDeCorrida): Antes {
  if (e.status !== 'running' && e.status !== 'waiting' && e.status !== 'paused') {
    return { accion: 'ignorar', razon: `la corrida está en "${e.status}"` };
  }

  if (e.currentNode && e.currentNode !== e.nodeId) {
    return {
      accion: 'ignorar',
      razon: `job del paso "${e.nodeId}" obsoleto: el puntero ya va en "${e.currentNode}"`,
    };
  }

  if (e.pasosDados >= MAX_PASOS) {
    return {
      accion: 'terminar',
      status: 'error',
      razon: `la corrida pasó de ${MAX_PASOS} pasos y se detuvo para no seguir actuando en bucle`,
    };
  }

  const nodo = e.definition.nodes.find((n) => n.id === e.nodeId);
  if (!nodo) {
    // El nodo desapareció: alguien editó el flujo mientras esta corrida
    // esperaba. No es un error del emprendedor — se cierra limpio.
    return { accion: 'terminar', status: 'completed', razon: 'el paso ya no existe en el flujo' };
  }

  if (e.nodoYaCompletado) {
    // Ya se hizo. No se repite, pero SÍ hay que seguir adelante: lo que falló
    // la vez pasada fue avanzar, no ejecutar.
    return { accion: 'ejecutar', nodo };
  }

  return { accion: 'ejecutar', nodo };
}

/** El paso que hay que dejar escrito. */
export interface PasoARegistrar {
  nodeId: string;
  nodeType: FlowNode['type'];
  status: StepStatus;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error: string | null;
}

export type Despues =
  /**
   * NO se escribe paso y NO se avanza el puntero: al reanudar se re-ejecuta
   * este mismo nodo. Tampoco cuenta para el tope anti-bucle — un canal que
   * tarda tres días en volver no debe gastarle los 100 pasos a la corrida.
   */
  | { accion: 'pausar'; razon: string }
  | {
      accion: 'terminar';
      status: Extract<RunStatus, 'completed' | 'error' | 'exited'>;
      paso: PasoARegistrar;
      error: string | null;
    }
  | {
      accion: 'avanzar';
      paso: PasoARegistrar;
      siguiente: string;
      /** `waiting` cuando el nodo pidió dormir; `running` si sigue de inmediato. */
      status: Extract<RunStatus, 'running' | 'waiting'>;
      wakeAt: string | null;
    };

/**
 * Qué hacer con el resultado de un nodo.
 *
 * ── La rama que no existe TERMINA la corrida ───────────────────────────────
 *
 * En GARDEN, una condición cuya rama tocada no tenía arista caía a `edges[0]`
 * — es decir, un contacto que NO cumplía la condición recibía la rama del sí.
 * Mensajes reales al cliente equivocado. Aquí, si la salida que tocó no está
 * conectada, la corrida se cierra como completada. El validador ya obliga a
 * conectar las dos, así que esto sólo cubre flujos guardados antes.
 */
export function decidirDespues(e: EstadoDeCorrida, nodo: FlowNode, r: NodeResult): Despues {
  if (r.status === 'paused') {
    return { accion: 'pausar', razon: r.error ?? String(r.output?.razon ?? 'el canal no está listo') };
  }

  const paso: PasoARegistrar = {
    nodeId: nodo.id,
    nodeType: nodo.type,
    status: r.status,
    input: (nodo.data?.config ?? {}) as Record<string, unknown>,
    output: r.output ?? {},
    error: r.error ?? null,
  };

  if (r.status === 'failed') {
    return { accion: 'terminar', status: 'error', paso, error: r.error ?? 'el paso falló' };
  }

  if (r.exit) {
    return { accion: 'terminar', status: 'exited', paso, error: null };
  }

  const salidas = e.definition.edges.filter((x) => x.source === nodo.id);
  const arista = r.nextHandle
    ? salidas.find((x) => (x.sourceHandle ?? '') === r.nextHandle)
    : salidas[0];

  if (!arista?.target) {
    return { accion: 'terminar', status: 'completed', paso, error: null };
  }

  return {
    accion: 'avanzar',
    paso,
    siguiente: arista.target,
    status: r.wakeAt ? 'waiting' : 'running',
    wakeAt: r.wakeAt ?? null,
  };
}

/**
 * El primer nodo real de un flujo: lo que sigue después del disparador.
 *
 * `null` cuando el disparador no lleva a ningún lado — un flujo que no hace
 * nada. Se enrola igual y se cierra de inmediato, en vez de dejar una corrida
 * apuntando a la nada.
 */
export function primerNodo(def: FlowDefinition): string | null {
  const trigger = def.nodes.find((n) => n.type === 'trigger');
  if (!trigger) return def.nodes[0]?.id ?? null;
  return def.edges.find((e) => e.source === trigger.id)?.target ?? null;
}
