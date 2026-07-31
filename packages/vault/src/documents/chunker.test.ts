/**
 * Partir mal un documento envenena la búsqueda en silencio: los trozos
 * cortados a media frase producen embeddings que no representan ninguna idea
 * completa, y la búsqueda empieza a devolver cosas que "casi" hablan del tema.
 */
import { describe, expect, it } from 'vitest';
import { chunkText } from './chunker';

describe('chunkText', () => {
  it('un texto corto es un solo trozo', () => {
    expect(chunkText('Una política breve.')).toEqual(['Una política breve.']);
  });

  it('un texto vacío no produce trozos', () => {
    expect(chunkText('   \n\n  ')).toEqual([]);
  });

  it('corta por párrafos, no a media frase', () => {
    const doc = ['a'.repeat(300), 'b'.repeat(300), 'c'.repeat(300)].join('\n\n');
    const trozos = chunkText(doc, 100); // 100 tokens ≈ 400 caracteres
    expect(trozos.length).toBeGreaterThan(1);
    for (const t of trozos) {
      // Cada trozo es uno o más párrafos enteros.
      expect(/^[abc]+(\n\n[abc]+)*$/.test(t)).toBe(true);
    }
  });

  it('un párrafo gigantesco se parte por oraciones', () => {
    // Un contrato sin saltos de línea no puede tragarse un trozo entero.
    const parrafo = Array.from({ length: 60 }, (_, i) => `Cláusula número ${i}.`).join(' ');
    const trozos = chunkText(parrafo, 50);
    expect(trozos.length).toBeGreaterThan(1);
    expect(trozos.every((t) => t.length <= 50 * 4 + 40)).toBe(true);
  });

  it('no pierde contenido', () => {
    const doc = ['Primero.', 'Segundo.', 'Tercero.'].join('\n\n');
    expect(chunkText(doc, 5).join(' ')).toContain('Tercero');
  });

  it('un texto con contenido SIEMPRE produce al menos un trozo', () => {
    // Un documento que se ingiere y no genera ni un trozo desaparecería de la
    // búsqueda sin avisarle a nadie.
    expect(chunkText('x', 1).length).toBeGreaterThan(0);
    expect(chunkText('sin dobles saltos de linea pero con texto', 1).length).toBeGreaterThan(0);
  });
});
