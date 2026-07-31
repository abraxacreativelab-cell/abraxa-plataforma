/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El motor de punta a punta: sin pg-boss, sin base viva, sin llaves.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Aquí se verifican los criterios observables del handoff que se pueden
 *  cerrar hoy:
 *
 *      #2 · editar un nodo, guardar, y que el motor corra la versión editada
 *      #5 · reintentar un paso fallido no duplica el mensaje ya enviado
 *      #6 · si el canal se cae a media corrida, el flujo pausa y reanuda
 *      #7 · volver a una versión anterior y que el motor use ésa
 *      #8 · un flujo del tenant A no puede tocar datos del B
 *
 *  La cola es `colaEnLinea()`, que ejecuta el siguiente paso en el momento.
 *  El motor no nota la diferencia: recibe una función `encolar` y ya.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { __clearPorts, __setClientForTests } from '@abraxa/db';
import { crearFakeDb, contextoDePrueba } from '../testing/fake-db';
import type { FakeDb } from '../testing/fake-db';
import { registrarTodo } from '../testing/dobles';
import type { DoblesRegistrados } from '../testing/dobles';
import { colaEnLinea } from '../queue';
import { emitirEvento } from '../events';
import { ejecutarPaso, reanudar } from './step';
import * as store from '../store';
import * as servicio from '../service';
import type { FlowDefinition } from '../types';

const CONTACTO = 'c-ana';
const WHATSAPP = '+528146811675';

const ctx = contextoDePrueba('t-uno');
const otroCtx = contextoDePrueba('t-dos');

let db: FakeDb;
let dobles: DoblesRegistrados;

/** Flujo: saludar → etiquetar → mover de etapa → fin. */
function definicion(saludo = 'Hola {nombre}'): FlowDefinition {
  return {
    nodes: [
      { id: 'inicio', type: 'trigger' },
      {
        id: 'saludo',
        type: 'send_message',
        data: { config: { channel: 'whatsapp', to: 'contact', template: saludo } },
      },
      { id: 'etiqueta', type: 'add_tag', data: { config: { tag: 'lead-nuevo' } } },
      { id: 'mover', type: 'move_stage', data: { config: { stage: 'contactado' } } },
      { id: 'fin', type: 'end' },
    ],
    edges: [
      { source: 'inicio', target: 'saludo' },
      { source: 'saludo', target: 'etiqueta' },
      { source: 'etiqueta', target: 'mover' },
      { source: 'mover', target: 'fin' },
    ],
  };
}

/** Siembra un flujo ACTIVO con su versión 1, en el tenant que se le diga. */
function sembrarFlujo(
  tenantId: string,
  id: string,
  def: FlowDefinition = definicion(),
  version = 1,
): void {
  db.tabla('flows').push({
    id,
    tenant_id: tenantId,
    name: 'Lead nuevo',
    description: null,
    trigger_type: 'contact_created',
    trigger_config: {},
    definition: def,
    status: 'active',
    version,
    created_by: 'santiago@abraxa.club',
    created_at: '2026-07-31T00:00:00.000Z',
    updated_at: '2026-07-31T00:00:00.000Z',
  });
  db.tabla('flow_versions').push({
    id: `${id}-v${version}`,
    tenant_id: tenantId,
    flow_id: id,
    version,
    name: 'Lead nuevo',
    trigger_type: 'contact_created',
    trigger_config: {},
    definition: def,
    note: 'versión inicial',
    created_at: '2026-07-31T00:00:00.000Z',
  });
}

beforeEach(() => {
  __clearPorts();
  db = crearFakeDb({ flows: [], flow_versions: [], flow_runs: [], flow_steps: [] });
  __setClientForTests(db.client);
  dobles = registrarTodo({
    contactos: [{ id: CONTACTO, firstName: 'Ana', whatsapp: WHATSAPP, stage: 'nuevo' }],
    valores: { 'precio.hora': '$800' },
    equipo: ['ana@abraxa.club', 'beto@abraxa.club'],
  });
});

// ════════════════════════════════════════════════════════════════════════════

