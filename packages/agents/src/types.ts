/**
 * Tipos internos del motor de agentes.
 *
 * Los que cruzan la frontera del paquete (`TenantContext`, `Usage`, `AgentRole`,
 * `ProviderName`, `AgentTool`…) viven en `@abraxa/db/ports` y son de H1. Aquí
 * sólo está lo que no sale de `packages/agents`.
 */
import type { AgentRole, ProviderName } from '@abraxa/db';

// ════════════════════════════════════════════════════════════════════════════
// Consumo
// ════════════════════════════════════════════════════════════════════════════

/**
 * Lo que devolvió el proveedor, tal cual, en tokens.
 *
 * Es deliberadamente MÁS RICO que el `Usage` del port: separa la escritura de
 * caché por TTL (5 minutos cuesta 1.25× el input; 1 hora cuesta 2×) y arrastra
 * el `requestId` para poder reconciliar contra la consola del proveedor.
 *
 * `costUsd` NO está aquí a propósito. Este objeto es medición; el costo es una
 * interpretación y se calcula aparte, en `pricing/`.
 */
export interface RawUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  /** Id de la respuesta del proveedor, si lo dio. */
  requestId: string | null;
  /**
   * Costo en USD reportado por el proveedor. Sólo OpenRouter lo manda.
   * Anthropic devuelve tokens y nada más, así que aquí va `null` y el costo se
   * calcula contra `app.model_pricing`.
   */
  providerCostUsd: number | null;
}

export const USAGE_CERO: RawUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWrite5mTokens: 0,
  cacheWrite1hTokens: 0,
  requestId: null,
  providerCostUsd: null,
};

/** Suma de dos mediciones. El agent loop acumula por iteración. */
export function sumarUsage(a: RawUsage, b: RawUsage): RawUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWrite5mTokens: a.cacheWrite5mTokens + b.cacheWrite5mTokens,
    cacheWrite1hTokens: a.cacheWrite1hTokens + b.cacheWrite1hTokens,
    // El primero que exista: sirve para reconciliar la corrida con la consola.
    requestId: a.requestId ?? b.requestId,
    providerCostUsd:
      a.providerCostUsd === null && b.providerCostUsd === null
        ? null
        : (a.providerCostUsd ?? 0) + (b.providerCostUsd ?? 0),
  };
}

/** Cómo se llegó al costo. Se guarda en la fila del ledger. */
export type CostSource = 'provider' | 'priced' | 'unpriced';

export interface CostoCalculado {
  costUsd: number;
  source: CostSource;
  /** Fila de `app.model_pricing` que se usó, si fue `priced`. */
  pricingId: string | null;
}

// ════════════════════════════════════════════════════════════════════════════
// Definiciones
// ════════════════════════════════════════════════════════════════════════════

/** Una fila de `app.agent_definitions`. */
export interface AgentDefinition {
  id: string;
  tenantId: string;
  role: AgentRole;
  name: string;
  provider: ProviderName;
  model: string;
  keyRef: string | null;
  systemPrompt: string;
  tools: string[];
  enabled: boolean;
}

// ════════════════════════════════════════════════════════════════════════════
// Conversación
// ════════════════════════════════════════════════════════════════════════════

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ════════════════════════════════════════════════════════════════════════════
// Presupuesto
// ════════════════════════════════════════════════════════════════════════════

export interface LimitesTenant {
  monthlyBudgetUsd: number;
  requestsPerMinute: number;
  maxOutputTokens: number;
  /** De dónde salió el límite. Sale en el mensaje de error. */
  origen: 'override' | 'plan' | 'default';
  plan: string;
}
