/**
 * Las reglas de seguridad de la §7 y el enrolamiento por disparador.
 *
 *     #4 · un flujo nuevo NACE EN PAUSA; activarlo exige confirmación y admin
 *
 * Y lo que hace segura la prueba de un flujo: que enrole UN contacto en UN
 * flujo, y no arrastre a los demás con el mismo disparador.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { __clearPorts, __setClientForTests, PlatformError } from '@abraxa/db';
import { crearFakeDb, contextoDePrueba } from './testing/fake-db';
import type { FakeDb } from './testing/fake-db';
import { registrarTodo } from './testing/dobles';
import type { DoblesRegistrados } from './testing/dobles';
import { colaEnLinea } from './queue';
import { disparadorCalza, emitirEvento } from './events';
import * as servicio from './service';
import * as store from './store';
import type { Flow } from './types';

const CONTACTO = 'c-ana';
const ctx = contextoDePrueba('t-uno');
const miembro = contextoDePrueba('t-uno', { role: 'member', email: 'juan@abraxa.club' });

let db: FakeDb;
let dobles: DoblesRegistrados;

const PROPUESTA = {
  name: 'Lead nuevo',
  description: 'Le manda un saludo',
  trigger_type: 'contact_created',
  trigger_config: {},
  definition: {
    nodes: [
      { id: 'inicio', type: 'trigger', data: {} },
      {
        id: 'saludo',
        type: 'send_message',
        data: { config: { channel: 'whatsapp', template: 'Hola {nombre}' } },
      },
    ],
    edges: [{ id: 'e1', source: 'inicio', target: 'saludo' }],
  },
};

beforeEach(() => {
  __clearPorts();
  db = crearFakeDb({ flows: [], flow_versions: [], flow_runs: [], flow_steps: [] });
  __setClientForTests(db.client);
  dobles = registrarTodo({
    contactos: [{ id: CONTACTO, firstName: 'Ana', whatsapp: '+528146811675', stage: 'nuevo' }],
    equipo: ['santiago@abraxa.club'],
  });
});

// ════════════════════════════════════════════════════════════════════════════

describe('criterio #4 · nace en pausa', () => {
  it('un flujo recién creado está apagado, aunque le pidan lo contrario', async () => {
    // Se le mete `status: 'active'` en el cuerpo a propósito: es lo que
    // intentaría un cliente que quisiera saltarse el paso humano.
    const flujo = await servicio.crear(ctx, { ...PROPUESTA, status: 'active' });
    expect(flujo.status).toBe('paused');
    expect(flujo.activatedAt).toBeNull();
  });

  it('estando en pausa, el disparador real NO lo enrola', async () => {
    await servicio.crear(ctx, PROPUESTA);
    const r = await emitirEvento(
      ctx,
      { type: 'contact_created', payload: { contactId: CONTACTO } },
      { encolar: colaEnLinea() },
    );
    expect(r.enroladas).toBe(0);
    expect(dobles.bandeja.envios).toHaveLength(0);
  });

  it('activar lo enciende y deja NOMBRE y HORA', async () => {
    const flujo = await servicio.crear(ctx, PROPUESTA);
    const activo = await servicio.activar(ctx, flujo.id);
    expect(activo.status).toBe('active');

    const guardado = await store.exigirFlujo(ctx, flujo.id);
    expect(guardado.status).toBe('active');
    expect(guardado.activatedBy).toBe('santiago@abraxa.club');
    expect(guardado.activatedAt).not.toBeNull();
  });

  it('activado, el disparador sí lo enrola y el mensaje sale', async () => {
    const flujo = await servicio.crear(ctx, PROPUESTA);
    await servicio.activar(ctx, flujo.id);
    await emitirEvento(
      ctx,
      { type: 'contact_created', payload: { contactId: CONTACTO } },
      { encolar: colaEnLinea() },
    );
    expect(dobles.bandeja.envios[0]?.body).toBe('Hola Ana');
  });
});

describe('criterio #4 · activar exige admin', () => {
  it('un miembro sin rol admin no puede activar, y se le dice por qué', async () => {
    const flujo = await servicio.crear(ctx, PROPUESTA);
    await expect(servicio.activar(miembro, flujo.id)).rejects.toThrow(PlatformError);
    await expect(servicio.activar(miembro, flujo.id)).rejects.toThrow(/rol admin/);

    expect((await store.exigirFlujo(ctx, flujo.id)).status).toBe('paused');
  });

  it('tampoco puede probar ni restaurar una versión', async () => {
    const flujo = await servicio.crear(ctx, PROPUESTA);
    await expect(
      servicio.probar(miembro, flujo.id, { contactId: CONTACTO, encolar: colaEnLinea() }),
    ).rejects.toThrow(/rol admin/);
    await expect(servicio.volverAVersion(miembro, flujo.id, 1)).rejects.toThrow(/rol admin/);
  });

  it('PARAR sí puede cualquiera: apagar algo nunca se bloquea', async () => {
    const flujo = await servicio.crear(ctx, PROPUESTA);
    await servicio.activar(ctx, flujo.id);
    await servicio.pausar(miembro, flujo.id);
    expect((await store.exigirFlujo(ctx, flujo.id)).status).toBe('paused');
  });

  it('no se puede activar un flujo que no se puede ejecutar', async () => {
    // Entre guardar y activar pudo borrarse la etapa a la que mueve.
    const flujo = await servicio.crear(ctx, PROPUESTA);
    db.tabla('flows')
      .filter((f) => f.id === flujo.id)
      .forEach((f) => {
        f.definition = { nodes: [{ id: 'x', type: 'end', data: {} }], edges: [] };
      });
    await expect(servicio.activar(ctx, flujo.id)).rejects.toThrow(/problemas|activar/);
  });
});

// ════════════════════════════════════════════════════════════════════════════

describe('probar', () => {
  it('corre aunque el flujo esté en pausa — para eso es probar', async () => {
    const flujo = await servicio.crear(ctx, PROPUESTA);
    const r = await servicio.probar(ctx, flujo.id, { contactId: CONTACTO, encolar: colaEnLinea() });
    expect(r.corridas).toBe(1);
    expect(dobles.bandeja.envios).toHaveLength(1);
  });

  it('la corrida de prueba queda MARCADA, para no ensuciar el historial real', async () => {
    const flujo = await servicio.crear(ctx, PROPUESTA);
    await servicio.probar(ctx, flujo.id, { contactId: CONTACTO, encolar: colaEnLinea() });
    const corridas = await store.listarCorridas(ctx, {});
    expect(corridas[0]?.isTest).toBe(true);
  });

  it('probar UN flujo no arrastra a los OTROS con el mismo disparador', async () => {
    // El error que GARDEN cometió: probar emitía el disparador de verdad y
    // enrolaba todos los flujos activos — mensajes reales de automatizaciones
    // que nadie quiso probar.
    const probado = await servicio.crear(ctx, { ...PROPUESTA, name: 'El que pruebo' });

    const vecino = await servicio.crear(ctx, {
      ...PROPUESTA,
      name: 'El vecino',
      definition: {
        nodes: [
          { id: 'inicio', type: 'trigger', data: {} },
          {
            id: 'saludo',
            type: 'send_message',
            data: { config: { channel: 'whatsapp', template: 'NO DEBÍ SALIR' } },
          },
        ],
        edges: [{ id: 'e1', source: 'inicio', target: 'saludo' }],
      },
    });
    await servicio.activar(ctx, vecino.id);

    await servicio.probar(ctx, probado.id, { contactId: CONTACTO, encolar: colaEnLinea() });

    expect(dobles.bandeja.envios).toHaveLength(1);
    expect(dobles.bandeja.envios[0]?.body).toBe('Hola Ana');
  });

  it('probar dos veces seguidas con el mismo contacto SÍ se puede', async () => {
    // Es exactamente lo que hace quien está afinando un mensaje. El índice
    // único deja fuera las corridas de prueba justo por esto.
    const flujo = await servicio.crear(ctx, PROPUESTA);
    const uno = await servicio.probar(ctx, flujo.id, { contactId: CONTACTO, encolar: colaEnLinea() });
    const dos = await servicio.probar(ctx, flujo.id, { contactId: CONTACTO, encolar: colaEnLinea() });
    expect(uno.corridas).toBe(1);
    expect(dos.corridas).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════

describe('guardar', () => {
  it('rechaza lo que no se puede ejecutar, con los errores en español', async () => {
    await expect(
      servicio.crear(ctx, {
        ...PROPUESTA,
        definition: {
          nodes: [
            { id: 'inicio', type: 'trigger', data: {} },
            { id: 'saludo', type: 'send_message', data: { config: { channel: 'whatsapp' } } },
          ],
          edges: [{ id: 'e1', source: 'inicio', target: 'saludo' }],
        },
      }),
    ).rejects.toThrow(/no se puede ejecutar/);
  });

  it('cada guardado escribe una versión, y son consecutivas', async () => {
    const flujo = await servicio.crear(ctx, PROPUESTA);
    await servicio.guardar(ctx, flujo.id, { ...PROPUESTA, name: 'v2' });
    await servicio.guardar(ctx, flujo.id, { ...PROPUESTA, name: 'v3' });
    const historial = await servicio.versiones(ctx, flujo.id);
    expect(historial.map((v) => v.version)).toEqual([3, 2, 1]);
  });

  it('editar un flujo activo NO lo apaga', async () => {
    const flujo = await servicio.crear(ctx, PROPUESTA);
    await servicio.activar(ctx, flujo.id);
    await servicio.guardar(ctx, flujo.id, { ...PROPUESTA, name: 'editado' });
    expect((await store.exigirFlujo(ctx, flujo.id)).status).toBe('active');
  });
});

// ════════════════════════════════════════════════════════════════════════════

describe('disparadorCalza — los filtros contra las llaves REALES de quien emite', () => {
  const flujo = (triggerType: string, triggerConfig: Record<string, unknown>): Flow =>
    ({ triggerType, triggerConfig }) as Flow;

  it('sin filtro, calza cualquiera', () => {
    expect(disparadorCalza(flujo('stage_changed', {}), { stageSlug: 'lo-que-sea' })).toBe(true);
  });

  it('el filtro de etapa calza por SLUG y por ID: el asistente manda uno y el builder el otro', () => {
    const payload = { stageSlug: 'contactado', stageId: 'et-2' };
    expect(disparadorCalza(flujo('stage_changed', { stage: 'contactado' }), payload)).toBe(true);
    expect(disparadorCalza(flujo('stage_changed', { stage: 'et-2' }), payload)).toBe(true);
    expect(disparadorCalza(flujo('stage_changed', { stage: 'ganado' }), payload)).toBe(false);
  });

  it('la etiqueta calza con la llave que manda H15', () => {
    expect(disparadorCalza(flujo('tag_added', { tag: 'vip' }), { tag: 'vip' })).toBe(true);
    expect(disparadorCalza(flujo('tag_added', { tag: 'vip' }), { tag: 'frío' })).toBe(false);
  });

  it('contact_created filtra por el canal por el que llegó', () => {
    expect(disparadorCalza(flujo('contact_created', { source: 'whatsapp' }), { channel: 'whatsapp' })).toBe(true);
    expect(disparadorCalza(flujo('contact_created', { source: 'whatsapp' }), { channel: 'email' })).toBe(false);
  });

  it('el filtro no distingue mayúsculas', () => {
    expect(disparadorCalza(flujo('tag_added', { tag: 'VIP' }), { tag: 'vip' })).toBe(true);
  });
});
