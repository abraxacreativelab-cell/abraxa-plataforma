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
import { FASES, indiceDeFase } from './fases';
import type { EstadoNegocio, Fase } from '../types';

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

  it('nunca salta a una fase que no es la siguiente, aunque el modelo lo pida', () => {
    // El modelo despistado pide cerrar 'modelo' estando en 'identidad'. Su
    // petición no elige destino: la única transición posible es a la fase
    // inmediatamente siguiente, y ocurre por los datos, no por el corchete.
    const r = aplicarTurno('identidad', NEGOCIO_COMPLETO, 'Va. [FASE_COMPLETA:modelo]');
    expect(r.fase).toBe('modelo');
    expect(FASES[indiceDeFase('identidad') + 1]).toBe('modelo');
  });
});

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El defecto que mató el Ritual en producción: la fase no avanzaba nunca.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Medido en vivo el 2026-07-31: la fase 'bienvenida' —que pide UN dato— duró 10
 * turnos con el agente ya bautizado y `faltante=[]`; 'proceso' se atoró 6 turnos
 * más con todo reunido. Nunca llegó al Mapa de Negocio.
 *
 * La causa era que `avanzo` exigía `[FASE_COMPLETA:x]`, y la familia Claude —la
 * configurada por defecto en `DEFAULT_MODEL_BY_ROLE.master`— no lo emite. Se
 * probó con el prompt EXACTO del sistema contra tres modelos: claude-sonnet-4.5
 * → 0 marcadores, claude-haiku-4.5 → 0, gpt-4.1 → sí.
 *
 * Un producto no puede depender de que el modelo se acuerde de escribir un
 * corchete. Y no hacía falta que dependiera: el propio archivo ya decía que
 * «`[FASE_COMPLETA:x]` es una PETICIÓN; quien decide es `puedeCerrar()`». Sólo
 * que la petición además era obligatoria, así que quien decidía de verdad era
 * el modelo. Ahora ya no.
 */
describe('el avance no depende de que el modelo emita el marcador', () => {
  it('avanza en cuanto la fase reúne sus datos, SIN [FASE_COMPLETA]', () => {
    const r = aplicarTurno('bienvenida', {}, 'Me encanta el nombre. [DATO:agente=Tacha]');

    expect(r.estado.agente).toBe('Tacha');
    expect(r.fase).toBe('identidad');
    expect(r.avanzo).toBe(true);
  });

  it('sigue sin avanzar si los datos no están, con marcador o sin él', () => {
    const sin = aplicarTurno('identidad', {}, 'Cuéntame más. [DATO:giro=taller]');
    expect(sin.fase).toBe('identidad');
    expect(sin.avanzo).toBe(false);

    const con = aplicarTurno('identidad', {}, 'Ya. [DATO:giro=taller][FASE_COMPLETA:identidad]');
    expect(con.fase).toBe('identidad');
    expect(con.avanzo).toBe(false);
  });

  it('llega hasta la síntesis con puros datos, sin un solo marcador de fase', () => {
    // El camino completo del invitado del evento, turno por turno. Si esto se
    // pone rojo, nadie vuelve a ver un Mapa de Negocio.
    const turnos: Array<{ fase: Fase; cruda: string }> = [
      { fase: 'bienvenida', cruda: '[DATO:agente=Tacha]' },
      {
        fase: 'identidad',
        cruda:
          '[DATO:giro=taquería][DATO:nicho=oficinistas][DATO:etapa=operando][DATO:tamano=80 al día]',
      },
      {
        fase: 'modelo',
        cruda:
          '[DATO:modelo_ingreso=venta en mostrador][DATO:ticket=120][DATO:margen=40%][LISTA:canales=whatsapp, mostrador]',
      },
      {
        fase: 'proceso',
        cruda:
          '[PASO:llegan|de boca en boca][PASO:piden|en el mostrador][PASO:pagan|efectivo][LISTA:herramientas=libreta]',
      },
      {
        fase: 'dolor',
        cruda:
          '[DOLOR:pierde pedidos del WhatsApp|ventas][DOLOR:no sabe qué se vende más|direccion]' +
          '[HITO:ventas|Los pedidos de WhatsApp entran solos|hoy se le pierden]',
      },
      { fase: 'gente', cruda: '[DATO:equipo=él y dos ayudantes]' },
    ];

    let estado: EstadoNegocio = {};
    let fase: Fase = 'bienvenida';

    for (const t of turnos) {
      expect(fase).toBe(t.fase);
      const r = aplicarTurno(fase, estado, `Va. ${t.cruda}`);
      expect(r.avanzo).toBe(true);
      estado = r.estado;
      fase = r.fase;
    }

    expect(fase).toBe('sintesis');
  });

  it('la síntesis no avanza a ningún lado: es la última', () => {
    const r = aplicarTurno('sintesis', NEGOCIO_COMPLETO, 'Aquí está tu mapa. [MAPA_LISTO]');
    expect(r.fase).toBe('sintesis');
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
