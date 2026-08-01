/**
 * Criterio 4 — *"desbloquear dispara el mini-onboarding, y al terminar hay un
 * resultado visible"*.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __clearPorts, __setClientForTests, registerPort } from '@abraxa/db';
import type { AgentPort, AgentRunInput, TenantContext } from '@abraxa/db';
import { createFakeDb, type FakeDb } from '../testing/fake-db';
import { TENANT_A, TENANT_B, mundo } from '../testing/seed';
import { listAreas, unlockArea } from './areas';
import { answer, finish, getOnboarding, start } from './onboarding';

let db: FakeDb;
let restaurar: () => void;

const ctx = (tenantId = TENANT_A): TenantContext => ({
  tenantId,
  tenantSlug: 'panaderia-lupita',
  userEmail: 'lupita@ejemplo.mx',
  role: 'owner',
  areas: { '*': 'admin' },
});

const sinAcceso = (): TenantContext => ({ ...ctx(), role: 'member', areas: { ventas: 'view' } });

/** Doble de H3 que además deja ver qué prompt recibió. */
function agentesFalsos(
  texto: string,
  espia?: { input?: string; systemSuffix?: string },
): AgentPort {
  return {
    async run(_c: TenantContext, i: AgentRunInput) {
      if (espia) {
        espia.input = i.input;
        espia.systemSuffix = i.systemSuffix;
      }
      if (texto === '__falla__') throw new Error('el proveedor se cayó');
      return {
        text: texto,
        usage: { inputTokens: 0, outputTokens: 0, cachedReadTokens: 0, cachedWriteTokens: 0, costUsd: 0 },
        stopReason: 'end_turn' as const,
        agentName: 'Bruno',
      };
    },
    registerTool() {},
    async upsertDefinition() {
      return { agentId: 'x' };
    },
  };
}

/** Abre `operaciones`, que nace disponible en todos los giros. */
async function conAreaAbierta(): Promise<void> {
  await listAreas(ctx());
}

beforeEach(() => {
  db = createFakeDb(mundo([{ id: TENANT_A, industry: 'servicios' }, { id: TENANT_B }]) as never);
  restaurar = __setClientForTests(db.client);
});

afterEach(() => {
  restaurar?.();
  __clearPorts();
});

