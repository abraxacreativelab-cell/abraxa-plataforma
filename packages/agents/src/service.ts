/**
 * ════════════════════════════════════════════════════════════════════════════
 *  AgentPort — el motor completo, en el orden en que corre.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *      1. definición    ← fila de app.agent_definitions   (no un YAML del disco)
 *      2. presupuesto   ← lanza ANTES de gastar           (no degrada en silencio)
 *      3. precio        ← lanza ANTES de gastar si el modelo es conocido y no
 *                         tiene precio vigente            (si no, el tope es ciego)
 *      4. llave         ← del tenant, o de la plataforma
 *      5. prompt        ← fila + bóveda + contexto
 *      6. caché         ← ¿el prefijo llega al mínimo del modelo?
 *      7. loop          ← proveedor + tools, hasta 10 vueltas
 *      8. costo         ← tokens reales × precio vigente
 *      9. ledger        ← se escribe SIEMPRE, éxito o error
 *
 *  El orden no es casual. El presupuesto va en el paso 2 porque un tope que se
 *  revisa después de llamar al modelo no es un tope. Y el ledger va en el 9
 *  incluso cuando la llamada falló, porque los tokens de una respuesta que
 *  reventó a medio camino ya se van a facturar igual.
 *
 *  El paso 3 llegó con la auditoría del 2026-07-31 y es del mismo linaje que el
 *  2: el precio se resuelve ANTES de llamar al modelo porque una corrida que
 *  vuelve sin precio no se puede cobrar contra el tope. Ver el comentario largo
 *  de `pricing/compute.ts`.
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
import { PlatformError } from '@abraxa/db';
import { capsFor, esConocido } from './capabilities';
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

      // ── 3. El precio. También antes de gastar. ───────────────────────────
      // Se resuelve aquí y no después del loop por una razón de dinero: una
      // corrida que vuelve sin precio se registra en `unpriced`, y aunque el
      // piso conservador impide que el tope se quede ciego, un modelo que
      // NOSOTROS decimos conocer y que no tiene precio capturado es un error de
      // operación, no una condición normal. Se dice a la primera, sin quemar un
      // token, y con el nombre exacto de la fila que falta.
      //
      // Un modelo DESCONOCIDO sí pasa: estrenar un modelo sin deploy es la
      // promesa entera de H3 (la fila de DB manda). Ése lo cubre el piso.
      //
      // ── Las tres condiciones, y por qué cada una ───────────────────────
      //
      // `falloDePrecio` separa "no hay fila" de "no pude preguntar". El
      // `.catch(() => null)` original las colapsaba en el mismo `null`, y una
      // puerta que lance sobre ese `null` convierte un timeout de PostgREST en
      // un corte TOTAL del motor para todos los tenants a la vez. El precio
      // protege el dinero; la disponibilidad vale más que la precisión de un
      // renglón. Fail-OPEN aquí, igual que el rate limit de budget.ts.
      //
      // `provider === 'anthropic'` acota la puerta al único proveedor cuyo
      // precio DEBE estar sembrado. OpenRouter reporta el costo real de la
      // llamada (`usage.cost`), así que sus filas de la 021 son respaldo y
      // varias combinaciones legítimas nunca se sembraron: exigir precio ahí
      // rompería configuraciones que hoy funcionan. `local` no factura tokens.
      let falloDePrecio = false;
      const precio = await pricing.lookup(def.provider, def.model).catch((err) => {
        falloDePrecio = true;
        log.warn(`no se pudo leer el precio de ${def.provider}/${def.model}: ${String(err)}`);
        return null;
      });

      if (
        precio === null &&
        !falloDePrecio &&
        def.provider === 'anthropic' &&
        esConocido(def.model, def.provider)
      ) {
        throw new PlatformError(
          'VALIDATION',
          `El modelo '${def.model}' de ${def.provider} está en el catálogo de capacidades ` +
            `pero NO tiene precio vigente en app.model_pricing. Sin precio, su consumo no ` +
            `se puede cobrar contra el tope del plan. Captura la fila y vuelve a intentar ` +
            `(revísalo con el guion check-pricing del paquete).`,
          { details: { provider: def.provider, model: def.model, role: def.role } },
        );
      }

      // ── 4. La llave. Del cliente si la tiene; si no, la de la plataforma. ─
      const apiKey = await dameLlave(ctx, def.provider, def.keyRef);

      // ── 5. El prompt. Fila + bóveda + contexto del tenant. ───────────────
      const system = await componerPrompt(ctx, {
        base: def.systemPrompt,
        systemSuffix: i.systemSuffix,
      });

      // ── 6. Caché. Se mide el prefijo COMPLETO: tools + system. ───────────
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

      // ── 7. El loop ───────────────────────────────────────────────────────
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
          // El acumulado se copia AQUÍ, vuelta por vuelta, y no de `r.usage` al
          // final. Es lo único que hace verdadera la promesa de abajo: si el
          // proveedor revienta en la iteración 5, `r` nunca existe y `r.usage`
          // tampoco — pero estas cuatro asignaciones ya ocurrieron y el consumo
          // real llega al ledger. Antes se escribían ceros y ~$0.32 de tokens
          // facturables desaparecían del tope.
          //
          // `iteraciones` viaja con el consumo por la misma razón: una fila con
          // 120,000 tokens e `iterations = 0` es incoherente, y apaga la única
          // columna que hace visible a un agente dándose de topes.
          onUsage: (_delta, acumulado, vuelta) => {
            usage = acumulado;
            iteraciones = vuelta;
          },
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
        // algo anda mal. `usage` trae lo acumulado hasta la vuelta que falló.
      }

      // ── 8. El costo. Tokens reales × precio vigente (resuelto en el 3). ──
      const costo: CostoCalculado = calcularCosto(usage, precio, def.provider);

      // ── 9. El ledger. Siempre. ───────────────────────────────────────────
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
