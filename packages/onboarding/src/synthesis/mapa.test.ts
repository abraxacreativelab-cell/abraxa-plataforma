/**
 * El criterio #4: **dos emprendedores de giros distintos obtienen mapas
 * distintos — no una plantilla igual.**
 *
 * Se prueba con dos negocios reales y contrarios, y sin llamar al modelo: si el
 * mapa dependiera de lo que un proveedor decida ese día, esta prueba sería un
 * flaky y el criterio, una opinión.
 */
import { describe, expect, it } from 'vitest';
import { areasPara, construirMapa, hitosPara, mensajeDeEntrega, tipoDeIndustria } from './mapa';
import type { EstadoNegocio } from '../types';

/** Solopreneur de servicios, apenas arrancando, sin nadie más. */
const CONSULTORA: EstadoNegocio = {
  agente: 'Nova',
  giro: 'consultoría de marca',
  nicho: 'startups en su primera ronda',
  etapa: 'primeros clientes',
  tamano: '3 proyectos al año',
  modeloIngreso: 'por proyecto',
  ticket: '$80,000 por proyecto',
  margen: 'casi todo, es mi tiempo',
  canales: ['recomendación'],
  recorrido: [
    { nombre: 'me recomiendan', como: 'un correo' },
    { nombre: 'propongo', como: 'un PDF que armo cada vez' },
    { nombre: 'cobro anticipo', como: 'transferencia' },
  ],
  herramientas: ['correo', 'figma'],
  dolores: [{ texto: 'me tardo días en armar cada propuesta' }],
  equipo: 'solo',
};

/** Negocio de operación, con volumen, con gente y con posventa. */
const TALLER: EstadoNegocio = {
  agente: 'Chuy',
  giro: 'taller mecánico',
  nicho: 'flotillas de reparto',
  etapa: 'creciendo',
  tamano: '120 servicios al mes',
  modeloIngreso: 'por servicio y mantenimiento mensual',
  ticket: '$3,200 por servicio',
  margen: '40%',
  canales: ['whatsapp', 'teléfono'],
  recorrido: [
    { nombre: 'entra la unidad', como: 'llegan sin cita' },
    { nombre: 'diagnóstico', como: 'papel' },
    { nombre: 'reparación', como: 'lo asigna el jefe de taller' },
    { nombre: 'entrega y seguimiento', como: 'les habla por teléfono' },
  ],
  herramientas: ['whatsapp', 'excel'],
  dolores: [
    { texto: 'no alcanzo a contestar los mensajes cuando hay pico' },
    { texto: 'no sé cuánto dinero me deja cada servicio' },
  ],
  equipo: 'equipo de 6, voy a contratar a dos más',
};

describe('criterio #4 — mapas distintos para giros distintos', () => {
  it('el estado de las áreas cambia según lo que dijo cada uno', () => {
    const consultora = areasPara(CONSULTORA);
    const taller = areasPara(TALLER);

    const estado = (as: ReturnType<typeof areasPara>, slug: string): string | undefined =>
      as.find((a) => a.slug === slug)?.estado;

    // El taller trae gente y va a contratar; la consultora está sola.
    expect(estado(taller, 'rh')).toBe('disponible');
    expect(estado(consultora, 'rh')).toBe('bloqueada');

    // El taller ya opera y su dolor es de dinero.
    expect(estado(taller, 'finanzas')).toBe('disponible');
    expect(estado(consultora, 'finanzas')).toBe('bloqueada');

    // El taller tiene un paso de posventa; la consultora termina al cobrar.
    expect(estado(taller, 'onboarding')).toBe('disponible');
    expect(estado(consultora, 'onboarding')).toBe('bloqueada');

    // Canales + recorrido de 4 pasos = embudo real que ordenar.
    expect(estado(taller, 'ventas')).toBe('en_progreso');
    expect(estado(consultora, 'ventas')).toBe('disponible');

    // Y en conjunto, los mapas no se parecen.
    expect(taller.map((a) => a.estado)).not.toEqual(consultora.map((a) => a.estado));
  });

  it('la razón de cada área cita datos de ESE negocio', () => {
    const taller = areasPara(TALLER);
    expect(taller.find((a) => a.slug === 'servicio')?.razon).toContain('no alcanzo a contestar');
    expect(taller.find((a) => a.slug === 'direccion')?.razon).toContain('$3,200 por servicio');

    const consultora = areasPara(CONSULTORA);
    expect(consultora.find((a) => a.slug === 'direccion')?.razon).toContain('$80,000 por proyecto');
  });

  it('las áreas bloqueadas se devuelven igual, con su promesa', () => {
    const bloqueadas = areasPara(CONSULTORA).filter((a) => a.estado === 'bloqueada');
    expect(bloqueadas.length).toBeGreaterThan(0);
    for (const a of bloqueadas) {
      expect(a.blurb.length).toBeGreaterThan(0);
      expect(a.razon.length).toBeGreaterThan(0);
      expect(a.requisitos.length).toBeGreaterThan(0);
    }
  });

  it('ventas nunca nace bloqueada', () => {
    for (const negocio of [CONSULTORA, TALLER, {} as EstadoNegocio]) {
      expect(areasPara(negocio).find((a) => a.slug === 'ventas')?.estado).not.toBe('bloqueada');
    }
  });
});

