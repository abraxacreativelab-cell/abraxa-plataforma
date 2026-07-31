-- ═══════════════════════════════════════════════════════════════════════════
--  032_vault_knowledge.sql — H4 · La Bóveda (3/4): índice semántico
--
--  Los documentos partidos en trozos y embebidos, para que la búsqueda
--  encuentre por SIGNIFICADO y no por palabra exacta.
--
--  DOS COSAS QUE HAY QUE SABER ANTES DE TOCAR ESTO:
--
--  1. `embedding NULL` ES UN RESULTADO LEGÍTIMO, no un error. La cuenta de
--     OpenAI se queda sin cuota (en GARDEN pasó el 2026-07-28) y el generador
--     devuelve null. El trozo se guarda igual, sin vector, y un backfill lo
--     rellena después. Perder el documento porque falló un proveedor externo
--     sería mucho peor que guardarlo a medias.
--     Por eso los índices son PARCIALES: `WHERE embedding IS NOT NULL`.
--
--  2. PostgREST NO EXPONE EL OPERADOR `<=>`. Sin la función de abajo, la
--     búsqueda semántica es inalcanzable desde supabase-js — el criterio #7
--     del handoff no se podría cumplir. La función es la única vía.
--
--  La extensión `vector` ya la habilitó H1 en la 001, en el schema
--  `extensions`. Por eso el tipo va calificado: `extensions.vector(1536)`.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE app.knowledge_chunks (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  document_id uuid REFERENCES app.documents(id) ON DELETE CASCADE,
  content     text NOT NULL,
  -- text-embedding-3-small. La dimensión es parte del contrato: mezclar
  -- vectores de otro modelo en esta columna envenenaría la búsqueda en
  -- silencio (ver el comentario de embeddings.ts sobre por qué NO hay
  -- proveedor de respaldo).
  embedding   extensions.vector(1536),
  chunk_index int NOT NULL CHECK (chunk_index >= 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app.knowledge_chunks ENABLE ROW LEVEL SECURITY;


-- Re-ingerir un documento reemplaza sus trozos en vez de duplicarlos.
CREATE UNIQUE INDEX knowledge_chunks_doc_index_idx
  ON app.knowledge_chunks (document_id, chunk_index);

CREATE INDEX knowledge_chunks_tenant_idx ON app.knowledge_chunks (tenant_id);

-- Los que esperan backfill. `scripts/backfill` los busca por aquí.
CREATE INDEX knowledge_chunks_pending_idx
  ON app.knowledge_chunks (tenant_id) WHERE embedding IS NULL;

-- HNSW sobre coseno. Parcial, porque una fila sin vector no participa.
CREATE INDEX knowledge_chunks_embedding_idx
  ON app.knowledge_chunks USING hnsw (embedding extensions.vector_cosine_ops)
  WHERE embedding IS NOT NULL;


-- ───────────────────────────────────────────────────────────────────────────
-- Búsqueda semántica.
--
-- `p_tenant_id` no es una comodidad: es el aislamiento. La función filtra por
-- tenant DENTRO del SQL, así que ni siquiera un llamador descuidado puede
-- pedir los trozos de otra empresa.
--
-- STABLE + search_path fijo: el operador `<=>` vive en `extensions` y sin
-- fijar la ruta la función dejaría de resolver según quién la llame.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION app.match_knowledge_chunks(
  p_tenant_id      uuid,
  p_embedding      extensions.vector(1536),
  p_limit          int DEFAULT 8,
  p_min_similarity double precision DEFAULT 0.0
)
RETURNS TABLE (
  id          bigint,
  document_id uuid,
  content     text,
  chunk_index int,
  similarity  double precision
)
LANGUAGE sql
STABLE
SET search_path = app, extensions, pg_catalog
AS $$
  SELECT k.id,
         k.document_id,
         k.content,
         k.chunk_index,
         1 - (k.embedding <=> p_embedding) AS similarity
    FROM app.knowledge_chunks k
   WHERE k.tenant_id = p_tenant_id
     AND k.embedding IS NOT NULL
     AND 1 - (k.embedding <=> p_embedding) >= p_min_similarity
   ORDER BY k.embedding <=> p_embedding
   LIMIT greatest(1, least(coalesce(p_limit, 8), 50));
$$;


COMMENT ON TABLE app.knowledge_chunks IS
  'Índice semántico de la biblioteca. embedding NULL es válido: se rellena por '
  'backfill cuando el proveedor de embeddings vuelve.';

COMMENT ON FUNCTION app.match_knowledge_chunks IS
  'Búsqueda por significado. Existe porque PostgREST no expone el operador <=>. '
  'Filtra por tenant dentro del SQL: el aislamiento no depende del llamador.';
