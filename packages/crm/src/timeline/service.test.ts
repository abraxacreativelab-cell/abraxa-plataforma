/**
 * La línea de tiempo tiene una sola regla dura: registrar un evento NUNCA
 * puede tumbar la operación que lo generó. Un WhatsApp sin contestar porque no
 * se pudo escribir una línea de bitácora es un desastre mucho peor que una
 * bitácora incompleta.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __clearPorts, __setClientForTests } from '@abraxa/db';
import type { AnyClient } from '@abraxa/db';
import { contextoDePrueba, createFakeDb, type FakeDb } from '../testing/fake-db';
import { crearContacto } from '../contacts/service';
import { leerFeed, leerLinea, registrarEvento } from './service';

const A = contextoDePrueba('tenant-a');
const B = contextoDePrueba('tenant-b');

let fake: FakeDb;
let restaurar: () => void;

beforeEach(() => {
  fake = createFakeDb();
  restaurar = __setClientForTests(fake.client);
  __clearPorts();
});

afterEach(() => {
  restaurar();
  __clearPorts();
  vi.restoreAllMocks();
});

describe('registrarEvento', () => {
  it('escribe y devuelve el id', async () => {
    const { contactId } = await crearContacto(A, { displayName: 'Santiago' });
    const r = await registrarEvento(A, {
      contactId,
      type: 'message_in',
      summary: 'Hola, ¿a qué hora abren?',
      source: 'inbox',
    });
    expect(r.eventId).toBeTruthy();
  });

  /**
   * Un webhook reenviado por Evolution y un reintento del motor de H8 pasan por
   * aquí dos veces con la misma llave. El índice único parcial de 122 los
   * colapsa en uno; el `external_id` es lo que lo hace posible.
   */
  it('el mismo external_id no duplica la línea de tiempo', async () => {
    const { contactId } = await crearContacto(A, { displayName: 'Santiago' });
    const antes = fake.tabla('contact_events').length;

    await registrarEvento(A, {
      contactId,
      type: 'message_in',
      summary: 'Hola',
      externalId: 'wamid.ABC123',
    });
    const repetido = await registrarEvento(A, {
      contactId,
      type: 'message_in',
      summary: 'Hola',
      externalId: 'wamid.ABC123',
    });

    expect(repetido.eventId).toBeNull();
    expect(fake.tabla('contact_events')).toHaveLength(antes + 1);
  });

  it('eventos SIN external_id sí se acumulan', async () => {
    const { contactId } = await crearContacto(A, { displayName: 'Santiago' });
    const antes = fake.tabla('contact_events').length;
    await registrarEvento(A, { contactId, type: 'note', summary: 'Llamé' });
    await registrarEvento(A, { contactId, type: 'note', summary: 'Llamé' });
    expect(fake.tabla('contact_events')).toHaveLength(antes + 2);
  });

  /** LA REGLA DURA. */
  it('NO lanza si la base falla: avisa y devuelve null', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const roto = {
      from: () => ({
        insert: () => ({
          select: () =>
            Promise.resolve({ data: null, error: { message: 'la base se cayó' }, count: null }),
        }),
      }),
    } as unknown as AnyClient;

    const deshacer = __setClientForTests(roto);
    const r = await registrarEvento(A, { contactId: 'x', type: 'note', summary: 'algo' });
    deshacer();

    expect(r.eventId).toBeNull();
    expect(aviso).toHaveBeenCalled();
  });

  it('tampoco lanza si el cliente revienta a media llamada', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const explota = {
      from: () => {
        throw new Error('socket cerrado');
      },
    } as unknown as AnyClient;

    const deshacer = __setClientForTests(explota);
    const r = await registrarEvento(A, { contactId: 'x', type: 'note', summary: 'algo' });
    deshacer();

    expect(r.eventId).toBeNull();
    expect(aviso).toHaveBeenCalled();
  });
});

describe('leerLinea', () => {
  it('devuelve del más reciente al más viejo', async () => {
    const { contactId } = await crearContacto(A, { displayName: 'Santiago' });
    await registrarEvento(A, {
      contactId,
      type: 'note',
      summary: 'primero',
      occurredAt: '2026-07-01T10:00:00.000Z',
    });
    await registrarEvento(A, {
      contactId,
      type: 'note',
      summary: 'segundo',
      occurredAt: '2026-07-02T10:00:00.000Z',
    });

    // Se filtran los dos sembrados: `crearContacto` deja sus propios eventos
    // con la hora REAL, que es posterior a cualquier fecha de 2026-07 que se
    // siembre aquí. Afirmar sobre `linea[0]` a secas probaría el reloj, no el
    // orden.
    const sembrados = (await leerLinea(A, { contactId }))
      .map((e) => e.summary)
      .filter((s) => s === 'primero' || s === 'segundo');

    expect(sembrados).toEqual(['segundo', 'primero']);
  });

  it('no mezcla la línea de tiempo de otro tenant', async () => {
    const enA = await crearContacto(A, { displayName: 'De A' });
    await registrarEvento(A, { contactId: enA.contactId, type: 'note', summary: 'secreto de A' });

    const enB = await leerLinea(B, { contactId: enA.contactId });
    expect(enB).toHaveLength(0);
    expect((await leerFeed(B)).map((e) => e.summary)).not.toContain('secreto de A');
  });

  it('pagina con `before`', async () => {
    const { contactId } = await crearContacto(A, { displayName: 'Santiago' });
    await registrarEvento(A, {
      contactId,
      type: 'note',
      summary: 'viejo',
      occurredAt: '2026-07-01T10:00:00.000Z',
    });
    await registrarEvento(A, {
      contactId,
      type: 'note',
      summary: 'nuevo',
      occurredAt: '2026-07-05T10:00:00.000Z',
    });

    const anteriores = await leerLinea(A, { contactId, before: '2026-07-03T00:00:00.000Z' });
    expect(anteriores.map((e) => e.summary)).toEqual(['viejo']);
  });
});
