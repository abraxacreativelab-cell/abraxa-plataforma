/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El agent loop. Portado de GARDEN (src/core/agent-loop.ts, 167 líneas).
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  El original es simple y sólido y se conserva su forma: tope de iteraciones,
 *  timeout por tool, y un tool que falla no tumba la corrida.
 *
 *  CUATRO CAMBIOS AL PORTARLO
 *
 *  1. El consumo se ACUMULA REAL, no se estima.
 *     GARDEN llama `estimateCost(model, in, out)` contra una tabla hardcodeada
 *     (openrouter.ts:83-100) que además tiene un fallback silencioso para
 *     modelos desconocidos. Aquí el loop devuelve tokens medidos y el costo se
 *     calcula fuera, contra `app.model_pricing`.
 *
 *  2. El formato del proveedor no entra aquí.
 *     GARDEN habla el dialecto de OpenAI dentro del loop. Aquí todo pasa por
 *     `ProviderAdapter`, que es lo que permite cambiar `provider` en una fila
 *     de DB sin tocar código.
 *
 *  3. `botId / companyId / companyScope` → `TenantContext`.
 *
 *  4. El rate limit LANZA en vez de devolver un texto amable.
 *     GARDEN, al toparlo, devuelve "Se alcanzó el límite de velocidad" como si
 *     fuera la respuesta del agente (agent-loop.ts:49-57). El cliente final
 *     recibe eso en su WhatsApp, y arriba nadie se entera de que hubo un
 *     límite. Es el mismo pecado que degradar el modelo en silencio. Aquí el
 *     control de presupuesto y ritmo vive ANTES del loop y lanza
 *     `RATE_LIMITED` / `BUDGET_EXCEEDED`, que H6 puede distinguir de un fallo
 *     de red sin acoplarse a nada de H3.
 */
import type { TenantContext } from '@abraxa/db';
import { MAX_ITERACIONES } from '../config';
import { log } from '../logger';
import type {
  CompletionResponse,
  ProviderAdapter,
  ProviderMessage,
  ToolSpec,
} from '../providers/types';
import type { RawUsage } from '../types';
import { sumarUsage, USAGE_CERO } from '../types';
import type { RegistroDeTool, ToolExecutor } from '../tools/executor';

export interface OpcionesLoop {
  ctx: TenantContext;
  adapter: ProviderAdapter;
  model: string;
  apiKey: string;
  system: string;
  /** Historial + el mensaje nuevo, ya armados. */
  messages: ProviderMessage[];
  tools: ToolSpec[];
  maxOutputTokens: number;
  cachePrefix: boolean;
  executor: ToolExecutor;
  signal?: AbortSignal | undefined;
  onToolCall?: ((name: string, input: Record<string, unknown>) => void) | undefined;
  /**
   * Se invoca al cerrar CADA iteración con lo que midió esa vuelta, el
   * acumulado hasta ahí, y cuántas vueltas van.
   *
   * Existe por una razón sola, y no es telemetría: el acumulado vive en una
   * variable local de esta función, así que si la iteración 5 lanza, las cuatro
   * anteriores se van con la excepción. `service.ts` no tenía forma de saber
   * que ya se habían quemado 120,000 tokens y escribía la fila del ledger en
   * ceros — con lo que ese gasto REAL jamás contaba contra el tope, y un 529
   * reintentado podía quemar decenas de dólares con el presupuesto en 0.
   *
   * Se resuelve empujando hacia afuera en vez de devolviendo al final, porque
   * un `return` sólo ocurre en el camino feliz.
   *
   * `iteracion` viaja junto al consumo y no aparte porque los dos se pierden
   * por el mismo motivo. Una fila del ledger con 120,000 tokens e
   * `iterations = 0` es internamente incoherente, y encima apaga justo la
   * columna que la migración 023 declara como el mecanismo para ver a un
   * agente dándose de topes: uno que revienta en la vuelta 9 se vería idéntico
   * a uno que revienta en la 1.
   *
   * NO DEBE LANZAR. Si lanza, mata el loop desde adentro y deja a quien llama
   * con el acumulado de la vuelta anterior — el mismo agujero que este callback
   * viene a tapar. `agentLoop` lo protege con try/catch por si acaso.
   */
  onUsage?: ((delta: RawUsage, acumulado: RawUsage, iteracion: number) => void) | undefined;
}

export interface ResultadoLoop {
  text: string;
  usage: RawUsage;
  iterations: number;
  toolCalls: RegistroDeTool[];
  stopReason: CompletionResponse['stopReason'];
  /** El modelo que de verdad respondió. */
  model: string;
}

