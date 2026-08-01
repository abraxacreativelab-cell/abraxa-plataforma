/**
 * Los criterios #5, #6 y #8 del handoff — sin base, sin red, sin tokens.
 *
 * Que se puedan probar así es la razón de que `aplicarTurno` sea una función
 * pura: son las tres reglas que más fácil se degradan en silencio, y una regla
 * que sólo se puede verificar a mano se degrada.
 */
import { describe, expect, it } from 'vitest';
import { aplicarTurno } from './maquina';
import { limpiarMarcadores, leerMarcadores, tieneMarcadores } from './marcadores';
import { faltantesDe, puedeCerrar } from './cierre';
import type { EstadoNegocio } from '../types';

const NEGOCIO_COMPLETO: EstadoNegocio = {
  agente: 'Aura',
  giro: 'panadería',
  nicho: 'cafeterías',
  etapa: 'operando',
  tamano: '12 clientes',
  modeloIngreso: 'pedido semanal',
  ticket: '4,500',
  margen: '35%',
  canales: ['whatsapp'],
  recorrido: [{ nombre: 'contacto' }, { nombre: 'cotiza' }, { nombre: 'entrega' }],
  herramientas: ['whatsapp'],
};

describe('criterio #5 — los marcadores nunca se ven', () => {
  it('borra todos los marcadores conocidos', () => {
    const cruda = `Perfecto, anotado.
[DATO:giro=panadería][LISTA:canales=whatsapp][PASO:cotiza|de memoria]
[DOLOR:se le pierden pedidos|ventas][HITO:ventas|Ordenar los pedidos|Hoy se pierden]
[AREA:ventas|disponible|vende por WhatsApp][FASE_COMPLETA:identidad][PAUSA][MAPA_LISTO]

¿Cuánto cobras?`;

    const visible = limpiarMarcadores(cruda);
    expect(visible).toBe('Perfecto, anotado.\n\n¿Cuánto cobras?');
    expect(tieneMarcadores(visible)).toBe(false);
  });

  it('borra también los marcadores MALFORMADOS', () => {
    // Es el caso peligroso: el parser no lo entiende, así que si el limpiador
    // se basara en la misma gramática estricta, este corchete acabaría en la
    // pantalla del cliente.
    const visible = limpiarMarcadores('Va. [DATO:giro sin igual] [FASE_COMPLETA:] listo');
    expect(visible).toBe('Va. listo');
  });

  it('barre los marcadores que el modelo se inventa', () => {
    const visible = limpiarMarcadores('Bien. [GUARDAR_TODO:si] [NOTA_INTERNA] Sigamos.');
    expect(visible).toBe('Bien. Sigamos.');
  });

  it('no se come el texto normal entre corchetes', () => {
    const visible = limpiarMarcadores('Dijiste [textualmente] que cobras por [pedido].');
    expect(visible).toBe('Dijiste [textualmente] que cobras por [pedido].');
  });

  it('lo que se guarda en el transcript es lo que se vio', () => {
    const r = aplicarTurno('identidad', {}, 'Listo. [DATO:giro=taller][FASE_COMPLETA:identidad]');
    expect(r.visible).toBe('Listo.');
    expect(tieneMarcadores(r.visible)).toBe(false);
  });
});

describe('criterio #6 — una fase no avanza sin sus datos', () => {
  it('ignora [FASE_COMPLETA] cuando falta información', () => {
    const r = aplicarTurno('identidad', {}, 'Ya te entendí. [DATO:giro=taller][FASE_COMPLETA:identidad]');

    expect(r.fase).toBe('identidad');
    expect(r.avanzo).toBe(false);
    expect(r.cierreDenegado).toBe(true);
    // El dato SÍ se guardó: no avanzar no significa tirar lo que ya se supo.
    expect(r.estado.giro).toBe('taller');
  });

  it('avanza cuando la fase reúne todo', () => {
    const cruda =
      '[DATO:giro=taller][DATO:nicho=flotillas][DATO:etapa=operando][DATO:tamano=30 al mes][FASE_COMPLETA:identidad]';
    const r = aplicarTurno('identidad', {}, cruda);

    expect(r.fase).toBe('modelo');
    expect(r.avanzo).toBe(true);
    expect(r.cierreDenegado).toBe(false);
  });

  it('no acepta que el modelo cierre una fase distinta a la que va', () => {
    const r = aplicarTurno('identidad', NEGOCIO_COMPLETO, 'Va. [FASE_COMPLETA:modelo]');
    expect(r.fase).toBe('identidad');
    expect(r.avanzo).toBe(false);
  });

  it('dice exactamente qué falta, en palabras que el agente puede usar', () => {
    expect(faltantesDe('modelo', { ticket: '500' })).toEqual([
      'cómo gana dinero exactamente',
      'qué margen le deja, aunque sea aproximado',
      'por dónde le llegan los clientes hoy',
    ]);
  });

  it('el proceso exige un recorrido de verdad, no una anécdota', () => {
    const dosPasos: EstadoNegocio = {
      recorrido: [{ nombre: 'me escriben' }, { nombre: 'les vendo' }],
      herramientas: ['whatsapp'],
    };
    expect(puedeCerrar('proceso', dosPasos)).toBe(false);
    expect(
      puedeCerrar('proceso', {
        ...dosPasos,
        recorrido: [...(dosPasos.recorrido ?? []), { nombre: 'entrego' }],
      }),
    ).toBe(true);
  });
});