describe('el guion sale de la base, no del código', () => {
  it('trae intro, promesa y TRES preguntas del catálogo', async () => {
    await conAreaAbierta();
    const v = await getOnboarding(ctx(), 'operaciones');

    expect(v.script.intro.length).toBeGreaterThan(20);
    expect(v.script.promise.length).toBeGreaterThan(15);
    expect(v.script.questions).toHaveLength(3);
    expect(v.script.result?.label).toBeTruthy();
  });

  it('el guion del giro le gana al genérico', async () => {
    // El catálogo trae una fila `restaurante/finanzas` distinta de la de `'*'`.
    db.sembrar('tenants', [
      { id: TENANT_A, slug: 't-a', name: 'X', industry_type: 'restaurante', created_at: new Date().toISOString() },
    ]);
    await listAreas(ctx());

    const v = await getOnboarding(ctx(), 'finanzas');
    expect(v.script.intro).toContain('cocina');
  });

  it('el guion de un área BLOQUEADA se puede leer: la promesa se muestra igual', async () => {
    await conAreaAbierta();
    const v = await getOnboarding(ctx(), 'rh');
    expect(v.state).toBe('bloqueada');
    expect(v.script.promise).toBeTruthy();
  });

  it('pero no se puede EMPEZAR el tutorial de un área bloqueada', async () => {
    await conAreaAbierta();
    await expect(start(ctx(), 'rh')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('sin acceso al área no se ve ni el guion', async () => {
    await conAreaAbierta();
    await expect(getOnboarding(sinAcceso(), 'operaciones')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

describe('el recorrido', () => {
  beforeEach(conAreaAbierta);

  it('empezar deja el área en progreso', async () => {
    const v = await start(ctx(), 'operaciones');
    expect(v.state).toBe('en_progreso');
    expect(v.question?.index).toBe(0);
    expect(v.question?.total).toBe(3);
  });

  it('volver a entrar RETOMA donde se quedó, no reinicia', async () => {
    const v0 = await start(ctx(), 'operaciones');
    await answer(ctx(), 'operaciones', v0.question?.key, 'Le cobro y le entrego el martes');

    const v1 = await start(ctx(), 'operaciones');
    expect(v1.question?.index).toBe(1);
    expect(v1.run?.answers).toHaveLength(1);
  });

  it('corregir una respuesta anterior la PISA y no agrega una cuarta', async () => {
    const v0 = await start(ctx(), 'operaciones');
    const primera = v0.question?.key;

    await answer(ctx(), 'operaciones', primera, 'primera versión');
    const v = await answer(ctx(), 'operaciones', primera, 'versión corregida');

    expect(v.run?.answers).toHaveLength(1);
    expect(v.run?.answers[0]?.answer).toBe('versión corregida');
    // Y el paso vuelve a la primera SIN contestar, no al final.
    expect(v.question?.index).toBe(1);
  });

  it('una pregunta que no está en el guion se rechaza', async () => {
    await start(ctx(), 'operaciones');
    await expect(answer(ctx(), 'operaciones', 'inventada', 'x')).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('una respuesta vacía se rechaza', async () => {
    const v = await start(ctx(), 'operaciones');
    await expect(answer(ctx(), 'operaciones', v.question?.key, '   ')).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('contestar las tres deja listo el cierre', async () => {
    let v = await start(ctx(), 'operaciones');
    for (const q of v.script.questions) {
      v = await answer(ctx(), 'operaciones', q.key, `respuesta a ${q.key}`);
    }
    expect(v.question).toBeNull();
    expect(v.readyToFinish).toBe(true);
  });

  it('no se puede cerrar con preguntas pendientes', async () => {
    await start(ctx(), 'operaciones');
    await expect(finish(ctx(), 'operaciones')).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

describe('el primer resultado visible', () => {
  beforeEach(conAreaAbierta);

  async function contestarTodo(): Promise<void> {
    let v = await start(ctx(), 'operaciones');
    for (const q of v.script.questions) {
      v = await answer(ctx(), 'operaciones', q.key, `lo que contesté de ${q.key}`);
    }
  }

  it('se genera con SUS respuestas y queda GUARDADO', async () => {
    const espia: { input?: string; systemSuffix?: string } = {};
    registerPort('agents', agentesFalsos('1. Recibes el pago\n2. Entregas el martes', espia));

    await contestarTodo();
    const { view, degraded } = await finish(ctx(), 'operaciones');

    expect(degraded).toBeNull();
    expect(view.run?.result?.body).toContain('Entregas el martes');
    expect(view.state).toBe('activa');

    // Guardado, no sólo pintado: volver dos días después lo sigue viendo.
    const fila = db.tabla('area_onboarding_runs').find((f) => f.area_slug === 'operaciones');
    expect((fila?.result as { body?: string })?.body).toContain('Entregas el martes');
    expect(fila?.completed_at).toBeTruthy();
  });

  it('el prompt lleva lo que él contestó y el guion como sufijo del system', async () => {
    const espia: { input?: string; systemSuffix?: string } = {};
    registerPort('agents', agentesFalsos('ok', espia));

    await contestarTodo();
    await finish(ctx(), 'operaciones');

    expect(espia.input).toContain('lo que contesté de');
    // El mismo mecanismo con el que H7 corre su entrevista, con otro texto.
    expect(espia.systemSuffix).toContain('Operaciones');
  });

  it('si H3 no está, el área se activa IGUAL y se dice por qué no hay resultado', async () => {
    await contestarTodo();
    const { view, degraded } = await finish(ctx(), 'operaciones');

    // Ganarse el área no puede depender de que un proveedor esté de buenas.
    expect(view.state).toBe('activa');
    expect(view.run?.result).toBeNull();
    expect(degraded).toContain('H3');
  });

  it('si el proveedor se cae, el área se activa igual y se dice', async () => {
    registerPort('agents', agentesFalsos('__falla__'));
    await contestarTodo();

    const { view, degraded } = await finish(ctx(), 'operaciones');
    expect(view.state).toBe('activa');
    expect(degraded).toBeTruthy();
  });

  it('cerrar dos veces no vuelve a llamar al agente ni pisa el resultado', async () => {
    registerPort('agents', agentesFalsos('el resultado bueno'));
    await contestarTodo();
    await finish(ctx(), 'operaciones');

    __clearPorts();
    registerPort('agents', agentesFalsos('OTRO resultado'));
    const { view } = await finish(ctx(), 'operaciones');

    expect(view.run?.result?.body).toBe('el resultado bueno');
  });
});

describe('el aislamiento', () => {
  it('el tutorial de una empresa no se ve desde otra', async () => {
    await listAreas(ctx(TENANT_A));
    await unlockArea(ctx(TENANT_A), 'servicio');
    await start(ctx(TENANT_A), 'servicio');

    await listAreas(ctx(TENANT_B));
    const v = await getOnboarding(ctx(TENANT_B), 'ventas');
    expect(v.run).toBeNull();

    expect(db.tabla('area_onboarding_runs').every((f) => f.tenant_id === TENANT_A)).toBe(true);
  });
});
