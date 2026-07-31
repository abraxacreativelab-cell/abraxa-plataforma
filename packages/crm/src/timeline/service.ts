/**
 * La línea de tiempo del contacto.
 *
 * Dos reglas la gobiernan y las dos vienen de errores reales:
 *
 *  · **Registrar un evento NUNCA tumba la operación que lo generó.** Si
 *    `recordEvent` falla, devuelve `{ eventId: null }` y avisa por consola. Un
 *    WhatsApp sin contestar porque no se pudo escribir una línea de bitácora
 *    es un desastre mucho peor que una bitácora incompleta. (H6 §7: "si el
 *    agente falla, el mensaje queda sin responder y se marca" — la bitácora no
 *    puede ser lo que provoque ese caso.)
 *
 *  · **`external_id` hace la escritura idempotente.** Un webhook reenviado por
 *    Evolution y un reintento del motor de H8 pasan por aquí dos veces con la
 *    misma llave; el índice único parcial de 122 los colapsa en uno.
 */
import type { TenantContext } from '@abraxa/db';
import type { ContactEvent, RecordEventInput } from '../port';
import type { FilaEvento } from '../types';
import { ahora, db, esDuplicado, lista } from '../store';

/** Fila cruda → forma del port. */
export function aEvento(f: FilaEvento): ContactEvent {
  return {
    id: f.id,
    contactId: f.contact_id,
    type: f.type,
    summary: f.summary,
    payload: f.payload ?? {},
    actor: f.actor,
    source: f.source,
    externalId: f.external_id,
    occurredAt: f.occurred_at,
  };
}

/**
 * Escribe un evento. Nunca lanza.
 *
 * Devuelve `eventId: null` en dos casos distintos y a propósito indistinguibles
 * para el llamador: que ya existiera (idempotencia) o que la escritura fallara.
 * Ninguno de los dos debe cambiar lo que hace quien llamó.
 */
export async function registrarEvento(
  ctx: TenantContext,
  i: RecordEventInput,
): Promise<{ eventId: string | null }> {
  const fila = {
    contact_id: i.contactId,
    type: i.type,
    summary: i.summary,
    payload: i.payload ?? {},
    actor: i.actor ?? null,
    source: i.source ?? 'crm',
    external_id: i.externalId ?? null,
    occurred_at: i.occurredAt ?? ahora(),
  };

  try {
    const r = await db(ctx).from('contact_events').insert(fila).select('id');
    if (r.error) {
      // Ya estaba: el reintento hizo su trabajo, no hay nada que reportar.
      if (esDuplicado(r.error)) return { eventId: null };
      console.warn(
        `[crm] no se pudo registrar el evento ${i.type} del contacto ${i.contactId}: ${r.error.message}`,
      );
      return { eventId: null };
    }
    const filas = (r.data ?? []) as Array<{ id: string }>;
    return { eventId: filas[0]?.id ?? null };
  } catch (e) {
    console.warn(
      `[crm] no se pudo registrar el evento ${i.type} del contacto ${i.contactId}`,
      e instanceof Error ? e.message : e,
    );
    return { eventId: null };
  }
}

/** Los últimos eventos del contacto, del más reciente al más viejo. */
export async function leerLinea(
  ctx: TenantContext,
  i: { contactId: string; limit?: number; before?: string },
): Promise<ContactEvent[]> {
  const tope = Math.min(Math.max(i.limit ?? 50, 1), 500);

  let q = db(ctx)
    .from('contact_events')
    .select('*')
    .eq('contact_id', i.contactId)
    .order('occurred_at', { ascending: false })
    .limit(tope);

  if (i.before) q = q.lt('occurred_at', i.before);

  const filas = lista(await q, 'línea de tiempo') as unknown as FilaEvento[];
  return filas.map(aEvento);
}

/** El feed del negocio completo. Lo pinta el tablero de contactos. */
export async function leerFeed(
  ctx: TenantContext,
  i: { limit?: number } = {},
): Promise<ContactEvent[]> {
  const tope = Math.min(Math.max(i.limit ?? 30, 1), 200);
  const filas = lista(
    await db(ctx)
      .from('contact_events')
      .select('*')
      .order('occurred_at', { ascending: false })
      .limit(tope),
    'feed de actividad',
  ) as unknown as FilaEvento[];
  return filas.map(aEvento);
}
