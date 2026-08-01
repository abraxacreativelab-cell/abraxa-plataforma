/**
 * El sink de blueprints, contra la base en memoria.
 *
 * Lo que se verifica aquí es lo que le pasó al único cliente que terminó el
 * Ritual: que su mapa aparezca completo, con las palabras que su agente le dijo,
 * con las herramientas del catálogo, y que reproyectarlo no le duplique nada.
 *
 * El catálogo y las plantillas por giro son los DE VERDAD (`testing/seed.ts` los
 * lee de las migraciones 090 y 033).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __clearPorts, __setClientForTests } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import { createFakeDb, type FakeDb } from '../testing/fake-db';
import { TENANT_A, TENANT_B, mundo } from '../testing/seed';
import {
  __olvidarPuenteParaPruebas,
  aplicarBlueprintDelRitual,
  hayPuente,
  proyectarBlueprint,
} from './blueprint';
import { listAreas, loadMap } from './areas';
import { listMilestones } from './milestones';

let db: FakeDb;
let restaurar: () => void;

const dueño = (tenantId = TENANT_A): TenantContext => ({
  tenantId,
  tenantSlug: 'taqueria-regia',
  userEmail: 'beto@ejemplo.mx',
  role: 'owner',
  areas: { '*': 'admin' },
});

/**
 * El blueprint que produjo el Ritual en producción el 2026-08-01, recortado a
 * los campos que la proyección lee. Los `type` de los requisitos son literales:
 * son los que el agente escogió, y son los que no coinciden con el evaluador.
 */
const BLUEPRINT = {
  id: 'ce22631b-c0ed-4796-8ccb-4a9aed578c35',
  industryType: null,
  areas: [
    {
      slug: 'ventas',
      label: 'Ventas y marketing',
      estado: 'en_progreso',
      blurb: 'Un equipo de ventas que nunca duerme.',
      position: 1,
      razon: 'Le llegan por WhatsApp y no da abasto.',
      requisitos: [{ min: 1, type: 'has_channel' }, { type: 'has_pipeline' }],
    },
    {
      slug: 'servicio',
      label: 'Servicio y atención',
      estado: 'disponible',
      blurb: 'Dejar de perder clientes por no contestar.',
      position: 2,
      razon: '',
      requisitos: [{ min: 5, type: 'contact_count' }],
    },
    {
      slug: 'rh',
      label: 'Equipo',
      estado: 'disponible',
      blurb: 'Graduarte de solopreneur.',
      position: 5,
      razon: '',
      requisitos: [{ type: 'declares_hiring' }],
    },
  ],
  hitos: [
    {
      areaSlug: 'rh',
      titulo: 'hacer una lista de precios fija y visible',
      detalle: null,
      origen: 'abogado_del_diablo',
    },
    {
      areaSlug: 'onboarding',
      titulo: 'Para abrir Onboarding: cerrar tu primera venta',
      detalle: null,
      origen: 'catalogo',
    },
  ],
};

function montar(datos: Record<string, unknown[]>): void {
  db = createFakeDb(datos as never);
  restaurar = __setClientForTests(db.client);
}

// El tenant real tenía `industry_type` NULL —`sembrarGiro` no llegó a
// escribirlo—, así que la siembra cae a `general`. Se reproduce igual.
beforeEach(() => montar(mundo([{ id: TENANT_A, industry: 'general' }])));

afterEach(() => {
  restaurar?.();
  __clearPorts();
});

// ════════════════════════════════════════════════════════════════════════════

describe('la empresa que terminó el Ritual y se quedó con el panel genérico', () => {
  it('sale del blueprint con su mapa entero: el catálogo MÁS lo que pidió el agente', async () => {
    const { areas } = await aplicarBlueprintDelRitual(dueño(), BLUEPRINT);
    expect(areas).toBe(3);

    const slugs = (await listAreas(dueño())).map((a) => a.slug).sort();
    // `general` (033) trae ventas, operaciones, finanzas, direccion;
    // `seed_always` (090) añade onboarding y rh; y el blueprint mete `servicio`,
    // que no le tocaba por giro pero su agente decidió que la necesita.
    expect(slugs).toContain('servicio');
    expect(slugs).toContain('operaciones');
    expect(slugs).toContain('onboarding');
  });

  it('ve las palabras de SU agente, no las genéricas del catálogo', async () => {
    await aplicarBlueprintDelRitual(dueño(), BLUEPRINT);
    const porSlug = Object.fromEntries((await listAreas(dueño())).map((a) => [a.slug, a]));

    expect(porSlug.ventas?.label).toBe('Ventas y marketing');
    expect(porSlug.rh?.label).toBe('Equipo');
    expect(porSlug.servicio?.blurb).toBe('Dejar de perder clientes por no contestar.');
  });

  it('las áreas nacen en el estado que decidió el agente', async () => {
    await aplicarBlueprintDelRitual(dueño(), BLUEPRINT);
    const porSlug = Object.fromEntries((await listAreas(dueño())).map((a) => [a.slug, a.state]));

    expect(porSlug.ventas).toBe('en_progreso');
    expect(porSlug.servicio).toBe('disponible');
    expect(porSlug.rh).toBe('disponible');
  });

  it('un área que el blueprint inventó igual recibe las herramientas del catálogo', async () => {
    await aplicarBlueprintDelRitual(dueño(), BLUEPRINT);
    const servicio = (await listAreas(dueño())).find((a) => a.slug === 'servicio');

    // Sin esto la tarjeta del mapa no enlazaría a ningún sitio: el agente
    // decide qué áreas necesita el negocio, pero no sabe qué pantallas existen.
    expect(servicio?.tools).toContain('servicio:conversaciones');
    expect(servicio?.icon).not.toBe('wrench');
  });

  it('los requisitos quedan EVALUABLES — el defecto que este archivo existe para evitar', async () => {
    await aplicarBlueprintDelRitual(dueño(), BLUEPRINT);
    const mapa = await loadMap(dueño());
    const ventas = mapa.areas.find((a) => a.slug === 'ventas');

    // Si se hubieran copiado `has_pipeline` / `declares_hiring` tal cual, el
    // candado diría que hay algo que no sabemos leer, y no abriría jamás.
    expect(ventas?.missing.join(' ')).not.toMatch(/no sabe leer/);

    const rh = mapa.areas.find((a) => a.slug === 'rh');
    expect(rh?.state).toBe('disponible');
  });

  it('el roadmap que le propuso el agente aparece, con su origen', async () => {
    const { hitos } = await aplicarBlueprintDelRitual(dueño(), BLUEPRINT);
    expect(hitos).toBe(2);

    const roadmap = await listMilestones(dueño());
    expect(roadmap.map((h) => h.title)).toContain('hacer una lista de precios fija y visible');
    expect(roadmap.find((h) => h.areaSlug === 'rh')?.generatedBy).toBe('master_agent');
  });
});

