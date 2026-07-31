/**
 * BÓVEDA · Búsqueda en la biblioteca.
 *
 * Dos vías, y la UI dice cuál contestó:
 *
 *   semántica → `app.match_knowledge_chunks` sobre los embeddings.
 *               Encuentra "cuánto cobro por instalar" en un documento que
 *               dice "tarifa de puesta en marcha". Es la que vale.
 *
 *   léxica    → `app.search_documents` sobre el índice de texto en español.
 *               No entiende sinónimos, pero NO depende de ningún proveedor
 *               externo. Cuando OpenAI se queda sin cuota —y pasa— es la
 *               diferencia entre una búsqueda peor y una búsqueda muerta.
 *
 * Se ejecutan las dos y se fusionan. Degradar en silencio a la léxica sin
 * decirlo sería mentirle al usuario sobre qué tan buena fue su búsqueda.
 *
 * ── Sobre `adminDb()` en este archivo ──────────────────────────────────────
 * `tenantDb(ctx)` no expone `.rpc()`. Por eso las dos funciones de SQL reciben
 * `p_tenant_id` y filtran por tenant DENTRO del SQL (ver migraciones 030 y
 * 032): el aislamiento vive en la base, no en la buena memoria del llamador.
 * El id sale de `ctx`, que viene de una sesión verificada.
 */
import { adminDb } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import { requireVaultRead } from '../rbac';
import type { SearchHit } from '../types';
import { generateEmbedding, isEmbeddingsAvailable, toVectorLiteral } from './embeddings';

export interface BuscarOpts {
  limite?: number;
  /** Similitud mínima para la vía semántica. Debajo de ~0.2 el ruido gana. */
  minSimilitud?: number;
}

export interface ResultadoBusqueda {
  hits: SearchHit[];
  /** `true` si la vía semántica no pudo correr. La UI lo dice, no lo esconde. */
  semanticaDegradada: boolean;
  motivoDegradacion: string;
}

export async function buscar(
  ctx: TenantContext,
  consulta: string,
  opts: BuscarOpts = {},
): Promise<ResultadoBusqueda> {
  requireVaultRead(ctx);

  const q = String(consulta ?? '').trim();
  if (!q) return { hits: [], semanticaDegradada: false, motivoDegradacion: '' };

  const limite = Math.min(Math.max(opts.limite ?? 8, 1), 50);

  const [semantica, lexica] = await Promise.all([
    buscarSemantica(ctx, q, limite, opts.minSimilitud ?? 0.2),
    buscarLexica(ctx, q, limite),
  ]);

  // Un documento que sale por las dos vías se muestra una vez, con el mejor
  // puntaje, y contando la semántica como la que lo encontró.
  const porDoc = new Map<string, SearchHit>();
  for (const hit of [...semantica.hits, ...lexica]) {
    const clave = hit.documentId ?? `${hit.title}#${hit.chunkIndex}`;
    const previo = porDoc.get(clave);
    if (!previo || hit.score > previo.score) porDoc.set(clave, hit);
  }

  const hits = [...porDoc.values()].sort((a, b) => b.score - a.score).slice(0, limite);

  return {
    hits,
    semanticaDegradada: semantica.degradada,
    motivoDegradacion: semantica.motivo,
  };
}

interface FilaSemantica {
  id: number;
  document_id: string | null;
  content: string;
  chunk_index: number;
  similarity: number;
}

async function buscarSemantica(
  ctx: TenantContext,
  consulta: string,
  limite: number,
  minSimilitud: number,
): Promise<{ hits: SearchHit[]; degradada: boolean; motivo: string }> {
  if (!isEmbeddingsAvailable()) {
    return {
      hits: [],
      degradada: true,
      motivo: 'El índice semántico no está disponible ahora mismo; se buscó sólo por palabras.',
    };
  }

  const vector = await generateEmbedding(consulta);
  if (!vector) {
    return {
      hits: [],
      degradada: true,
      motivo: 'No se pudo interpretar la búsqueda por significado; se buscó sólo por palabras.',
    };
  }

  const { data, error } = await adminDb().rpc('match_knowledge_chunks', {
    p_tenant_id: ctx.tenantId,
    p_embedding: toVectorLiteral(vector),
    p_limit: limite,
    p_min_similarity: minSimilitud,
  });

  if (error) {
    console.warn(`[vault] búsqueda semántica falló: ${error.message}`);
    return {
      hits: [],
      degradada: true,
      motivo: 'La búsqueda por significado falló; se buscó sólo por palabras.',
    };
  }

  const hits = ((data ?? []) as FilaSemantica[]).map<SearchHit>((f) => ({
    documentId: f.document_id,
    title: '',
    excerpt: recortar(f.content),
    chunkIndex: f.chunk_index,
    score: Number(f.similarity),
    via: 'semantica',
  }));

  return { hits, degradada: false, motivo: '' };
}

interface FilaLexica {
  id: string;
  title: string;
  area_slug: string | null;
  doc_type: string;
  excerpt: string;
  rank: number;
}

async function buscarLexica(
  ctx: TenantContext,
  consulta: string,
  limite: number,
): Promise<SearchHit[]> {
  const { data, error } = await adminDb().rpc('search_documents', {
    p_tenant_id: ctx.tenantId,
    p_query: consulta,
    p_limit: limite,
  });

  if (error) {
    console.warn(`[vault] búsqueda léxica falló: ${error.message}`);
    return [];
  }

  const filas = (data ?? []) as FilaLexica[];
  // `ts_rank` no está acotado a 1. Se normaliza contra el mejor de esta
  // consulta para poder mezclarlo con la similitud del coseno sin que un
  // resultado léxico gane siempre por tener un número más grande.
  const maximo = filas.reduce((m, f) => Math.max(m, Number(f.rank) || 0), 0) || 1;

  return filas.map<SearchHit>((f) => ({
    documentId: f.id,
    title: f.title,
    excerpt: f.excerpt ?? '',
    chunkIndex: 0,
    // Se escala a 0–0.8 a propósito: con igualdad de mérito, un acierto
    // semántico es mejor pista que uno léxico.
    score: (Number(f.rank) / maximo) * 0.8,
    via: 'lexica',
  }));
}

function recortar(texto: string, max = 240): string {
  const t = String(texto ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}
