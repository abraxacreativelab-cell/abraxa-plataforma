/**
 * Dobles de proveedor y de red.
 *
 * Todo lo que habla con el exterior en este paquete recibe su `fetch` por
 * parámetro justamente para poder sustituirlo aquí. Es lo que permite probar
 * el ARMADO DEL CUERPO —que Haiku no reciba `effort`, que Sonnet 5 reciba
 * `thinking: disabled`— sin llave, sin red y sin gastar un token.
 */
import type { ProviderName } from '@abraxa/db';
import type {
  CompletionRequest,
  CompletionResponse,
  FetchLike,
  ProviderAdapter,
} from '../providers/types';
import type { RawUsage } from '../types';
import { USAGE_CERO } from '../types';

/** Un adaptador que devuelve lo que le digas y guarda lo que le pidieron. */
export interface AdaptadorFalso extends ProviderAdapter {
  /** Las peticiones que recibió, en orden. */
  readonly llamadas: CompletionRequest[];
}

export function createFakeAdapter(
  name: ProviderName,
  respuestas: Array<Partial<CompletionResponse>> | Partial<CompletionResponse> = {},
): AdaptadorFalso {
  const cola = Array.isArray(respuestas) ? [...respuestas] : [respuestas];
  const llamadas: CompletionRequest[] = [];
  let n = 0;

  return {
    name,
    llamadas,
    complete(req) {
      llamadas.push(req);
      n += 1;
      const r = cola.length > 1 ? (cola.shift() ?? {}) : (cola[0] ?? {});
      const u = r.usage ?? { ...USAGE_CERO, inputTokens: 1000, outputTokens: 100 };

      return Promise.resolve({
        text: r.text ?? `respuesta de ${name}`,
        toolCalls: r.toolCalls ?? [],
        // Un id ÚNICO por llamada cuando el test no fijó uno. La API real
        // siempre devuelve uno distinto, y el ledger tiene un índice único por
        // (provider, request_id): un doble que repite el id haría que la
        // segunda corrida se dedupara y el test mediría otra cosa.
        usage: u.requestId === null ? { ...u, requestId: `${name}-${n}` } : u,
        stopReason: r.stopReason ?? 'end_turn',
        model: r.model ?? req.model,
      });
    },
  };
}

/** Consumo con valores puestos a mano. */
export function usage(parcial: Partial<RawUsage> = {}): RawUsage {
  return { ...USAGE_CERO, ...parcial };
}

export interface FetchFalso {
  impl: FetchLike;
  /** Los cuerpos que se mandaron, ya parseados. Es lo que se afirma. */
  readonly cuerpos: Array<Record<string, unknown>>;
  readonly urls: string[];
  readonly headers: Array<Record<string, string>>;
}

/**
 * `fetch` que responde lo que le des y guarda lo que le mandaron.
 *
 * Guardar el cuerpo PARSEADO es el punto: la prueba que de verdad importa aquí
 * no es qué contestó el modelo, sino qué se le pidió — porque el 400 de Haiku
 * ocurre por un campo de más en el cuerpo, no por la respuesta.
 */
export function createFakeFetch(respuesta: unknown, status = 200): FetchFalso {
  const cuerpos: Array<Record<string, unknown>> = [];
  const urls: string[] = [];
  const headers: Array<Record<string, string>> = [];

  const impl: FetchLike = (url, init) => {
    urls.push(url);
    headers.push((init.headers ?? {}) as Record<string, string>);
    if (typeof init.body === 'string') {
      cuerpos.push(JSON.parse(init.body) as Record<string, unknown>);
    }
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(respuesta),
      text: () => Promise.resolve(JSON.stringify(respuesta)),
    } as Response);
  };

  return { impl, cuerpos, urls, headers };
}
