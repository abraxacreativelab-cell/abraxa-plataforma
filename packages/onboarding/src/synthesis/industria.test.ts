/**
 * ════════════════════════════════════════════════════════════════════════════
 *  `tenants.industry_type` apunta a una fila, no a un slug bonito.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * El defecto del PR #8: H7 escribía ahí el giro del emprendedor normalizado a
 * slug —`panaderia-artesanal`, `taller-mecanico`— cuando la migración 033 dice
 * que esa columna apunta a `app.industry_templates.id`, con cinco filas ya
 * sembradas. Nadie se queja: no hay FK. Lo que falla es `detectGaps()` de la
 * bóveda, que busca la plantilla por ese id, no la encuentra y devuelve vacío
 * — y el agente maestro deja de saber qué le falta preguntar.
 *
 * Las plantillas de abajo son copia literal de los `id`, `name` y `blurb` de la
 * migración 033. No es duplicación de lógica: es la entrada de la prueba, y si
 * H4 cambia esos textos, lo que se rompe aquí es exactamente lo que hay que
 * volver a mirar.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __setClientForTests } from '@abraxa/db';
import type { AnyClient } from '@abraxa/db';
import { crearFakeDb, type Fila } from '../testing/fake-db';
import { ctxDePrueba } from '../testing/agente-falso';
import { elegirPlantilla, plantillasDeGiro, slugDelGiro, tipoDeIndustria } from './industria';
import { construirMapa } from './mapa';
import { sembrarGiro } from './entrega';

/** Las cinco filas de la migración 033, tal cual. */
const CATALOGO: Fila[] = [
  {
    id: 'servicios',
    name: 'Servicios profesionales',
    blurb:
      'Despachos, consultorios, talleres, salones, estudios. Cobras por tu trabajo o por hora.',
    position: 1,
  },
  {
    id: 'comercio',
    name: 'Comercio y tienda en linea',
    blurb: 'Vendes producto: local, tienda en linea, marketplace o las tres.',
    position: 2,
  },
  {
    id: 'restaurante',
    name: 'Restaurante y cafeteria',
    blurb: 'Cocinas y vendes en el momento: local, para llevar o reparto.',
    position: 3,
  },
  {
    id: 'agencia',
    name: 'Agencia o estudio',
    blurb:
      'Vendes trabajo por proyecto o por iguala: marketing, diseno, software, contabilidad.',
    position: 4,
  },
  {
    id: 'general',
    name: 'Otro giro',
    blurb: 'Lo minimo que todo negocio necesita tener claro, sea cual sea su giro.',
    position: 9,
  },
];

const PLANTILLAS = CATALOGO.map((f) => ({
  id: f.id as string,
  name: f.name as string,
  blurb: f.blurb as string,
}));

