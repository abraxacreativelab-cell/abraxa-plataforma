/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El enchufe. Lo que hace posibles H12 y H13 sin tocar una línea de H6.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Cada driver vive en `src/drivers/<canal>/` y se auto-registra al importarse.
 *  H12 crea `drivers/meta/`, H13 crea `drivers/email/` y `drivers/sms/`. H6 no
 *  los toca: sólo deja este registro y se asegura de que NO asuma nada de
 *  WhatsApp.
 *
 *  Que eso último sea verdad no es una promesa: `registry.test.ts` corre la
 *  cadena entera —alta de canal, webhook entrante, decisión de la IA, envío—
 *  con un driver falso que no es WhatsApp. Si algún día se cuela un supuesto,
 *  esa prueba se cae.
 *
 *  ── El hueco de GARDEN que aquí se cierra ──────────────────────────────────
 *
 *  `sendViaChannel()` (src/crm/channels/service.ts:181) abre con:
 *
 *      if (channel.driver !== 'evolution') throw new CrmError(400, …);
 *
 *  Un `throw` como primera línea de la fachada de envío convierte "soportar
 *  otro canal" en "editar la fachada". Aquí se despacha por el registro: el
 *  canal nuevo funciona en cuanto su driver se registra.
 */
import { PlatformError } from '@abraxa/db';
import type { ChannelType } from '@abraxa/db';
import { log } from '../logger';
import type { DriverCompleto } from './types';

const registro = new Map<ChannelType, DriverCompleto>();

/**
 * Da de alta un driver. Idempotente: volver a registrar el mismo tipo lo
 * reemplaza, que es lo que hace falta con el recarga-en-caliente y en pruebas.
 */
export function registerDriver(d: DriverCompleto): void {
  if (!d || typeof d.type !== 'string') {
    throw new PlatformError('VALIDATION', 'Un driver tiene que declarar su `type`.');
  }
  if (typeof d.send !== 'function' || typeof d.parseWebhook !== 'function') {
    throw new PlatformError(
      'VALIDATION',
      `El driver '${d.type}' no cumple ChannelDriver: faltan send() o parseWebhook().`,
    );
  }
  if (registro.has(d.type)) log.debug(`driver '${d.type}' reemplazado`);
  registro.set(d.type, d);
}

/**
 * El driver de un tipo de canal, o CHANNEL_ERROR nombrando a quién falta.
 *
 * El mensaje dice el handoff dueño por la misma razón que `usePort` de H1: la
 * conversación que lo topa sabe a quién está esperando sin preguntarle a nadie.
 */
export function driverFor(type: ChannelType): DriverCompleto {
  const d = registro.get(type);
  if (!d) {
    throw new PlatformError(
      'CHANNEL_ERROR',
      `No hay driver registrado para el canal '${type}'. Lo entrega ${duenoDe(type)}. ` +
        'Los drivers se auto-registran al importar su carpeta; si el paquete ya existe, ' +
        'revisa que `packages/inbox/src/index.ts` lo importe.',
      { details: { channelType: type }, retryable: false },
    );
  }
  return d;
}

export function hasDriver(type: ChannelType): boolean {
  return registro.has(type);
}

export function listDrivers(): ChannelType[] {
  return [...registro.keys()].sort();
}

/** Sólo para pruebas. */
export function __clearDrivers(): void {
  registro.clear();
}

/**
 * La dirección en su forma canónica, según su canal.
 *
 * Sin driver registrado se recorta y ya: es lo único honesto que se puede hacer
 * sin saber de qué canal se habla, y deja el camino abierto para que el driver
 * la afine cuando aterrice.
 *
 * OJO: cambiar la normalización de un canal ya en uso parte los hilos
 * existentes en dos. Es una migración de datos, no un ajuste.
 */
export function normalizarDireccion(type: ChannelType, raw: string): string {
  const d = registro.get(type);
  const base = String(raw ?? '').trim();
  if (!d?.normalizeAddress) return base;
  return d.normalizeAddress(base);
}

/** Cómo se le muestra la dirección al emprendedor. */
export function mostrarDireccion(type: ChannelType, address: string): string {
  const d = registro.get(type);
  if (!d?.displayAddress) return address;
  return d.displayAddress(address);
}

const DUENO: Record<ChannelType, string> = {
  whatsapp: 'H6 · packages/inbox/src/drivers/whatsapp',
  instagram: 'H12 · packages/inbox/src/drivers/meta',
  messenger: 'H12 · packages/inbox/src/drivers/meta',
  email: 'H13 · packages/inbox/src/drivers/email',
  sms: 'H13 · packages/inbox/src/drivers/sms',
};

function duenoDe(type: ChannelType): string {
  return DUENO[type] ?? 'un handoff que todavía no existe';
}
