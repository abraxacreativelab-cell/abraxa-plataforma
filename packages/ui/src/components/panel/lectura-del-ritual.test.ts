/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El encargo #3: «que se vea impresionante con poco» — sin inventar un dato
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  El panel sólo puede enseñar lo que de verdad existe. Estas pruebas defienden
 *  las dos mitades de esa promesa:
 *
 *   · que lo que hay se lea bien (las frases del agente, la fase correcta, la
 *     llamada que corresponde a cada uno de los cuatro estados de la sesión)
 *   · que lo que NO hay no se rellene con un cero, un guion o un `undefined`
 *
 *  La entrada de `loQueYaSabe` es literal: el `memoria` que devuelve
 *  `GET /onboarding/ritual` para la única empresa que hay en producción, con el
 *  giro que el agente le sacó a Santiago el 2026-08-01.
 */

import { describe, expect, it } from 'vitest';
import {
  type PasoDelRitual,
  type RitualEnPanel,
  areasQueAbreLaSiguienteFase,
  hitosDelRitual,
  llamadaDelPanel,
  loQueYaSabe,
  nombreDelAgente,
} from './lectura-del-ritual';
import { AREAS_DE_ARRANQUE } from '../nav/areas-de-arranque';

/** Las 7 fases con su copy, textual de H7 (`interview/fases.ts` → FICHAS). */
const PASOS: PasoDelRitual[] = [
  { fase: 'bienvenida', titulo: 'El bautizo', promesa: 'Le pones nombre a tu agente.' },
  { fase: 'identidad', titulo: 'Tu negocio', promesa: 'A qué te dedicas y en qué punto vas.' },
  { fase: 'modelo', titulo: 'Cómo ganas dinero', promesa: 'Qué cobras, cuánto y por dónde te llegan.' },
  { fase: 'proceso', titulo: 'Tu proceso', promesa: 'Cómo es hoy, de que te buscan hasta que te pagan.' },
  { fase: 'dolor', titulo: 'Dónde se rompe', promesa: 'Qué te roba tiempo y dinero.' },
  { fase: 'gente', titulo: 'Tu gente', promesa: 'Si estás solo, con equipo, o vas a contratar.' },
  { fase: 'sintesis', titulo: 'Tu Mapa de Negocio', promesa: 'Lo que sigue para tu empresa, en orden.' },
];

const ritual = (over: Partial<RitualEnPanel> = {}): RitualEnPanel => ({
  agente: 'Chica Guapa',
  faseIndice: 1,
  fasesTotales: 7,
  progreso: 14,
  tituloDeFase: 'Tu negocio',
  status: 'activa',
  turnos: 9,
  nuevo: false,
  loQueYaSabe: [],
  faltante: [],
  ...over,
});

/** El `memoria` real de producción, tal cual lo arma H7 al reanudar. */
const MEMORIA_REAL = [
  'Nos quedamos a medias hace un rato. Aquí sigo.',
  '',
  'Esto es lo que ya sé de tu negocio:',
  '· Te dedicas a organizar eventos de networking donde inversionistas patrocinan.',
  '· Le vendes a emprendedores.',
  '',
  'Vamos en la fase 2 de 7: tu negocio. A qué te dedicas y en qué punto vas.',
  '',
  '— Chica Guapa',
].join('\n');

// ════════════════════════════════════════════════════════════════════════════

describe('loQueYaSabe — las frases del agente, no etiquetas nuestras', () => {
  it('saca las viñetas del mensaje de regreso', () => {
    expect(loQueYaSabe(MEMORIA_REAL)).toEqual([
      'Te dedicas a organizar eventos de networking donde inversionistas patrocinan.',
      'Le vendes a emprendedores.',
    ]);
  });

  it('no se lleva el saludo, ni el rumbo, ni la firma', () => {
    const frases = loQueYaSabe(MEMORIA_REAL).join(' ');
    expect(frases).not.toContain('Aquí sigo');
    expect(frases).not.toContain('Vamos en la fase');
    expect(frases).not.toContain('— Chica Guapa');
  });

  it('si el formato cambia, devuelve vacío en vez de pintar el crudo', () => {
    // La alternativa —volcar `memoria` tal cual— pondría el saludo y la firma
    // del agente en medio del panel. Mejor no enseñar nada que enseñar basura.
    expect(loQueYaSabe('otro formato completamente distinto')).toEqual([]);
    expect(loQueYaSabe('')).toEqual([]);
    expect(loQueYaSabe(null)).toEqual([]);
    expect(loQueYaSabe(undefined)).toEqual([]);
  });

  it('nunca pasa de cuatro: el panel no es un volcado', () => {
    const muchas = ['Esto es lo que ya sé:', ...Array.from({ length: 12 }, (_, i) => `· dato ${i}`)];
    expect(loQueYaSabe(muchas.join('\n'))).toHaveLength(4);
  });
});

// ════════════════════════════════════════════════════════════════════════════

