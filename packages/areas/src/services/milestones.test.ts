/**
 * Criterio 7 — *"el roadmap del agente maestro aparece y se puede marcar,
 * reordenar y editar"*.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PlatformError, __clearPorts, __setClientForTests, registerPort } from '@abraxa/db';
import type { AgentPort, TenantContext } from '@abraxa/db';
import { createFakeDb, type FakeDb } from '../testing/fake-db';
import { TENANT_A, TENANT_B, mundo } from '../testing/seed';
import {
  LIMITE_HITOS,
  createMilestone,
  deleteMilestone,
  listMilestones,
  proposeMilestones,
  reorderMilestones,
  updateMilestone,
} from './milestones';

let db: FakeDb;
let restaurar: () => void;

const ctx = (tenantId = TENANT_A): TenantContext => ({
  tenantId,
  tenantSlug: 'panaderia-lupita',
  userEmail: 'lupita@ejemplo.mx',
  role: 'owner',
  areas: { '*': 'admin' },
});

/** Doble de H3. La regla 5 del contrato: se programa contra la interfaz. */
function agentesFalsos(texto: string, nombre = 'Bruno'): AgentPort {
  return {
    async run() {
      return {
        text: texto,
        usage: { inputTokens: 0, outputTokens: 0, cachedReadTokens: 0, cachedWriteTokens: 0, costUsd: 0 },
        stopReason: 'end_turn' as const,
        agentName: nombre,
      };
    },
    registerTool() {},
    async upsertDefinition() {
      return { agentId: 'x' };
    },
  };
}

beforeEach(() => {
  db = createFakeDb(mundo([{ id: TENANT_A }, { id: TENANT_B }]) as never);
  restaurar = __setClientForTests(db.client);
});

afterEach(() => {
  restaurar?.();
  __clearPorts();
});

