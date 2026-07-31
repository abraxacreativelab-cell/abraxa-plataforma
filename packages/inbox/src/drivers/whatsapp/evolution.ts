/**
 * Cliente HTTP de Evolution API — WhatsApp sobre Baileys, self-hosted.
 *
 * Cada canal de WhatsApp del producto es una instancia de Evolution: multilínea
 * por tenant, reconexión automática y sesión persistida del lado de Evolution.
 * Nada de Puppeteer.
 *
 * El `fetch` se inyecta para poder probar la cadena entera sin red. No es un
 * adorno de pruebas: los criterios #4, #5 y #6 de H6 se verifican justamente
 * aquí, y ninguno debería necesitar un WhatsApp conectado para correr en CI.
 */
import { PlatformError } from '@abraxa/db';
import { env } from '@abraxa/config';
import { TIMEOUT_CANAL_MS, TIMEOUT_MEDIA_MS } from '../../config';
import { telefonoAJid } from './phone';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface OpcionesEvolution {
  baseUrl?: string;
  apiKey?: string;
  fetchImpl?: FetchLike;
}

export interface RespuestaEvolution<T = unknown> {
  status: number;
  data: T;
}

export interface EstadoInstancia {
  instance: string;
  state: 'open' | 'connecting' | 'close' | 'unknown';
  number: string | null;
  profileName: string | null;
}

export interface ClienteEvolution {
  crearInstancia(instance: string, webhookUrl: string): Promise<void>;
  fijarWebhook(instance: string, url: string): Promise<void>;
  estado(instance: string): Promise<EstadoInstancia>;
  qr(instance: string): Promise<{ base64: string | null; pairingCode: string | null }>;
  borrarInstancia(instance: string): Promise<void>;
  enviarTexto(instance: string, to: string, text: string): Promise<{ externalId: string | null }>;
  enviarMedia(
    instance: string,
    to: string,
    media: { url: string; type?: string; caption?: string; fileName?: string },
  ): Promise<{ externalId: string | null }>;
}