describe('hitosDelRitual — las 7 conversaciones, con su estado', () => {
  it('marca cerradas, actual y pendientes según las fases cerradas', () => {
    const h = hitosDelRitual(PASOS, ritual({ faseIndice: 2 }));
    expect(h.map((x) => x.estado)).toEqual([
      'cerrada',
      'cerrada',
      'actual',
      'pendiente',
      'pendiente',
      'pendiente',
      'pendiente',
    ]);
  });

  it('el Ritual completo deja las siete cerradas y ninguna actual', () => {
    const h = hitosDelRitual(PASOS, ritual({ status: 'completada', faseIndice: 6 }));
    expect(h.every((x) => x.estado === 'cerrada')).toBe(true);
  });

  it('sin foto del Ritual, la primera es la actual y ninguna está cerrada', () => {
    const h = hitosDelRitual(PASOS, null);
    expect(h[0]?.estado).toBe('actual');
    expect(h.filter((x) => x.estado === 'cerrada')).toHaveLength(0);
  });

  it('conserva el copy de H7 sin reescribirlo', () => {
    const h = hitosDelRitual(PASOS, ritual());
    expect(h[0]?.titulo).toBe('El bautizo');
    expect(h[0]?.promesa).toBe('Le pones nombre a tu agente.');
  });
});

// ════════════════════════════════════════════════════════════════════════════

describe('llamadaDelPanel — una sola acción, la que toca', () => {
  const siguienteDe = (r: RitualEnPanel | null) =>
    hitosDelRitual(PASOS, r).find((h) => h.estado === 'actual') ?? null;

  it('a quien no ha empezado le dice cuántas son y por dónde empieza', () => {
    const l = llamadaDelPanel(ritual({ nuevo: true }), siguienteDe(null));
    expect(l.boton).toBe('Empezar');
    expect(l.texto).toContain('Siete');
    expect(l.href).toBe('/ritual');
  });

  it('a quien va a medias le dice qué sigue, con el nombre de su agente', () => {
    // `faseIndice` cuenta fases CERRADAS, no la fase en curso (ver su comentario
    // en lectura-del-ritual.ts). Con dos cerradas —el bautizo y «Tu negocio»— la
    // que sigue es la tercera. Escribirlo con el índice explícito evita el
    // off-by-one que tenía esta prueba: pedía la tercera con sólo una cerrada.
    const r = ritual({ faseIndice: 2 });
    const l = llamadaDelPanel(r, siguienteDe(r));
    expect(l.boton).toBe('Seguir con Chica Guapa');
    expect(l.texto).toContain('Cómo ganas dinero');
  });

  it('con UNA fase cerrada, la que sigue es la segunda — no se salta ninguna', () => {
    // El otro lado del off-by-one, fijado a propósito: si alguien "arregla" la
    // aritmética moviendo el código en vez de la prueba, esto se pone rojo.
    const r = ritual({ faseIndice: 1 });
    expect(llamadaDelPanel(r, siguienteDe(r)).texto).toContain('Tu negocio');
  });

  it('a quien lo pausó lo llama por su nombre, no con un genérico', () => {
    const r = ritual({ status: 'pausada' });
    expect(llamadaDelPanel(r, siguienteDe(r)).titulo).toContain('Chica Guapa');
  });

  it('a quien terminó no le vuelve a pedir que conteste', () => {
    const r = ritual({ status: 'completada', faseIndice: 6, progreso: 100 });
    const l = llamadaDelPanel(r, siguienteDe(r));
    expect(l.boton).toContain('Mapa de Negocio');
    expect(l.texto).not.toContain('Sigue');
  });

  it('sin nombre de agente no aparece un hueco ni un "null"', () => {
    const r = ritual({ agente: null });
    const l = llamadaDelPanel(r, siguienteDe(r));
    expect(l.boton).toBe('Seguir con tu agente');
    for (const v of Object.values(l)) {
      expect(v).not.toContain('null');
      expect(v).not.toContain('undefined');
    }
  });

  it('sin foto del Ritual sigue habiendo una llamada, no un hueco', () => {
    const l = llamadaDelPanel(null, null);
    expect(l.boton.trim()).not.toBe('');
    expect(l.href).toBe('/ritual');
  });

  it('nunca deja un texto vacío en ninguno de los cuatro estados', () => {
    const estados = [
      ritual({ nuevo: true }),
      ritual({ status: 'activa' }),
      ritual({ status: 'pausada' }),
      ritual({ status: 'completada' }),
    ];
    for (const r of estados) {
      const l = llamadaDelPanel(r, siguienteDe(r));
      expect(l.titulo.trim()).not.toBe('');
      expect(l.texto.trim().length).toBeGreaterThan(20);
      expect(l.boton.trim()).not.toBe('');
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════

describe('nombreDelAgente', () => {
  it.each([null, undefined, '', '   '])('con %j no deja un hueco', (v) => {
    expect(nombreDelAgente(ritual({ agente: v as string | null }))).toBe('tu agente');
  });

  it('con nombre lo usa tal cual', () => {
    expect(nombreDelAgente(ritual({ agente: 'Chica Guapa' }))).toBe('Chica Guapa');
  });
});

// ════════════════════════════════════════════════════════════════════════════

describe('areasQueAbreLaSiguienteFase — el gancho, en números', () => {
  it('dice qué se abre con la siguiente conversación', () => {
    // Con cero fases cerradas, la siguiente («El bautizo») abre Ventas.
    expect(areasQueAbreLaSiguienteFase(AREAS_DE_ARRANQUE, ritual({ faseIndice: 0 }))).toEqual([
      'Ventas',
    ]);
  });

  it('no promete áreas que no están construidas', () => {
    // Dirección pide 2 fases pero no está cableada: prometerla sería mentir.
    const abre = areasQueAbreLaSiguienteFase(AREAS_DE_ARRANQUE, ritual({ faseIndice: 1 }));
    expect(abre).not.toContain('Dirección');
  });

  it('con el Ritual completo no promete nada más', () => {
    expect(
      areasQueAbreLaSiguienteFase(AREAS_DE_ARRANQUE, ritual({ status: 'completada' })),
    ).toEqual([]);
  });
});