describe('el roadmap', () => {
  it('pone primero lo que salió del abogado del diablo', () => {
    const estado: EstadoNegocio = {
      ...TALLER,
      hitos: [
        { areaSlug: 'ventas', titulo: 'Un catálogo de precios', origen: 'emprendedor' },
        {
          areaSlug: 'servicio',
          titulo: 'Que los mensajes del pico entren a una fila',
          origen: 'abogado_del_diablo',
        },
      ],
    };

    const hitos = hitosPara(estado, areasPara(estado));
    expect(hitos[0]?.origen).toBe('abogado_del_diablo');
    expect(hitos[1]?.origen).toBe('emprendedor');
  });

  it('toda área bloqueada trae su instrucción de cómo abrirla', () => {
    const areas = areasPara(CONSULTORA);
    const hitos = hitosPara(CONSULTORA, areas);

    for (const bloqueada of areas.filter((a) => a.estado === 'bloqueada')) {
      expect(hitos.some((h) => h.areaSlug === bloqueada.slug && h.origen === 'catalogo')).toBe(true);
    }
  });
});

describe('el giro', () => {
  it('se normaliza a slug sin acentos', () => {
    expect(tipoDeIndustria({ giro: 'Panadería Artesanal' })).toBe('panaderia-artesanal');
    expect(tipoDeIndustria({ giro: '  taller mecánico / hojalatería ' })).toBe(
      'taller-mecanico-hojalateria',
    );
  });

  it('sin giro no inventa uno', () => {
    expect(tipoDeIndustria({})).toBeNull();
    expect(tipoDeIndustria({ giro: '   ' })).toBeNull();
  });
});

describe('el documento madre', () => {
  it('sólo contiene lo que el emprendedor dijo', () => {
    const mapa = construirMapa(CONSULTORA);
    expect(mapa.resumen).toContain('consultoría de marca');
    expect(mapa.resumen).toContain('$80,000 por proyecto');
    expect(mapa.resumen).toContain('me tardo días en armar cada propuesta');
    // No se inventa una sección de algo que nunca se preguntó.
    expect(mapa.resumen).not.toContain('undefined');
    expect(mapa.resumen).not.toContain('null');
  });

  it('un negocio a medias produce un resumen a medias, no uno inventado', () => {
    const mapa = construirMapa({ giro: 'florería' });
    expect(mapa.resumen).toContain('florería');
    expect(mapa.resumen).not.toContain('Modelo de negocio');
  });
});

describe('el mensaje de entrega sin modelo', () => {
  it('entrega el mapa completo aunque el proveedor se caiga', () => {
    const mensaje = mensajeDeEntrega(construirMapa(TALLER), TALLER);

    expect(mensaje).toContain('taller mecánico');
    expect(mensaje).toContain('Puedes empezar hoy con');
    expect(mensaje).toContain('Chuy');
    // El taller abre las seis: no hay sección de bloqueadas que enseñar, y
    // enseñarla vacía sería peor que no enseñarla.
    expect(mensaje).not.toContain('Todavía no, pero te esperan');
  });

  it('cuando sí hay áreas cerradas, las nombra con su promesa', () => {
    const mensaje = mensajeDeEntrega(construirMapa(CONSULTORA), CONSULTORA);

    expect(mensaje).toContain('Todavía no, pero te esperan');
    expect(mensaje).toContain('Graduarte de solopreneur');
    expect(mensaje).toContain('Por dónde empezar mañana');
  });

  it('la frase de apertura se lee como frase, no como campos pegados', () => {
    const mensaje = mensajeDeEntrega(construirMapa(TALLER), TALLER);

    expect(mensaje).toContain(
      'Te dedicas a taller mecánico para flotillas de reparto y cobras por servicio y mantenimiento mensual, alrededor de $3,200 por servicio.',
    );
    expect(mensaje).not.toContain(' ,');
  });

  it('un negocio del que se sabe poco no produce una frase rota', () => {
    const mensaje = mensajeDeEntrega(construirMapa({}), {});
    expect(mensaje).not.toContain(' ,');
    expect(mensaje).not.toContain('undefined');
    expect(mensaje).toContain('Listo.');
  });
});
