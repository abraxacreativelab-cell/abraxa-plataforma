/**
 * Fusión: lo que GARDEN no tiene.
 *
 * Las dos aserciones que de verdad importan son que el perdedor NO se borra y
 * que sus identidades siguen resolviendo al ganador. Todo lo demás es
 * contabilidad.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PlatformError, __clearPorts, __setClientForTests } from '@abraxa/db';
import { contextoDePrueba, createFakeDb, type FakeDb } from '../testing/fake-db';
import { crearContacto, leerContacto, listarContactos, resolverPorIdentidad } from './service';
import { detectarDuplicados, fusionar } from './merge';
import { moverEtapa, sembrarEmbudoPorDefecto } from '../pipeline/service';

const A = contextoDePrueba('tenant-a');

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
});

describe('fusionar', () => {
  it('mueve identidades, etiquetas y línea de tiempo al ganador', async () => {
    const ganador = await crearContacto(A, {
      displayName: 'Santiago Alcalá',
      identities: [{ channel: 'whatsapp', identifier: '+528146811675' }],
      tags: ['vip'],
    });
    const perdedor = await crearContacto(A, {
      displayName: 'Santiago',
      identities: [{ channel: 'email', identifier: 'santiago@abraxa.club' }],
      tags: ['monterrey'],
    });

    const r = await fusionar(A, {
      winnerId: ganador.contactId,
      loserId: perdedor.contactId,
      actor: 'ana@abraxa.club',
    });

    expect(r.movedIdentities).toBe(1);

    const vivo = await leerContacto(A, ganador.contactId);
    expect(vivo?.identities.map((i) => i.identifier).sort()).toEqual([
      '+528146811675',
      'santiago@abraxa.club',
    ]);
    expect(vivo?.tags).toEqual(['monterrey', 'vip']);
  });

  it('NO borra al perdedor: lo apunta al ganador', async () => {
    const g = await crearContacto(A, { displayName: 'Bueno' });
    const p = await crearContacto(A, { displayName: 'Duplicado' });

    await fusionar(A, { winnerId: g.contactId, loserId: p.contactId });

    // La fila sigue ahí — `threads.contact_id` de H6 y los enrolamientos de H8
    // pueden seguir apuntándole sin romperse.
    expect(fake.tabla('contacts')).toHaveLength(2);
    const muerto = await leerContacto(A, p.contactId);
    expect(muerto?.mergedInto).toBe(g.contactId);

    // Pero ya no sale en la lista del emprendedor.
    expect((await listarContactos(A, {})).contacts.map((c) => c.id)).toEqual([g.contactId]);
  });

  it('un mensaje viejo del perdedor sigue resolviendo al ganador', async () => {
    const p = await resolverPorIdentidad(A, { channel: 'whatsapp', identifier: '+528146811675' });
    const g = await crearContacto(A, { displayName: 'Santiago (bueno)' });

    await fusionar(A, { winnerId: g.contactId, loserId: p.contactId });

    const otraVez = await resolverPorIdentidad(A, {
      channel: 'whatsapp',
      identifier: '+528146811675',
    });
    expect(otraVez.contactId).toBe(g.contactId);
    expect(otraVez.created).toBe(false);
  });

  it('el ganador hereda lo que le falta, y NO pisa lo que ya tiene', async () => {
    const g = await crearContacto(A, { displayName: 'Santiago', ownerEmail: 'ana@abraxa.club' });
    const p = await crearContacto(A, {
      displayName: 'Santiago Alcalá',
      companyName: 'ABRAXA',
      ownerEmail: 'luis@abraxa.club',
    });

    await fusionar(A, { winnerId: g.contactId, loserId: p.contactId });

    const vivo = await leerContacto(A, g.contactId);
    expect(vivo?.companyName).toBe('ABRAXA'); // no lo tenía: lo hereda
    expect(vivo?.ownerEmail).toBe('ana@abraxa.club'); // ya lo tenía: no se pisa
    expect(vivo?.displayName).toBe('Santiago');
  });

  it('conserva la etapa del ganador y no lo retrocede en el embudo', async () => {
    await sembrarEmbudoPorDefecto(A);
    const g = await crearContacto(A, { displayName: 'Bueno' });
    const p = await crearContacto(A, { displayName: 'Duplicado' });

    await moverEtapa(A, { contactId: g.contactId, stage: 'propuesta' });
    await moverEtapa(A, { contactId: p.contactId, stage: 'nuevo' });

    await fusionar(A, { winnerId: g.contactId, loserId: p.contactId });

    const vivo = await leerContacto(A, g.contactId);
    expect(vivo?.placements[0]?.stageSlug).toBe('propuesta');
    expect(fake.tabla('contact_stages').filter((s) => s.contact_id === p.contactId)).toHaveLength(0);
  });

  it('deja bitácora de qué se movió', async () => {
    const g = await crearContacto(A, { displayName: 'Bueno' });
    const p = await crearContacto(A, {
      displayName: 'Duplicado',
      identities: [{ channel: 'email', identifier: 'x@abraxa.club' }],
    });

    await fusionar(A, { winnerId: g.contactId, loserId: p.contactId, actor: 'ana@abraxa.club' });

    const bitacora = fake.tabla('contact_merges')[0];
    expect(bitacora?.winner_id).toBe(g.contactId);
    expect(bitacora?.loser_id).toBe(p.contactId);
    expect(bitacora?.merged_by).toBe('ana@abraxa.club');
    // El perdedor completo, para poder reconstruirlo a mano si la fusión estuvo mal.
    expect((bitacora?.payload as { loser?: { display_name?: string } })?.loser?.display_name).toBe(
      'Duplicado',
    );
  });

  it('fusionar sobre una cadena existente no crea una cadena más larga', async () => {
    const a = await crearContacto(A, { displayName: 'A' });
    const b = await crearContacto(A, { displayName: 'B' });
    const c = await crearContacto(A, { displayName: 'C' });

    await fusionar(A, { winnerId: b.contactId, loserId: a.contactId });
    // Se pide fusionar C en A, que ya está muerto: debe resolverse contra B.
    await fusionar(A, { winnerId: b.contactId, loserId: c.contactId });

    expect((await leerContacto(A, a.contactId))?.mergedInto).toBe(b.contactId);
    expect((await leerContacto(A, c.contactId))?.mergedInto).toBe(b.contactId);
  });

  it('se niega a fusionar un contacto consigo mismo', async () => {
    const x = await crearContacto(A, { displayName: 'X' });
    await expect(fusionar(A, { winnerId: x.contactId, loserId: x.contactId })).rejects.toThrow(
      PlatformError,
    );
  });

  it('se niega si los dos ya son el mismo por una fusión previa', async () => {
    const g = await crearContacto(A, { displayName: 'G' });
    const p = await crearContacto(A, { displayName: 'P' });
    await fusionar(A, { winnerId: g.contactId, loserId: p.contactId });
    await expect(fusionar(A, { winnerId: g.contactId, loserId: p.contactId })).rejects.toThrow(
      /ya son el mismo/,
    );
  });
});

describe('detectarDuplicados', () => {
  it('propone el par que el índice único NO puede atrapar', async () => {
    // `+528146811675` y `8146811675` son llaves distintas a propósito: la
    // normalización se niega a inventar el país del segundo.
    const uno = await crearContacto(A, {
      displayName: 'Santiago',
      identities: [{ channel: 'whatsapp', identifier: '+528146811675' }],
    });
    const dos = await crearContacto(A, {
      displayName: 'S. Alcalá',
      identities: [{ channel: 'whatsapp', identifier: '8146811675' }],
    });

    const pares = await detectarDuplicados(A);
    const par = pares.find(
      (p) =>
        (p.aId === uno.contactId && p.bId === dos.contactId) ||
        (p.aId === dos.contactId && p.bId === uno.contactId),
    );
    expect(par?.score).toBe(0.95);
    expect(par?.reason).toContain('8146811675');
  });

  it('propone por nombre idéntico, pero con puntaje bajo', async () => {
    await crearContacto(A, { displayName: 'José Pérez' });
    await crearContacto(A, { displayName: 'Jose Perez' });

    const pares = await detectarDuplicados(A);
    expect(pares).toHaveLength(1);
    expect(pares[0]?.score).toBe(0.55);
  });

  it('NO propone contactos ya fusionados', async () => {
    const g = await crearContacto(A, { displayName: 'Repetido' });
    const p = await crearContacto(A, { displayName: 'Repetido' });
    expect(await detectarDuplicados(A)).toHaveLength(1);

    await fusionar(A, { winnerId: g.contactId, loserId: p.contactId });
    expect(await detectarDuplicados(A)).toHaveLength(0);
  });

  it('nunca fusiona nada por su cuenta', async () => {
    await crearContacto(A, { displayName: 'Repetido' });
    await crearContacto(A, { displayName: 'Repetido' });
    await detectarDuplicados(A);
    expect(fake.tabla('contacts').filter((c) => c.merged_into)).toHaveLength(0);
  });
});

/**
 * Lo que la fusión destruía sin dejar rastro (auditoría del PR #9).
 *
 * La decisión de negocio no cambia: si el ganador ya ocupa ese embudo, se
 * queda donde está. Lo que cambia es que la posición descartada —y su monto—
 * dejan de evaporarse.
 */
