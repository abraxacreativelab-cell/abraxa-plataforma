/**
 * Criterio observable #7 del handoff:
 *
 *   La búsqueda semántica encuentra un documento por significado, no por
 *   palabra exacta.
 *
 * El embedding se simula con una bolsa de conceptos determinista: lo que se
 * verifica aquí es la LÓGICA de búsqueda —fusión de las dos vías, umbral,
 * normalización de puntajes y la degradación honesta—, no la calidad del
 * modelo de OpenAI.
 *
 * La correctitud del SQL (`match_knowledge_chunks` con el índice HNSW) se
 * verifica contra una base real con `npm run vault:verify`. Está dicho aquí
 * para que nadie lea estas pruebas como si cubrieran eso.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { montar, type Harness } from '../testing/harness';
import { buscar } from './search';
import { resetEmbeddingsCooldown } from './embeddings';

/**
 * Vector de conceptos. Dos textos que hablan de lo mismo con palabras
 * distintas caen cerca; dos que comparten palabras pero no tema, lejos.
 */
const CONCEPTOS = ['dinero', 'tiempo', 'comida', 'gente'] as const;

const LEXICO: Record<string, number[]> = {
  // "tarifa de puesta en marcha" y "cuánto cobro por instalar" → dinero
  tarifa: [1, 0, 0, 0],
  puesta: [0.8, 0.2, 0, 0],
  marcha: [0.8, 0.2, 0, 0],
  cobro: [1, 0, 0, 0],
  cobra: [1, 0, 0, 0],
  cuesta: [1, 0, 0, 0],
  instalar: [0.7, 0.3, 0, 0],
  instalacion: [0.7, 0.3, 0, 0],
  precio: [1, 0, 0, 0],
  // horarios → tiempo
  horario: [0, 1, 0, 0],
  abrimos: [0, 1, 0, 0],
  cerramos: [0, 1, 0, 0],
  // menú → comida
  menu: [0, 0, 1, 0],
  taco: [0, 0, 1, 0],
  cocina: [0, 0, 1, 0],
};

function vectorizar(texto: string): number[] {
  const v = new Array<number>(CONCEPTOS.length).fill(0);
  const palabras = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/\W+/);
  for (const p of palabras) {
    const c = LEXICO[p];
    if (!c) continue;
    for (let i = 0; i < v.length; i++) v[i] = (v[i] ?? 0) + (c[i] ?? 0);
  }
  return v;
}

/** Sustituye la llamada HTTP a OpenAI por el vectorizador de arriba. */
function stubEmbeddings() {
  // Corta a propósito: no debe parecerse a una llave real ni en el diff.
  process.env.OPENAI_API_KEY = 'llave-de-prueba';
  resetEmbeddingsCooldown();
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    const { input } = JSON.parse(init.body) as { input: string };
    // El endpoint real devuelve 1536 dims; el doble rellena el resto con ceros
    // para que la validación de dimensión del generador siga vigente.
    const base = vectorizar(input);
    const embedding = [...base, ...new Array(1536 - base.length).fill(0)];
    return { ok: true, json: async () => ({ data: [{ embedding }] }) };
  });
}

let h: Harness;

beforeEach(async () => {
  // `montar()` apaga las llaves de IA; `stubEmbeddings()` pone una falsa y
  // sustituye `fetch`, así que nada sale a la red.
  h = montar();
  stubEmbeddings();

  const { crearDocumento } = await import('./service');
  await crearDocumento(h.a, {
    title: 'Tarifas de servicio',
    content: 'La tarifa de puesta en marcha se cobra una sola vez al inicio del proyecto.',
    docType: 'precios',
    areaSlug: 'ventas',
    status: 'active',
  });
  await crearDocumento(h.a, {
    title: 'Horarios',
    content: 'Abrimos a las nueve y cerramos a las seis, de lunes a viernes.',
    docType: 'politica',
    areaSlug: 'operaciones',
    status: 'active',
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetEmbeddingsCooldown();
  h.restaurar();
});

describe('criterio #7 · encontrar por significado', () => {
  it('encuentra "tarifa de puesta en marcha" preguntando "cuánto cobro por instalar"', async () => {
    // Cero palabras en común con el documento. La búsqueda léxica sola no
    // devolvería nada.
    const r = await buscar(h.a, 'cuánto cobro por instalar');

    expect(r.semanticaDegradada).toBe(false);
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.hits[0]?.via).toBe('semantica');
    expect(r.hits[0]?.excerpt).toContain('puesta en marcha');
  });

  it('no confunde temas distintos', async () => {
    const r = await buscar(h.a, 'a qué horario abrimos');
    expect(r.hits[0]?.excerpt).toContain('nueve');
  });

  it('la vía léxica sigue funcionando para palabras exactas', async () => {
    const r = await buscar(h.a, 'proyecto');
    expect(r.hits.length).toBeGreaterThan(0);
  });
});

describe('degradación honesta', () => {
  it('sin llave de OpenAI busca por palabras y LO DICE', async () => {
    // La mentira cara sería devolver cero resultados como si no existiera
    // nada, cuando lo que pasó es que no se pudo buscar bien.
    delete process.env.OPENAI_API_KEY;

    const r = await buscar(h.a, 'tarifa puesta marcha');
    expect(r.semanticaDegradada).toBe(true);
    expect(r.motivoDegradacion).toMatch(/sólo por palabras/i);
    // Y aun así contesta: el índice de texto no depende de ningún proveedor.
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.hits[0]?.via).toBe('lexica');
  });

  it('si el proveedor devuelve 429, no se cae: degrada', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: false,
      status: 429,
      text: async () => 'insufficient_quota',
    }));

    const r = await buscar(h.a, 'tarifa');
    expect(r.semanticaDegradada).toBe(true);
    expect(r.hits.length).toBeGreaterThan(0);
  });

  it('una consulta vacía no devuelve todo el archivo', async () => {
    expect((await buscar(h.a, '   ')).hits).toHaveLength(0);
  });
});

describe('fusión de las dos vías', () => {
  it('un documento que sale por las dos aparece UNA vez', async () => {
    const r = await buscar(h.a, 'tarifa');
    const ids = r.hits.map((x) => x.documentId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
