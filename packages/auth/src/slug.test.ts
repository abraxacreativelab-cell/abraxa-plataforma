import { describe, expect, it } from 'vitest';
import { FORMATO_SLUG, huella, nombreDeEmpresa, slugAlternativo, slugDeCorreo } from './slug';

describe('slugDeCorreo', () => {
  it('es determinista: el mismo correo da el mismo slug', () => {
    expect(slugDeCorreo('ana@gmail.com')).toBe(slugDeCorreo('ana@gmail.com'));
  });

  it('no distingue mayúsculas ni espacios de sobra', () => {
    expect(slugDeCorreo('  Ana@Gmail.com ')).toBe(slugDeCorreo('ana@gmail.com'));
  });

  it('separa correos con la misma parte local', () => {
    expect(slugDeCorreo('ana@gmail.com')).not.toBe(slugDeCorreo('ana@outlook.com'));
  });

  it('cumple el formato que exige la base', () => {
    const correos = [
      'a@b.co',
      'ana@gmail.com',
      'nombre.muy.largo.de.verdad.que.no.acaba.nunca@empresa.com.mx',
      'CON+etiqueta@gmail.com',
      '___@x.com',
      '@sin-local.com',
      'ünïcode@dominio.mx',
      '123@x.com',
      '-guion-al-inicio@x.com',
    ];

    for (const c of correos) {
      const s = slugDeCorreo(c);
      expect(FORMATO_SLUG.test(s), `${c} → ${s}`).toBe(true);
      expect(s.length).toBeLessThanOrEqual(40);
      expect(s.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('sin parte local usable, no revienta', () => {
    const s = slugDeCorreo('@ejemplo.com');
    expect(s.startsWith('equipo-')).toBe(true);
    expect(FORMATO_SLUG.test(s)).toBe(true);
  });

  it('mil correos distintos dan mil slugs distintos', () => {
    const slugs = new Set<string>();
    for (let i = 0; i < 1000; i++) slugs.add(slugDeCorreo(`invitado${i}@ejemplo.com`));
    expect(slugs.size).toBe(1000);
  });

  it('y mil correos con la MISMA parte local, también', () => {
    const slugs = new Set<string>();
    for (let i = 0; i < 1000; i++) slugs.add(slugDeCorreo(`info@empresa${i}.mx`));
    expect(slugs.size).toBe(1000);
  });
});

describe('slugAlternativo', () => {
  it('cambia el slug y sigue cumpliendo el formato', () => {
    const base = slugDeCorreo('ana@gmail.com');
    for (let i = 2; i <= 4; i++) {
      const alt = slugAlternativo('ana@gmail.com', i);
      expect(alt).not.toBe(base);
      expect(FORMATO_SLUG.test(alt), alt).toBe(true);
    }
  });

  it('recorta para no pasarse de 40 con un correo larguísimo', () => {
    const correo = `${'x'.repeat(200)}@ejemplo.com`;
    const alt = slugAlternativo(correo, 9);
    expect(alt.length).toBeLessThanOrEqual(40);
    expect(FORMATO_SLUG.test(alt), alt).toBe(true);
  });
});

describe('huella', () => {
  it('es estable entre corridas', () => {
    expect(huella('ana@gmail.com')).toBe(huella('ana@gmail.com'));
  });

  it('mide lo que se le pide', () => {
    expect(huella('x', 4)).toHaveLength(4);
    expect(huella('x', 8)).toHaveLength(8);
  });

  it('sólo usa caracteres válidos en un slug', () => {
    for (let i = 0; i < 200; i++) expect(/^[a-z0-9]+$/.test(huella(`x${i}`))).toBe(true);
  });
});

describe('nombreDeEmpresa', () => {
  it('prefiere el nombre de Google', () => {
    expect(nombreDeEmpresa('ana@gmail.com', 'Ana Ruiz')).toBe('Ana Ruiz');
  });

  it('sin nombre de Google, lo saca del correo y lo capitaliza', () => {
    expect(nombreDeEmpresa('ana.ruiz@gmail.com', null)).toBe('Ana Ruiz');
    expect(nombreDeEmpresa('ana_ruiz@gmail.com')).toBe('Ana Ruiz');
  });

  it('nunca devuelve menos de 2 caracteres, que es lo que exige H2', () => {
    expect(nombreDeEmpresa('a@b.co', null).length).toBeGreaterThanOrEqual(2);
    expect(nombreDeEmpresa('@b.co', '').length).toBeGreaterThanOrEqual(2);
    expect(nombreDeEmpresa('a@b.co', 'X').length).toBeGreaterThanOrEqual(2);
  });

  it('nunca pasa de 120, que es lo que exige H2', () => {
    expect(nombreDeEmpresa('a@b.co', 'N'.repeat(400)).length).toBe(120);
  });
});
