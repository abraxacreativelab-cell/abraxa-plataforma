/**
 * ════════════════════════════════════════════════════════════════════════════
 *  La interfaz que hace que migrar a un modelo propio sea UNA FILA.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Santiago quiere eventualmente correr modelos locales para dejar de pagar
 *  tokens. Ese día no puede ser un refactor: tiene que ser un UPDATE a la
 *  columna `provider` de `app.agent_definitions`.
 *
 *  Para que eso funcione, todo lo específico de un proveedor —forma del cuerpo,
 *  cabeceras, cómo se pide el caché, dónde viene el conteo de tokens— vive
 *  detrás de este contrato. Nada de eso puede filtrarse al agent loop.
 *
 *  Es la razón por la que `local.ts` existe hoy aunque no haga nada: si el
 *  tercer adaptador no cabe en la interfaz, la interfaz está mal, y más vale
 *  descubrirlo ahora que el día que haya un modelo local esperando.
 */
import type { ProviderName } from '@abraxa/db';
import type { RawUsage } from '../types';

/** Una tool, en forma neutra. Cada adaptador la traduce a su dialecto. */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Petición del modelo para usar una tool. */
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Un turno de la conversación tal como se le manda al proveedor.
 *
 * Incluye los turnos de tool porque el loop tiene que poder reconstruir el
 * historial completo entre iteraciones.
 */
export type ProviderMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

export interface CompletionRequest {
  model: string;
  /** El prompt de sistema ya compuesto: fila + bóveda + contexto del tenant. */
  system: string;
  messages: ProviderMessage[];
  tools: ToolSpec[];
  maxOutputTokens: number;
  /**
   * Pedir caché del prefijo. El adaptador decide CÓMO (y si el modelo puede).
   * Quien llama no debería saber qué es un `cache_control`.
   */
  cachePrefix: boolean;
  /** Credencial a usar. La resuelve `keys.ts`. */
  apiKey: string;
  /** Corta la llamada. */
  signal?: AbortSignal | undefined;
}

export interface CompletionResponse {
  /** Texto de la respuesta. Vacío si el modelo sólo pidió tools. */
  text: string;
  toolCalls: ToolCall[];
  /** Medición real, en tokens. Nunca estimada. */
  usage: RawUsage;
  stopReason: 'end_turn' | 'max_tokens' | 'tool_use' | 'error';
  /** El modelo que de verdad respondió (puede diferir del pedido). */
  model: string;
}

/**
 * Lo que tiene que saber hacer un proveedor. Nada más.
 *
 * `fetchImpl` es inyectable en todos los adaptadores: es lo que permite probar
 * el armado del cuerpo y la lectura del `usage` sin red y sin llave.
 */
export interface ProviderAdapter {
  readonly name: ProviderName;
  complete(req: CompletionRequest): Promise<CompletionResponse>;
}

/** Firma de `fetch`, para poder inyectar un doble en las pruebas. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