/**
 * Corre el agente hasta que deje de pedir tools.
 *
 * El consumo se acumula en TODAS las iteraciones, incluida la que topa el
 * límite: esos tokens ya se gastaron y se van a facturar. Un loop que sólo
 * cuenta la última vuelta subestima el gasto justo en las conversaciones más
 * caras, que son las que más tools usan.
 *
 * Y se acumula también cuando la corrida REVIENTA: cada vuelta se reporta por
 * `onUsage` en cuanto se cierra, así que el consumo de las iteraciones que sí
 * llegaron sobrevive a la excepción de la que no. Ver `OpcionesLoop.onUsage`.
 */
export async function agentLoop(opciones: OpcionesLoop): Promise<ResultadoLoop> {
  const {
    ctx,
    adapter,
    model,
    apiKey,
    system,
    tools,
    maxOutputTokens,
    cachePrefix,
    executor,
    signal,
    onToolCall,
    onUsage,
  } = opciones;

  const messages: ProviderMessage[] = [...opciones.messages];
  const toolCalls: RegistroDeTool[] = [];
  let usage: RawUsage = USAGE_CERO;
  let iteraciones = 0;
  let ultimoModelo = model;

  while (iteraciones < MAX_ITERACIONES) {
    const respuesta = await adapter.complete({
      model,
      system,
      messages,
      tools,
      maxOutputTokens,
      cachePrefix,
      apiKey,
      signal,
    });

    usage = sumarUsage(usage, respuesta.usage);
    ultimoModelo = respuesta.model;
    iteraciones++;

    // Se empuja hacia afuera AQUÍ, no al terminar: si la vuelta siguiente lanza,
    // esto ya se contabilizó. Es la única forma de que un 529 en la iteración 5
    // no borre los tokens de las cuatro que sí se facturaron.
    // Protegido: un callback que lance mataría el loop desde adentro y dejaría
    // a quien llama con el acumulado de la vuelta ANTERIOR — exactamente el
    // agujero que esto viene a tapar, sólo que una vuelta más corto.
    try {
      onUsage?.(respuesta.usage, usage, iteraciones);
    } catch (err) {
      log.warn(`onUsage lanzó y se ignoró (el loop sigue): ${String(err)}`);
    }

    // Sin tools pedidas: el agente terminó.
    if (respuesta.toolCalls.length === 0) {
      log.debug(
        `corrida lista en ${iteraciones} iteración(es); ` +
          `${usage.inputTokens + usage.outputTokens} tokens, ` +
          `caché leído ${usage.cacheReadTokens}`,
      );
      return {
        text: respuesta.text,
        usage,
        iterations: iteraciones,
        toolCalls,
        stopReason: respuesta.stopReason,
        model: ultimoModelo,
      };
    }

    // El turno del asistente, con sus peticiones de tool, entra al historial
    // ANTES de ejecutarlas: el proveedor exige que cada resultado tenga su
    // petición correspondiente en el turno anterior.
    messages.push({
      role: 'assistant',
      content: respuesta.text,
      toolCalls: respuesta.toolCalls,
    });

    // En paralelo. El modelo puede pedir varias de una vez y ejecutarlas en
    // serie multiplica la latencia sin ninguna ganancia; los resultados van
    // todos juntos en el siguiente turno, que es lo que la API espera.
    const registros = await Promise.all(
      respuesta.toolCalls.map(async (tc) => {
        onToolCall?.(tc.name, tc.input);
        const r = await executor.execute(ctx, tc.name, tc.input);
        return { tc, r };
      }),
    );

    for (const { tc, r } of registros) {
      toolCalls.push(r);
      messages.push({
        role: 'tool',
        toolCallId: tc.id,
        content: typeof r.result === 'string' ? r.result : JSON.stringify(r.result),
      });
    }
  }

  // Tope de iteraciones. Se devuelve lo que haya con `max_tokens` como razón de
  // paro, y el consumo COMPLETO: diez vueltas se pagan aunque no hayan llegado
  // a nada. El campo `iterations` del ledger es lo que hace visible un agente
  // dándose de topes; en GARDEN esto sólo dejaba una línea de log.
  log.warn(`se alcanzó el tope de ${MAX_ITERACIONES} iteraciones`);
  return {
    text:
      'No pude terminar de resolverlo con las herramientas que tengo. ' +
      '¿Me lo puedes plantear de otra forma?',
    usage,
    iterations: MAX_ITERACIONES,
    toolCalls,
    stopReason: 'max_tokens',
    model: ultimoModelo,
  };
}