describe('criterio #8 — la fase 4 saca algo que él no pidió', () => {
  it('no cierra la fase de dolor si sólo se recogieron quejas', () => {
    const conDolores: EstadoNegocio = {
      dolores: [{ texto: 'me falta tiempo' }, { texto: 'cobro tarde' }],
    };
    expect(puedeCerrar('dolor', conDolores)).toBe(false);
    expect(faltantesDe('dolor', conDolores)).toEqual([
      'al menos un hueco que TÚ detectaste atacando su proceso y que él no había pedido',
    ]);
  });

  it('un hito nacido en la fase 4 se marca como del abogado del diablo', () => {
    const r = aplicarTurno(
      'dolor',
      { dolores: [{ texto: 'uno' }, { texto: 'dos' }] },
      '[HITO:ventas|Los pedidos del domingo entran solos|hoy dependen de que él lea todo][FASE_COMPLETA:dolor]',
    );

    expect(r.estado.hitos?.[0]?.origen).toBe('abogado_del_diablo');
    expect(r.avanzo).toBe(true);
    expect(r.fase).toBe('gente');
  });

  it('el mismo hito en otra fase NO se atribuye al abogado del diablo', () => {
    const r = aplicarTurno('proceso', {}, '[HITO:ventas|Ordenar los pedidos|porque él lo pidió]');
    expect(r.estado.hitos?.[0]?.origen).toBe('emprendedor');
  });

  it('el modelo puede corregir la atribución si de verdad lo pidió el dueño', () => {
    const r = aplicarTurno('dolor', {}, '[HITO:ventas|Un catálogo en PDF|lo pidió él|emprendedor]');
    expect(r.estado.hitos?.[0]?.origen).toBe('emprendedor');
  });
});

describe('acumulación de datos entre turnos', () => {
  it('el recorrido se enriquece en vez de duplicarse', () => {
    const uno = aplicarTurno('proceso', {}, '[PASO:Cotización]');
    const dos = aplicarTurno('proceso', uno.estado, '[PASO:cotizacion|con calculadora]');

    expect(dos.estado.recorrido).toHaveLength(1);
    expect(dos.estado.recorrido?.[0]?.como).toBe('con calculadora');
  });

  it('las listas se unen sin repetir, aunque cambien los acentos', () => {
    const uno = aplicarTurno('modelo', {}, '[LISTA:canales=WhatsApp, Recomendación]');
    const dos = aplicarTurno('modelo', uno.estado, '[LISTA:canales=whatsapp, instagram]');

    expect(dos.estado.canales).toEqual(['WhatsApp', 'Recomendación', 'instagram']);
  });

  it('un dato sin campo propio no se tira: cae en extra', () => {
    const r = aplicarTurno('identidad', {}, '[DATO:temporada_fuerte=diciembre]');
    expect(r.estado.extra?.temporada_fuerte).toBe('diciembre');
  });

  it('un marcador de área con estado inválido se ignora', () => {
    const r = aplicarTurno('sintesis', {}, '[AREA:ventas|encendida|porque sí][AREA:rh|bloqueada|está solo]');
    expect(r.estado.areasPropuestas).toEqual([
      { slug: 'rh', estado: 'bloqueada', razon: 'está solo' },
    ]);
  });
});

describe('el parser', () => {
  it('respeta los = que vienen dentro del valor', () => {
    const s = leerMarcadores('[DATO:modelo_ingreso=comisión = 10% del cierre]');
    expect(s.datos.modelo_ingreso).toBe('comisión = 10% del cierre');
  });

  it('parte una lista escrita en un solo marcador', () => {
    const s = leerMarcadores('[LISTA:herramientas=excel, whatsapp,  libreta ]');
    expect(s.listas.herramientas).toEqual(['excel', 'whatsapp', 'libreta']);
  });

  it('ignora una fase inventada', () => {
    expect(leerMarcadores('[FASE_COMPLETA:facturacion]').faseCompleta).toBeUndefined();
  });
});
