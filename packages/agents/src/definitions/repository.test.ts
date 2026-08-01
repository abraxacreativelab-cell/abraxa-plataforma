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
    // Sin `provider` ni `model` explícitos, cae en la semilla del rol — que
    // desde la migración 029 nace en OpenRouter, el único proveedor con llave.
    expect(d.provider).toBe('openrouter');
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
      // En el dialecto de OpenRouter, que es el proveedor de la semilla. Pasar
      // aquí 'claude-sonnet-5' —el id de Anthropic— hoy se RECHAZA, y es lo
      // correcto: el par (provider, model) es una sola decisión.
      model: 'anthropic/claude-sonnet-5',
    });

    // H7 renombra al agente en el bautizo y no debería tocar nada más.
    await upsertDefinicion(ctx, { role: 'sales', name: 'Chelo', systemPrompt: 'p' });

    const d = await obtenerDefinicion(ctx, 'sales');
    expect(d.name).toBe('Chelo');
    expect(d.model).toBe('anthropic/claude-sonnet-5');
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  El par (provider, model) — hallazgo del 2026-07-31
// ════════════════════════════════════════════════════════════════════════════

describe('la combinación proveedor/modelo no se puede escribir rota', () => {
  it('cambiar SÓLO el proveedor se rechaza en vez de heredar el modelo anterior', async () => {
    // Ésta es la reproducción exacta del hallazgo. Antes, la línea de abajo
    // guardaba provider='openrouter' con model='claude-haiku-4-5' —un id que en
    // OpenRouter no existe— sin una sola queja, y el cliente final dejaba de
    // recibir respuesta en el siguiente mensaje: 400 en cada intento.
    await upsertDefinicion(ctx, {
      role: 'sales',
      name: 'Ventas',
      systemPrompt: 'p',
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
    });

    await expect(
      upsertDefinicion(ctx, {
        role: 'sales',
        name: 'Ventas',
        systemPrompt: 'p',
        provider: 'openrouter',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });

    // Y la fila anterior quedó intacta: un upsert que se rechaza no escribe.
    const d = await obtenerDefinicion(ctx, 'sales');
    expect(d.provider).toBe('anthropic');
    expect(d.model).toBe('claude-haiku-4-5');
  });

  it('el mensaje dice qué falta, no sólo que algo falló', async () => {
    await upsertDefinicion(ctx, {
      role: 'sales',
      name: 'V',
      systemPrompt: 'p',
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
    });

    await expect(
      upsertDefinicion(ctx, { role: 'sales', name: 'V', systemPrompt: 'p', provider: 'openrouter' }),
    ).rejects.toThrow(/modelo/i);
  });

  it('escribir el par roto a mano también se rechaza', async () => {
    await expect(
      upsertDefinicion(ctx, {
        role: 'sales',
        name: 'V',
        systemPrompt: 'p',
        provider: 'openrouter',
        model: 'claude-haiku-4-5',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('el cambio de proveedor CON modelo explícito sí pasa: es el criterio #2', async () => {
    await upsertDefinicion(ctx, {
      role: 'sales',
      name: 'V',
      systemPrompt: 'p',
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
    });

    await upsertDefinicion(ctx, {
      role: 'sales',
      name: 'V',
      systemPrompt: 'p',
      provider: 'openrouter',
      model: 'anthropic/claude-haiku-4.5',
    });

    const d = await obtenerDefinicion(ctx, 'sales');
    expect(d.provider).toBe('openrouter');
    expect(d.model).toBe('anthropic/claude-haiku-4.5');
  });

  it('un modelo de OpenRouter que NO está en el catálogo también pasa', async () => {
    // La validación de DIALECTO mira la forma del id, no el catálogo. Si mirara
    // el catálogo, estrenar un modelo pediría un deploy — el problema que H3
    // vino a matar. El riesgo de dinero de un modelo desconocido lo cubre el
    // piso conservador del ledger, no esta puerta.
    //
    // El ejemplo es un Claude que el catálogo todavía no tabula. Antes esta
    // prueba usaba `deepseek/deepseek-chat`, y ese cambio es el punto: el
    // dialecto sigue siendo laxo con el CATÁLOGO, pero la lista blanca de
    // proveedores ya no deja pasar a quien procesa fuera de la declaración de
    // datos. Son dos puertas distintas y las dos hacen falta.
    await upsertDefinicion(ctx, {
      role: 'analyst',
      name: 'Analista',
      systemPrompt: 'p',
      provider: 'openrouter',
      model: 'anthropic/claude-opus-6',
    });

    expect((await obtenerDefinicion(ctx, 'analyst')).model).toBe('anthropic/claude-opus-6');
  });

  it('y un proveedor fuera de la lista blanca NO pasa, aunque el dialecto esté bien', async () => {
    // `deepseek/deepseek-chat` es un id perfectamente formado de OpenRouter.
    // Lo que lo detiene no es la forma: es dónde procesa.
    await expect(
      upsertDefinicion(ctx, {
        role: 'analyst',
        name: 'Analista',
        systemPrompt: 'p',
        provider: 'openrouter',
        model: 'deepseek/deepseek-chat',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('cambiar sólo el nombre NO exige modelo: el proveedor no se movió', async () => {
    await upsertDefinicion(ctx, {
      role: 'sales',
      name: 'V',
      systemPrompt: 'p',
      provider: 'openrouter',
      model: 'anthropic/claude-haiku-4.5',
    });

    // Mismo provider explícito, sin model. Hereda, y está bien que herede.
    await upsertDefinicion(ctx, {
      role: 'sales',
      name: 'Chelo',
      systemPrompt: 'p',
      provider: 'openrouter',
    });

    const d = await obtenerDefinicion(ctx, 'sales');
    expect(d.name).toBe('Chelo');
    expect(d.model).toBe('anthropic/claude-haiku-4.5');
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
      model: 'anthropic/claude-opus-4.8',
    });

    const segunda = await sembrarAgentes(ctx);

    expect(await listarDefiniciones(ctx)).toHaveLength(5);
    expect(segunda.creados).toBe(0);
    expect(segunda.existentes).toBe(5);

    // Sembrar es "asegúrate de que tenga sus cinco agentes", no "devuélvelos a
    // como venían de fábrica". H2 y H7 llaman a esto más de una vez, y un
    // emprendedor que ya bautizó a su agente no debe perderlo por eso.
    const sales = await obtenerDefinicion(ctx, 'sales');
    expect(sales.model).toBe('anthropic/claude-opus-4.8');
    expect(sales.name).toBe('Chelo');
    expect(sales.systemPrompt).toBe('mío');
  });
});

describe('las semillas', () => {
  it('los tres agentes de cara al cliente corren en Haiku 4.5', () => {
    const s = semillasPorDefecto();
    for (const rol of ['sales', 'service', 'social'] as const) {
      // Con el prefijo del vendor: es el dialecto de OpenRouter, el proveedor
      // con el que nacen desde la 029.
      expect(s.find((x) => x.role === rol)?.model).toBe('anthropic/claude-haiku-4.5');
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