describe('una corrida completa', () => {
  it('recorre los cuatro pasos, manda el mensaje y toca el CRM', async () => {
    sembrarFlujo(ctx.tenantId, 'f-1');

    const r = await emitirEvento(
      ctx,
      { type: 'contact_created', payload: { contactId: CONTACTO } },
      { encolar: colaEnLinea() },
    );
    expect(r.enroladas).toBe(1);

    // El mensaje salió UNA vez, con la variable resuelta.
    expect(dobles.bandeja.envios).toHaveLength(1);
    expect(dobles.bandeja.envios[0]?.body).toBe('Hola Ana');
    expect(dobles.bandeja.envios[0]?.address).toBe(WHATSAPP);

    // El CRM se movió de verdad.
    expect(dobles.crm.etiquetasDe(CONTACTO)).toContain('lead-nuevo');

    const corridas = await store.listarCorridas(ctx, {});
    expect(corridas[0]?.status).toBe('exited'); // el nodo `end`

    const pasos = await store.listarPasos(ctx, corridas[0]!.id);
    expect(pasos.map((p) => p.nodeId)).toEqual(['saludo', 'etiqueta', 'mover', 'fin']);
    expect(pasos.every((p) => p.status === 'ok')).toBe(true);
  });

  it('resuelve los valores de la bóveda en el mensaje', async () => {
    sembrarFlujo(ctx.tenantId, 'f-1', definicion('Hola {nombre}, la hora sale en {precio.hora}'));
    await emitirEvento(
      ctx,
      { type: 'contact_created', payload: { contactId: CONTACTO } },
      { encolar: colaEnLinea() },
    );
    expect(dobles.bandeja.envios[0]?.body).toBe('Hola Ana, la hora sale en $800');
  });

  it('una variable que nadie conoce queda VACÍA, nunca {cruda} en la cara del cliente', async () => {
    sembrarFlujo(ctx.tenantId, 'f-1', definicion('Hola {nombre}{inventada}'));
    await emitirEvento(
      ctx,
      { type: 'contact_created', payload: { contactId: CONTACTO } },
      { encolar: colaEnLinea() },
    );
    expect(dobles.bandeja.envios[0]?.body).toBe('Hola Ana');
  });
});

// ════════════════════════════════════════════════════════════════════════════

