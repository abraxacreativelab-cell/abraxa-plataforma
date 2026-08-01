/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El embudo invertido, probado como promesa de producto y no como plomería.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Las tres cosas que este archivo defiende, y que se degradan solas si nadie
 *  las fija:
 *
 *   1. **Las primeras preguntas se contestan con el pulgar.** Si alguien mete
 *      una pregunta abierta al principio, esto se pone rojo.
 *   2. **Salirse temprano ya no cuesta todo.** Con las cuatro respuestas de la
 *      fase 1 el mapa ya distingue este negocio de otro.
 *   3. **Los botones ayudan, no encierran.** Toda ayuda con opciones deja
 *      escribir, y toda pregunta abierta trae ejemplos que enseñan.
 */
import { describe, expect, it } from 'vitest';
import { ayudaDe, ayudaDelTurno, bloqueDeAyuda } from './ayudas';
import { primerFaltante, requisitosDe } from './cierre';
import { FASES } from './fases';
import { areasPara } from '../synthesis/mapa';
import type { EstadoNegocio } from '../types';

/** Lo único que se contestó: la fase 1 completa. Cuatro respuestas. */
const SOLO_LO_ESENCIAL: EstadoNegocio = {
  agente: 'Sol',
  categoria: 'Es una taquería / restaurante',
  equipo: 'Somos de 6 a 20',
  giro: 'taquería de suadero con reparto en la Roma',
  etapa: 'Ya opera parejo',
};

describe('el orden de las fases: primero el pulgar, después la cabeza', () => {
  it('el dolor es la última fase de preguntas, pegada al mapa', () => {
    expect(FASES[FASES.length - 1]).toBe('sintesis');
    expect(FASES[FASES.length - 2]).toBe('dolor');
  });

  it('la fase 1 es la esencial y sus tres primeras se contestan con un botón', () => {
    expect(FASES[1]).toBe('identidad');

    const claves = ['categoria', 'equipo', 'giro', 'etapa'];
    let estado: EstadoNegocio = { agente: 'Sol' };

    // Se recorre la fase como la vive el invitado: contestando el primer
    // faltante una y otra vez.
    const vistas: string[] = [];
    for (let i = 0; i < claves.length; i++) {
      const clave = primerFaltante('identidad', estado);
      expect(clave).toBe(claves[i]);
      if (clave) vistas.push(clave);
      estado = { ...estado, ...siguienteValor(clave) };
    }

    expect(vistas).toEqual(claves);

    // Tres de las cuatro traen botones; la del giro trae ejemplos.
    expect(ayudaDe('categoria')?.opciones.length).toBeGreaterThan(4);
    expect(ayudaDe('equipo')?.opciones.length).toBe(4);
    expect(ayudaDe('etapa')?.opciones.length).toBe(4);
    expect(ayudaDe('giro')?.opciones).toEqual([]);
    expect(ayudaDe('giro')?.ejemplos.length).toBeGreaterThanOrEqual(3);
  });

  it('cada requisito de cada fase tiene ayuda, o es trabajo del agente', () => {
    // Un requisito sin ayuda y sin excusa es una pregunta que el invitado
    // contesta a ciegas. La única excusa legítima es que no le toque a él.
    const claves = [
      'agente',
      'categoria',
      'equipo',
      'giro',
      'etapa',
      'nicho',
      'modelo_ingreso',
      'ticket',
      'margen',
      'canales',
      'recorrido',
      'herramientas',
      'equipo_detalle',
      'dolores',
    ];

    for (const clave of claves) {
      const a = ayudaDe(clave);
      expect(a, `falta la ayuda de "${clave}"`).not.toBeNull();
      expect(
        (a?.opciones.length ?? 0) > 0 || (a?.ejemplos.length ?? 0) > 0,
        `la ayuda de "${clave}" está vacía`,
      ).toBe(true);
    }

    // La única sin ayuda, y con razón: el hito que el agente detecta atacando
    // el proceso no lo contesta el invitado. No hay botón para eso.
    expect(ayudaDe('hito_del_diablo')).toBeNull();
    expect(requisitosDe('dolor')).toHaveLength(2);
  });
});

