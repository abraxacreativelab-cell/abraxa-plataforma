/**
 * El driver de WhatsApp. El único que trae H6.
 *
 * Es también la prueba de que la interfaz sirve: si algo de aquí tuviera que
 * estar en el núcleo para que WhatsApp funcione, entonces el enchufe de H12 y
 * H13 estaría mal hecho. Todo lo que sabe qué es un JID, qué es una instancia
 * de Evolution y cómo se ve un `messages.upsert` vive dentro de esta carpeta.
 */
import { PlatformError } from '@abraxa/db';
import type { InboundMessage } from '@abraxa/db';
import { randomBytes } from 'node:crypto';
import { log } from '../../logger';
import { cargarCanalPorId } from '../../channels/lookup';
import type { DriverCompleto, EventoCanal } from '../types';
import { leerSobre } from '../types';
import { createEvolutionClient, type ClienteEvolution } from './evolution';
import { parsearEventos, parsearMensajes } from './parse';
import { normalizarTelefono } from './phone';

export interface OpcionesDriverWhatsApp {
  cliente?: ClienteEvolution;
  /** De dónde cuelga la URL pública del webhook. */
  baseUrlPublica?: string;
  /** Para pruebas: resuelve la fila del canal sin base. */
  cargarCanal?: (channelId: string) => Promise<{ config: Record<string, unknown> }>;
}

export function createWhatsAppDriver(opts: OpcionesDriverWhatsApp = {}): DriverCompleto {
  const cliente = opts.cliente ?? createEvolutionClient();
  const cargarCanal = opts.cargarCanal ?? ((id: string) => cargarCanalPorId(id));

  const instanciaDe = async (channelId: string): Promise<string> => {
    const canal = await cargarCanal(channelId);
    const instancia = (canal.config as { instance?: unknown })?.instance;
    if (typeof instancia !== 'string' || instancia.length === 0) {
      throw new PlatformError(
        'CHANNEL_ERROR',
        'El canal de WhatsApp no tiene instancia de Evolution en su config. ' +
          'Se crea con `crearCanal()`; una fila insertada a mano no sirve.',
        { retryable: false, details: { channelId } },
      );
    }
    return instancia;
  };

  return {
    type: 'whatsapp',

    // ── Dirección canónica: E.164, no JID ────────────────────────────────
    //
    // Que el hilo del cliente que escribe y el del saliente que le manda la
    // bandeja sean EL MISMO depende enteramente de esta línea.
    normalizeAddress: (raw) => normalizarTelefono(raw),

    displayAddress: (address) => address,

    async send({ channelId, address, body, media }) {
      const instancia = await instanciaDe(channelId);
      const destino = normalizarTelefono(address);
      if (!destino) {
        throw new PlatformError('VALIDATION', `Teléfono inválido: "${address}"`);
      }

      const primeraMedia = media?.[0];
      const r = primeraMedia
        ? await cliente.enviarMedia(instancia, destino, {
            url: primeraMedia,
            type: tipoDeMedia(primeraMedia),
            caption: body ?? '',
          })
        : await cliente.enviarTexto(instancia, destino, body);

      if (!r.externalId) {
        // Evolution aceptó el envío pero no devolvió id. Se sigue adelante: el
        // mensaje salió. Lo que se pierde es el acuse y la deduplicación del
        // eco `fromMe`, así que queda anotado en vez de fingir que todo bien.
        log.warn(`Evolution no devolvió id para el saliente de ${instancia} → ${destino}`);
      }
      return { externalId: r.externalId ?? '' };
    },

    async parseWebhook(raw: unknown): Promise<InboundMessage[]> {
      const sobre = leerSobre(raw);
      if (!sobre) return [];
      return parsearMensajes(sobre.channelId, sobre.payload);
    },

    async parseEvents(raw: unknown): Promise<EventoCanal[]> {
      const sobre = leerSobre(raw);
      if (!sobre) return [];
      return parsearEventos(sobre.payload);
    },

    /**
     * Alta de la línea: instancia dedicada + webhook con token propio.
     *
     * El token se genera aquí y viaja en la URL del webhook. Es lo que hace que
     * el endpoint público de un cliente no sirva para inyectarle mensajes a
     * otro.
     */
    async provisionChannel({ tenantId, name, config }) {
      const instancia =
        typeof config.instance === 'string' && config.instance.length > 0
          ? config.instance
          : `abx-${String(tenantId).slice(0, 8)}-${randomBytes(3).toString('hex')}`;
      const token =
        typeof config.webhook_token === 'string' && config.webhook_token.length > 0
          ? config.webhook_token
          : randomBytes(24).toString('hex');

      config.instance = instancia;
      config.webhook_token = token;

      const url = urlDelWebhook(opts.baseUrlPublica, config.channelId, token);
      await cliente.crearInstancia(instancia, url);
      log.info(`canal de WhatsApp aprovisionado: ${name} (instancia ${instancia})`);

      // `externalId` vacío a propósito: esa columna guarda la DIRECCIÓN de la
      // línea —el número conectado—, y todavía no hay número: nadie ha
      // escaneado el QR. La instancia vive en `config.instance`, que es donde
      // le corresponde. Lo llena `channelStatus()` al vincular.
      return { externalId: '', status: 'pending' };
    },

    async channelStatus({ config }) {
      const instancia = String(config.instance ?? '');
      if (!instancia) return { status: 'error', externalId: null, qr: null };

      const estado = await cliente.estado(instancia);
      let qr: string | null = null;
      if (estado.state !== 'open') {
        // Todavía sin QR es normal mientras Evolution levanta la instancia:
        // no es un error que deba tumbar la pantalla de conexión.
        try {
          qr = (await cliente.qr(instancia)).base64;
        } catch {
          qr = null;
        }
      }
      return {
        status: estado.state === 'open' ? 'active' : 'disconnected',
        externalId: estado.number,
        qr,
      };
    },

    async teardownChannel({ config }) {
      const instancia = String(config.instance ?? '');
      if (instancia) await cliente.borrarInstancia(instancia);
    },
  };
}

/**
 * La URL a la que Evolution manda los eventos.
 *
 * `channelId` puede faltar cuando el canal aún no tiene fila (es el orden que
 * impone `provisionChannel`, que corre antes del INSERT en algunos caminos): en
 * ese caso `crearCanal()` vuelve a fijar el webhook con el id real.
 */
export function urlDelWebhook(base: string | undefined, channelId: unknown, token: string): string {
  const raiz = (base ?? process.env.API_BASE_URL ?? 'http://localhost:3100').replace(/\/+$/, '');
  const id = typeof channelId === 'string' ? channelId : 'sin-id';
  return `${raiz}/inbox/webhooks/${id}?token=${encodeURIComponent(token)}`;
}

function tipoDeMedia(url: string): string {
  const limpia = url.split('?')[0] ?? '';
  const ext = limpia.slice(limpia.lastIndexOf('.') + 1).toLowerCase();
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'webm', '3gp'].includes(ext)) return 'video';
  if (['mp3', 'ogg', 'oga', 'wav', 'm4a'].includes(ext)) return 'audio';
  return 'document';
}
