/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El vocabulario de las automatizaciones.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Sólo tipos y constantes de datos. Nada que hable con la base ni con la red:
 *  este archivo lo importa el navegador (el builder) y el worker por igual.
 */
import type { TriggerType } from '@abraxa/db';

// ════════════════════════════════════════════════════════════════════════════
// El catálogo CERRADO de nodos
// ════════════════════════════════════════════════════════════════════════════

/**
 * Los once tipos de nodo. Diez hacen algo; `trigger` es estructural — marca
 * por dónde entra la corrida y no ejecuta nada.
 *
 * ES CERRADO A PROPÓSITO. El cliente edita FLUJOS, no código: no hay un nodo
 * "ejecuta esto" ni una forma de que una configuración se vuelva un `eval`.
 * Y la ley que GARDEN dejó escrita y que aquí se conserva:
 *
 *     la UI no promete ningún nodo que el worker no corra de verdad.
 *
 * `send_email` no aparece porque no es un nodo: es `send_message` con
 * `channel: 'email'`. En GARDEN `send_email` era un caso que devolvía
 * `skipped` — un nodo que el builder ofrecía y el motor no ejecutaba.
 */
export const TIPOS_DE_NODO = [
  'trigger',
  'send_message',
  'wait',
  'condition',
  'assign_owner',
  'move_stage',
  'add_tag',
  'create_task',
  'webhook',
  'ai_step',
  'end',
] as const;

export type NodeType = (typeof TIPOS_DE_NODO)[number];

/** Los 8 disparadores. Es el `TriggerType` de H1, sin inventar ninguno. */
export const TIPOS_DE_DISPARADOR: readonly TriggerType[] = [
  'contact_created',
  'stage_changed',
  'form_submitted',
  'appointment_created',
  'appointment_cancelled',
  'tag_added',
  'message_in',
  'manual',
];

/** Operadores del nodo `condition`. */
export const OPERADORES = ['eq', 'neq', 'contains', 'in', 'not_empty', 'empty'] as const;
export type Operador = (typeof OPERADORES)[number];

/** Canales por los que `send_message` puede salir. Los despacha `InboxPort`. */
export const CANALES_DE_SALIDA = ['whatsapp', 'email', 'sms', 'instagram', 'messenger'] as const;

// ════════════════════════════════════════════════════════════════════════════
// El grafo
// ════════════════════════════════════════════════════════════════════════════

export interface FlowNode {
  id: string;
  type: NodeType;
  /** Dónde lo puso el emprendedor en el lienzo. El motor no la mira. */
  position?: { x: number; y: number };
  data?: {
    label?: string;
    config?: Record<string, unknown>;
  };
}

export interface FlowEdge {
  id?: string;
  source: string;
  target: string;
  /**
   * Sólo lo usa `condition`: `'yes'` y `'no'`. Un nodo normal tiene UNA salida.
   *
   * En GARDEN la rama sin arista conectada caía a `edges[0]`, así que un
   * contacto que NO cumplía la condición recibía la rama del sí — mensajes
   * reales mal enrutados. Aquí el validador exige las dos ramas conectadas y
   * el motor termina la corrida si la que tocó no existe.
   */
  sourceHandle?: 'yes' | 'no' | null;
  label?: string;
}

