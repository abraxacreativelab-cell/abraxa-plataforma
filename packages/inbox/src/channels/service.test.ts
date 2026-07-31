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

describe('borrarCanal', () => {
  it('da de baja con el proveedor y borra la fila', async () => {
    const creado = await crearCanal(ctx, { type: 'sms', name: 'Línea' });
    await borrarCanal(ctx, creado.id);
    expect(db.tabla('channels')).toHaveLength(0);
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
