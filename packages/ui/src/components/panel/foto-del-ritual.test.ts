import { describe, expect, it } from 'vitest';
import { pasosDelRitual, ritualEnPanel, senalesDelRitual } from './lectura-del-ritual';
import { areasDeArranque, requisitosDeArranque } from '../nav/areas-de-arranque';
import { isNavigable } from '../nav/resolve-areas';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El hallazgo 4, convertido en prueba
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  «EL PANEL MIENTE SOBRE LO QUE FALTA: con el Ritual COMPLETO sigue diciendo
 *   "Se abre cuando tu agente termine contigo El bautizo".»
 *
 *  La cadena entera —de lo que contesta la API a lo que se lee bajo el
 *  candado— es lo que se verifica aquí. Cada eslabón por su lado ya estaba
 *  bien; lo que faltaba era engancharlos, así que la prueba que importa es la
 *  de la cadena completa.
 *
 *  Los payloads son los REALES: se consultó producción el 2026-08-01 y se
 *  reprodujeron las dos empresas con Ritual, con sus nombres de agente y su
 *  fase exacta.
 */

/** `GET /onboarding/ritual` para `taqueria-regia-…` — Ritual COMPLETO. */
const LUPITA_COMPLETO = {
  vista: {
    fase: 'sintesis',
    faseIndice: 6,
    fasesTotales: 7,
    progreso: 86,
    tituloDeFase: 'Tu Mapa de Negocio',
    status: 'completada',
    agente: 'Lupita',
    turnos: 21,
    checkpointAt: '2026-08-01T12:29:40.010Z',
    faltante: [],
  },
  memoria:
    'Esto es lo que ya sé de tu negocio:\n' +
    '· Vendes hamburguesas y tienes un local en San Nicolás.\n' +
    '· El viernes de quincena se te junta todo y no te alcanza la plancha.\n' +
    '· Cobras en efectivo y por transferencia, sin terminal.\n',
  ausencia: null,
  mapa: null,
  nuevo: false,
};

/** `GET /onboarding/ritual` para `santiago-alcala-…` — fase 1 de 7 cerrada. */
const CHICA_GUAPA_EMPEZADO = {
  vista: {
    fase: 'identidad',
    faseIndice: 1,
    fasesTotales: 7,
    progreso: 14,
    tituloDeFase: 'Tu negocio',
    status: 'activa',
    agente: 'Chica Guapa',
    turnos: 4,
    checkpointAt: null,
    faltante: ['a qué te dedicas'],
  },
  memoria: '· Le pusiste Chica Guapa a tu agente.\n',
  ausencia: null,
  mapa: null,
  nuevo: false,
};

describe('la foto de H7, traducida', () => {
  it('lee el Ritual completo tal cual está en producción', () => {
    const r = ritualEnPanel(LUPITA_COMPLETO);

    expect(r).not.toBeNull();
    expect(r?.agente).toBe('Lupita');
    expect(r?.status).toBe('completada');
    expect(r?.faseIndice).toBe(6);
    expect(r?.nuevo).toBe(false);
    expect(r?.loQueYaSabe).toHaveLength(3);
    expect(r?.loQueYaSabe[1]).toContain('viernes de quincena');
  });

  it('el progreso de un Ritual COMPLETO es 100, no el 86 que manda la API', () => {
    // La API cuenta 6 de 7 fases cerradas mientras la séptima está en curso, y
    // con `completada` eso dejaría el anillo en 86% para siempre: el
    // emprendedor terminó y el producto le enseña que le falta algo.
    expect(ritualEnPanel(LUPITA_COMPLETO)?.progreso).toBe(100);
  });

  it('el progreso se recalcula por fases cerradas y cuadra con el «llevas X de 7»', () => {
    const r = ritualEnPanel(CHICA_GUAPA_EMPEZADO);
    expect(r?.faseIndice).toBe(1);
    expect(r?.progreso).toBe(14); // round(1/7 * 100)
  });

  it('sin foto no se inventa un avance', () => {
    expect(ritualEnPanel(null)).toBeNull();
    expect(ritualEnPanel(undefined)).toBeNull();
    expect(senalesDelRitual(null)).toBeNull();
  });
});

describe('una API que contesta raro no rompe el panel', () => {
  it('un cuerpo vacío produce el estado más conservador: nadie ha empezado', () => {
    const r = ritualEnPanel({});
    expect(r?.faseIndice).toBe(0);
    expect(r?.fasesTotales).toBe(7);
    expect(r?.progreso).toBe(0);
    expect(r?.nuevo).toBe(true);
    expect(r?.loQueYaSabe).toEqual([]);
  });

  it('un faseIndice mayor que el total se recorta — nunca «llevas 9 de 7»', () => {
    const r = ritualEnPanel({ vista: { faseIndice: 9, fasesTotales: 7, status: 'activa' } });
    expect(r?.faseIndice).toBe(7);
    expect(r?.progreso).toBe(100);
  });

  it('números basura no se pintan', () => {
    const r = ritualEnPanel({
      vista: { faseIndice: -3, fasesTotales: Number.NaN, turnos: Number.POSITIVE_INFINITY },
    } as never);
    expect(r?.faseIndice).toBe(0);
    expect(r?.fasesTotales).toBe(7);
    expect(r?.turnos).toBe(0);
  });

  it('un agente en blanco cuenta como sin nombre, no como un nombre vacío', () => {
    expect(ritualEnPanel({ vista: { agente: '   ' } })?.agente).toBeNull();
  });

  it('`faltante` que no es arreglo se ignora en vez de reventar', () => {
    expect(ritualEnPanel({ vista: { faltante: 'a qué te dedicas' } } as never)?.faltante).toEqual([]);
  });
});

