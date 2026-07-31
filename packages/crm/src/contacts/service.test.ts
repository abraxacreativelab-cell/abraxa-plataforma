/**
 * Los criterios de "listo" de H15 que se pueden verificar sin base viva.
 *
 * El más importante es el de la carrera: dos webhooks simultáneos del mismo
 * número tienen que devolver el MISMO contacto. Se prueba de verdad, corriendo
 * las dos llamadas con `Promise.all` contra un doble que sí reproduce el
 * índice único — no simulando el resultado.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformError, __clearPorts, __setClientForTests, registerPort } from '@abraxa/db';
import { contextoDePrueba, createFakeDb, type FakeDb } from '../testing/fake-db';
import {
  agregarEtiqueta,
  agregarIdentidad,
  asignarDueno,
  crearContacto,
  leerContacto,
  listarContactos,
  quitarEtiqueta,
  resolverPorIdentidad,
  seguirFusion,
} from './service';

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

describe('resolveByIdentity', () => {
  it('crea el contacto la primera vez y lo reusa la segunda', async () => {
    const uno = await resolverPorIdentidad(A, {
      channel: 'whatsapp',
      identifier: '+52 81 4681 1675',
      name: 'Santiago',
    });
    expect(uno.created).toBe(true);

    const dos = await resolverPorIdentidad(A, {
      channel: 'whatsapp',
      identifier: '5218146811675@s.whatsapp.net',
    });

    expect(dos.created).toBe(false);
    expect(dos.contactId).toBe(uno.contactId);
    expect(fake.tabla('contacts')).toHaveLength(1);
  });

  /**
   * LA PRUEBA QUE JUSTIFICA EL DISEÑO.
   *
   * Las dos llamadas hacen su SELECT antes de que ninguna haya insertado —
   * exactamente la ventana que abre "busca y si no está créalo". Una gana el
   * índice único; la otra recibe 23505, borra su contacto huérfano y relee al
   * ganador. Si el `catch` de 23505 no existiera, esto dejaría dos contactos.
   */
  it('dos webhooks concurrentes del mismo número dan UN contacto', async () => {
    const [uno, dos] = await Promise.all([
      resolverPorIdentidad(A, { channel: 'whatsapp', identifier: '+528146811675' }),
      resolverPorIdentidad(A, { channel: 'whatsapp', identifier: '+528146811675' }),
    ]);

    expect(dos.contactId).toBe(uno.contactId);
    expect(fake.tabla('contacts')).toHaveLength(1);
    expect(fake.tabla('contact_identities')).toHaveLength(1);
  });

  it('un tenant no ve ni toca el contacto de otro', async () => {
    const enA = await resolverPorIdentidad(A, { channel: 'whatsapp', identifier: '+528146811675' });
    const enB = await resolverPorIdentidad(B, { channel: 'whatsapp', identifier: '+528146811675' });

    // El MISMO número en dos empresas son dos contactos distintos: el índice
    // único lleva `tenant_id` como primera columna a propósito.
    expect(enB.contactId).not.toBe(enA.contactId);
    expect(enB.created).toBe(true);

    expect(await leerContacto(B, enA.contactId)).toBeNull();
    const lista = await listarContactos(B, {});
    expect(lista.contacts.map((c) => c.id)).toEqual([enB.contactId]);
  });

  it('rechaza un grupo de WhatsApp: un grupo no es una persona', async () => {
    await expect(
      resolverPorIdentidad(A, { channel: 'whatsapp', identifier: '120363000@g.us' }),
    ).rejects.toThrow(PlatformError);
  });

  it('sigue la cadena de fusión hasta el contacto vivo', async () => {
    const viejo = await resolverPorIdentidad(A, {
      channel: 'whatsapp',
      identifier: '+528146811675',
    });
    const nuevo = await crearContacto(A, { displayName: 'Santiago (bueno)' });

    // Se simula la marca que deja `fusionar()`.
    const fila = fake.tabla('contacts').find((c) => c.id === viejo.contactId);
    if (fila) fila.merged_into = nuevo.contactId;

    const otra = await resolverPorIdentidad(A, {
      channel: 'whatsapp',
      identifier: '+528146811675',
    });
    expect(otra.contactId).toBe(nuevo.contactId);
  });

  it('detecta un ciclo de fusión en vez de colgarse', async () => {
    const x = await crearContacto(A, { displayName: 'X' });
    const y = await crearContacto(A, { displayName: 'Y' });
    for (const c of fake.tabla('contacts')) {
      if (c.id === x.contactId) c.merged_into = y.contactId;
      if (c.id === y.contactId) c.merged_into = x.contactId;
    }
    await expect(seguirFusion(A, x.contactId)).rejects.toThrow(/[Cc]iclo de fusión/);
  });

  it('deja la creación anotada en la línea de tiempo', async () => {
    const { contactId } = await resolverPorIdentidad(A, {
      channel: 'whatsapp',
      identifier: '+528146811675',
    });
    const eventos = fake.tabla('contact_events').filter((e) => e.contact_id === contactId);
    expect(eventos.some((e) => e.type === 'contact_created')).toBe(true);
  });
});

