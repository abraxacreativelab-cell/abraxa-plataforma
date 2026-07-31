/**
 * El embudo, y sobre todo la regla anti-bucle de `moverEtapa`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PlatformError, __clearPorts, __setClientForTests, registerPort } from '@abraxa/db';
import type { TriggerType } from '@abraxa/db';
import { contextoDePrueba, createFakeDb, type FakeDb } from '../testing/fake-db';
import { crearContacto, leerContacto } from '../contacts/service';
import {
  estadisticasEmbudo,
  listarEmbudos,
  moverEtapa,
  sembrarEmbudoPorDefecto,
} from './service';
import { ETAPAS_POR_DEFECTO } from './defaults';

const A = contextoDePrueba('tenant-a');

let fake: FakeDb;
let restaurar: () => void;
let emitidos: Array<{ type: TriggerType; payload: unknown }>;

beforeEach(() => {
  fake = createFakeDb();
  restaurar = __setClientForTests(fake.client);
  __clearPorts();
  emitidos = [];
  registerPort('flows', {
    emit: async (_ctx, e) => {
      emitidos.push(e);
    },
  });
});

afterEach(() => {
  restaurar();
  __clearPorts();
});

describe('sembrarEmbudoPorDefecto', () => {
  it('crea el embudo con sus siete etapas', async () => {
    const r = await sembrarEmbudoPorDefecto(A);
    expect(r.created).toBe(true);

    const embudos = await listarEmbudos(A);
    expect(embudos).toHaveLength(1);
    expect(embudos[0]?.isDefault).toBe(true);
    expect(embudos[0]?.stages.map((s) => s.slug)).toEqual(ETAPAS_POR_DEFECTO.map((s) => s.slug));
  });

  it('incluye "Perdido", que en GARDEN no existe', async () => {
    await sembrarEmbudoPorDefecto(A);
    const etapas = (await listarEmbudos(A))[0]?.stages ?? [];
    expect(etapas.find((s) => s.isLost)?.slug).toBe('perdido');
    expect(etapas.find((s) => s.isWon)?.slug).toBe('ganado');
  });

  it('es idempotente: correrlo dos veces no duplica etapas', async () => {
    await sembrarEmbudoPorDefecto(A);
    const segundo = await sembrarEmbudoPorDefecto(A);
    expect(segundo.created).toBe(false);
    expect(fake.tabla('pipeline_stages')).toHaveLength(ETAPAS_POR_DEFECTO.length);
  });
});

describe('moverEtapa', () => {
  it('acepta el slug, el id y el nombre en español del asistente de H8', async () => {
    await sembrarEmbudoPorDefecto(A);
    const { contactId } = await crearContacto(A, { displayName: 'Santiago' });

    const porSlug = await moverEtapa(A, { contactId, stage: 'contactado' });
    expect(porSlug.moved).toBe(true);

    // Lo que propondría el asistente en español, con mayúscula y acento.
    const porNombre = await moverEtapa(A, { contactId, stage: 'Negociación' });
    expect(porNombre.moved).toBe(true);

    const porId = await moverEtapa(A, { contactId, stage: porSlug.stageId });
    expect(porId.moved).toBe(true);
  });

  /**
   * LA REGLA QUE EVITA EL BUCLE.
   *
   * "Cuando entre un lead, muévelo a Contactado" + un flujo que escucha
   * `stage_changed` = 100 mensajes al cliente antes de que el anti-loop del
   * motor de H8 lo corte. Se corta aquí, en el origen.
   */
  it('mover a la etapa en la que YA está no emite stage_changed', async () => {
    await sembrarEmbudoPorDefecto(A);
    const { contactId } = await crearContacto(A, { displayName: 'Santiago' });
    emitidos.length = 0;

    const primera = await moverEtapa(A, { contactId, stage: 'contactado' });
    const segunda = await moverEtapa(A, { contactId, stage: 'contactado' });

    expect(primera.moved).toBe(true);
    expect(segunda.moved).toBe(false);
    expect(emitidos.filter((e) => e.type === 'stage_changed')).toHaveLength(1);
  });

  it('sí actualiza el monto aunque la etapa no cambie', async () => {
    await sembrarEmbudoPorDefecto(A);
    const { contactId } = await crearContacto(A, { displayName: 'Santiago' });
    await moverEtapa(A, { contactId, stage: 'propuesta', amount: 1000 });
    await moverEtapa(A, { contactId, stage: 'propuesta', amount: 2500 });

    const contacto = await leerContacto(A, contactId);
    expect(contacto?.placements[0]?.amount).toBe(2500);
  });

  it('anota el movimiento legible en la línea de tiempo', async () => {
    await sembrarEmbudoPorDefecto(A);
    const { contactId } = await crearContacto(A, { displayName: 'Santiago' });
    await moverEtapa(A, { contactId, stage: 'nuevo' });
    await moverEtapa(A, { contactId, stage: 'calificado' });

    const resumenes = fake
      .tabla('contact_events')
      .filter((e) => e.type === 'stage_changed')
      .map((e) => e.summary);
    expect(resumenes).toContain('Nuevo → Calificado');
  });

  it('dice qué etapas hay cuando le piden una que no existe', async () => {
    await sembrarEmbudoPorDefecto(A);
    const { contactId } = await crearContacto(A, { displayName: 'Santiago' });
    await expect(moverEtapa(A, { contactId, stage: 'inventada' })).rejects.toThrow(/contactado/);
  });

  it('exige que exista un embudo en vez de inventar uno', async () => {
    const { contactId } = await crearContacto(A, { displayName: 'Santiago' });
    await expect(moverEtapa(A, { contactId, stage: 'nuevo' })).rejects.toThrow(PlatformError);
    expect(fake.tabla('pipelines')).toHaveLength(0);
  });

  it('el CRM sigue funcionando si el motor de flujos no está', async () => {
    __clearPorts(); // sin FlowPort registrado
    await sembrarEmbudoPorDefecto(A);
    const { contactId } = await crearContacto(A, { displayName: 'Santiago' });
    const r = await moverEtapa(A, { contactId, stage: 'contactado' });
    expect(r.moved).toBe(true);
  });
});

