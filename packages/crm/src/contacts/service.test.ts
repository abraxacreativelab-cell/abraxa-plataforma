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

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Los defectos que el gate en verde no podía ver (auditoría del PR #9)
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Las cuatro pruebas de este bloque FALLABAN con el código anterior. No
 *  prueban rutas nuevas: prueban que las que ya existían dejen de perder datos
 *  en silencio y de responder 200 sin haber hecho nada.
 */
describe('pérdida silenciosa — lo que el typecheck no ve', () => {
  it('dos teléfonos marcados AMBOS como principal: se guardan los dos', async () => {
    /* El caso literal de la portada del carril, "una persona con dos
       teléfonos". Antes: la segunda salía con `is_primary: true` porque el `||`
       cortocircuitaba, chocaba con el índice parcial de 120, `esDuplicado()`
       era cierto y el teléfono se descartaba anotando "ya pertenece a otro
       contacto" — un contacto que no existe. */
    const { contactId } = await crearContacto(A, {
      displayName: 'Santiago',
      identities: [
        { channel: 'whatsapp', identifier: '+528146811675', isPrimary: true },
        { channel: 'whatsapp', identifier: '+525512345678', isPrimary: true },
      ],
    });

    const contacto = await leerContacto(A, contactId);
    expect(contacto?.identities.map((x) => x.identifier).sort()).toEqual([
      '+525512345678',
      '+528146811675',
    ]);
    // Una sola principal: el índice parcial sigue siendo el árbitro.
    expect(contacto?.identities.filter((x) => x.isPrimary)).toHaveLength(1);

    // Y NADIE anotó una razón falsa.
    const mentira = fake
      .tabla('contact_events')
      .find((e) => String(e.summary ?? '').includes('ya pertenece a otro contacto'));
    expect(mentira).toBeUndefined();
  });

  it('asignar un responsable a un contacto que no existe es 404, no {ok:true}', async () => {
    await expect(
      asignarDueno(A, { contactId: 'uuid-que-no-existe', ownerEmail: 'ana@abraxa.club' }),
    ).rejects.toThrow(PlatformError);
    // Y no dejó basura: ni la fila, ni el evento.
    expect(fake.tabla('contact_events')).toHaveLength(0);
  });

  it('un contactId de OTRA empresa no puede recibir una identidad', async () => {
    /* Sin `exigirContacto`, `tenantDb` estampaba `tenant_id = A` y la FK
       simple sólo exigía que el contacto existiera EN ALGÚN LADO: quedaba una
       identidad del tenant A colgada de un contacto del tenant B. La migración
       123 lo vuelve irrepresentable en la base; esto lo convierte en un 404
       antes de llegar allá. */
    const deB = await crearContacto(B, { displayName: 'Cliente de otra empresa' });

    await expect(
      agregarIdentidad(A, {
        contactId: deB.contactId,
        identity: { channel: 'whatsapp', identifier: '+528146811675' },
      }),
    ).rejects.toThrow(PlatformError);

    expect(fake.tabla('contact_identities')).toHaveLength(0);
  });

  it('etiquetar y tocar un id ajeno tampoco escribe nada', async () => {
    const deB = await crearContacto(B, { displayName: 'Cliente de otra empresa' });
    await expect(agregarEtiqueta(A, { contactId: deB.contactId, tag: 'vip' })).rejects.toThrow(
      PlatformError,
    );
    expect(fake.tabla('contact_tags')).toHaveLength(0);
  });
});

describe('un grupo de WhatsApp no entra por ninguna puerta', () => {
  it('ni por create', async () => {
    await expect(
      crearContacto(A, {
        displayName: 'Grupo',
        identities: [{ channel: 'whatsapp', identifier: '120363041234567890@g.us' }],
      }),
    ).rejects.toThrow(/grupo de WhatsApp/);
    expect(fake.tabla('contacts')).toHaveLength(0);
  });

  it('ni por addIdentity', async () => {
    const { contactId } = await crearContacto(A, { displayName: 'Santiago' });
    await expect(
      agregarIdentidad(A, {
        contactId,
        identity: { channel: 'whatsapp', identifier: '120363041234567890@g.us' },
      }),
    ).rejects.toThrow(/grupo de WhatsApp/);
  });

  it('ni por resolveByIdentity, que es donde ya estaba la guarda', async () => {
    await expect(
      resolverPorIdentidad(A, { channel: 'whatsapp', identifier: '120363041234567890@g.us' }),
    ).rejects.toThrow(/grupo de WhatsApp/);
  });
});

/**
 * El filtro que reventaba la URL de PostgREST.
 *
 * No se puede reproducir el 414 con un doble en memoria —no hay URL que
 * desbordar, que es justamente por qué esto pasó el gate en verde—, así que lo
 * que se prueba es la defensa: que el primer paso se acote y que el resultado
 * DIGA que está incompleto en vez de mentir por omisión.
 */
describe('filtro por etiqueta con muchos contactos', () => {
  it('se acota y avisa que la lista es parcial', () => {
    const contactos = Array.from({ length: 1200 }, (_, n) => ({
      id: `c-${n}`,
      tenant_id: 'tenant-a',
      display_name: `Contacto ${n}`,
      lifecycle: 'lead',
      custom: {},
      merged_into: null,
      last_activity_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));
    fake.sembrar('contacts', contactos);
    fake.sembrar(
      'contact_tags',
      contactos.map((c) => ({ tenant_id: 'tenant-a', contact_id: c.id, tag: 'cliente' })),
    );

    return listarContactos(A, { tag: 'cliente', limit: 10 }).then((r) => {
      expect(r.filterTruncated).toBe(true);
      expect(r.contacts.length).toBeLessThanOrEqual(10);
    });
  });

  it('con pocos contactos no marca nada', async () => {
    const { contactId } = await crearContacto(A, { displayName: 'Santiago', tags: ['cliente'] });
    const r = await listarContactos(A, { tag: 'cliente' });
    expect(r.contacts.map((c) => c.id)).toEqual([contactId]);
    expect(r.filterTruncated).toBeUndefined();
  });
});
