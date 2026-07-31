/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Lo que un canal necesita saber hacer, más allá de `ChannelDriver`.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  `ChannelDriver` vive en `packages/db/ports.ts` y es de H1: H6 no lo edita
 *  (el gate de propiedad falla el PR, y con razón — un tipo que cambia debajo
 *  de cuatro conversaciones vivas cuesta más que esperar).
 *
 *  Pero el port cubre lo mínimo —`send`, `parseWebhook`, `provisionChannel`— y
 *  hay dos cosas más que un canal real necesita:
 *
 *    · **Normalizar una dirección.** Que el mismo cliente escribiendo por
 *      WhatsApp y el saliente que le manda la bandeja caigan en EL MISMO hilo
 *      depende de que `+52 55 1234 5678`, `5215512345678` y `525512345678`
 *      converjan a una sola cadena. Cómo se normaliza es del canal, no del
 *      núcleo: para correo es minúsculas, para teléfono es E.164, para un id de
 *      Instagram es tal cual.
 *
 *    · **Los eventos que no son mensajes.** Acuses de entrega y cambios de
 *      conexión llegan por el mismo webhook y `parseWebhook` sólo devuelve
 *      `InboundMessage[]`.
 *
 *  Las dos son OPCIONALES y con un default sensato. Un driver de H12 o H13 que
 *  sólo implemente el port funciona completo: la dirección se recorta y ya, y
 *  el canal simplemente no reporta acuses. Nada se rompe por no implementarlas.
 */
import type { ChannelDriver } from '@abraxa/db';
import type { MessageStatus } from '../types';

/**
 * Un acuse del proveedor: "el mensaje X ya se entregó / ya lo leyeron".
 * `externalId` es el id del proveedor, el mismo que guardó `messages`.
 */
export interface EventoAcuse {
  kind: 'acuse';
  externalId: string;
  status: MessageStatus;
  error?: string;
}

/** Cambio de estado de la línea: se conectó, se cayó, cambió de número. */
export interface EventoConexion {
  kind: 'conexion';
  status: 'active' | 'disconnected' | 'error';
  /** La dirección propia de la línea, si el proveedor la manda. */
  externalId?: string;
}

export type EventoCanal = EventoAcuse | EventoConexion;

export interface ExtrasDriver {
  /**
   * Forma canónica de una dirección de este canal. Por defecto: `raw.trim()`.
   *
   * DEBE ser idempotente — `f(f(x)) === f(x)` — porque se aplica tanto a lo que
   * llega del webhook como a lo que escribe un humano en la UI, y las dos rutas
   * tienen que dar la misma cadena o se abren dos hilos para la misma persona.
   */
  normalizeAddress?(raw: string): string;

  /** Cómo se muestra una dirección en la UI. Por defecto: la dirección misma. */
  displayAddress?(address: string): string;

  /** Acuses y cambios de conexión que vienen en el mismo webhook. */
  parseEvents?(raw: unknown): Promise<EventoCanal[]>;

  /** Estado vivo de la línea + lo que haga falta para vincularla (QR, enlace). */
  channelStatus?(i: {
    channelId: string;
    config: Record<string, unknown>;
  }): Promise<{ status: string; externalId?: string | null; qr?: string | null }>;

  /** Baja de la línea con el proveedor. Se llama antes de borrar la fila. */
  teardownChannel?(i: { channelId: string; config: Record<string, unknown> }): Promise<void>;
}

/** Lo que de verdad guarda el registro: el port más los extras opcionales. */
export type DriverCompleto = ChannelDriver & ExtrasDriver;

/**
 * El sobre con el que el núcleo le entrega un webhook al driver.
 *
 * `ChannelDriver.parseWebhook(raw: unknown)` no recibe el id del canal, y el
 * driver no puede deducirlo del cuerpo del proveedor: Evolution manda su
 * `instance`, Meta manda su `page_id`. Quien sí lo sabe es la ruta, porque el
 * canal viene en la URL del webhook y ya validó su token.
 *
 * Por eso `raw` es este sobre. El tipo es `unknown` en el port justamente para
 * que quien lo llama decida la forma; aquí se decide una, se documenta, y H12 y
 * H13 la reciben igual sin coordinarse con nadie.
 */
export interface SobreWebhook {
  channelId: string;
  /** El cuerpo tal como lo mandó el proveedor. */
  payload: unknown;
  /** Cabeceras, por si el driver verifica una firma (H12 la va a necesitar). */
  headers?: Record<string, string | undefined>;
}

/** Lee el sobre sin confiar en que venga bien formado. */
export function leerSobre(raw: unknown): SobreWebhook | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<SobreWebhook>;
  if (typeof s.channelId !== 'string' || s.channelId.length === 0) return null;
  return { channelId: s.channelId, payload: s.payload, headers: s.headers };
}