describe('crearContacto', () => {
  it('normaliza las identidades antes de escribirlas', async () => {
    const { contactId } = await crearContacto(A, {
      displayName: 'Santiago',
      identities: [
        { channel: 'whatsapp', identifier: '  +52 81 4681 1675 ' },
        { channel: 'email', identifier: 'Santiago@ABRAXA.club' },
      ],
      tags: ['vip', 'monterrey'],
    });

    const contacto = await leerContacto(A, contactId);
    expect(contacto?.identities.map((i) => i.identifier).sort()).toEqual([
      '+528146811675',
      'santiago@abraxa.club',
    ]);
    expect(contacto?.tags).toEqual(['monterrey', 'vip']);
  });

  it('marca una principal por canal, sin pelear con el índice parcial', async () => {
    const { contactId } = await crearContacto(A, {
      identities: [
        { channel: 'whatsapp', identifier: '+528146811675' },
        { channel: 'whatsapp', identifier: '+525512345678' },
      ],
    });
    const contacto = await leerContacto(A, contactId);
    const principales = contacto?.identities.filter((i) => i.isPrimary) ?? [];
    expect(principales).toHaveLength(1);
  });

  /**
   * Robar la identidad partiría el historial del otro contacto sin avisar;
   * fallar obligaría a limpiar antes de poder dar de alta a nadie. Se anota.
   */
  it('no roba una identidad que ya es de otro contacto: la anota', async () => {
    const primero = await crearContacto(A, {
      displayName: 'Santiago',
      identities: [{ channel: 'whatsapp', identifier: '+528146811675' }],
    });
    const segundo = await crearContacto(A, {
      displayName: 'Otro',
      identities: [{ channel: 'whatsapp', identifier: '+528146811675' }],
    });

    const deSantiago = await leerContacto(A, primero.contactId);
    const deOtro = await leerContacto(A, segundo.contactId);
    expect(deSantiago?.identities).toHaveLength(1);
    expect(deOtro?.identities).toHaveLength(0);

    const anotacion = fake
      .tabla('contact_events')
      .find((e) => e.contact_id === segundo.contactId && (e.payload as { conflict?: boolean })?.conflict);
    expect(anotacion).toBeTruthy();
  });

  it('arma el nombre visible a partir de nombre y apellido', async () => {
    const { contactId } = await crearContacto(A, { firstName: 'Ana', lastName: 'Ruiz' });
    expect((await leerContacto(A, contactId))?.displayName).toBe('Ana Ruiz');
  });
});

