import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __setClientForTests } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import { __clearDrivers, registerDriver } from '../drivers/registry';
import { createFakeDb, type FakeDb } from '../testing/fake-db';
import { createFakeDriver } from '../testing/fake-driver';
import {
  ajustarCanal,
  borrarCanal,
  crearCanal,
  listarCanales,
  sanearCanal,
  validarHorario,
} from './service';
import { igualSeguro, normalizarFila } from './lookup';
import type { ChannelRow } from '../types';

const ctx: TenantContext = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  tenantSlug: 'acme',
  userEmail: 'santiago@abraxa.club',
  role: 'owner',
  areas: { ventas: 'admin' },
};

let db: FakeDb;
let restaurar: () => void;

beforeEach(() => {
  db = createFakeDb();
  restaurar = __setClientForTests(db.client);
  __clearDrivers();
  registerDriver(createFakeDriver({ type: 'sms' }));
});

afterEach(() => {
  restaurar();
  __clearDrivers();
});

describe('crearCanal', () => {
  it('crea la fila, aprovisiona con el driver y guarda lo que el driver escribió', async () => {
    const canal = await crearCanal(ctx, { type: 'sms', name: 'Línea de ventas' });

    expect(canal.name).toBe('Línea de ventas');
    expect(canal.status).toBe('active');
    expect(canal.external_id).toBe('falso-externo');

    // El driver escribió su token en `config` y el servicio lo persistió…
    const fila = db.tabla('channels')[0];
    expect((fila?.config as Record<string, unknown>)?.webhook_token).toBe('token-de-prueba');
    // …y el id del canal se le pasó para que pudiera armar la URL del webhook.
    expect((fila?.config as Record<string, unknown>)?.channelId).toBe(fila?.id);
  });

  it('NUNCA devuelve los secretos del canal', async () => {
    const canal = await crearCanal(ctx, { type: 'sms', name: 'Línea' });
    expect(canal.config.webhook_token).toBeUndefined();
    expect(canal.config.instancia_falsa).toBe('x'); // lo que no es secreto sí sale
  });

  it('sin driver para el tipo, falla al crear y no cuando llegue el primer mensaje', async () => {
    await expect(crearCanal(ctx, { type: 'instagram', name: 'IG' })).rejects.toMatchObject({
      code: 'CHANNEL_ERROR',
    });
    expect(db.tabla('channels')).toHaveLength(0);
  });

  it('exige nombre', async () => {
    await expect(crearCanal(ctx, { type: 'sms', name: '  ' })).rejects.toThrow(/nombre/i);
  });

  it('si el aprovisionamiento falla, la fila queda en `error` — no desaparece', async () => {
    __clearDrivers();
    const roto = createFakeDriver({ type: 'sms' });
    roto.provisionChannel = async () => {
      throw new Error('el proveedor no responde');
    };
    registerDriver(roto);

    await expect(crearCanal(ctx, { type: 'sms', name: 'Línea' })).rejects.toThrow(/no responde/);
    expect(db.tabla('channels')[0]?.status).toBe('error');
  });

  it('el agente por defecto es ventas y se puede cambiar al crear', async () => {
    await crearCanal(ctx, { type: 'sms', name: 'A' });
    expect(db.tabla('channels')[0]?.agent_role).toBe('sales');

    await crearCanal(ctx, { type: 'sms', name: 'B', agentRole: 'service' });
    expect(db.tabla('channels')[1]?.agent_role).toBe('service');
  });
});

describe('ajustarCanal', () => {
  it('cambia el agente, el interruptor de IA y el horario', async () => {
    const creado = await crearCanal(ctx, { type: 'sms', name: 'Línea' });
    const ajustado = await ajustarCanal(ctx, creado.id, {
      agentRole: 'service',
      aiEnabled: false,
      aiOutsideHours: false,
      businessHours: { tz: 'America/Mexico_City', semana: { lun: [['09:00', '18:00']] } },
    });

    expect(ajustado.agent_role).toBe('service');
    expect(ajustado.ai_enabled).toBe(false);
    expect(ajustado.ai_outside_hours).toBe(false);
    expect(ajustado.business_hours.tz).toBe('America/Mexico_City');
  });
});

