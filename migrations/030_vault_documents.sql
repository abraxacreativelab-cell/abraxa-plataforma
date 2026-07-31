-- ═══════════════════════════════════════════════════════════════════════════
--  030_vault_documents.sql — H4 · La Bóveda (1/4): documentos y biblioteca
--
--  LA REGLA DE DISEÑO QUE ESTE ARCHIVO SOSTIENE:
--
--    El documento ES la fuente de verdad. Los valores canónicos (031) son una
--    PROYECCIÓN de él. Por eso los documentos se crean primero y por eso
--    `canonical_values.source_doc_id` apunta aquí con una llave foránea de
--    verdad: si no puedes rastrear de qué documento salió un número, la
--    proyección deja de ser una proyección y se vuelve un dato inventado con
--    mejor reputación.
--
--  Y por eso existe `document_versions`: editar un documento no pisa su
--  historia. Cuando el emprendedor pregunte "¿de dónde salió que mi comisión
--  es 15%?", la respuesta tiene que existir.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 1. Documentos
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE app.documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  area_slug     text,
  title         text NOT NULL,
  content       text NOT NULL,
  doc_type      text NOT NULL DEFAULT 'otro'
                CHECK (doc_type IN ('sop','contrato','precios','guion','politica',
                                    'manual','faq','plantilla','otro')),
  status        text NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','active','archived')),
  version       int  NOT NULL DEFAULT 1 CHECK (version >= 1),
  source_kind   text NOT NULL DEFAULT 'paste'
                CHECK (source_kind IN ('paste','upload','agent','connector','manual')),
  tags          text[] NOT NULL DEFAULT '{}',
  -- Confianza de la clasificación automática. NULL = lo clasificó una persona.
  confidence    numeric(3,2) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app.documents ENABLE ROW LEVEL SECURITY;


-- ───────────────────────────────────────────────────────────────────────────
-- 2. Historia. Una fila por versión anterior; la vigente vive en `documents`.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE app.document_versions (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES app.documents(id) ON DELETE CASCADE,
  version     int  NOT NULL,
  title       text NOT NULL,
  content     text NOT NULL,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app.document_versions ENABLE ROW LEVEL SECURITY;


-- ───────────────────────────────────────────────────────────────────────────
-- 3. Índices
--
--    El GIN de texto completo en español es la búsqueda LÉXICA de la
--    biblioteca. Existe a propósito junto a la semántica de la 032: cuando la
--    cuenta de OpenAI se queda sin cuota —y en GARDEN pasó el 2026-07-28— los
--    embeddings devuelven NULL y la búsqueda semántica se queda ciega. El
--    índice de texto no depende de ningún proveedor externo y sigue
--    contestando. Degradar es mejor que apagarse.
-- ───────────────────────────────────────────────────────────────────────────

CREATE INDEX documents_tenant_area_idx ON app.documents (tenant_id, area_slug);
CREATE INDEX documents_tenant_type_idx ON app.documents (tenant_id, doc_type);
CREATE INDEX documents_tenant_updated_idx ON app.documents (tenant_id, updated_at DESC);

CREATE INDEX documents_fts_idx ON app.documents
  USING gin (to_tsvector('spanish', coalesce(title,'') || ' ' || coalesce(content,'')));

CREATE UNIQUE INDEX document_versions_doc_version_idx
  ON app.document_versions (document_id, version);


-- ───────────────────────────────────────────────────────────────────────────
-- 4. `updated_at` que no depende de que nadie se acuerde de mandarlo.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION app.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER documents_touch_updated_at
  BEFORE UPDATE ON app.documents
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();


-- ───────────────────────────────────────────────────────────────────────────
-- 5. Búsqueda léxica.
--
--    Existe como función y no como filtro de PostgREST porque el índice de
--    arriba es sobre una EXPRESIÓN (`title || content`), y el operador `fts`
--    de PostgREST sólo sabe apuntar a una columna: sin esta función la
--    consulta ignoraría el índice y haría scan completo.
--
--    Filtra por tenant DENTRO del SQL, igual que la búsqueda semántica de la
--    032: el aislamiento no depende de que el llamador se acuerde.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION app.search_documents(
  p_tenant_id uuid,
  p_query     text,
  p_limit     int DEFAULT 8
)
RETURNS TABLE (
  id         uuid,
  title      text,
  area_slug  text,
  doc_type   text,
  excerpt    text,
  rank       double precision
)
LANGUAGE sql
STABLE
SET search_path = app, pg_catalog
AS $$
  WITH q AS (SELECT websearch_to_tsquery('spanish', coalesce(p_query, '')) AS tsq)
  SELECT d.id,
         d.title,
         d.area_slug,
         d.doc_type,
         ts_headline(
           'spanish',
           d.content,
           q.tsq,
           'MaxWords=28, MinWords=12, ShortWord=3, MaxFragments=1, FragmentDelimiter= … '
         ) AS excerpt,
         ts_rank(
           to_tsvector('spanish', coalesce(d.title,'') || ' ' || coalesce(d.content,'')),
           q.tsq
         )::double precision AS rank
    FROM app.documents d, q
   WHERE d.tenant_id = p_tenant_id
     AND d.status <> 'archived'
     AND q.tsq IS NOT NULL
     AND to_tsvector('spanish', coalesce(d.title,'') || ' ' || coalesce(d.content,'')) @@ q.tsq
   -- Por ordinal y no por nombre: `rank` también es una columna de salida del
   -- RETURNS TABLE, y escribirlo suelto puede resolverse a la otra y fallar con
   -- "column reference is ambiguous".
   ORDER BY 6 DESC
   LIMIT greatest(1, least(coalesce(p_limit, 8), 50));
$$;


COMMENT ON TABLE app.documents IS
  'Fuente de verdad de la bóveda. Los valores canónicos de app.canonical_values '
  'son una proyección de estos documentos, no al revés.';

COMMENT ON FUNCTION app.search_documents IS
  'Búsqueda léxica en español. Complementa a match_knowledge_chunks: cuando el '
  'proveedor de embeddings no responde, ésta sigue contestando.';

COMMENT ON TABLE app.document_versions IS
  'Historia de ediciones. Editar un documento archiva aquí la versión anterior '
  'antes de pisarla: la trazabilidad de un número es parte del producto.';
