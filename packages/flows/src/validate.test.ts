/**
 * El validador, alimentado con propuestas MALAS A PROPÓSITO.
 *
 * Es lo que la §9 del handoff identifica como la pieza que de verdad ejercita
 * el criterio #1: sin llaves de ningún proveedor, lo que hace segura a una
 * propuesta de IA no es el modelo — es que nada llegue a la base sin pasar por
 * aquí. Así que estas pruebas no le dan flujos bonitos.
 */
import { describe, expect, it } from 'vitest';
import { tieneCiclo, validar, validarSemantica } from './validate';
import type { CatalogoDelTenant, Propuesta } from './validate';

const CATALOGO: CatalogoDelTenant = {
  etapas: [
    { id: 'et-1', slug: 'nuevo', name: 'Nuevo', pipelineSlug: 'ventas' },
    { id: 'et-2', slug: 'contactado', name: 'Contactado', pipelineSlug: 'ventas' },
  ],
  etiquetas: [],
  miembros: [{ email: 'ana@abraxa.club', name: 'Ana' }],
};

/** El flujo del ejemplo del handoff, bien armado. */
function flujoBueno(): Propuesta {
  return {
    name: 'Lead nuevo por la página',
    description: 'Le escribe y lo mueve a Contactado',
    trigger_type: 'contact_created',
    trigger_config: {},
    definition: {
      nodes: [
        { id: 'inicio', type: 'trigger', data: {} },
        {
          id: 'saludo',
          type: 'send_message',
          data: { config: { channel: 'whatsapp', to: 'contact', template: 'Hola {nombre}' } },
        },
        { id: 'mover', type: 'move_stage', data: { config: { stage: 'contactado' } } },
        { id: 'fin', type: 'end', data: {} },
      ],
      edges: [
        { id: 'e1', source: 'inicio', target: 'saludo' },
        { id: 'e2', source: 'saludo', target: 'mover' },
        { id: 'e3', source: 'mover', target: 'fin' },
      ],
    },
    notes: null,
  } as Propuesta;
}

