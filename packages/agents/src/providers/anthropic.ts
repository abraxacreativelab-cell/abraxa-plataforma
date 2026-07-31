/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Adaptador de Anthropic — Messages API.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  POR QUÉ `fetch` Y NO EL SDK.
 *
 *  H1 instaló `@anthropic-ai/sdk@^0.33.1`, que es de diciembre de 2024 y no
 *  conoce `output_config.effort` ni `thinking` — dos parámetros que este motor
 *  necesita para no romper Haiku 4.5 y para apagar el pensamiento por omisión de
 *  Sonnet 5. Subir la versión mueve `package-lock.json`, y el lockfile es de H1:
 *  el gate rebota el PR (y con razón — dos ramas tocándolo es un conflicto
 *  garantizado).
 *
 *  Así que se habla HTTP, que además deja tres cosas mejor:
 *    · control total de cabeceras beta, que es donde vive lo nuevo de la API;
 *    · simetría con OpenRouter, que de todas formas no tiene SDK instalado;
 *    · `fetch` inyectable → se prueba el cuerpo y la lectura de `usage` sin red.
 *
 *  ANOTADO EN EL PR: subir `@anthropic-ai/sdk` a una versión actual. Cuando
 *  pase, este archivo se puede reescribir con el SDK sin tocar nada más — para
 *  eso existe `ProviderAdapter`.
 *
 *  AUTENTICACIÓN: llave de API (`x-api-key`), no el Agent SDK con suscripción.
 *  Son productos distintos y el segundo sólo autentica bien de forma local.
 */
import { PlatformError } from '@abraxa/db';
import { ANTHROPIC_BASE_URL, ANTHROPIC_VERSION, TIMEOUT_PROVEEDOR_MS } from '../config';
import { capsFor } from '../capabilities';
import type { RawUsage } from '../types';
import type {
  CompletionRequest,
  CompletionResponse,
  FetchLike,
  ProviderAdapter,
  ToolCall,
} from './types';

// ── Forma de la respuesta que nos importa ──────────────────────────────────

interface BloqueTexto {
  type: 'text';
  text: string;
}
interface BloqueToolUse {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}
interface BloqueOtro {
  type: string;
}
type Bloque = BloqueTexto | BloqueToolUse | BloqueOtro;

interface RespuestaAnthropic {
  id?: string;
  model?: string;
  content?: Bloque[];
  stop_reason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
    /** Desglose por TTL cuando se usa el caché de 1 hora. */
    cache_creation?: {
      ephemeral_5m_input_tokens?: number;
      ephemeral_1h_input_tokens?: number;
    };
  };
}

/**
 * Lee el consumo REAL de la respuesta.
 *
 * Los cuatro conceptos se cobran distinto, así que se leen los cuatro:
 * `input_tokens` es lo NO cacheado, `cache_read_input_tokens` lo servido del
 * caché a ~0.1×, y la escritura sale más cara que el input (1.25× a 5 min,
 * 2× a 1 h).
 *
 * Cuando la respuesta trae el desglose `cache_creation` por TTL, se usa. Cuando
 * no —lo normal con el TTL de 5 minutos— el total se asigna a 5m, que es lo que
 * de verdad se pidió.
 */
function leerUsage(r: RespuestaAnthropic): RawUsage {
  const u = r.usage ?? {};
  const creacionTotal = u.cache_creation_input_tokens ?? 0;
  const desglose = u.cache_creation;

  const w5m = desglose?.ephemeral_5m_input_tokens;
  const w1h = desglose?.ephemeral_1h_input_tokens;

  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWrite5mTokens: w5m ?? (w1h === undefined ? creacionTotal : 0),
    cacheWrite1hTokens: w1h ?? 0,
    requestId: r.id ?? null,
    // Anthropic NO devuelve costo. Devuelve tokens. El costo se calcula contra
    // app.model_pricing y se marca `priced`. Ésta es la línea que explica por
    // qué existe esa tabla.
    providerCostUsd: null,
  };
}

function mapearStopReason(s: string | undefined): CompletionResponse['stopReason'] {
  switch (s) {
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'max_tokens';
    case 'end_turn':
    case 'stop_sequence':
      return 'end_turn';
    default:
      return 'end_turn';
  }
}