describe('etiquetas', () => {
  it('etiquetar dos veces no emite dos veces el disparador', async () => {
    const emitidos: string[] = [];
    registerPort('flows', {
      emit: async (_ctx, e) => {
        emitidos.push(e.type);
      },
    });

    const { contactId } = await crearContacto(A, { displayName: 'Santiago' });
    emitidos.length = 0;

    expect((await agregarEtiqueta(A, { contactId, tag: 'vip' })).added).toBe(true);
    expect((await agregarEtiqueta(A, { contactId, tag: 'vip' })).added).toBe(false);

    expect(emitidos.filter((t) => t === 'tag_added')).toHaveLength(1);
  });

  it('quitar una etiqueta que no está devuelve false y no anota nada', async () => {
    const { contactId } = await crearContacto(A, { displayName: 'Santiago' });
    const antes = fake.tabla('contact_events').length;
    expect((await quitarEtiqueta(A, { contactId, tag: 'no-existe' })).removed).toBe(false);
    expect(fake.tabla('contact_events')).toHaveLength(antes);
  });
});

describe('asignarDueno', () => {
  it('guarda el correo en minúsculas y lo anota', async () => {
    const { contactId } = await crearContacto(A, { displayName: 'Santiago' });
    await asignarDueno(A, { contactId, ownerEmail: '  Ana@Abraxa.Club ' });
    expect((await leerContacto(A, contactId))?.ownerEmail).toBe('ana@abraxa.club');

    const evento = fake
      .tabla('contact_events')
      .find((e) => e.contact_id === contactId && e.type === 'owner_assigned');
    expect(evento?.summary).toContain('ana@abraxa.club');
  });

  it('acepta null para desasignar', async () => {
    const { contactId } = await crearContacto(A, { displayName: 'S', ownerEmail: 'ana@x.com' });
    await asignarDueno(A, { contactId, ownerEmail: null });
    expect((await leerContacto(A, contactId))?.ownerEmail).toBeNull();
  });
});

describe('agregarIdentidad', () => {
  it('avisa de quién es si la identidad ya tiene dueño, en vez de fallar', async () => {
    const dueno = await crearContacto(A, {
      identities: [{ channel: 'email', identifier: 'hola@abraxa.club' }],
    });
    const otro = await crearContacto(A, { displayName: 'Otro' });

    const r = await agregarIdentidad(A, {
      contactId: otro.contactId,
      identity: { channel: 'email', identifier: 'HOLA@abraxa.club' },
    });
    expect(r.alreadyOwnedBy).toBe(dueno.contactId);
  });

  it('agregar la que ya tenía es un no-op silencioso', async () => {
    const c = await crearContacto(A, {
      identities: [{ channel: 'email', identifier: 'hola@abraxa.club' }],
    });
    const r = await agregarIdentidad(A, {
      contactId: c.contactId,
      identity: { channel: 'email', identifier: 'hola@abraxa.club' },
    });
    expect(r.alreadyOwnedBy).toBeNull();
    expect(fake.tabla('contact_identities')).toHaveLength(1);
  });
});

describe('listarContactos', () => {
  it('encuentra por nombre y por identificador', async () => {
    await crearContacto(A, {
      displayName: 'Santiago Alcalá',
      identities: [{ channel: 'whatsapp', identifier: '+528146811675' }],
    });
    await crearContacto(A, { displayName: 'Ana Ruiz' });

    expect((await listarContactos(A, { search: 'santiago' })).contacts).toHaveLength(1);
    expect((await listarContactos(A, { search: '8146811675' })).contacts).toHaveLength(1);
    expect((await listarContactos(A, { search: 'nadie' })).contacts).toHaveLength(0);
  });

  it('esconde los fusionados salvo que se pidan', async () => {
    const vivo = await crearContacto(A, { displayName: 'Vivo' });
    const muerto = await crearContacto(A, { displayName: 'Duplicado' });
    const fila = fake.tabla('contacts').find((c) => c.id === muerto.contactId);
    if (fila) fila.merged_into = vivo.contactId;

    expect((await listarContactos(A, {})).contacts).toHaveLength(1);
    expect((await listarContactos(A, { includeMerged: true })).contacts).toHaveLength(2);
  });

  it('un filtro que no deja a nadie devuelve vacío, no todos', async () => {
    await crearContacto(A, { displayName: 'Santiago' });
    const r = await listarContactos(A, { tag: 'etiqueta-inexistente' });
    expect(r.contacts).toHaveLength(0);
    expect(r.total).toBe(0);
  });
});
