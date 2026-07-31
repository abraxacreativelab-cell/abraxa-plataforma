/**
 * ════════════════════════════════════════════════════════════════════════════
 *  AgentPort — el motor completo, en el orden en que corre.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *      1. definición    ← fila de app.agent_definitions   (no un YAML del disco)
 *      2. presupuesto   ← lanza ANTES de gastar           (no degrada en silencio)
 *      3. llave         ← del tenant, o de la plataforma
 *      4. prompt        ← fila + bóveda + contexto
 *      5. caché         ← ¿el prefijo llega al mínimo del modelo?
 *      6. loop          ← proveedor + tools, hasta 10 vueltas
 *      7. costo         ← tokens reales × precio vigente
 *      8. ledger        ← se escribe SIEMPRE, éxito o error
 *
 *  El orden no es casual. El presupuesto va en el paso 2 porque un tope que se
 *  revisa después de llamar al modelo no es un tope. Y el ledger va en el 8
 *  incluso cuando la llamada falló, porque los tokens de una respuesta que
 *  reventó a medio camino ya se van a facturar igual.
 */
import type {
  AgentPort,
  AgentRunInput,
  AgentRunResult,
  AgentTool,
  ProviderName,
  TenantContext,
  Usage,
} from '@abraxa/db';
import { capsFor } from './capabilities';
import { cargarHistorial, guardarTurno } from './conversation/store';
import { obtenerDefinicion, upsertDefinicion } from './definitions/repository';
import { verificarPresupuesto } from './ledger/budget';
import { registrarConsumo } from './ledger/usage-ledger';
import { agentLoop } from './loop/agent-loop';
import { log } from './logger';
import { calcularCosto } from './pricing/compute';
import type { PricingCatalog } from './pricing/catalog';
import { createPricingCatalog } from './pricing/catalog';
import { decidirCache } from './prompt/cache';
import { componerPrompt } from './prompt/compose';
import { resolverLlave } from './providers/keys';
import type { ProviderRouter } from './providers/router';
import { createProviderRouter } from './providers/router';
import type { ProviderMessage } from './providers/types';
import { ToolExecutor } from './tools/executor';
import { toolRegistry } from './tools/registry';
import type { CostoCalculado, RawUsage } from './types';
import { USAGE_CERO } from './types';

export interface OpcionesServicio {
  router?: ProviderRouter;
  pricing?: PricingCatalog;
  /** Para pruebas: resuelve la llave sin tocar la base ni el entorno. */
  resolverLlaveImpl?: (
    ctx: TenantContext,
    provider: ProviderName,
    keyRef: string | null,
  ) => Promise<string>;
}

