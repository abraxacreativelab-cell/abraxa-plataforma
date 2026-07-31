/**
 * El hueco estructural, probado.
 *
 * `tenant_areas` y `tenant_milestones` no existen todavía —las crea H11 en la
 * ola 3— y `AreasPort` sólo declara lectura. Lo que se verifica aquí es que esa
 * ausencia NO pierde el trabajo del cliente: el blueprint se guarda igual,
 * queda marcado como pendiente, y el día que H11 registre su sink se proyecta
 * solo con un barrido. Ver ports/blueprint-sink.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setClientForTests } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import { crearFakeDb } from '../testing/fake-db';
import { ctxDePrueba } from '../testing/agente-falso';
import { registrarBlueprintSink, type BlueprintSink } from '../ports/blueprint-sink';
import {
  aplicarBlueprintsPendientes,
  blueprintVigente,
  guardarBlueprint,
  listarBlueprints,
} from './blueprint';
import { construirMapa } from './mapa';
import type { BlueprintGuardado, EstadoNegocio } from '../types';

const NEGOCIO: EstadoNegocio = {
  agente: 'Aura',
  giro: 'estudio de tatuajes',
  nicho: 'primera vez',
  etapa: 'operando',
  tamano: '20 citas al mes',
  modeloIngreso: 'por sesión',
  ticket: '$2,500',
  margen: '60%',
  canales: ['instagram'],
  recorrido: [{ nombre: 'me escriben' }, { nombre: 'agendo' }, { nombre: 'tatúo' }],
  herramientas: ['instagram', 'agenda de papel'],
  dolores: [{ texto: 'se me caen citas y no cobro anticipo' }],
  equipo: 'solo',
  hitos: [
    { areaSlug: 'ventas', titulo: 'Cobrar anticipo al agendar', origen: 'abogado_del_diablo' },
  ],
};

let db: ReturnType<typeof crearFakeDb>;
let restaurar: () => void;
let ctx: TenantContext;

beforeEach(() => {
  db = crearFakeDb();
  restaurar = __setClientForTests(db.cliente);
  ctx = ctxDePrueba();
  registrarBlueprintSink(null);
});

afterEach(() => {
  restaurar();
  registrarBlueprintSink(null);
});

describe('sin H11', () => {
  it('el blueprint se guarda íntegro y queda pendiente, no perdido', async () => {
    const guardado = await guardarBlueprint(ctx, 'sesion-1', construirMapa(NEGOCIO));

    expect(guardado.version).toBe(1);
    expect(guardado.appliedAt).toBeNull();
    expect(guardado.areas).toHaveLength(6);
    expect(guardado.hitos.some((h) => h.origen === 'abogado_del_diablo')).toBe(true);
    expect(guardado.resumen).toContain('estudio de tatuajes');

    // Y el barrido no hace nada mientras no haya quién escriba.
    expect(await aplicarBlueprintsPendientes(ctx)).toBe(0);
  });

  it('re-sintetizar no pisa la versión anterior', async () => {
    await guardarBlueprint(ctx, 'sesion-1', construirMapa(NEGOCIO));
    await guardarBlueprint(ctx, 'sesion-1', construirMapa({ ...NEGOCIO, equipo: 'voy a contratar' }));

    const todos = await listarBlueprints(ctx);
    expect(todos.map((b) => b.version)).toEqual([2, 1]);
    expect((await blueprintVigente(ctx))?.version).toBe(2);

    // La v2 abre Equipo; la v1 lo tenía cerrado. Es el registro de qué se le
    // prometió y cuándo, que es justo lo que se perdería al pisar.
    const v2 = todos[0];
    const v1 = todos[1];
    expect(v2?.areas.find((a) => a.slug === 'rh')?.estado).toBe('disponible');
    expect(v1?.areas.find((a) => a.slug === 'rh')?.estado).toBe('bloqueada');
  });
});

describe('cuando H11 aterrice', () => {
  it('un barrido proyecta lo que quedó pendiente, sin re-entrevistar a nadie', async () => {
    await guardarBlueprint(ctx, 'sesion-1', construirMapa(NEGOCIO));

    const recibidos: BlueprintGuardado[] = [];
    const sink: BlueprintSink = {
      nombre: 'H11 · packages/areas',
      aplicar: (_ctx, b) => {
        recibidos.push(b);
        return Promise.resolve();
      },
    };
    registrarBlueprintSink(sink);

    expect(await aplicarBlueprintsPendientes(ctx)).toBe(1);
    expect(recibidos).toHaveLength(1);
    expect(recibidos[0]?.areas).toHaveLength(6);

    const vigente = await blueprintVigente(ctx);
    expect(vigente?.appliedAt).toBeTruthy();
    expect(vigente?.appliedBy).toBe('H11 · packages/areas');

    // Idempotente: un segundo barrido ya no reprocesa nada.
    expect(await aplicarBlueprintsPendientes(ctx)).toBe(0);
  });

  it('si el sink falla, el motivo queda escrito y el blueprint sigue pendiente', async () => {
    await guardarBlueprint(ctx, 'sesion-1', construirMapa(NEGOCIO));

    registrarBlueprintSink({
      nombre: 'sink roto',
      aplicar: () => Promise.reject(new Error('tenant_areas no existe')),
    });

    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await aplicarBlueprintsPendientes(ctx)).toBe(0);
    error.mockRestore();

    const vigente = await blueprintVigente(ctx);
    expect(vigente?.appliedAt).toBeNull();
    expect(vigente?.applyError).toBe('tenant_areas no existe');
  });
});
