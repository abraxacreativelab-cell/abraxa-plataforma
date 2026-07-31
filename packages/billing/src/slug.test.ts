/**
 * Criterio 5 del handoff: «Dos negocios con el mismo nombre obtienen slugs
 * distintos, ambos legibles.»
 *
 * Y el que no está escrito pero cuesta más caro: TODO slug que salga de aquí
 * tiene que pasar los CHECK de `app.tenants`. Si no, `provision()` revienta
 * después de que Stripe ya cobró.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_CANDIDATOS,
  SLUGS_RESERVADOS,
  SLUG_LARGO_MAX,
  SLUG_PATRON,
  candidatosDeSlug,
  esSlugValido,
  slugify,
} from './slug';

describe('slugify', () => {
  it('convierte un nombre normal en algo legible', () => {
    expect(slugify('Panadería Lupita')).toBe('panaderia-lupita');
  });

  it('quita los acentos sin partir la letra en dos', () => {
    // El bug clásico de NFD: sin quitar los diacríticos sueltos, "panadería"
    // sale "panaderi-a".
    expect(slugify('Café Té Ñoño')).toBe('cafe-te-nono');
  });

  it('la ñ no se descompone en NFD, se traduce aparte', () => {
    expect(slugify('Ñu')).toBe('nu');
  });

  it('colapsa símbolos, espacios y emoji en un solo guion', () => {
    expect(slugify('CAFÉ  &  Té  ☕')).toBe('cafe-te');
  });

  it('no deja guiones en las puntas', () => {
    expect(slugify('  ¡¡Tacos!!  ')).toBe('tacos');
  });

  it('recorta al máximo sin dejar un guion colgando', () => {
    const largo = slugify('a'.repeat(30) + ' ' + 'b'.repeat(30));
    expect(largo.length).toBeLessThanOrEqual(SLUG_LARGO_MAX);
    expect(largo.endsWith('-')).toBe(false);
  });
});

describe('esSlugValido', () => {
  it('acepta lo que la base acepta', () => {
    expect(esSlugValido('panaderia-lupita')).toBe(true);
    expect(esSlugValido('abc')).toBe(true);
  });

  it('rechaza lo que la base rechaza', () => {
    expect(esSlugValido('ab')).toBe(false); // corto
    expect(esSlugValido('-abc')).toBe(false); // guion al inicio
    expect(esSlugValido('abc-')).toBe(false); // guion al final
    expect(esSlugValido('Abc')).toBe(false); // mayúscula
    expect(esSlugValido('a'.repeat(41))).toBe(false); // largo
    expect(esSlugValido('api')).toBe(false); // reservado
  });
});

describe('candidatosDeSlug — criterio 5', () => {
  /*
   * Esto ANTES era `derivarSlug(nombre, estaOcupado)`: preguntaba a la base si
   * el slug estaba ocupado y devolvía el primero libre. La pregunta era la
   * equivocada — "¿existe la fila?" en vez de "¿es de otro dueño?" — y por eso
   * el reproceso de un pago creaba una segunda empresa con el sufijo. Ahora
   * esto sólo GENERA candidatos; quien decide es `app.provision_tenant`, que es
   * el único que sabe de quién es cada slug. Ver `provisionarEmpresa()`.
   */

  it('dos negocios con el mismo nombre salen distintos y ambos legibles', () => {
    const [primero, segundo] = candidatosDeSlug('Panadería Lupita');

    expect(primero).toBe('panaderia-lupita');
    expect(segundo).toBe('panaderia-lupita-2');
    expect(primero).not.toBe(segundo);
    // "Legible" es el criterio: nada de uuid.
    expect(segundo).toMatch(/^[a-z-]+-\d+$/);
  });

  it('sigue subiendo el sufijo mientras haya colisión', () => {
    expect(candidatosDeSlug('Tacos El Gordo').slice(0, 4)).toEqual([
      'tacos-el-gordo',
      'tacos-el-gordo-2',
      'tacos-el-gordo-3',
      'tacos-el-gordo-4',
    ]);
  });

  it('un nombre reservado sale con sufijo en vez de reventar', () => {
    // El negocio de alguien se puede llamar "Stripe" o "Blog".
    expect(candidatosDeSlug('Stripe')[0]).toBe('stripe-2');
    expect(candidatosDeSlug('Blog')[0]).toBe('blog-2');
    // Y el reservado no aparece NUNCA, ni más abajo en la lista.
    expect(candidatosDeSlug('Stripe')).not.toContain('stripe');
  });

  it('un nombre demasiado corto se alarga en vez de fallar', () => {
    const s = candidatosDeSlug('Ya')[0]!;
    expect(esSlugValido(s)).toBe(true);
    expect(s).toBe('ya-negocio');
  });

  it('un nombre que no deja nada usable todavía da un slug válido', () => {
    const s = candidatosDeSlug('☕☕☕')[0]!;
    expect(esSlugValido(s)).toBe(true);
  });

  it('el sufijo respeta el largo máximo', () => {
    const nombre = 'a'.repeat(60);

    for (const c of candidatosDeSlug(nombre)) {
      expect(c.length).toBeLessThanOrEqual(SLUG_LARGO_MAX);
      expect(esSlugValido(c)).toBe(true);
    }
  });

  it('la lista es finita: el alta no se puede volver un bucle dentro de un webhook', () => {
    expect(candidatosDeSlug('Panadería').length).toBeLessThanOrEqual(MAX_CANDIDATOS);
    expect(candidatosDeSlug('Panadería', 5).length).toBeLessThanOrEqual(5);
  });

  it('no repite un candidato: cada intento de alta prueba un slug distinto', () => {
    // Con nombres largos el recorte podría colapsar dos sufijos en el mismo
    // slug y hacer que el alta reintentara el mismo candidato para siempre.
    for (const nombre of ['Panadería Lupita', 'a'.repeat(60), 'Ya', 'Stripe']) {
      const lista = candidatosDeSlug(nombre);
      expect(new Set(lista).size).toBe(lista.length);
    }
  });
});

describe('todo lo que sale pasa los CHECK de app.tenants', () => {
  const nombres = [
    'Panadería Lupita',
    'CAFÉ  &  Té  ☕',
    'Ñoño’s',
    'Ya',
    '   ',
    '☕',
    'a'.repeat(80),
    'API',
    'admin',
    'Tacos "El Güero" #1',
    '123',
    '---',
    'Öñü Ãç',
  ];

  it.each(nombres)('«%s» produce slugs que la base aceptaría', (nombre) => {
    const lista = candidatosDeSlug(nombre);
    expect(lista.length).toBeGreaterThan(0);

    // TODOS, no sólo el primero: el alta puede acabar en cualquiera de ellos.
    for (const s of lista) {
      expect(SLUG_PATRON.test(s)).toBe(true);
      expect(SLUGS_RESERVADOS.has(s)).toBe(false);
    }
  });
});