export function createAgentService(opciones: OpcionesServicio = {}): AgentPort {
  const router = opciones.router ?? createProviderRouter();
  const pricing = opciones.pricing ?? createPricingCatalog();
  const dameLlave = opciones.resolverLlaveImpl ?? resolverLlave;
  const executor = new ToolExecutor(toolRegistry);

  return {
    registerTool(t: AgentTool): void {
      toolRegistry.register(t);
    },

    upsertDefinition(ctx, d) {
      return upsertDefinicion(ctx, {
        role: d.role,
        name: d.name,
        systemPrompt: d.systemPrompt,
        provider: d.provider,
        model: d.model,
        tools: d.tools,
      });
    },

    async run(ctx: TenantContext, i: AgentRunInput): Promise<AgentRunResult> {
      const inicio = Date.now();

      // ── 1. La definición. De la base, no del disco. ──────────────────────
      const def = await obtenerDefinicion(ctx, i.role);

      // ── 2. El presupuesto. Antes de gastar un solo token. ────────────────
      // Lanza BUDGET_EXCEEDED o RATE_LIMITED. No hay degradación silenciosa a
      // un modelo más barato: eso deja al cliente con un producto peor y sin
      // forma de saber por qué.
      const limites = await verificarPresupuesto(ctx);

      // ── 3. La llave. Del cliente si la tiene; si no, la de la plataforma. ─
      const apiKey = await dameLlave(ctx, def.provider, def.keyRef);

      // ── 4. El prompt. Fila + bóveda + contexto del tenant. ───────────────
      const system = await componerPrompt(ctx, {
        base: def.systemPrompt,
        systemSuffix: i.systemSuffix,
      });

      // ── 5. Caché. Se mide el prefijo COMPLETO: tools + system. ───────────
      const toolsPedidas = i.tools ?? def.tools;
      const specs = toolRegistry.specs(toolsPedidas);
      const cache = decidirCache(system, specs, def.model, def.provider);
      if (!cache.pedirCache) {
        // Ruidoso a propósito: sin esta línea, un prompt que se quedó corto es
        // un costo invisible hasta que la factura no cuadra.
        log.info(`sin caché para ${def.role}/${def.model}: ${cache.razon}`);
      }

      // ── Historial ────────────────────────────────────────────────────────
      const historial =
        i.history ??
        (i.threadId ? await cargarHistorial(ctx, i.role, i.threadId) : []);

      const messages: ProviderMessage[] = [
        ...historial.map(
          (m): ProviderMessage =>
            m.role === 'assistant'
              ? { role: 'assistant', content: m.content }
              : { role: 'user', content: m.content },
        ),
        { role: 'user', content: i.input },
      ];

      const caps = capsFor(def.model, def.provider);
      const maxOutputTokens = Math.min(limites.maxOutputTokens, caps.maxOutputTokens);

      // ── 6. El loop ───────────────────────────────────────────────────────
      let usage: RawUsage = USAGE_CERO;
      let iteraciones = 0;
      let texto = '';
      let stopReason: AgentRunResult['stopReason'] = 'error';
      let estado: 'ok' | 'error' | 'partial' = 'error';
      let fallo: unknown = null;

      try {
        const r = await agentLoop({
          ctx,
          adapter: router.get(def.provider),
          model: def.model,
          apiKey,
          system,
          messages,
          tools: specs,
          maxOutputTokens,
          cachePrefix: cache.pedirCache,
          executor,
        });

        usage = r.usage;
        iteraciones = r.iterations;
        texto = r.text;
        stopReason = r.stopReason;
        estado = r.stopReason === 'max_tokens' ? 'partial' : 'ok';
      } catch (err) {
        fallo = err;
        // No se re-lanza todavía: primero se registra el consumo. Un error del
        // proveedor a media generación ya quemó tokens que se van a facturar, y
        // un ledger que sólo anota los éxitos subestima el gasto justo cuando
        // algo anda mal.
      }

      // ── 7. El costo. Tokens reales × precio vigente. ─────────────────────
      const precio = await pricing.lookup(def.provider, def.model).catch(() => null);
      const costo: CostoCalculado = calcularCosto(usage, precio);

      // ── 8. El ledger. Siempre. ───────────────────────────────────────────
      await registrarConsumo(ctx, {
        role: def.role,
        agentDefinitionId: def.id,
        provider: def.provider,
        model: def.model,
        usage,
        costo,
        threadId: i.threadId,
        iterations: iteraciones,
        latencyMs: Date.now() - inicio,
        status: estado,
      });

      // Ya quedó registrado el consumo; ahora sí sube el error. `PlatformError`
      // viaja intacto para que H6 pueda distinguir BUDGET_EXCEEDED de un fallo
      // de red sin acoplarse a nada de H3.
      if (fallo) throw fallo;

      if (i.threadId && !i.history) {
        await guardarTurno(ctx, i.role, i.threadId, { entrada: i.input, respuesta: texto });
      }

      const usageDelPort: Usage = {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cachedReadTokens: usage.cacheReadTokens,
        cachedWriteTokens: usage.cacheWrite5mTokens + usage.cacheWrite1hTokens,
        costUsd: costo.costUsd,
      };

      return {
        text: texto,
        usage: usageDelPort,
        stopReason,
        // El nombre que el emprendedor le puso a SU agente. La UI lo muestra.
        agentName: def.name,
      };
    },
  };
}