export interface FlowDefinition {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

// ════════════════════════════════════════════════════════════════════════════
// El flujo guardado
// ════════════════════════════════════════════════════════════════════════════

export type FlowStatus = 'paused' | 'active' | 'archived';

export interface Flow {
  id: string;
  name: string;
  description: string | null;
  triggerType: TriggerType;
  triggerConfig: Record<string, unknown>;
  definition: FlowDefinition;
  status: FlowStatus;
  version: number;
  createdBy: string | null;
  activatedBy: string | null;
  activatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FlowVersion {
  version: number;
  name: string;
  triggerType: TriggerType;
  triggerConfig: Record<string, unknown>;
  definition: FlowDefinition;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
}

// ════════════════════════════════════════════════════════════════════════════
// La corrida
// ════════════════════════════════════════════════════════════════════════════

export type RunStatus = 'running' | 'waiting' | 'paused' | 'completed' | 'exited' | 'error';

/** Los estados en los que la corrida ya no se mueve sola. */
export const ESTADOS_TERMINALES: readonly RunStatus[] = ['completed', 'exited', 'error'];

export const esTerminal = (s: RunStatus): boolean => ESTADOS_TERMINALES.includes(s);

export type StepStatus = 'ok' | 'failed' | 'skipped' | 'waiting';

/** El contexto del evento que disparó la corrida. */
export interface RunContext {
  /** Camel case porque así lo manda H15 (`packages/crm/src/events.ts`). */
  contactId?: string | null;
  threadId?: string;
  event?: TriggerType;
  [k: string]: unknown;
}

export interface FlowRun {
  id: string;
  flowId: string;
  version: number;
  contactId: string | null;
  status: RunStatus;
  currentNode: string | null;
  context: RunContext;
  triggerType: TriggerType;
  isTest: boolean;
  error: string | null;
  /**
   * Ejecuciones de nodo, no pasos guardados. Es el contador del tope
   * anti-bucle: contar filas de `flow_steps` no sirve porque el índice único
   * rechaza el segundo paso `ok` del mismo nodo, y en un ciclo el contador se
   * quedaría clavado. Ver la migración 061.
   */
  stepsTaken: number;
  startedAt: string;
  wakeAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface FlowStep {
  id: string;
  runId: string;
  nodeId: string;
  nodeType: NodeType;
  status: StepStatus;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
}

/** Lo que el panel en vivo pinta. Es exactamente lo que devuelve `GET /flows/runs/:id`. */
export interface RunSnapshot {
  run: FlowRun;
  steps: FlowStep[];
}

// ════════════════════════════════════════════════════════════════════════════
// El resultado de ejecutar UN nodo
// ════════════════════════════════════════════════════════════════════════════

/**
 * `paused` merece su propia entrada y no es un `failed` suave.
 *
 * Un canal caído no es un flujo roto: es un flujo que espera. En GARDEN, antes
 * de que existiera este estado, un lead que llegaba con el WhatsApp
 * desconectado perdía TODO su seguimiento en silencio. Con `paused` no se
 * escribe paso, no se avanza el puntero y no cuenta para el tope anti-bucle:
 * al reanudar se re-ejecuta ESTE mismo nodo.
 */
export interface NodeResult {
  status: StepStatus | 'paused';
  output?: Record<string, unknown>;
  error?: string;
  /** Rama explícita de `condition`. Sin esto se toma la primera salida. */
  nextHandle?: 'yes' | 'no';
  /** Retrasar el siguiente paso hasta esta hora (ISO). Lo pone `wait`. */
  wakeAt?: string;
  /** `true` termina la corrida sin seguir el grafo. Lo pone `end`. */
  exit?: boolean;
}

// ════════════════════════════════════════════════════════════════════════════
// El catálogo que consume la UI
// ════════════════════════════════════════════════════════════════════════════

export interface CampoDeNodo {
  clave: string;
  etiqueta: string;
  tipo: 'texto' | 'texto-largo' | 'numero' | 'opcion' | 'booleano';
  opciones?: Array<{ valor: string; etiqueta: string }>;
  ayuda?: string;
  requerido?: boolean;
}

export interface DefinicionDeNodo {
  tipo: NodeType;
  etiqueta: string;
  /** Qué hace, en la lengua del emprendedor. Es lo que se lee en la paleta. */
  resumen: string;
  /** Nombre de icono lucide, como en `AreaSummary.icon` de H11. */
  icono: string;
  /** `true` si tiene dos salidas ('yes' y 'no'). */
  bifurca?: boolean;
  /** `true` si termina la corrida. */
  termina?: boolean;
  campos: CampoDeNodo[];
}
