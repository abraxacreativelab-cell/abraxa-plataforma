/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El outbox de eventos del tenant.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * El handoff pide dos cosas que parecen compatibles y no lo son de forma
 * obvia: que `provision()` sea todo-o-nada, Y que emita `tenant.provisioned`
 * para que H11 siembre las áreas del giro.
 *
 * Un bus en memoria las rompe. Si el proceso muere entre el COMMIT de la
 * transacción y el `emit`, queda una empresa creada que nunca recibió sus
 * áreas — y no hay forma de saber cuáles, porque el evento nunca existió.
 *
 * Por eso el evento es una FILA, escrita dentro de la misma transacción que el
 * hecho que describe (ver migración 011). Si el alta se revierte, el evento se
 * revierte con ella; si el alta se confirma, el evento está ahí esperando,
 * sobreviva o no el proceso. Es el patrón de outbox transaccional.
 *
 * ── Nota para H11 ─────────────────────────────────────────────────────────
 *
 * `TriggerType` de packages/db/ports.ts todavía no incluye
 * `'tenant_provisioned'` (está anotado en el PR para que H1 lo agregue).
 * Mientras tanto, hay dos formas de consumirlo, y las dos funcionan hoy:
 *
 *   · en proceso:  `onTenantProvisioned(async (e) => { … })`
 *   · desde fuera: leer `app.tenant_events` con `type = 'tenant_provisioned'`
 */
import { tenantDb } from '@abraxa/db';
import { fetchUndeliveredEvents, markEventDelivered } from '../db/queries';
import { mapPgError } from '../errors';
import type { TenantContext, TenantEventRow } from '../types';

export const TENANT_PROVISIONED = 'tenant_provisioned';
export const MEMBER_JOINED = 'member_joined';
export const MEMBER_REMOVED = 'member_removed';

export type TenantEventHandler = (evento: TenantEventRow) => void | Promise<void>;

const suscriptores = new Map<string, Set<TenantEventHandler>>();

/**
 * Escucha un tipo de evento. Devuelve la función para dejar de escuchar.
 *
 * Registrarse NO consume el evento: `drainTenantEvents()` es quien lo lee de
 * la tabla y lo reparte. Así, un suscriptor que se registra tarde sigue
 * recibiendo lo que quedó pendiente.
 */
export function onTenantEvent(tipo: string, handler: TenantEventHandler): () => void {
  const actuales = suscriptores.get(tipo) ?? new Set<TenantEventHandler>();
  actuales.add(handler);
  suscriptores.set(tipo, actuales);
  return () => {
    actuales.delete(handler);
  };
}

/** Atajo para el evento que le importa a H11. */
export const onTenantProvisioned = (handler: TenantEventHandler): (() => void) =>
  onTenantEvent(TENANT_PROVISIONED, handler);

/** Sólo para pruebas: deja el registro limpio entre casos. */
export function __clearTenantEventHandlers(): void {
  suscriptores.clear();
}

/**
 * Publica un evento desde dentro de un contexto de empresa.
 *
 * Los eventos de `provision()` y de aceptar una invitación NO pasan por aquí:
 * los escribe el SQL, dentro de su transacción, que es justamente el punto.
 * Esta función es para los eventos que ocurren fuera de una transacción de
 * base de datos.
 */
export async function emitTenantEvent(
  ctx: TenantContext,
  tipo: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await tenantDb(ctx)
    .from('tenant_events')
    .insert({ type: tipo, payload });
  if (error) throw mapPgError(error, `No se pudo registrar el evento ${tipo}`);
}

export interface DrainResult {
  entregados: number;
  fallidos: number;
}

/**
 * Reparte los eventos pendientes y los marca entregados.
 *
 * Un evento sólo se marca si TODOS sus suscriptores lo procesaron sin lanzar.
 * Si alguno falla, la fila se queda pendiente y la siguiente pasada lo
 * reintenta: es un outbox, no un bus de "mejor esfuerzo". El precio es que un
 * suscriptor tiene que ser idempotente, y eso es más barato que perder la
 * siembra de áreas de un cliente nuevo.
 */
export async function drainTenantEvents(limite = 100): Promise<DrainResult> {
  const pendientes = await fetchUndeliveredEvents(limite);
  let entregados = 0;
  let fallidos = 0;

  for (const evento of pendientes) {
    const handlers = suscriptores.get(evento.type);

    if (!handlers || handlers.size === 0) {
      // Nadie escucha todavía (H11 aún no aterriza). El evento se queda
      // pendiente a propósito: cuando exista quien lo consuma, lo va a
      // encontrar. Marcarlo entregado ahora sería perderlo.
      continue;
    }

    try {
      for (const handler of handlers) await handler(evento);
      await markEventDelivered(evento.id);
      entregados++;
    } catch (e) {
      fallidos++;
      console.error(`[tenancy] evento ${evento.type} (${evento.id}) falló; se reintentará`, e);
    }
  }

  return { entregados, fallidos };
}