describe('validar — la forma', () => {
  it('acepta el flujo del ejemplo del handoff', () => {
    const r = validar(flujoBueno(), CATALOGO);
    expect(r.errores).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('rechaza un tipo de nodo inventado: el catálogo es CERRADO', () => {
    const malo = flujoBueno();
    (malo.definition.nodes[1] as { type: string }).type = 'ejecutar_codigo';
    const r = validar(malo, CATALOGO);
    expect(r.ok).toBe(false);
    expect(r.errores.join(' ')).toMatch(/type/);
  });

  it('rechaza un disparador que no está en los ocho', () => {
    const malo = { ...flujoBueno(), trigger_type: 'cuando_yo_quiera' };
    expect(validar(malo, CATALOGO).ok).toBe(false);
  });
});

describe('validar — la semántica, con propuestas malas a propósito', () => {
  it('la que INVENTA UN ID de etapa', () => {
    const malo = flujoBueno();
    malo.definition.nodes[2]!.data = { config: { stage: 'super-contactado' } };
    const r = validar(malo, CATALOGO);
    expect(r.ok).toBe(false);
    // El mensaje le dice al emprendedor cuáles SÍ tiene.
    expect(r.errores.join(' ')).toContain('super-contactado');
    expect(r.errores.join(' ')).toContain('contactado');
  });

  it('la que trae UN CICLO', () => {
    const malo = flujoBueno();
    malo.definition.edges.push({ id: 'e4', source: 'fin', target: 'saludo' });
    const r = validar(malo, CATALOGO);
    expect(r.ok).toBe(false);
    expect(r.errores.some((e) => e.includes('ciclo'))).toBe(true);
  });

  it('la que deja UNA RAMA COLGANDO en una condición', () => {
    const malo = flujoBueno();
    malo.definition.nodes.push({
      id: 'si',
      type: 'condition',
      data: { config: { field: 'etapa', op: 'eq', value: 'nuevo' } },
    });
    malo.definition.edges.push({ id: 'e5', source: 'mover', target: 'si' });
    // sólo la rama del sí
    malo.definition.edges.push({ id: 'e6', source: 'si', target: 'fin', sourceHandle: 'yes' });
    const r = validar(malo, CATALOGO);
    expect(r.ok).toBe(false);
    expect(r.errores.some((e) => e.includes('las dos salidas'))).toBe(true);
  });

  it('la que asigna a alguien que NO ES DEL EQUIPO', () => {
    const malo = flujoBueno();
    malo.definition.nodes.push({
      id: 'dueno',
      type: 'assign_owner',
      data: { config: { owner_email: 'intruso@otraempresa.com' } },
    });
    malo.definition.edges.push({ id: 'e7', source: 'mover', target: 'dueno' });
    const r = validar(malo, CATALOGO);
    expect(r.ok).toBe(false);
    expect(r.errores.join(' ')).toContain('intruso@otraempresa.com');
  });

  it('la que deja un paso HUÉRFANO, al que no se llega desde el disparador', () => {
    const malo = flujoBueno();
    malo.definition.nodes.push({ id: 'suelto', type: 'add_tag', data: { config: { tag: 'vip' } } });
    const r = validar(malo, CATALOGO);
    expect(r.ok).toBe(false);
    expect(r.errores.some((e) => e.includes('suelto'))).toBe(true);
  });

  it('la que pone DOS DISPARADORES', () => {
    const malo = flujoBueno();
    malo.definition.nodes.push({ id: 'otro-inicio', type: 'trigger', data: {} });
    malo.definition.edges.push({ id: 'e8', source: 'otro-inicio', target: 'fin' });
    const r = validar(malo, CATALOGO);
    expect(r.ok).toBe(false);
    expect(r.errores.some((e) => e.includes('exactamente 1'))).toBe(true);
  });

  it('la que conecta DOS SALIDAS al mismo puerto de un paso normal', () => {
    const malo = flujoBueno();
    malo.definition.edges.push({ id: 'e9', source: 'saludo', target: 'fin' });
    const r = validar(malo, CATALOGO);
    expect(r.ok).toBe(false);
    expect(r.errores.some((e) => e.includes('dos conexiones'))).toBe(true);
  });

  it('la que apunta el webhook a la RED INTERNA', () => {
    const malo = flujoBueno();
    malo.definition.nodes.push({
      id: 'gancho',
      type: 'webhook',
      data: { config: { url: 'http://169.254.169.254/latest/meta-data/' } },
    });
    malo.definition.edges.push({ id: 'e10', source: 'mover', target: 'gancho' });
    const r = validar(malo, CATALOGO);
    expect(r.ok).toBe(false);
    expect(r.errores.some((e) => e.includes('interna o privada'))).toBe(true);
  });

  it('la que manda un mensaje SIN DECIR QUÉ', () => {
    const malo = flujoBueno();
    malo.definition.nodes[1]!.data = { config: { channel: 'whatsapp', template: '   ' } };
    expect(validar(malo, CATALOGO).ok).toBe(false);
  });

  it('la que espera CERO minutos', () => {
    const malo = flujoBueno();
    malo.definition.nodes.push({ id: 'esperar', type: 'wait', data: { config: { minutes: 0 } } });
    malo.definition.edges.push({ id: 'e11', source: 'mover', target: 'esperar' });
    const r = validar(malo, CATALOGO);
    expect(r.ok).toBe(false);
    expect(r.errores.some((e) => e.includes('minutos'))).toBe(true);
  });

  it('acumula TODOS los errores en una pasada, no sólo el primero', () => {
    const malo = flujoBueno();
    malo.definition.nodes[1]!.data = { config: { channel: 'paloma-mensajera', template: '' } };
    malo.definition.nodes[2]!.data = { config: { stage: 'inventada' } };
    const r = validar(malo, CATALOGO);
    expect(r.errores.length).toBeGreaterThanOrEqual(3);
  });
});

describe('el catálogo vacío no invalida nada', () => {
  it('un tenant recién creado, sin embudo, puede guardar su flujo', () => {
    // Rechazar por esto convertiría "todavía no configuras tu embudo" en "tu
    // flujo está mal", que es una acusación distinta y falsa.
    const r = validar(flujoBueno(), { etapas: [], etiquetas: [], miembros: [] });
    expect(r.ok).toBe(true);
  });
});

describe('tieneCiclo', () => {
  it('encuentra un ciclo que no toca el disparador', () => {
    expect(
      tieneCiclo({
        nodes: [
          { id: 'a', type: 'trigger' },
          { id: 'b', type: 'end' },
          { id: 'c', type: 'end' },
        ],
        edges: [
          { source: 'b', target: 'c' },
          { source: 'c', target: 'b' },
        ],
      }),
    ).toBe(true);
  });

  it('un rombo (dos caminos que se vuelven a juntar) NO es un ciclo', () => {
    // Es el error clásico de un detector escrito con "ya lo visité": un nodo
    // alcanzable por dos ramas no es una vuelta atrás.
    expect(
      tieneCiclo({
        nodes: [
          { id: 'a', type: 'condition' },
          { id: 'b', type: 'end' },
          { id: 'c', type: 'end' },
          { id: 'd', type: 'end' },
        ],
        edges: [
          { source: 'a', target: 'b', sourceHandle: 'yes' },
          { source: 'a', target: 'c', sourceHandle: 'no' },
          { source: 'b', target: 'd' },
          { source: 'c', target: 'd' },
        ],
      }),
    ).toBe(false);
  });

  it('aguanta una cadena larga sin desbordar la pila', () => {
    const nodes = Array.from({ length: 500 }, (_, i) => ({ id: `n${i}`, type: 'end' as const }));
    const edges = Array.from({ length: 499 }, (_, i) => ({ source: `n${i}`, target: `n${i + 1}` }));
    expect(tieneCiclo({ nodes, edges })).toBe(false);
  });
});

describe('validarSemantica sin catálogo', () => {
  it('sigue exigiendo lo que no depende de la empresa', () => {
    const errs = validarSemantica(
      {
        ...flujoBueno(),
        definition: { nodes: [{ id: 'x', type: 'end', data: {} }], edges: [] },
      } as Propuesta,
      { etapas: [], etiquetas: [], miembros: [] },
    );
    expect(errs.some((e) => e.includes('exactamente 1'))).toBe(true);
  });
});
