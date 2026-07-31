/**
 * Adaptador de OpenRouter — API compatible con OpenAI.
 *
 * Es el carril de los modelos baratos y el respaldo cuando Anthropic se cae.
 * Cambiar un agente de `anthropic` a `openrouter` tiene que ser exactamente un
 * UPDATE a una columna; nada de este archivo puede asomarse fuera de aquí.
 *
 * LA DIFERENCIA QUE IMPORTA: OpenRouter sí devuelve el costo real de la llamada
 * si se lo pides con `usage: {include: true}`. Anthropic devuelve tokens y nada
 * más. Por eso una fila del ledger con `cost_source='provider'` viene de aquí y
 * una con `'priced'` viene de un cálculo nuestro — y por eso esa columna existe:
 * para no tener que adivinar cuál es cuál después.
 *
 * De GARDEN se porta el transporte de `src/services/openrouter.ts`. NO se porta
 * `MODEL_COSTS` ni `estimateCost()`: son exactamente el bug que este handoff
 * viene a cerrar.
 */
import { PlatformError } from '@abraxa/db';
import { OPENROUTER_BASE_URL, TIMEOUT_PROVEEDOR_MS } from '../config';
import { capsFor } from '../capabilities';
import type { RawUsage } from '../types';
import type {
  CompletionRequest,
  CompletionResponse,
  FetchLike,
  ProviderAdapter,
  ToolCall,
} from './types';

interface ToolCallCruda {
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface RespuestaOpenRouter {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: { content?: string | null; tool_calls?: ToolCallCruda[] };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    /** Costo real en USD. Llega sólo si se pidió `usage: {include: true}`. */
    cost?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

function leerUsage(r: RespuestaOpenRouter): RawUsage {
  const u = r.usage ?? {};
  const cacheados = u.prompt_tokens_details?.cached_tokens ?? 0;
  const prompt = u.prompt_tokens ?? 0;

  return {
    // En el dialecto de OpenAI, `prompt_tokens` INCLUYE los cacheados. Aquí se
    // separan porque se cobran distinto; sumarlos contaría de más.
    inputTokens: Math.max(0, prompt - cacheados),
    outputTokens: u.completion_tokens ?? 0,
    cacheReadTokens: cacheados,
    // El dialecto de OpenAI no reporta escritura de caché por separado.
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    requestId: r.id ?? null,
    // Lo que Anthropic no da: costo real de la llamada.
    providerCostUsd: typeof u.cost === 'number' ? u.cost : null,
  };
}

function mapearFinishReason(s: string | undefined): CompletionResponse['stopReason'] {
  switch (s) {
    case 'tool_calls':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    default:
      return 'end_turn';
  }
}

function construirMensajes(req: CompletionRequest): unknown[] {
  // En el dialecto de OpenAI el sistema es el primer mensaje, no un campo.
  const salida: unknown[] = [{ role: 'system', content: req.system }];

  for (const m of req.messages) {
    if (m.role === 'user') {
      salida.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      const msg: Record<string, unknown> = { role: 'assistant', content: m.content || null };
      if (m.toolCalls?.length) {
        msg.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.input) },
        }));
      }
      salida.push(msg);
    } else {
      salida.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
    }
  }

  return salida;
}

export function createOpenRouterAdapter(fetchImpl: FetchLike = fetch): ProviderAdapter {
  return {
    name: 'openrouter',

    async complete(req: CompletionRequest): Promise<CompletionResponse> {
      const caps = capsFor(req.model, 'openrouter');

      const cuerpo: Record<string, unknown> = {
        model: req.model,
        max_tokens: Math.min(req.maxOutputTokens, caps.maxOutputTokens),
        messages: construirMensajes(req),
        // Sin esto, la respuesta no trae `usage.cost` y todo cae a `priced`.
        // Es una línea, y es la diferencia entre costo reportado y costo
        // calculado por nosotros.
        usage: { include: true },
      };

      if (req.tools.length > 0) {
        cuerpo.tools = req.tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.inputSchema },
        }));
      }

      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), TIMEOUT_PROVEEDOR_MS);
      if (req.signal) req.signal.addEventListener('abort', () => abort.abort(), { once: true });

      let res: Response;
      try {
        res = await fetchImpl(`${OPENROUTER_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${req.apiKey}`,
            'HTTP-Referer': 'https://mi.abraxa.club',
            'X-Title': 'ABRAXA Plataforma',
          },
          body: JSON.stringify(cuerpo),
          signal: abort.signal,
        });
      } catch (err) {
        throw new PlatformError('PROVIDER_ERROR', `No se pudo llamar a OpenRouter: ${String(err)}`, {
          cause: err,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!res.ok) {
        const texto = await res.text().catch(() => '');
        throw new PlatformError(
          'PROVIDER_ERROR',
          `OpenRouter respondió ${res.status}: ${texto.slice(0, 500)}`,
          {
            retryable: res.status === 429 || res.status >= 500,
            details: { status: res.status, model: req.model },
          },
        );
      }

      const datos = (await res.json()) as RespuestaOpenRouter;
      const choice = datos.choices?.[0];
      const mensaje = choice?.message;

      const toolCalls: ToolCall[] = [];
      for (const tc of mensaje?.tool_calls ?? []) {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(tc.function?.arguments ?? '{}') as Record<string, unknown>;
        } catch {
          // Argumentos mal formados no tumban la corrida: la tool recibe un
          // objeto vacío, falla con su propio mensaje, y el modelo se corrige.
          input = {};
        }
        toolCalls.push({ id: tc.id ?? '', name: tc.function?.name ?? '', input });
      }

      return {
        text: mensaje?.content ?? '',
        toolCalls,
        usage: leerUsage(datos),
        stopReason: mapearFinishReason(choice?.finish_reason),
        model: datos.model ?? req.model,
      };
    },
  };
}