// ═════════════════════════════════════════════════════════════════════════════
describe('el giro se resuelve contra el catálogo', () => {
  it('el id exacto gana sin más ceremonia', () => {
    expect(elegirPlantilla('restaurante', PLANTILLAS).id).toBe('restaurante');
    expect(elegirPlantilla('  Servicios  ', PLANTILLAS).id).toBe('servicios');
  });

  it('reconoce el giro por las palabras del propio catálogo', () => {
    // "talleres" y "salones" salen del blurb de `servicios`; "tienda" y "linea"
    // del de `comercio`. No hay un diccionario de sinónimos escrito en H7: si
    // H4 agrega una fila, sus palabras empiezan a contar sin tocar este código.
    expect(elegirPlantilla('taller mecánico', PLANTILLAS).id).toBe('servicios');
    expect(elegirPlantilla('salón de belleza', PLANTILLAS).id).toBe('servicios');
    expect(elegirPlantilla('tienda de ropa en línea', PLANTILLAS).id).toBe('comercio');
    expect(elegirPlantilla('cafetería', PLANTILLAS).id).toBe('restaurante');
    expect(elegirPlantilla('agencia de marketing digital', PLANTILLAS).id).toBe('agencia');
    expect(elegirPlantilla('despacho contable', PLANTILLAS).id).toBe('servicios');
  });

  it('NUNCA devuelve un slug que no exista en el catálogo', () => {
    const ids = new Set(PLANTILLAS.map((p) => p.id));

    for (const giro of [
      'panadería artesanal',
      'taller mecánico',
      'consultoría de marca',
      'renta de andamios',
      'restaurante de mariscos',
      'lo que sea',
    ]) {
      const r = elegirPlantilla(giro, PLANTILLAS);
      // El bug era exactamente esto: `panaderia-artesanal` pasaba por bueno.
      expect(r.id === null || ids.has(r.id)).toBe(true);
      expect(r.id).not.toBe(slugDelGiro(giro));
    }
  });

  it('lo que no reconoce queda en null, y con su razón escrita', () => {
    const r = elegirPlantilla('panadería artesanal', PLANTILLAS);

    expect(r.id).toBeNull();
    // La razón es lo que se "anota": nombra el giro literal y qué había para
    // escoger, que es lo que hace falta para decidir si al catálogo le falta
    // una fila o si a la fila le faltan palabras.
    expect(r.razon).toContain('panadería artesanal');
    expect(r.razon).toContain('servicios, comercio, restaurante, agencia, general');
  });

  it('un empate no se resuelve a la suerte: queda en null', () => {
    // "taller" es de `servicios` y "tienda" es de `comercio`. Elegir una de las
    // dos sería inventar; el emprendedor merece que se le pregunte, no que se
    // le adivine.
    const r = elegirPlantilla('taller y tienda de bicicletas', PLANTILLAS);
    expect(r.id).toBeNull();
    expect(r.razon).toContain('empataron');
  });

  it('las palabras que comparten dos plantillas no votan', () => {
    // "local" está en el blurb de `comercio` y en el de `restaurante`, así que
    // no distingue nada. Sola, no debe decidir.
    expect(elegirPlantilla('un local', PLANTILLAS).id).toBeNull();
  });

  it('el comodín no se gana por parecido de palabras', () => {
    // El blurb de `general` habla de "todo negocio": describe a cualquiera. Si
    // votara, se llevaría media entrevista por accidente.
    expect(elegirPlantilla('mi negocio', PLANTILLAS).id).toBeNull();
    expect(elegirPlantilla('otro giro más', PLANTILLAS).id).toBeNull();
    // Pero pedirla por su id sí funciona: es una elección, no un accidente.
    expect(elegirPlantilla('general', PLANTILLAS).id).toBe('general');
  });

  it('sin catálogo no se inventa nada', () => {
    const r = elegirPlantilla('restaurante', []);
    expect(r.id).toBeNull();
    expect(r.razon).toContain('vacío');
  });

  it('sin giro tampoco', () => {
    expect(tipoDeIndustria({}, PLANTILLAS)).toBeNull();
    expect(tipoDeIndustria({ giro: '   ' }, PLANTILLAS)).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('de la entrevista a app.tenants', () => {
  let db: ReturnType<typeof crearFakeDb>;
  let restaurar: () => void;

  beforeEach(() => {
    db = crearFakeDb({
      tenants: [{ id: 'tenant-a', slug: 'tenant-a', name: 'Prueba' }],
      industry_templates: CATALOGO,
    });
    restaurar = __setClientForTests(db.cliente);
  });

  afterEach(() => restaurar());

  it('lee el catálogo que HAY, no una lista copiada aquí', async () => {
    const plantillas = await plantillasDeGiro();
    expect(plantillas.map((p) => p.id)).toEqual([
      'servicios',
      'comercio',
      'restaurante',
      'agencia',
      'general',
    ]);
  });

  it('un giro reconocido aterriza como id de plantilla, no como slug', async () => {
    const plantillas = await plantillasDeGiro();
    const mapa = construirMapa({ giro: 'restaurante de mariscos' }, plantillas);

    expect(mapa.industryType).toBe('restaurante');

    await sembrarGiro(ctxDePrueba(), mapa, { etapa: 'operando' });

    const empresa = db.filas('tenants')[0];
    expect(empresa?.industry_type).toBe('restaurante');
    expect(empresa?.stage).toBe('operando');
  });

  it('un giro que el catálogo no reconoce deja la columna en paz', async () => {
    const plantillas = await plantillasDeGiro();
    const mapa = construirMapa({ giro: 'panadería artesanal' }, plantillas);

    expect(mapa.industryType).toBeNull();

    await sembrarGiro(ctxDePrueba(), mapa, { etapa: 'operando' });

    const empresa = db.filas('tenants')[0];
    // Ni `panaderia-artesanal` ni un `general` de consuelo: vacía y visible.
    expect(empresa?.industry_type).toBeUndefined();
    // Y lo que sí se supo sigue escribiéndose.
    expect(empresa?.stage).toBe('operando');
    // El giro literal no se pierde: viaja en el documento madre.
    expect(mapa.resumen).toContain('panadería artesanal');
  });

  it('si el catálogo no responde, el mapa sale con null y no se cae', async () => {
    restaurar();
    // Un cliente que revienta al leer: es el caso "la tabla no contesta". El
    // último turno del Ritual es el pago de 20 minutos de entrevista y no puede
    // convertirse en "algo salió mal" porque un catálogo esté caído.
    restaurar = __setClientForTests({
      from: () => {
        throw new Error('sin conexión');
      },
    } as unknown as AnyClient);

    expect(await plantillasDeGiro()).toEqual([]);

    const mapa = construirMapa({ giro: 'restaurante' }, await plantillasDeGiro());
    expect(mapa.industryType).toBeNull();
    expect(mapa.areas.length).toBeGreaterThan(0);
    expect(mapa.resumen).toContain('restaurante');
  });
});