export function createEvolutionClient(opts: OpcionesEvolution = {}): ClienteEvolution {
  const pedir = async <T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs = TIMEOUT_CANAL_MS,
  ): Promise<RespuestaEvolution<T>> => {
    const { baseUrl, apiKey, fetchImpl } = resolverConfig(opts);

    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', apikey: apiKey },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      // La distinción que GARDEN aprendió a la mala y que aquí se conserva:
      //
      //   · timeout  → la petición SÍ salió y pudo entregarse. Reintentar a
      //     ciegas duplicaría el mensaje, y un duplicado en WhatsApp "quema el
      //     número". Se marca NO reintentable.
      //   · cualquier otro fallo de red (ECONNREFUSED, DNS) → la petición no
      //     llegó, el mensaje seguro NO salió: reintentar es seguro.
      const nombre = (err as Error)?.name ?? 'Error';
      const expiro = nombre === 'TimeoutError' || nombre === 'AbortError';
      throw new PlatformError(
        'CHANNEL_ERROR',
        expiro
          ? `Evolution no respondió en ${timeoutMs / 1000}s (envío ambiguo, no se reintenta)`
          : `Evolution inalcanzable (${nombre}) — ¿la línea está conectada?`,
        { retryable: !expiro, details: { path, timeout: expiro } },
      );
    }

    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      /* Evolution responde vacío en varias rutas; no es un error. */
    }
    return { status: res.status, data: data as T };
  };

  const fallar = (status: number, data: unknown, que: string): never => {
    throw new PlatformError('CHANNEL_ERROR', `${que} (${status}): ${recortar(data)}`, {
      // 5xx del proveedor sí se reintenta; un 4xx es un problema nuestro.
      retryable: status >= 500,
      details: { status },
    });
  };

  return {
    async crearInstancia(instance, webhookUrl) {
      const { status, data } = await pedir<Array<{ name?: string }>>(
        'GET',
        `/instance/fetchInstances?instanceName=${encodeURIComponent(instance)}`,
      );
      const existe = status === 200 && Array.isArray(data) && data.some((i) => i?.name === instance);
      if (!existe) {
        const creada = await pedir('POST', '/instance/create', {
          instanceName: instance,
          integration: 'WHATSAPP-BAILEYS',
          qrcode: true,
        });
        if (creada.status >= 400) fallar(creada.status, creada.data, 'Evolution no creó la instancia');
      }
      await this.fijarWebhook(instance, webhookUrl);
    },

    async fijarWebhook(instance, url) {
      const { status, data } = await pedir(
        'POST',
        `/webhook/set/${encodeURIComponent(instance)}`,
        {
          webhook: {
            enabled: true,
            url,
            byEvents: false,
            base64: false,
            events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'],
          },
        },
      );
      if (status >= 400) fallar(status, data, 'Evolution rechazó el webhook');
    },

    async estado(instance) {
      const { status, data } = await pedir<{ instance?: { state?: string } }>(
        'GET',
        `/instance/connectionState/${encodeURIComponent(instance)}`,
      );
      if (status === 404) return { instance, state: 'unknown', number: null, profileName: null };

      const crudo = data?.instance?.state ?? 'unknown';
      const estado =
        crudo === 'open' || crudo === 'connecting' || crudo === 'close' ? crudo : 'unknown';

      const { data: lista } = await pedir<Array<{ name?: string; number?: string; profileName?: string }>>(
        'GET',
        `/instance/fetchInstances?instanceName=${encodeURIComponent(instance)}`,
      );
      const info = Array.isArray(lista) ? lista.find((i) => i?.name === instance) : null;

      return {
        instance,
        state: estado,
        number: info?.number ?? null,
        profileName: info?.profileName ?? null,
      };
    },

    async qr(instance) {
      const { status, data } = await pedir<{
        base64?: string;
        pairingCode?: string;
        qrcode?: { base64?: string };
      }>('GET', `/instance/connect/${encodeURIComponent(instance)}`);
      if (status >= 400) fallar(status, data, 'Evolution no entregó el QR');
      return { base64: data?.base64 ?? data?.qrcode?.base64 ?? null, pairingCode: data?.pairingCode ?? null };
    },

    async borrarInstancia(instance) {
      await pedir('DELETE', `/instance/logout/${encodeURIComponent(instance)}`);
      await pedir('DELETE', `/instance/delete/${encodeURIComponent(instance)}`);
    },

    async enviarTexto(instance, to, text) {
      const { status, data } = await pedir<{ key?: { id?: string } }>(
        'POST',
        `/message/sendText/${encodeURIComponent(instance)}`,
        { number: telefonoAJid(to), text },
      );
      if (status >= 400) fallar(status, data, 'WhatsApp no enviado');
      return { externalId: data?.key?.id ?? null };
    },

    async enviarMedia(instance, to, media) {
      const { status, data } = await pedir<{ key?: { id?: string } }>(
        'POST',
        `/message/sendMedia/${encodeURIComponent(instance)}`,
        {
          number: telefonoAJid(to),
          mediatype: media.type ?? 'image',
          media: media.url,
          caption: media.caption ?? '',
          fileName: media.fileName,
        },
        TIMEOUT_MEDIA_MS,
      );
      if (status >= 400) fallar(status, data, 'Media no enviada');
      return { externalId: data?.key?.id ?? null };
    },
  };
}

function resolverConfig(opts: OpcionesEvolution): {
  baseUrl: string;
  apiKey: string;
  fetchImpl: FetchLike;
} {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
  if (!fetchImpl) {
    throw new PlatformError('INTERNAL', 'No hay `fetch` en este runtime. Node 22 lo trae nativo.');
  }

  // Perezoso a propósito, igual que `env()` de H1: importar este módulo no
  // puede exigir secretos, o `npm run build` y CI reventarían sin `.env` y la
  // primera reacción de alguien sería aflojar el esquema.
  let baseUrl = opts.baseUrl;
  let apiKey = opts.apiKey;
  if (baseUrl === undefined || apiKey === undefined) {
    const e = env();
    baseUrl ??= e.EVOLUTION_API_URL ?? 'http://127.0.0.1:8080';
    apiKey ??= e.EVOLUTION_API_KEY ?? '';
  }

  return { baseUrl: baseUrl.replace(/\/+$/, ''), apiKey, fetchImpl };
}

function recortar(data: unknown): string {
  try {
    return JSON.stringify(data)?.slice(0, 200) ?? '';
  } catch {
    return String(data).slice(0, 200);
  }
}
