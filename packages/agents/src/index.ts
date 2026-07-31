/**
 * @abraxa/agents — el motor que corre los agentes de cada emprendedor.
 *
 * Cada cliente tiene un agente MAESTRO al que él mismo le pone nombre, y debajo
 * sub-agentes por área que contestan a SUS clientes. Este paquete es lo que los
 * define, los corre, les cobra el consumo y les pone un tope.
 *
 * ── Los dos huecos de GARDEN que aquí no se repiten ────────────────────────
 *
 *   1. Las definiciones vivían en YAML del disco, cargados con `readdirSync` al
 *      arrancar (src/bots/bot-factory.ts:39-55). Cliente nuevo = commit +
 *      deploy. Aquí viven en `app.agent_definitions`: cliente nuevo = INSERT.
 *
 *   2. El costo se estimaba con una tabla hardcodeada de 8 modelos y un
 *      fallback silencioso de {input:1.0, output:3.0} para el resto
 *      (src/services/openrouter.ts:83-100). Estuvo roto meses sin que nadie lo
 *      notara. Aquí los TOKENS se leen de la respuesta, el PRECIO vive en
 *      `app.model_pricing`, y el ledger guarda los tokens crudos para poder
 *      recalcular cuando un precio esté mal.
 *
 * ── Cómo se usa ───────────────────────────────────────────────────────────
 *
 *   // Correr un agente (H6 al llegar un mensaje, H7 en la entrevista)
 *   const { text, usage, agentName } = await usePort('agents').run(ctx, {
 *     role: 'sales', input: 'hola, ¿a qué hora abren?', threadId,
 *   });
 *
 *   // Registrar una tool desde TU paquete (H4 la de bóveda, H6 la de mensajes)
 *   usePort('agents').registerTool({ name, description, inputSchema, handler });
 */
import { registerPort } from '@abraxa/db';
import { createAgentService } from './service';

export { router } from './routes';
export { meta } from './meta';

// ── La implementación del port ─────────────────────────────────────────────
export const agentService = createAgentService();
registerPort('agents', agentService);

// ── Superficie pública ─────────────────────────────────────────────────────
export { createAgentService, type OpcionesServicio } from './service';

// Definiciones en DB
export {
  listarDefiniciones,
  obtenerDefinicion,
  sembrarAgentes,
  upsertDefinicion,
  type EntradaUpsert,
} from './definitions/repository';
export { semillasPorDefecto, type SemillaAgente } from './definitions/defaults';

// Costo y presupuesto
export { estadoPresupuesto, resolverLimites, invalidarCachePresupuesto } from './ledger/budget';
export { gastoDesde, registrarConsumo } from './ledger/usage-ledger';
export { calcularCosto, costoSinCache } from './pricing/compute';
export {
  createPricingCatalog,
  createStaticPricingCatalog,
  type PricingCatalog,
  type PricingRow,
} from './pricing/catalog';

// Caché de prompt — el criterio #4
export {
  decidirCache,
  estimarTokens,
  estimarTokensPrefijo,
  type DecisionCache,
} from './prompt/cache';

// Proveedores
export { createProviderRouter, type ProviderRouter } from './providers/router';
export { createAnthropicAdapter } from './providers/anthropic';
export { createOpenRouterAdapter } from './providers/openrouter';
export { createLocalAdapter } from './providers/local';
export type {
  CompletionRequest,
  CompletionResponse,
  FetchLike,
  ProviderAdapter,
  ToolSpec,
} from './providers/types';

// Capacidades por modelo
export {
  capsFor,
  esConocido,
  modelosConocidos,
  type ModelCapabilities,
  type ThinkingStyle,
} from './capabilities';

// Tools
export { toolRegistry, ToolRegistry } from './tools/registry';
export { ToolExecutor, type RegistroDeTool } from './tools/executor';

export type { AgentDefinition, CostoCalculado, LimitesTenant, RawUsage } from './types';