// ════════════════════════════════════════════════════════════════════════════

describe('idempotencia — el contrato duro de BlueprintSink', () => {
  it('aplicarlo tres veces no duplica un área ni un hito', async () => {
    await aplicarBlueprintDelRitual(dueño(), BLUEPRINT);
    const areas = db.tabla('tenant_areas').length;

    await aplicarBlueprintDelRitual(dueño(), BLUEPRINT);
    await aplicarBlueprintDelRitual(dueño(), BLUEPRINT);

    expect(db.tabla('tenant_areas')).toHaveLength(areas);
    expect(db.tabla('tenant_milestones')).toHaveLength(2);
  });

  it('no le cierra un área que ya estaba usando', async () => {
    await aplicarBlueprintDelRitual(dueño(), BLUEPRINT);

    // El emprendedor terminó el mini-onboarding de Servicio: pasó a `activa`.
    const fila = db.tabla('tenant_areas').find((f) => f.area_slug === 'servicio');
    if (fila) fila.state = 'activa';

    // El blueprint sigue diciendo `disponible`. No la puede bajar.
    await aplicarBlueprintDelRitual(dueño(), BLUEPRINT);
    expect(db.tabla('tenant_areas').find((f) => f.area_slug === 'servicio')?.state).toBe('activa');
  });

  it('no le mueve la fecha en que se ganó el área', async () => {
    await aplicarBlueprintDelRitual(dueño(), BLUEPRINT);
    const primera = db.tabla('tenant_areas').find((f) => f.area_slug === 'rh')?.unlocked_at;
    expect(primera).toBeTruthy();

    await aplicarBlueprintDelRitual(dueño(), BLUEPRINT);
    expect(db.tabla('tenant_areas').find((f) => f.area_slug === 'rh')?.unlocked_at).toBe(primera);
  });

  it('no le borra un hito que él escribió a mano', async () => {
    db.sembrar('tenant_milestones', [
      {
        id: 'mio',
        tenant_id: TENANT_A,
        area_slug: null,
        title: 'Abrir el segundo local',
        description: null,
        position: 1,
        done_at: null,
        generated_by: 'user',
        created_at: new Date().toISOString(),
      },
    ]);

    await aplicarBlueprintDelRitual(dueño(), BLUEPRINT);
    const titulos = (await listMilestones(dueño())).map((h) => h.title);
    expect(titulos).toContain('Abrir el segundo local');
    expect(titulos).toHaveLength(3);
  });
});

// ════════════════════════════════════════════════════════════════════════════

describe('el aislamiento no se afloja por proyectar', () => {
  it('el blueprint de una empresa no toca el mapa de otra', async () => {
    montar(mundo([{ id: TENANT_A, industry: 'general' }, { id: TENANT_B, industry: 'general' }]));

    await aplicarBlueprintDelRitual(dueño(TENANT_A), BLUEPRINT);

    const ajenas = db.tabla('tenant_areas').filter((f) => f.tenant_id === TENANT_B);
    expect(ajenas).toHaveLength(0);
    expect(db.tabla('tenant_milestones').every((h) => h.tenant_id === TENANT_A)).toBe(true);
  });

  it('un blueprint sin forma se rechaza en vez de escribir basura', async () => {
    await expect(aplicarBlueprintDelRitual(dueño(), { areas: [] })).rejects.toThrow();
    expect(db.tabla('tenant_areas')).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════

describe('el puente con el Ritual se enciende al arrancar, nunca en una petición', () => {
  it('sin puente encendido, proyectar no hace NADA y no carga nada', async () => {
    __olvidarPuenteParaPruebas();
    expect(hayPuente()).toBe(false);

    // Devuelve `false` en el acto. Si esto disparara el `import()` de
    // `@abraxa/onboarding`, la primera lectura de un mapa vacío arrastraría el
    // paquete entero del Ritual a cargarse dentro del render — medido en 67 s
    // contra 3 s. Un carril que no está montado no le cuesta nada a otro.
    expect(await proyectarBlueprint(dueño())).toBe(false);
    expect(hayPuente()).toBe(false);
  });

  it('sin puente, el mapa igual se sirve del catálogo del giro', async () => {
    __olvidarPuenteParaPruebas();
    const areas = await listAreas(dueño());
    expect(areas.length).toBeGreaterThan(0);
    expect(areas.map((a) => a.slug)).toContain('ventas');
  });
});
