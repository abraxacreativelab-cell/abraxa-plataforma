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
  SLUGS_RESERVADOS,
  SLUG_LARGO_MAX,
  SLUG_PATRON,
  derivarSlug,
  esSlugValido,
  slugify,
} from './slug';

/** Un `estaOcupado` que considera ocupados los slugs de la lista. */
const ocupados = (...tomados: string[]) => {
  const set = new Set(tomados);
  return async (s: string) => set.has(s);
};

const libre = async () => false;

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

describe('derivarSlug — criterio 5', () => {
  it('dos negocios con el mismo nombre salen distintos y ambos legibles', async () => {
    const primero = await derivarSlug('Panadería Lupita', libre);
    const segundo = await derivarSlug('Panadería Lupita', ocupados(primero));

    expect(primero).toBe('panaderia-lupita');
    expect(segundo).toBe('panaderia-lupita-2');
    expect(primero).not.toBe(segundo);
    // "Legible" es el criterio: nada de uuid.
    expect(segundo).toMatch(/^[a-z-]+-\d+$/);
  });

  it('sigue subiendo el sufijo mientras haya colisión', async () => {
    const tomados = ocupados('tacos-el-gordo', 'tacos-el-gordo-2', 'tacos-el-gordo-3');
    expect(await derivarSlug('Tacos El Gordo', tomados)).toBe('tacos-el-gordo-4');
  });

  it('un nombre reservado sale con sufijo en vez de reventar', async () => {
    // El negocio de alguien se puede llamar "Stripe" o "Blog".
    expect(await derivarSlug('Stripe', libre)).toBe('stripe-2');
    expect(await derivarSlug('Blog', libre)).toBe('blog-2');
  });

  it('un nombre demasiado corto se alarga en vez de fallar', async () => {
    const s = await derivarSlug('Ya', libre);
    expect(esSlugValido(s)).toBe(true);
    expect(s).toBe('ya-negocio');
  });

  it('un nombre que no deja nada usable todavía da un slug válido', async () => {
    const s = await derivarSlug('☕☕☕', libre);
    expect(esSlugValido(s)).toBe(true);
  });

  it('el sufijo respeta el largo máximo', async () => {
    const nombre = 'a'.repeat(60);
    const base = await derivarSlug(nombre, libre);
    const conSufijo = await derivarSlug(nombre, ocupados(base));

    expect(conSufijo.length).toBeLessThanOrEqual(SLUG_LARGO_MAX);
    expect(esSlugValido(conSufijo)).toBe(true);
  });

  it('corta en vez de colgarse si `estaOcupado` siempre dice que sí', async () => {
    // Una caída de red mal manejada dentro de un webhook de pago no puede
    // convertirse en un bucle infinito.
    await expect(derivarSlug('Panadería', async () => true, 5)).rejects.toThrow(/intentos/);
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

  it.each(nombres)('«%s» produce un slug que la base aceptaría', async (nombre) => {
    const s = await derivarSlug(nombre, libre);
    expect(SLUG_PATRON.test(s)).toBe(true);
    expect(SLUGS_RESERVADOS.has(s)).toBe(false);
  });
});