describe('escribir y editar el roadmap', () => {
  it('un hito nuevo se va al final: no se cuela en medio del plan', async () => {
    await createMilestone(ctx(), { title: 'Primer empleado' });
    await createMilestone(ctx(), { title: 'Segundo local' });

    expect((await listMilestones(ctx())).map((m) => m.title)).toEqual([
      'Primer empleado',
      'Segundo local',
    ]);
  });

  it('un hito escrito por el emprendedor se marca como suyo', async () => {
    const m = await createMilestone(ctx(), { title: 'Cobrar sin perseguir a nadie' });
    expect(m.generatedBy).toBe('user');
    expect(m.done).toBe(false);
  });

  it('un título vacío se rechaza antes de escribir', async () => {
    await expect(createMilestone(ctx(), { title: '   ' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    expect(db.tabla('tenant_milestones')).toHaveLength(0);
  });

  it('se puede editar el título y la descripción', async () => {
    const m = await createMilestone(ctx(), { title: 'Contratar' });
    const editado = await updateMilestone(ctx(), m.id, {
      title: 'Contratar a la primera persona',
      description: 'Alguien que atienda WhatsApp los sábados',
    });
    expect(editado.title).toBe('Contratar a la primera persona');
    expect(editado.description).toBe('Alguien que atienda WhatsApp los sábados');
  });

  it('marcar guarda CUÁNDO, no sólo que sí', async () => {
    const m = await createMilestone(ctx(), { title: 'Primer empleado' });
    const hecho = await updateMilestone(ctx(), m.id, { done: true });
    expect(hecho.done).toBe(true);
    expect(hecho.doneAt).toBeTruthy();
  });

  it('desmarcar limpia la fecha', async () => {
    const m = await createMilestone(ctx(), { title: 'Primer empleado' });
    await updateMilestone(ctx(), m.id, { done: true });
    const otra = await updateMilestone(ctx(), m.id, { done: false });
    expect(otra.done).toBe(false);
    expect(otra.doneAt).toBeNull();
  });

  it('un patch vacío se rechaza en vez de escribir nada y decir que sí', async () => {
    const m = await createMilestone(ctx(), { title: 'X' });
    await expect(updateMilestone(ctx(), m.id, {})).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('editar un hito que no existe da 404', async () => {
    await expect(updateMilestone(ctx(), 'no-existe', { done: true })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('se puede borrar', async () => {
    const m = await createMilestone(ctx(), { title: 'X' });
    await deleteMilestone(ctx(), m.id);
    expect(await listMilestones(ctx())).toEqual([]);
  });
});

describe('reordenar', () => {
  it('los ids en el orden nuevo mandan', async () => {
    const a = await createMilestone(ctx(), { title: 'A' });
    const b = await createMilestone(ctx(), { title: 'B' });
    const c = await createMilestone(ctx(), { title: 'C' });

    const orden = await reorderMilestones(ctx(), [c.id, a.id, b.id]);
    expect(orden.map((m) => m.title)).toEqual(['C', 'A', 'B']);
  });

  it('algo que no es una lista de ids se rechaza', async () => {
    await expect(reorderMilestones(ctx(), 'c,a,b')).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(reorderMilestones(ctx(), [1, 2])).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('un id de otra empresa simplemente no se encuentra', async () => {
    const mio = await createMilestone(ctx(TENANT_A), { title: 'Mío' });
    const suyo = await createMilestone(ctx(TENANT_B), { title: 'Suyo' });

    await reorderMilestones(ctx(TENANT_A), [suyo.id, mio.id]);

    // El de B no se movió: `tenantDb` no lo alcanza.
    const deB = db.tabla('tenant_milestones').find((f) => f.id === suyo.id);
    expect(deB?.position).toBe(1);
    expect((await listMilestones(ctx(TENANT_B))).map((m) => m.title)).toEqual(['Suyo']);
  });
});

describe('el aislamiento', () => {
  it('cada empresa ve sólo su roadmap', async () => {
    await createMilestone(ctx(TENANT_A), { title: 'De A' });
    await createMilestone(ctx(TENANT_B), { title: 'De B' });

    expect((await listMilestones(ctx(TENANT_A))).map((m) => m.title)).toEqual(['De A']);
    expect((await listMilestones(ctx(TENANT_B))).map((m) => m.title)).toEqual(['De B']);
  });

  it('no se puede borrar el hito de otra empresa', async () => {
    const suyo = await createMilestone(ctx(TENANT_B), { title: 'De B' });
    await deleteMilestone(ctx(TENANT_A), suyo.id);
    expect(await listMilestones(ctx(TENANT_B))).toHaveLength(1);
  });
});

describe('el roadmap que propone el agente maestro', () => {
  it('sin H3 registrado no se cae: lo DICE', async () => {
    const r = await proposeMilestones(ctx());
    expect(r.created).toBe(0);
    expect(r.reason).toContain('H3');
    expect(r.milestones).toEqual([]);
  });

  it('con H3 escribe los hitos que propuso', async () => {
    registerPort(
      'agents',
      agentesFalsos(
        JSON.stringify([
          { title: 'Cobrar por adelantado', description: 'Anticipo del 50%', areaSlug: 'finanzas' },
          { title: 'Primer empleado' },
        ]),
      ),
    );

    const r = await proposeMilestones(ctx());
    expect(r.created).toBe(2);
    expect(r.reason).toBeNull();
    expect(r.milestones.map((m) => m.title)).toEqual(['Cobrar por adelantado', 'Primer empleado']);
    expect(r.milestones[0]?.generatedBy).toBe('master_agent');
    expect(r.milestones[0]?.areaSlug).toBe('finanzas');
  });

  it('recorta el envoltorio con el que a veces contesta el modelo', async () => {
    registerPort(
      'agents',
      agentesFalsos('Claro, aquí va:\n```json\n[{"title":"Punto de equilibrio"}]\n```\n¿Te sirve?'),
    );
    const r = await proposeMilestones(ctx());
    expect(r.milestones.map((m) => m.title)).toEqual(['Punto de equilibrio']);
  });

  it('un JSON roto no es un error del sistema: es una propuesta que no sirvió', async () => {
    registerPort('agents', agentesFalsos('no sé hacer eso', 'Bruno'));
    const r = await proposeMilestones(ctx());
    expect(r.created).toBe(0);
    expect(r.reason).toContain('Bruno');
  });

  it('NO borra lo que el emprendedor ya había escrito', async () => {
    await createMilestone(ctx(), { title: 'El mío, ya marcado' });
    registerPort('agents', agentesFalsos(JSON.stringify([{ title: 'El del agente' }])));

    const r = await proposeMilestones(ctx());
    expect(r.milestones.map((m) => m.title)).toEqual(['El mío, ya marcado', 'El del agente']);
  });

  it('descarta los que vienen sin título en vez de escribir hitos vacíos', async () => {
    registerPort('agents', agentesFalsos(JSON.stringify([{ title: '' }, { title: 'Bueno' }])));
    const r = await proposeMilestones(ctx());
    expect(r.milestones.map((m) => m.title)).toEqual(['Bueno']);
  });

  it('respeta el techo del roadmap', async () => {
    for (let i = 0; i < LIMITE_HITOS; i += 1) {
      await createMilestone(ctx(), { title: `Hito ${i}` });
    }
    registerPort('agents', agentesFalsos(JSON.stringify([{ title: 'Uno más' }])));

    const r = await proposeMilestones(ctx());
    expect(r.created).toBe(0);
    expect(r.reason).toContain('lleno');
    await expect(createMilestone(ctx(), { title: 'Otro' })).rejects.toThrow(PlatformError);
  });
});