describe('criterio #5 · reintentar no duplica el mensaje', () => {
  it('re-ejecutar el mismo nodo NO manda un segundo mensaje', async () => {
    sembrarFlujo(ctx.tenantId, 'f-1');
    await emitirEvento(
      ctx,
      { type: 'contact_created', payload: { contactId: CONTACTO } },
      { encolar: colaEnLinea() },
    );
    expect(dobles.bandeja.cuantosA(WHATSAPP)).toBe(1);

    const corrida = (await store.listarCorridas(ctx, {}))[0]!;

    // El reintento tardío de la cola sobre un nodo ya hecho. Es exactamente el
    // job que pg-boss re-entrega cuando el proceso murió después de enviar.
    const r = await ejecutarPaso(
      {
        tenantId: ctx.tenantId,
        tenantSlug: ctx.tenantSlug,
        runId: corrida.id,
        nodeId: 'saludo',
      },
      { encolar: colaEnLinea() },
    );

    expect(r.accion).toBe('ignorado');
    expect(dobles.bandeja.cuantosA(WHATSAPP)).toBe(1); // sigue siendo UNO
  });

  it('el índice único rechaza un segundo paso `ok` del mismo nodo', async () => {
    // El árbitro no es el SELECT previo —que pierde la carrera—: es Postgres.
    sembrarFlujo(ctx.tenantId, 'f-1');
    await emitirEvento(
      ctx,
      { type: 'contact_created', payload: { contactId: CONTACTO } },
      { encolar: colaEnLinea() },
    );
    const corrida = (await store.listarCorridas(ctx, {}))[0]!;

    const escrito = await store.registrarPaso(ctx, {
      runId: corrida.id,
      nodeId: 'saludo',
      nodeType: 'send_message',
      status: 'ok',
      input: {},
      output: {},
      error: null,
      startedAt: new Date().toISOString(),
    });
    expect(escrito).toBe(false); // 23505: ya estaba hecho
  });

  it('un contacto no se enrola dos veces en el mismo flujo a la vez', async () => {
    sembrarFlujo(ctx.tenantId, 'f-1', {
      nodes: [
        { id: 'inicio', type: 'trigger' },
        { id: 'esperar', type: 'wait', data: { config: { minutes: 60 } } },
        { id: 'fin', type: 'end' },
      ],
      edges: [
        { source: 'inicio', target: 'esperar' },
        { source: 'esperar', target: 'fin' },
      ],
    });

    const evento = { type: 'contact_created' as const, payload: { contactId: CONTACTO } };
    const uno = await emitirEvento(ctx, evento, { encolar: colaEnLinea() });
    const dos = await emitirEvento(ctx, evento, { encolar: colaEnLinea() });

    expect(uno.enroladas).toBe(1);
    expect(dos.enroladas).toBe(0);
    expect(dos.duplicadas).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════

describe('criterio #6 · el canal se cae: pausa y reanuda', () => {
  it('pausa sin registrar el paso, y al volver el canal manda UNA sola vez', async () => {
    sembrarFlujo(ctx.tenantId, 'f-1');
    dobles.bandeja.fallarSiguiente('transitorio'); // el canal está caído

    await emitirEvento(
      ctx,
      { type: 'contact_created', payload: { contactId: CONTACTO } },
      { encolar: colaEnLinea() },
    );

    const corrida = (await store.listarCorridas(ctx, {}))[0]!;
    expect(corrida.status).toBe('paused');
    expect(corrida.currentNode).toBe('saludo'); // el puntero NO avanzó
    expect(await store.listarPasos(ctx, corrida.id)).toHaveLength(0); // ni un paso escrito
    expect(dobles.bandeja.envios).toHaveLength(0);

    // El canal vuelve.
    dobles.bandeja.sanar();
    const reanudada = await reanudar(
      { tenantId: ctx.tenantId, tenantSlug: ctx.tenantSlug, runId: corrida.id },
      { encolar: colaEnLinea() },
    );
    expect(reanudada).toBe(true);

    expect(dobles.bandeja.cuantosA(WHATSAPP)).toBe(1);
    const despues = await store.obtenerCorrida(ctx, corrida.id);
    expect(despues?.status).toBe('exited');
  });

  it('un fallo PERMANENTE mata la corrida en vez de esperar para siempre', async () => {
    sembrarFlujo(ctx.tenantId, 'f-1');
    dobles.bandeja.fallarSiguiente('permanente'); // número inválido

    await emitirEvento(
      ctx,
      { type: 'contact_created', payload: { contactId: CONTACTO } },
      { encolar: colaEnLinea() },
    );

    const corrida = (await store.listarCorridas(ctx, {}))[0]!;
    expect(corrida.status).toBe('error');
    expect(corrida.error).toContain('ese número no existe');
  });

  it('dos reanudaciones simultáneas: sólo una gana', async () => {
    sembrarFlujo(ctx.tenantId, 'f-1');
    dobles.bandeja.fallarSiguiente('transitorio');
    await emitirEvento(
      ctx,
      { type: 'contact_created', payload: { contactId: CONTACTO } },
      { encolar: colaEnLinea() },
    );
    const corrida = (await store.listarCorridas(ctx, {}))[0]!;
    dobles.bandeja.sanar();

    const trabajo = { tenantId: ctx.tenantId, tenantSlug: ctx.tenantSlug, runId: corrida.id };
    const primera = await reanudar(trabajo, { encolar: colaEnLinea() });
    const segunda = await reanudar(trabajo, { encolar: colaEnLinea() });

    expect(primera).toBe(true);
    expect(segunda).toBe(false); // ya no está pausada
    expect(dobles.bandeja.cuantosA(WHATSAPP)).toBe(1);
  });

  it('sin cola, la corrida queda pausada y lo dice — no zombi', async () => {
    sembrarFlujo(ctx.tenantId, 'f-1');
    const { colaAusente } = await import('../queue');
    await emitirEvento(
      ctx,
      { type: 'contact_created', payload: { contactId: CONTACTO } },
      { encolar: colaAusente() },
    );
    const corrida = (await store.listarCorridas(ctx, {}))[0]!;
    expect(corrida.status).toBe('paused');
    expect(corrida.error).toContain('encolar');
  });
});

// ════════════════════════════════════════════════════════════════════════════

describe('criterio #2 y #7 · versiones', () => {
  it('editar un nodo y que el motor corra la versión editada', async () => {
    sembrarFlujo(ctx.tenantId, 'f-1');
    const flujo = await store.exigirFlujo(ctx, 'f-1');

    const editado = await servicio.guardar(ctx, 'f-1', {
      name: 'Lead nuevo',
      trigger_type: 'contact_created',
      trigger_config: {},
      definition: definicion('Va de nuevo, {nombre}'),
    });
    expect(editado.version).toBe(flujo.version + 1);

    await emitirEvento(
      ctx,
      { type: 'contact_created', payload: { contactId: CONTACTO } },
      { encolar: colaEnLinea() },
    );
    expect(dobles.bandeja.envios[0]?.body).toBe('Va de nuevo, Ana');
  });

  it('una corrida en vuelo NO cambia de guion cuando se edita el flujo', async () => {
    // El fallo que esto evita: el contacto recibe el mensaje 3 de la versión
    // vieja y el 4 de la nueva.
    sembrarFlujo(ctx.tenantId, 'f-1', {
      nodes: [
        { id: 'inicio', type: 'trigger' },
        { id: 'esperar', type: 'wait', data: { config: { minutes: 60 } } },
        {
          id: 'saludo',
          type: 'send_message',
          data: { config: { channel: 'whatsapp', template: 'versión vieja' } },
        },
      ],
      edges: [
        { source: 'inicio', target: 'esperar' },
        { source: 'esperar', target: 'saludo' },
      ],
    });

    await emitirEvento(
      ctx,
      { type: 'contact_created', payload: { contactId: CONTACTO } },
      { encolar: colaEnLinea() },
    );
    const corrida = (await store.listarCorridas(ctx, {}))[0]!;
    expect(corrida.status).toBe('waiting');

    // Se edita el flujo MIENTRAS la corrida duerme.
    await servicio.guardar(ctx, 'f-1', {
      name: 'Lead nuevo',
      trigger_type: 'contact_created',
      trigger_config: {},
      definition: {
        nodes: [
          { id: 'inicio', type: 'trigger' },
          { id: 'esperar', type: 'wait', data: { config: { minutes: 60 } } },
          {
            id: 'saludo',
            type: 'send_message',
            data: { config: { channel: 'whatsapp', template: 'VERSIÓN NUEVA' } },
          },
        ],
        edges: [
          { source: 'inicio', target: 'esperar' },
          { source: 'esperar', target: 'saludo' },
        ],
      },
    });

    // Despierta y sigue con SU versión.
    await ejecutarPaso(
      { tenantId: ctx.tenantId, tenantSlug: ctx.tenantSlug, runId: corrida.id, nodeId: 'saludo' },
      { encolar: colaEnLinea() },
    );
    expect(dobles.bandeja.envios[0]?.body).toBe('versión vieja');
  });

  it('volver a una versión anterior y que el motor use ésa', async () => {
    sembrarFlujo(ctx.tenantId, 'f-1');

    await servicio.guardar(ctx, 'f-1', {
      name: 'Lead nuevo',
      trigger_type: 'contact_created',
      trigger_config: {},
      definition: definicion('mensaje de la v2'),
    });

    const restaurado = await servicio.volverAVersion(ctx, 'f-1', 1);
    expect(restaurado.version).toBe(3); // el historial va hacia adelante

    await emitirEvento(
      ctx,
      { type: 'contact_created', payload: { contactId: CONTACTO } },
      { encolar: colaEnLinea() },
    );
    expect(dobles.bandeja.envios[0]?.body).toBe('Hola Ana'); // la v1

    const historial = await servicio.versiones(ctx, 'f-1');
    expect(historial.map((v) => v.version)).toEqual([3, 2, 1]);
    expect(historial[0]?.note).toContain('restaurada de la versión 1');
  });
});

// ════════════════════════════════════════════════════════════════════════════

describe('criterio #8 · aislamiento entre empresas', () => {
  it('el evento del tenant B no enrola el flujo del tenant A', async () => {
    sembrarFlujo(ctx.tenantId, 'f-de-A');

    const r = await emitirEvento(
      otroCtx,
      { type: 'contact_created', payload: { contactId: CONTACTO } },
      { encolar: colaEnLinea() },
    );

    expect(r.enroladas).toBe(0);
    expect(dobles.bandeja.envios).toHaveLength(0);
  });

  it('el tenant B no puede leer ni la corrida ni los pasos del A', async () => {
    sembrarFlujo(ctx.tenantId, 'f-de-A');
    await emitirEvento(
      ctx,
      { type: 'contact_created', payload: { contactId: CONTACTO } },
      { encolar: colaEnLinea() },
    );
    const corrida = (await store.listarCorridas(ctx, {}))[0]!;

    expect(await store.obtenerCorrida(otroCtx, corrida.id)).toBeNull();
    expect(await store.listarPasos(otroCtx, corrida.id)).toEqual([]);
    expect(await store.listarCorridas(otroCtx, {})).toEqual([]);
    expect(await store.obtenerFlujo(otroCtx, 'f-de-A')).toBeNull();
  });

  it('un job con el tenant equivocado no ejecuta nada', async () => {
    // El fence real: aunque alguien fabricara el job, `obtenerCorrida` filtra
    // por tenant y no encuentra nada que ejecutar.
    sembrarFlujo(ctx.tenantId, 'f-de-A');
    await emitirEvento(
      ctx,
      { type: 'contact_created', payload: { contactId: CONTACTO } },
      { encolar: colaEnLinea() },
    );
    const corrida = (await store.listarCorridas(ctx, {}))[0]!;
    const antes = dobles.bandeja.envios.length;

    const r = await ejecutarPaso(
      {
        tenantId: otroCtx.tenantId,
        tenantSlug: otroCtx.tenantSlug,
        runId: corrida.id,
        nodeId: 'saludo',
      },
      { encolar: colaEnLinea() },
    );

    expect(r.accion).toBe('ignorado');
    expect(dobles.bandeja.envios).toHaveLength(antes);
  });
});

// ════════════════════════════════════════════════════════════════════════════

describe('el tope anti-bucle', () => {
  it('un flujo con ciclo guardado antes del validador se detiene solo', async () => {
    // El validador ya prohíbe los ciclos; esto es la segunda red, para un
    // grafo guardado antes o editado a mano en la base.
    sembrarFlujo(ctx.tenantId, 'f-1', {
      nodes: [
        { id: 'inicio', type: 'trigger' },
        { id: 'a', type: 'add_tag', data: { config: { tag: 'x' } } },
        { id: 'b', type: 'add_tag', data: { config: { tag: 'y' } } },
      ],
      edges: [
        { source: 'inicio', target: 'a' },
        { source: 'a', target: 'b' },
        { source: 'b', target: 'a' },
      ],
    });

    await emitirEvento(
      ctx,
      { type: 'contact_created', payload: { contactId: CONTACTO } },
      { encolar: colaEnLinea() },
    );

    const corrida = (await store.listarCorridas(ctx, {}))[0]!;
    expect(corrida.status).toBe('error');
    expect(corrida.error).toContain('bucle');

    // El detalle que hace que esto funcione: el contador cuenta EJECUCIONES,
    // no filas. Los dos nodos del ciclo sólo dejan DOS pasos guardados —el
    // índice único rechaza el segundo `ok` de cada uno—, así que contar filas
    // habría dejado el contador clavado en 2 y el bucle habría corrido para
    // siempre.
    expect(corrida.stepsTaken).toBe(100);
    expect((await store.listarPasos(ctx, corrida.id)).length).toBeLessThanOrEqual(2);
  });
});