describe('las 7 fichas de `_status`', () => {
  it('las lee tal como las publica la API', () => {
    const pasos = pasosDelRitual({
      ready: true,
      fases: [
        { fase: 'bienvenida', titulo: 'El bautizo', promesa: 'Le pones nombre a tu agente.' },
        { fase: 'identidad', titulo: 'Tu negocio', promesa: 'A qué te dedicas.' },
      ],
      blueprintSink: 'pendiente (H11 · packages/areas)',
    });

    expect(pasos).toHaveLength(2);
    expect(pasos[0]?.titulo).toBe('El bautizo');
  });

  it('descarta las fichas sin fase o sin título en vez de pintar huecos', () => {
    const pasos = pasosDelRitual({
      fases: [{ fase: 'x' }, { titulo: 'y' }, null, 7, { fase: 'ok', titulo: 'Sí' }],
    });
    expect(pasos).toEqual([{ fase: 'ok', titulo: 'Sí', promesa: '' }]);
  });

  it('una respuesta que no trae `fases` da una lista vacía, no una excepción', () => {
    expect(pasosDelRitual(null)).toEqual([]);
    expect(pasosDelRitual({ error: 'boom' })).toEqual([]);
    expect(pasosDelRitual('texto')).toEqual([]);
  });
});

/**
 * ── La cadena completa: de lo que contesta la API a lo que se lee ──────────
 *
 * Es la prueba que hubiera atrapado el hallazgo 4 antes del ensayo.
 */
describe('lo que el emprendedor lee bajo cada candado', () => {
  it('con el Ritual COMPLETO ya nadie le pide El bautizo', () => {
    const senales = senalesDelRitual(ritualEnPanel(LUPITA_COMPLETO));
    const requisitos = requisitosDeArranque(senales);

    for (const [slug, frase] of Object.entries(requisitos)) {
      expect(frase, `${slug} sigue pidiendo una fase del Ritual ya terminado`).not.toContain(
        'El bautizo',
      );
      expect(frase, `${slug} sigue mandando al Ritual, que ya terminó`).not.toContain('Ritual');
    }
  });

  it('con el Ritual COMPLETO, Ventas está abierta', () => {
    const senales = senalesDelRitual(ritualEnPanel(LUPITA_COMPLETO));
    const ventas = areasDeArranque(senales).find((a) => a.slug === 'ventas');

    expect(ventas).toBeDefined();
    expect(isNavigable(ventas!)).toBe(true);
  });

  it('lo que sigue cerrado dice la verdad: lo estamos construyendo nosotros', () => {
    const senales = senalesDelRitual(ritualEnPanel(LUPITA_COMPLETO));
    const requisitos = requisitosDeArranque(senales);

    // Las tres que no están construidas, y ninguna le echa la culpa al invitado.
    expect(Object.keys(requisitos).sort()).toEqual(['direccion', 'finanzas', 'operaciones']);
    for (const frase of Object.values(requisitos)) {
      expect(frase).toContain('es cosa nuestra, no tuya');
    }
  });

  it('con UNA fase cerrada, Ventas ya abrió y el nombre del agente entra en el candado', () => {
    const senales = senalesDelRitual(ritualEnPanel(CHICA_GUAPA_EMPEZADO));
    const areas = areasDeArranque(senales);
    const requisitos = requisitosDeArranque(senales);

    expect(isNavigable(areas.find((a) => a.slug === 'ventas')!)).toBe(true);
    // Dirección está sin construir, así que su motivo NO puede ser el Ritual:
    // prometerle que se abre contestando sería una promesa incumplible.
    expect(requisitos.direccion).toContain('es cosa nuestra, no tuya');
  });

  it('SIN Ritual todavía, nada está abierto y el candado invita a empezar', () => {
    const senales = senalesDelRitual(ritualEnPanel(null));
    const areas = areasDeArranque(senales);
    const requisitos = requisitosDeArranque(senales);

    expect(areas.every((a) => !isNavigable(a))).toBe(true);
    expect(requisitos.ventas).toContain('«El bautizo»');
    expect(requisitos.ventas).toContain('tu agente');
  });

  it('el shell y el panel calculan lo mismo a partir de la misma foto', () => {
    // Es la garantía de que la barra lateral y el mosaico no se contradigan.
    const foto = LUPITA_COMPLETO;
    const a = areasDeArranque(senalesDelRitual(ritualEnPanel(foto)));
    const b = areasDeArranque(senalesDelRitual(ritualEnPanel(foto)));
    expect(a).toEqual(b);
  });
});