/** Los turnos internos → el formato de la Messages API. */
function construirMensajes(req: CompletionRequest): unknown[] {
  const salida: unknown[] = [];

  for (const m of req.messages) {
    if (m.role === 'user') {
      salida.push({ role: 'user', content: m.content });
      continue;
    }

    if (m.role === 'assistant') {
      const bloques: unknown[] = [];
      if (m.content) bloques.push({ type: 'text', text: m.content });
      for (const tc of m.toolCalls ?? []) {
        bloques.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
      }
      // Un turno de assistant vacío es un 400. Si el modelo no dijo nada y no
      // pidió tools, no hay turno que mandar.
      if (bloques.length > 0) salida.push({ role: 'assistant', content: bloques });
      continue;
    }

    // Los resultados de tool viajan como turno de `user` con bloques
    // `tool_result`. Es el formato de la API, no una elección nuestra.
    const ultimo = salida[salida.length - 1] as { role?: string; content?: unknown[] } | undefined;
    const bloque = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content };

    // Todos los resultados de una misma tanda van en UN solo turno. Partirlos
    // entrena al modelo a dejar de pedir tools en paralelo.
    if (ultimo && ultimo.role === 'user' && Array.isArray(ultimo.content)) {
      ultimo.content.push(bloque);
    } else {
      salida.push({ role: 'user', content: [bloque] });
    }
  }

  return salida;
}

export function createAnthropicAdapter(fetchImpl: FetchLike = fetch): ProviderAdapter {
  return {
    name: 'anthropic',

    async complete(req: CompletionRequest): Promise<CompletionResponse> {
      const caps = capsFor(req.model, 'anthropic');

      // El techo de salida del modelo manda. Pedir 128k a Haiku 4.5, que corta
      // en 64k, es un 400 evitable.
      const maxTokens = Math.min(req.maxOutputTokens, caps.maxOutputTokens);

      // ── El prompt de sistema, con o sin caché ─────────────────────────────
      // Se manda como ARRAY de bloques (no como string) porque `cache_control`
      // sólo se puede colgar de un bloque. El punto de corte va en el último
      // bloque estable: el orden de render es `tools → system → messages`, así
      // que marcar aquí cachea las tools Y el sistema juntos.
      const system = req.cachePrefix
        ? [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }]
        : [{ type: 'text', text: req.system }];

      const cuerpo: Record<string, unknown> = {
        model: req.model,
        max_tokens: maxTokens,
        system,
        messages: construirMensajes(req),
      };

      if (req.tools.length > 0) {
        cuerpo.tools = req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema,
        }));
      }

      // ── Aquí es donde la matriz de capacidades gana su sueldo ─────────────
      //
      // Haiku 4.5 devuelve 400 si le llega `output_config.effort`. Como los tres
      // sub-agentes de cara al cliente corren en Haiku, mandarlo a ciegas los
      // tumba a los tres en la primera llamada.
      if (caps.effort) {
        cuerpo.output_config = { effort: 'medium' };
      }

      // Y en Sonnet 5 el pensamiento viene ENCENDIDO por omisión: si nadie lo
      // apaga, cada mensaje de un cliente final paga razonamiento que nadie
      // pidió, y `max_tokens` cubre pensamiento + texto, así que la respuesta
      // sale además truncada. No hay error: sólo respuestas peores y más caras.
      if (caps.thinking === 'adaptive' && caps.thinkingOnByDefault) {
        cuerpo.thinking = { type: 'disabled' };
      }

      // ── La llamada ────────────────────────────────────────────────────────
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), TIMEOUT_PROVEEDOR_MS);
      if (req.signal) req.signal.addEventListener('abort', () => abort.abort(), { once: true });

      let res: Response;
      try {
        res = await fetchImpl(`${ANTHROPIC_BASE_URL}/v1/messages`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': req.apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
          },
          body: JSON.stringify(cuerpo),
          signal: abort.signal,
        });
      } catch (err) {
        throw new PlatformError('PROVIDER_ERROR', `No se pudo llamar a Anthropic: ${String(err)}`, {
          cause: err,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!res.ok) {
        const texto = await res.text().catch(() => '');
        throw new PlatformError(
          'PROVIDER_ERROR',
          `Anthropic respondió ${res.status}: ${texto.slice(0, 500)}`,
          {
            // 429 y 5xx sí se reintentan; un 400 nuestro no se arregla solo.
            retryable: res.status === 429 || res.status >= 500,
            details: { status: res.status, model: req.model },
          },
        );
      }

      const datos = (await res.json()) as RespuestaAnthropic;

      let texto = '';
      const toolCalls: ToolCall[] = [];
      for (const b of datos.content ?? []) {
        if (b.type === 'text') texto += (b as BloqueTexto).text;
        else if (b.type === 'tool_use') {
          const t = b as BloqueToolUse;
          toolCalls.push({ id: t.id, name: t.name, input: t.input ?? {} });
        }
      }

      return {
        text: texto,
        toolCalls,
        usage: leerUsage(datos),
        stopReason: mapearStopReason(datos.stop_reason),
        model: datos.model ?? req.model,
      };
    },
  };
}
