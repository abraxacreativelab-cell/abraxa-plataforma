/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Un driver que NO es WhatsApp — la prueba de que el enchufe sirve.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  El handoff lo pide con estas palabras: *"escribe un driver falso en tus
 *  tests que no sea WhatsApp y confirma que todo el flujo funciona con él"*.
 *  Es el criterio #6, y es lo único que de verdad demuestra que H12 y H13 van a
 *  poder enchufar sus canales sin tocar una línea de H6.
 *
 *  Está en `testing/` y no en `drivers/`: `drivers/meta`, `drivers/email` y
 *  `drivers/sms` son de otros handoffs y H6 no escribe ahí.
 *
 *  El tipo es parametrizable a propósito. Una prueba que sólo funcionara con
 *  `type: 'sms'` no demostraría genericidad, sólo que hay dos casos escritos a
 *  mano.
 */
import type { ChannelType, InboundMessage } from '@abraxa/db';
import type { DriverCompleto, EventoCanal } from '../drivers/types';
import { leerSobre } from '../drivers/types';

export interface EnvioRegistrado {
  channelId: string;
  address: string;
  body: string;
  media?: string[] | undefined;
}

export interface DriverFalso extends DriverCompleto {
  /** Todo lo que salió por este canal, en orden. */
  enviados: EnvioRegistrado[];
  /** El siguiente `send()` lanza este error y luego se limpia. */
  fallarSiguienteEnvio(err: Error): void;
}

export interface OpcionesDriverFalso {
  type?: ChannelType;
  /** Normalización propia del canal, para probar que el núcleo no la asume. */
  normalizeAddress?(raw: string): string;
  /** Sin id externo: prueba el camino del driver que no puede deduplicar. */
  sinExternalId?: boolean;
}

/**
 * El sobre que este driver entiende:
 *
 *     { channelId, payload: { mensajes: [{ address, body, externalId, … }],
 *                             eventos:  [ … ] } }
 *
 * Es un formato inventado, y ése es justo el punto: cada proveedor tiene el
 * suyo y el núcleo no conoce ninguno.
 */
export interface PayloadFalso {
  mensajes?: Array<{
    address: string;
    body?: string;
    media?: string[];
    externalId?: string;
    fromMe?: boolean;
    contactName?: string;
    receivedAt?: string;
  }>;
  eventos?: EventoCanal[];
}

export function createFakeDriver(opts: OpcionesDriverFalso = {}): DriverFalso {
  const type: ChannelType = opts.type ?? 'sms';
  const enviados: EnvioRegistrado[] = [];
  let fallaPendiente: Error | null = null;
  let n = 0;

  const driver: DriverFalso = {
    type,
    enviados,

    fallarSiguienteEnvio(err) {
      fallaPendiente = err;
    },

    ...(opts.normalizeAddress ? { normalizeAddress: opts.normalizeAddress } : {}),

    async send({ channelId, address, body, media }) {
      if (fallaPendiente) {
        const err = fallaPendiente;
        fallaPendiente = null;
        throw err;
      }
      enviados.push({ channelId, address, body, media });
      n += 1;
      return { externalId: opts.sinExternalId ? '' : `falso-out-${n}` };
    },

    async parseWebhook(raw: unknown): Promise<InboundMessage[]> {
      const sobre = leerSobre(raw);
      if (!sobre) return [];
      const payload = (sobre.payload ?? {}) as PayloadFalso;

      return (payload.mensajes ?? []).map((m, i) => ({
        channelType: type,
        channelId: sobre.channelId,
        address: m.address,
        body: m.body ?? '',
        media: m.media ?? [],
        externalId: m.externalId ?? `falso-in-${i}`,
        ...(m.fromMe ? { fromMe: true } : {}),
        ...(m.contactName ? { contactName: m.contactName } : {}),
        ...(m.receivedAt ? { receivedAt: m.receivedAt } : {}),
      }));
    },

    async parseEvents(raw: unknown): Promise<EventoCanal[]> {
      const sobre = leerSobre(raw);
      if (!sobre) return [];
      return ((sobre.payload ?? {}) as PayloadFalso).eventos ?? [];
    },

    async provisionChannel({ config }) {
      config.webhook_token = 'token-de-prueba';
      config.instancia_falsa = 'x';
      return { externalId: 'falso-externo', status: 'active' };
    },
  };

  return driver;
}

/** Un doble de `AgentPort.run` con lo mínimo que el puente le pide. */
export function createFakeAgents(
  responder: (input: string) => string | Promise<string> = () => 'respuesta del agente',
): {
  run: DriverAgentes['run'];
  llamadas: Array<{ role: string; input: string; threadId?: string | undefined }>;
} {
  const llamadas: Array<{ role: string; input: string; threadId?: string | undefined }> = [];
  return {
    llamadas,
    async run(_ctx, i) {
      llamadas.push({ role: i.role, input: i.input, threadId: i.threadId });
      const text = await responder(i.input);
      return {
        text,
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          cachedReadTokens: 0,
          cachedWriteTokens: 0,
          costUsd: 0.0001,
        },
        stopReason: 'end_turn' as const,
        agentName: 'Agente de prueba',
      };
    },
  };
}

type DriverAgentes = import('../bridge/responder').CorredorDeAgentes;