describe('estadisticasEmbudo', () => {
  it('cuenta contactos y suma montos por etapa', async () => {
    await sembrarEmbudoPorDefecto(A);
    const uno = await crearContacto(A, { displayName: 'Uno' });
    const dos = await crearContacto(A, { displayName: 'Dos' });
    const tres = await crearContacto(A, { displayName: 'Tres' });

    await moverEtapa(A, { contactId: uno.contactId, stage: 'propuesta', amount: 1000 });
    await moverEtapa(A, { contactId: dos.contactId, stage: 'propuesta', amount: 500 });
    await moverEtapa(A, { contactId: tres.contactId, stage: 'nuevo' });

    const stats = await estadisticasEmbudo(A);
    const propuesta = stats.stages.find((s) => s.slug === 'propuesta');
    expect(propuesta?.count).toBe(2);
    expect(propuesta?.amount).toBe(1500);
    expect(stats.stages.find((s) => s.slug === 'nuevo')?.count).toBe(1);
    expect(stats.stages.find((s) => s.slug === 'ganado')?.count).toBe(0);
  });

  it('no cuenta contactos fusionados: inflarían el tablero', async () => {
    await sembrarEmbudoPorDefecto(A);
    const vivo = await crearContacto(A, { displayName: 'Vivo' });
    const muerto = await crearContacto(A, { displayName: 'Duplicado' });
    await moverEtapa(A, { contactId: vivo.contactId, stage: 'propuesta', amount: 1000 });
    await moverEtapa(A, { contactId: muerto.contactId, stage: 'propuesta', amount: 9999 });

    const fila = fake.tabla('contacts').find((c) => c.id === muerto.contactId);
    if (fila) fila.merged_into = vivo.contactId;

    const propuesta = (await estadisticasEmbudo(A)).stages.find((s) => s.slug === 'propuesta');
    expect(propuesta?.count).toBe(1);
    expect(propuesta?.amount).toBe(1000);
  });
});