describe('salirse temprano ya no cuesta todo', () => {
  it('con sólo la fase 1 el mapa ya distingue este negocio de otro', () => {
    const taqueria = areasPara(SOLO_LO_ESENCIAL);
    const idea = areasPara({
      ...SOLO_LO_ESENCIAL,
      categoria: 'Doy servicios profesionales',
      equipo: 'Solo yo',
      giro: 'diseño de logos',
      etapa: 'Apenas es una idea',
    });

    const estados = (as: ReturnType<typeof areasPara>): string =>
      as.map((a) => `${a.slug}:${a.estado}`).join('|');

    expect(estados(taqueria)).not.toBe(estados(idea));

    // Y la diferencia es la que el dueño esperaría: con 6 a 20 personas el área
    // de Equipo nace abierta; estando solo, con candado y con su promesa.
    expect(taqueria.find((a) => a.slug === 'rh')?.estado).toBe('disponible');
    expect(idea.find((a) => a.slug === 'rh')?.estado).toBe('bloqueada');
  });

  it('el número de empleados que llega de un botón SÍ se entiende', () => {
    // El botón manda "Somos de 6 a 20", donde no aparece ninguna de las
    // palabras que el catálogo buscaba antes. Sin esto, un negocio de 18
    // personas caía en "hoy estás tú".
    for (const cubeta of ['Somos de 2 a 5', 'Somos de 6 a 20', 'Somos más de 20']) {
      expect(areasPara({ equipo: cubeta }).find((a) => a.slug === 'rh')?.estado).toBe('disponible');
    }
    expect(areasPara({ equipo: 'Solo yo' }).find((a) => a.slug === 'rh')?.estado).toBe('bloqueada');
  });
});

describe('los botones ayudan, no encierran', () => {
  it('todas las ayudas con opciones dejan escribir lo propio', () => {
    for (const clave of ['categoria', 'equipo', 'etapa', 'modelo_ingreso', 'margen', 'canales']) {
      expect(ayudaDe(clave)?.abierta, `"${clave}" no deja escribir`).toBe(true);
    }
  });

  it('canales y herramientas admiten varias; lo demás no', () => {
    expect(ayudaDe('canales')?.multiple).toBe(true);
    expect(ayudaDe('herramientas')?.multiple).toBe(true);
    expect(ayudaDe('categoria')?.multiple).toBe(false);
  });

  it('"no lo sé" es una respuesta de un toque para el margen', () => {
    // Era el dato que más atoraba la entrevista: la persona no quería contestar
    // mal y dejaba de contestar.
    const margen = ayudaDe('margen');
    expect(margen?.opciones.some((o) => /no lo s|no s[eé]/i.test(o.valor))).toBe(true);
  });

  it('los ejemplos son de negocios mexicanos, no de plantilla', () => {
    const todos = ['giro', 'nicho', 'ticket', 'recorrido', 'equipo_detalle', 'dolores']
      .flatMap((c) => ayudaDe(c)?.ejemplos ?? [])
      .join(' ');

    expect(todos).toMatch(/tacos|taquer|Roma|Coyoac|Sat[eé]lite|WhatsApp|\$/);
    // Nada de "Lorem", "Ej:", ni de vocabulario de consultora.
    expect(todos).not.toMatch(/lorem|soluciones integrales|sinergia|Ej\.:/i);

    for (const c of ['giro', 'nicho', 'ticket', 'recorrido', 'dolores']) {
      expect(ayudaDe(c)?.ejemplos.length, `"${c}" necesita 2 o 3 ejemplos`).toBeGreaterThanOrEqual(
        2,
      );
    }
  });
});

describe('la ayuda del turno sigue al primer faltante', () => {
  it('en el bautizo ofrece nombres', () => {
    expect(ayudaDelTurno('bienvenida', {})?.clave).toBe('agente');
  });

  it('avanza sola conforme se contesta', () => {
    expect(ayudaDelTurno('identidad', { agente: 'Sol' })?.clave).toBe('categoria');
    expect(ayudaDelTurno('identidad', { agente: 'Sol', categoria: 'taquería' })?.clave).toBe(
      'equipo',
    );
  });

  it('cuando la fase ya no debe nada, no hay ayuda que pintar', () => {
    expect(ayudaDelTurno('identidad', SOLO_LO_ESENCIAL)).toBeNull();
    expect(ayudaDelTurno('sintesis', SOLO_LO_ESENCIAL)).toBeNull();
  });

  it('el bloque para el modelo no se inventa botones que no existen', () => {
    expect(bloqueDeAyuda(null)).toBeNull();
    const bloque = bloqueDeAyuda(ayudaDe('giro'));
    expect(bloque).not.toBeNull();
    expect(bloque).not.toContain('BOTONES');
    expect(bloque).toContain('ejemplos');
  });
});

// ── Ayudas de la prueba ─────────────────────────────────────────────────────

function siguienteValor(clave: string | null): Partial<EstadoNegocio> {
  switch (clave) {
    case 'categoria':
      return { categoria: 'Es una taquería / restaurante' };
    case 'equipo':
      return { equipo: 'Somos de 6 a 20' };
    case 'giro':
      return { giro: 'taquería de suadero' };
    case 'etapa':
      return { etapa: 'Ya opera parejo' };
    default:
      return {};
  }
}
