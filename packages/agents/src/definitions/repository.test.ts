/**
 * Las definiciones viven en la base, no en YAML del disco.
 *
 * Lo que se prueba aquí es lo que hace posible el criterio #1: alta, cambio e
 * idempotencia sobre `app.agent_definitions`, sin reiniciar nada.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __setClientForTests } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import {
  listarDefiniciones,
  obtenerDefinicion,
  sembrarAgentes,
  upsertDefinicion,
} from './repository';
import { semillasPorDefecto } from './defaults';
import { createFakeDb, type FakeDb } from '../testing/fake-db';

const T = '11111111-1111-1111-1111-111111111111';
const ctx: TenantContext = {
  tenantId: T,
  tenantSlug: 'panaderia-lupita',
  userEmail: 'lupita@ejemplo.mx',
  role: 'owner',
  areas: {},
};

let db: FakeDb;
let restaurar: () => void;

beforeEach(() => {
  db = createFakeDb({ agent_definitions: [] });
  restaurar = __setClientForTests(db.client);
});

afterEach(() => restaurar());

describe('alta y lectura', () => {
  it('un agente que no existe da NOT_FOUND con instrucción de qué hacer', async () => {
    await expect(obtenerDefinicion(ctx, 'sales')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(obtenerDefinicion(ctx, 'sales')).rejects.toThrow(/sembrarAgentes|upsertDefinition/);
  });

  it('crea y lee de vuelta', async () => {
    await upsertDefinicion(ctx, {
      role: 'master',
      name: 'Chelo',
      systemPrompt: 'Eres Chelo.',
    });

    const d = await obtenerDefinicion(ctx, 'master');
    expect(d.name).toBe('Chelo');
    expect(d.role).toBe('master');
    // Sin `provider` ni `model` explícitos, cae en la semilla del rol.
    expect(d.provider).toBe('anthropic');
    expect(d.model).toBe(semillasPorDefecto()[0]?.model);
  });
});

describe('upsert idempotente', () => {
  it('correrlo dos veces no duplica: la llave es (tenant_id, role)', async () => {
    await upsertDefinicion(ctx, { role: 'sales', name: 'A', systemPrompt: 'p1' });
    await upsertDefinicion(ctx, { role: 'sales', name: 'B', systemPrompt: 'p2' });

    const todos = await listarDefiniciones(ctx);
    expect(todos).toHaveLength(1);
    expect(todos[0]?.name).toBe('B');
  });

  it('cambiar el NOMBRE no resetea el modelo que el cliente ya tenía', async () => {
    await upsertDefinicion(ctx, {
      role: 'sales',
      name: 'A',
      systemPrompt: 'p',
      model: 'claude-sonnet-5',
    });

    // H7 renombra al agente en el bautizo y no debería tocar nada más.
    await upsertDefinicion(ctx, { role: 'sales', name: 'Chelo', systemPrompt: 'p' });

    const d = await obtenerDefinicion(ctx, 'sales');
    expect(d.name).toBe('Chelo');
    expect(d.model).toBe('claude-sonnet-5');
  });
});

describe('siembra de un cliente nuevo', () => {
  it('crea los cinco roles', async () => {
    const { creados } = await sembrarAgentes(ctx);
    expect(creados).toBe(5);

    const roles = (await listarDefiniciones(ctx)).map((d) => d.role).sort();
    expect(roles).toEqual(['analyst', 'master', 'sales', 'service', 'social']);
  });

  it('el nombre del maestro se puede fijar desde el bautizo', async () => {
    await sembrarAgentes(ctx, { nombreDelMaestro: 'Chelo' });
    expect((await obtenerDefinicion(ctx, 'master')).name).toBe('Chelo');
  });

  it('sembrar dos veces no duplica NI pisa lo que el cliente personalizó', async () => {
    await sembrarAgentes(ctx);
    await upsertDefinicion(ctx, {
      role: 'sales',
      name: 'Chelo',
      systemPrompt: 'mío',
      model: 'claude-opus-5',
    });

    const segunda = await sembrarAgentes(ctx);

    expect(await listarDefiniciones(ctx)).toHaveLength(5);
    expect(segunda.creados).toBe(0);
    expect(segunda.existentes).toBe(5);

    // Sembrar es "asegúrate de que tenga sus cinco agentes", no "devuélvelos a
    // como venían de fábrica". H2 y H7 llaman a esto más de una vez, y un
    // emprendedor que ya bautizó a su agente no debe perderlo por eso.
    const sales = await obtenerDefinicion(ctx, 'sales');
    expect(sales.model).toBe('claude-opus-5');
    expect(sales.name).toBe('Chelo');
    expect(sales.systemPrompt).toBe('mío');
  });
});

describe('las semillas', () => {
  it('los tres agentes de cara al cliente corren en Haiku 4.5', () => {
    const s = semillasPorDefecto();
    for (const rol of ['sales', 'service', 'social'] as const) {
      expect(s.find((x) => x.role === rol)?.model).toBe('claude-haiku-4-5');
    }
  });

  it('todas llevan la instrucción de no inventar cifras', () => {
    // Es la línea que separa a un agente útil de uno que le promete a un
    // cliente un precio que su dueño nunca dio.
    for (const s of semillasPorDefecto()) {
      expect(s.systemPrompt, s.role).toContain('Jamás lo inventes');
      expect(s.systemPrompt, s.role).toContain('bloque de datos vigentes');
    }
  });

  it('todas dicen cuándo pasar la conversación a un humano', () => {
    for (const s of semillasPorDefecto()) {
      expect(s.systemPrompt.toLowerCase()).toContain('humano');
    }
  });
});