describe('fusionar no evapora dinero', () => {
  it('guarda la posición descartada y su monto en la bitácora y en la ficha', async () => {
    await sembrarEmbudoPorDefecto(A);

    // A ("Santiago", por WhatsApp) va en Negociación con 250,000.
    const perdedor = await crearContacto(A, { displayName: 'Santiago' });
    await moverEtapa(A, { contactId: perdedor.contactId, stage: 'negociacion', amount: 250000 });

    // B ("Santiago Alcalá", por el formulario) está en Nuevo, sin monto.
    const ganador = await crearContacto(A, { displayName: 'Santiago Alcalá' });
    await moverEtapa(A, { contactId: ganador.contactId, stage: 'nuevo' });

    await fusionar(A, { winnerId: ganador.contactId, loserId: perdedor.contactId });

    // El criterio no cambió: al ganador NO se le retrocede.
    const vivo = await leerContacto(A, ganador.contactId);
    expect(vivo?.placements[0]?.stageSlug).toBe('nuevo');

    // Pero los 250,000 quedaron anotados, con su etapa.
    const bitacora = fake.tabla('contact_merges')[0];
    const descartadas = (bitacora?.payload as { discardedPlacements?: Array<{ amount: unknown }> })
      ?.discardedPlacements;
    expect(descartadas).toHaveLength(1);
    expect(Number(descartadas?.[0]?.amount)).toBe(250000);

    // Y el emprendedor puede leerlo donde va a buscarlo: en la ficha.
    const evento = fake
      .tabla('contact_events')
      .find((e) => e.contact_id === ganador.contactId && e.type === 'merged');
    expect(String(evento?.summary)).toMatch(/Se descartó su posición/);
    expect(String(evento?.summary)).toMatch(/250,000/);
  });

  it('sin posiciones descartadas el resumen no inventa nada', async () => {
    const g = await crearContacto(A, { displayName: 'Bueno' });
    const p = await crearContacto(A, { displayName: 'Duplicado' });
    await fusionar(A, { winnerId: g.contactId, loserId: p.contactId });

    const evento = fake
      .tabla('contact_events')
      .find((e) => e.contact_id === g.contactId && e.type === 'merged');
    expect(String(evento?.summary)).not.toMatch(/descartó/);
    const bitacora = fake.tabla('contact_merges')[0];
    expect(
      (bitacora?.payload as { discardedPlacements?: unknown[] })?.discardedPlacements,
    ).toHaveLength(0);
  });
});