describe('validarHorario', () => {
  it('un horario con tramos SIN zona se rechaza', () => {
    // Sin `tz` se interpretaría en UTC y el agente se callaría seis horas antes
    // de lo que el emprendedor cree. Es una trampa, no un default.
    expect(() => validarHorario({ semana: { lun: [['09:00', '18:00']] } })).toThrow(/zona horaria/i);
  });

  it('un horario vacío pasa: significa 24/7', () => {
    expect(validarHorario({})).toEqual({});
    expect(validarHorario({ semana: {} })).toEqual({ semana: {} });
  });

  it('crearCanal lo valida ANTES del INSERT — no deja la fila mal formada', async () => {
    await expect(
      crearCanal(ctx, {
        type: 'sms',
        name: 'Línea',
        businessHours: { semana: { lun: [['09:00', '18:00']] } },
      }),
    ).rejects.toThrow(/zona horaria/i);
    expect(db.tabla('channels')).toHaveLength(0);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Faltaba justo la mitad de la comprobación, y era la mitad que se cuela:
  // se exigía que `tz` viniera puesta, no que significara algo. Una zona
  // inventada se guardaba tan campante y `momentoLocal()` caía a UTC en
  // silencio — el mismo desfase de seis horas que el caso de arriba dice
  // proteger, sólo que sin nadie a quien avisar.
  // ══════════════════════════════════════════════════════════════════════════
  it('una zona que NO existe se rechaza igual que la que falta', () => {
    // `"CST"` no está en la lista a propósito: el ICU de Node lo acepta como
    // alias heredado, así que es una zona real. Ver `zonaValida` en
    // `bridge/hours.test.ts`.
    for (const tz of ['America/MexicoCity', 'GMT-6', 'Marte/Olympus']) {
      expect(() => validarHorario({ tz, semana: { lun: [['09:00', '18:00']] } })).toThrow(
        /zona horaria/i,
      );
    }
  });

  it('una zona real pasa', () => {
    const h = { tz: 'America/Mexico_City', semana: { lun: [['09:00', '18:00']] } } as const;
    expect(validarHorario(h as never)).toEqual(h);
  });

  it('crearCanal tampoco deja entrar una zona inventada', async () => {
    await expect(
      crearCanal(ctx, {
        type: 'sms',
        name: 'Línea',
        businessHours: { tz: 'America/MexicoCity', semana: { lun: [['09:00', '18:00']] } },
      }),
    ).rejects.toThrow(/zona horaria/i);
    expect(db.tabla('channels')).toHaveLength(0);
  });
});

describe('sanearCanal', () => {
  it('quita todo lo que parezca un secreto', () => {
    const fila = normalizarFila({
      id: 'c',
      tenant_id: 't',
      type: 'sms',
      config: {
        instance: 'abx-1',
        webhook_token: 'no-debe-salir',
        api_key: 'tampoco',
        TOKEN: 'ni-en-mayúsculas',
        visible: 'sí',
      },
      status: 'active',
    }) as ChannelRow;

    const publico = sanearCanal(fila);
    expect(publico.config).toEqual({ instance: 'abx-1', visible: 'sí' });
    expect(publico.conectado).toBe(true);
  });
});

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  «Desconectar mi WhatsApp» NO puede significar «borrar mi historial».
 * ════════════════════════════════════════════════════════════════════════════
 *
 * El escenario del hallazgo: seis meses de operación, la línea se cae (batería,
 * sesión de Baileys vencida), y el camino natural para reconectar es borrar el
 * canal y volverlo a crear para escanear un QR nuevo. Con `DELETE FROM channels`
 * + `ON DELETE CASCADE` en `threads.channel_id`, eso se llevaba por delante
 * cada conversación y cada mensaje con cada cliente. Respuesta: `{ ok: true }`.
 *
 * El historial de conversaciones es literalmente el producto.
 */
describe('borrarCanal', () => {
  /** Un canal con historial, como lo tendría un tenant de verdad. */
  function conHistorial(channelId: string, hilos: number, porHilo: number): void {
    const filasHilos = Array.from({ length: hilos }, (_, i) => ({
      id: `hilo-${i}`,
      tenant_id: ctx.tenantId,
      channel_id: channelId,
      channel_type: 'sms',
      external_address: `+52551234${String(i).padStart(4, '0')}`,
      status: 'open',
      assigned_to: null,
      ai_enabled: true,
      unread: 0,
    }));
    const filasMensajes = filasHilos.flatMap((h) =>
      Array.from({ length: porHilo }, (_, j) => ({
        id: `${h.id}-msg-${j}`,
        tenant_id: ctx.tenantId,
        thread_id: h.id,
        direction: j % 2 === 0 ? 'in' : 'out',
        body: `mensaje ${j}`,
      })),
    );
    db.sembrar('threads', filasHilos);
    db.sembrar('messages', filasMensajes);
  }

  it('con historial: da de baja la línea y CONSERVA hilos y mensajes', async () => {
    const creado = await crearCanal(ctx, { type: 'sms', name: 'Línea' });
    conHistorial(creado.id, 3, 4);

    const r = await borrarCanal(ctx, creado.id);

    // Lo primero que se afirma es lo que el defecto rompía: el historial sigue
    // ahí. Va antes que cualquier aserción sobre el valor devuelto para que,
    // si alguien reintroduce el `DELETE`, la prueba falle por LA razón —no por
    // un `undefined.borrado` que no dice nada.
    expect(db.tabla('threads')).toHaveLength(3);
    expect(db.tabla('messages')).toHaveLength(12);

    // La línea, en cambio, sí dejó de funcionar…
    const fila = db.tabla('channels')[0];
    expect(fila).toBeDefined();
    expect(fila?.status).toBe('disconnected');
    expect(fila?.external_id).toBeNull();
    // …y sus secretos ya no se guardan.
    expect(fila?.config).toEqual({});

    expect(r.borrado).toBe(false);
  });

  it('dice cuánto había en juego en vez de un `{ ok: true }` mudo', async () => {
    const creado = await crearCanal(ctx, { type: 'sms', name: 'Línea' });
    conHistorial(creado.id, 2, 5);

    const r = await borrarCanal(ctx, creado.id);

    expect(r.hilos).toBe(2);
    expect(r.mensajes).toBe(10);
    expect(r.detalle).toMatch(/no se borra al desconectar/i);
  });

  it('sin historial no hay nada que proteger: la fila se va', async () => {
    const creado = await crearCanal(ctx, { type: 'sms', name: 'Línea' });
    const r = await borrarCanal(ctx, creado.id);

    expect(r.borrado).toBe(true);
    expect(r).toMatchObject({ hilos: 0, mensajes: 0 });
    expect(db.tabla('channels')).toHaveLength(0);
  });

  it('el borrado destructivo existe, pero hay que pedirlo por su nombre', async () => {
    const creado = await crearCanal(ctx, { type: 'sms', name: 'Línea' });
    conHistorial(creado.id, 3, 4);

    const r = await borrarCanal(ctx, creado.id, { purgar: true });

    expect(r.borrado).toBe(true);
    expect(r.hilos).toBe(3);
    expect(r.mensajes).toBe(12);
    expect(db.tabla('channels')).toHaveLength(0);
    expect(db.tabla('threads')).toHaveLength(0);
    expect(db.tabla('messages')).toHaveLength(0);
  });

  it('la purga no toca los hilos de OTRO canal', async () => {
    const uno = await crearCanal(ctx, { type: 'sms', name: 'Uno' });
    const dos = await crearCanal(ctx, { type: 'sms', name: 'Dos' });
    db.sembrar('threads', [
      { id: 'h-uno', tenant_id: ctx.tenantId, channel_id: uno.id, external_address: '+1' },
      { id: 'h-dos', tenant_id: ctx.tenantId, channel_id: dos.id, external_address: '+2' },
    ]);
    db.sembrar('messages', [
      { id: 'm-uno', tenant_id: ctx.tenantId, thread_id: 'h-uno', body: 'a' },
      { id: 'm-dos', tenant_id: ctx.tenantId, thread_id: 'h-dos', body: 'b' },
    ]);

    await borrarCanal(ctx, uno.id, { purgar: true });

    expect(db.tabla('threads').map((h) => h.id)).toEqual(['h-dos']);
    expect(db.tabla('messages').map((m) => m.id)).toEqual(['m-dos']);
  });

  /**
   * El tenant del escenario del hallazgo: seis meses, ~800 hilos, ~40k
   * mensajes. Importa porque los ids de los hilos viajan en un `.in(…)`, y en
   * PostgREST eso es QUERY STRING: 800 uuids son ~30 KB de URL y el servidor
   * contesta 414. Un 414 leído como "no hay mensajes" sería otra pérdida
   * silenciosa, justo la que estamos cerrando. Van en lotes de 100.
   */
  it('un canal con 800 hilos se cuenta y se purga entero, en lotes', async () => {
    const creado = await crearCanal(ctx, { type: 'sms', name: 'Línea' });
    conHistorial(creado.id, 800, 5);

    const r = await borrarCanal(ctx, creado.id, { purgar: true });

    // 800 > IDS_POR_LOTE: si el `.in(…)` no se partiera, esto contaría de menos.
    expect(r.hilos).toBe(800);
    expect(r.mensajes).toBe(4_000);
    expect(db.tabla('threads')).toHaveLength(0);
    expect(db.tabla('messages')).toHaveLength(0);
  });

  it('un proveedor que no responde no deja al cliente con un canal imborrable', async () => {
    __clearDrivers();
    const terco = createFakeDriver({ type: 'sms' });
    terco.teardownChannel = async () => {
      throw new Error('el proveedor no responde');
    };
    registerDriver(terco);

    const creado = await crearCanal(ctx, { type: 'sms', name: 'Línea' });
    await borrarCanal(ctx, creado.id);
    expect(db.tabla('channels')).toHaveLength(0);
  });
});

/**
 * La cascada que ya no está. Es una prueba sobre el SQL a propósito: el defecto
 * vivía en la migración, no en TypeScript, y ningún doble en memoria lo puede
 * reproducir — la fake-db no modela llaves foráneas. Si alguien vuelve a poner
 * `ON DELETE CASCADE` en `threads.channel_id`, esto se cae.
 */
describe('migración 040 · las llaves foráneas', () => {
  const sql = readFileSync(
    new URL('../../../../migrations/040_inbox.sql', import.meta.url),
    'utf8',
  );

  it('threads.channel_id NO cascadea: borrar un canal no borra las conversaciones', () => {
    const linea = sql
      .split('\n')
      .find((l) => /channel_id\s+uuid\s+NOT NULL REFERENCES app\.channels/i.test(l));

    expect(linea).toBeDefined();
    expect(linea).not.toMatch(/ON DELETE CASCADE/i);
    // Tampoco RESTRICT: rompería el borrado de un tenant, que cascadea a
    // `channels` y a `threads` en la misma sentencia. Ver la nota en la 040.
    expect(linea).not.toMatch(/ON DELETE RESTRICT/i);
  });

  it('messages.thread_id SÍ cascadea: ahí la cascada es la correcta', () => {
    const linea = sql
      .split('\n')
      .find((l) => /thread_id\s+uuid\s+NOT NULL REFERENCES app\.threads/i.test(l));

    expect(linea).toMatch(/ON DELETE CASCADE/i);
  });
});

describe('listarCanales', () => {
  it('devuelve los del tenant, saneados', async () => {
    await crearCanal(ctx, { type: 'sms', name: 'Uno' });
    const otro = { ...db.tabla('channels')[0], id: 'de-otro', tenant_id: 'otro-tenant' };
    db.sembrar('channels', [...db.tabla('channels'), otro]);

    const lista = await listarCanales(ctx);
    expect(lista).toHaveLength(1);
    expect(lista[0]?.config.webhook_token).toBeUndefined();
  });
});

describe('igualSeguro', () => {
  it('compara sin filtrar la longitud por el camino corto', () => {
    expect(igualSeguro('abc', 'abc')).toBe(true);
    expect(igualSeguro('abc', 'abd')).toBe(false);
    expect(igualSeguro('abc', 'abcd')).toBe(false);
    expect(igualSeguro('', '')).toBe(true);
    expect(igualSeguro('', 'x')).toBe(false);
  });
});
