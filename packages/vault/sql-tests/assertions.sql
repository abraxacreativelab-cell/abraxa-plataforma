-- ════════════════════════════════════════════════════════════════════════════
--  Lo que el doble en memoria NO puede probar: que la base haga lo que dice.
--  Cada bloque LANZA si la aserción falla, así que `psql -v ON_ERROR_STOP=1`
--  devuelve != 0 en cuanto algo se rompe.
-- ════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.debe(cond boolean, msg text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT cond THEN RAISE EXCEPTION '✖ %', msg; END IF;
  RAISE NOTICE '  ✔ %', msg;
END $$;

-- Tenant de trabajo
INSERT INTO app.tenants (id, slug, name, industry_type)
VALUES ('11111111-1111-4111-8111-111111111111', 'verif', 'Verificación', 'servicios');
INSERT INTO app.tenants (id, slug, name, industry_type)
VALUES ('22222222-2222-4222-8222-222222222222', 'otra', 'La otra empresa', 'comercio');

\echo ''
\echo '── Esquema y siembra ──────────────────────────────────────────────────'

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM app.industry_templates;
  PERFORM pg_temp.debe(n = 5, format('el catálogo de giros tiene 5 filas (tiene %s)', n));

  SELECT count(*) INTO n FROM app.industry_templates
   WHERE lower(areas::text || expected_docs::text || expected_values::text)
         ~ '(propiedad|socio|inperio|huesped|guesty|airbnb|chapa|blancos)';
  PERFORM pg_temp.debe(n = 0, 'cero vocabulario de property management en la siembra');

  SELECT count(*) INTO n FROM app.industry_templates
   WHERE NOT (areas @> '[{"slug":"direccion"}]'::jsonb);
  PERFORM pg_temp.debe(n = 0, 'los 5 giros incluyen el área Dirección');
END $$;

\echo ''
\echo '── Restricciones de canonical_values ──────────────────────────────────'

DO $$
DECLARE v_active boolean; ok boolean;
BEGIN
  -- active nace en false
  INSERT INTO app.canonical_values (tenant_id, key, label, kind, value)
  VALUES ('11111111-1111-4111-8111-111111111111', 'precio_hora', 'Precio por hora', 'money', 900)
  RETURNING active INTO v_active;
  PERFORM pg_temp.debe(v_active = false, 'active nace en FALSE: nada se activa solo');

  -- el índice único rechaza el duplicado
  ok := false;
  BEGIN
    INSERT INTO app.canonical_values (tenant_id, key, label, kind, value)
    VALUES ('11111111-1111-4111-8111-111111111111', 'precio_hora', 'X', 'money', 1);
  EXCEPTION WHEN unique_violation THEN ok := true;
  END;
  PERFORM pg_temp.debe(ok, 'el índice único rechaza (tenant, key, scope) repetido');

  -- y el upsert de la ingesta funciona contra ese mismo índice
  INSERT INTO app.canonical_values (tenant_id, key, label, kind, value)
  VALUES ('11111111-1111-4111-8111-111111111111', 'precio_hora', 'Precio por hora', 'money', 1100)
  ON CONFLICT (tenant_id, key, scope_type, scope_id) DO UPDATE SET value = EXCLUDED.value;
  PERFORM pg_temp.debe(
    (SELECT value FROM app.canonical_values
      WHERE tenant_id = '11111111-1111-4111-8111-111111111111' AND key = 'precio_hora') = 1100,
    'el upsert ON CONFLICT de la ingesta actualiza en vez de reventar');

  -- clave que no es snake_case
  ok := false;
  BEGIN
    INSERT INTO app.canonical_values (tenant_id, key, label, kind, value_text)
    VALUES ('11111111-1111-4111-8111-111111111111', 'Precio Hora', 'X', 'text', 'x');
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  PERFORM pg_temp.debe(ok, 'el CHECK rechaza una clave que no es snake_case');

  -- alcance por área sin área
  ok := false;
  BEGIN
    INSERT INTO app.canonical_values (tenant_id, key, label, kind, value_text, scope_type, scope_id)
    VALUES ('11111111-1111-4111-8111-111111111111', 'x_area', 'X', 'text', 'x', 'area', '');
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  PERFORM pg_temp.debe(ok, 'el CHECK rechaza un alcance por área sin área');

  -- kind inventado
  ok := false;
  BEGIN
    INSERT INTO app.canonical_values (tenant_id, key, label, kind, value)
    VALUES ('11111111-1111-4111-8111-111111111111', 'x_kind', 'X', 'moneda', 1);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  PERFORM pg_temp.debe(ok, 'el CHECK rechaza un kind fuera de los siete');

  -- alcance por área SÍ se permite con su área: es el override
  INSERT INTO app.canonical_values (tenant_id, key, label, kind, value, scope_type, scope_id)
  VALUES ('11111111-1111-4111-8111-111111111111', 'precio_hora', 'Precio en ventas', 'money', 1500, 'area', 'ventas');
  PERFORM pg_temp.debe(
    (SELECT count(*) FROM app.canonical_values
      WHERE tenant_id = '11111111-1111-4111-8111-111111111111' AND key = 'precio_hora') = 2,
    'la misma clave convive en dos alcances distintos');
END $$;

\echo ''
\echo '── Documentos, trazabilidad y versiones ───────────────────────────────'

DO $$
DECLARE doc_id uuid; despues timestamptz; huerfano uuid; ok boolean;
BEGIN
  INSERT INTO app.documents (tenant_id, title, content, doc_type, area_slug, status)
  VALUES ('11111111-1111-4111-8111-111111111111', 'Tarifas de servicio',
          'La tarifa de puesta en marcha se cobra una sola vez al inicio del proyecto.',
          'precios', 'ventas', 'active')
  RETURNING id INTO doc_id;

  -- El trigger de updated_at, probado de forma que no dependa del reloj:
  -- `now()` es constante dentro de una transacción, así que comparar antes/
  -- después no prueba nada aquí. En cambio, si el trigger PISA un valor
  -- escrito a mano, es que corrió.
  UPDATE app.documents SET title = 'Tarifas v2', updated_at = '2000-01-01' WHERE id = doc_id;
  SELECT updated_at INTO despues FROM app.documents WHERE id = doc_id;
  PERFORM pg_temp.debe(
    despues > '2020-01-01'::timestamptz,
    'el trigger touch_updated_at pisa el valor escrito a mano: dispara solo');

  -- historial: una versión por documento
  INSERT INTO app.document_versions (tenant_id, document_id, version, title, content)
  VALUES ('11111111-1111-4111-8111-111111111111', doc_id, 1, 'Tarifas de servicio', 'v1');
  ok := false;
  BEGIN
    INSERT INTO app.document_versions (tenant_id, document_id, version, title, content)
    VALUES ('11111111-1111-4111-8111-111111111111', doc_id, 1, 'dup', 'dup');
  EXCEPTION WHEN unique_violation THEN ok := true;
  END;
  PERFORM pg_temp.debe(ok, 'no se puede archivar dos veces la misma versión');

  -- ON DELETE SET NULL: la trazabilidad no queda colgando
  UPDATE app.canonical_values SET source_doc_id = doc_id
   WHERE tenant_id = '11111111-1111-4111-8111-111111111111' AND key = 'precio_hora' AND scope_type = 'tenant';
  DELETE FROM app.documents WHERE id = doc_id;
  SELECT source_doc_id INTO huerfano FROM app.canonical_values
   WHERE tenant_id = '11111111-1111-4111-8111-111111111111' AND key = 'precio_hora' AND scope_type = 'tenant';
  PERFORM pg_temp.debe(huerfano IS NULL, 'borrar un documento deja source_doc_id en NULL, no colgando');
END $$;

\echo ''
\echo '── Las dos funciones SQL (PostgREST no expone <=> ni FTS por expresión) ─'

DO $$
DECLARE doc_id uuid; n int; sim double precision;
BEGIN
  INSERT INTO app.documents (tenant_id, title, content, doc_type, status)
  VALUES ('11111111-1111-4111-8111-111111111111', 'Política de envíos',
          'Los envíos a la zona metropolitana cuestan ciento ochenta pesos por paquete.',
          'politica', 'active')
  RETURNING id INTO doc_id;

  -- Un documento de la OTRA empresa, con las mismas palabras.
  INSERT INTO app.documents (tenant_id, title, content, doc_type, status)
  VALUES ('22222222-2222-4222-8222-222222222222', 'Envíos de la otra',
          'Los envíos a la zona metropolitana de la otra empresa son gratis.',
          'politica', 'active');

  SELECT count(*) INTO n FROM app.search_documents(
    '11111111-1111-4111-8111-111111111111', 'envios zona metropolitana', 5);
  PERFORM pg_temp.debe(n = 1, format('search_documents encuentra y AÍSLA por tenant (devolvió %s)', n));

  PERFORM pg_temp.debe(
    (SELECT excerpt FROM app.search_documents(
       '11111111-1111-4111-8111-111111111111', 'envios', 1)) <> '',
    'search_documents devuelve el fragmento resaltado');

  PERFORM pg_temp.debe(
    (SELECT count(*) FROM app.search_documents(
       '11111111-1111-4111-8111-111111111111', 'palabraquenoexiste', 5)) = 0,
    'search_documents no inventa resultados');

  -- Vector: un trozo con embedding y otro sin él, conviviendo.
  INSERT INTO app.knowledge_chunks (tenant_id, document_id, content, chunk_index, embedding)
  VALUES ('11111111-1111-4111-8111-111111111111', doc_id, 'Los envíos cuestan ciento ochenta pesos.', 0,
          ('[' || 1 || repeat(',0', 1535) || ']')::extensions.vector);

  INSERT INTO app.knowledge_chunks (tenant_id, document_id, content, chunk_index, embedding)
  VALUES ('11111111-1111-4111-8111-111111111111', doc_id, 'Fragmento sin indexar todavía.', 1, NULL);

  PERFORM pg_temp.debe(true, 'embedding NULL convive con el índice parcial (backfill posible)');

  SELECT count(*), max(similarity) INTO n, sim FROM app.match_knowledge_chunks(
    '11111111-1111-4111-8111-111111111111',
    ('[' || 1 || repeat(',0', 1535) || ']')::extensions.vector, 5, 0.5);
  PERFORM pg_temp.debe(n = 1, format('match_knowledge_chunks devuelve sólo lo que tiene vector (%s)', n));
  PERFORM pg_temp.debe(sim > 0.99, format('la similitud consigo mismo es ~1 (%s)', round(sim::numeric, 4)));

  SELECT count(*) INTO n FROM app.match_knowledge_chunks(
    '22222222-2222-4222-8222-222222222222',
    ('[' || 1 || repeat(',0', 1535) || ']')::extensions.vector, 5, 0.0);
  PERFORM pg_temp.debe(n = 0, 'match_knowledge_chunks NO filtra nada de otro tenant');
END $$;

\echo ''
\echo '── Índices y RLS ──────────────────────────────────────────────────────'

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_indexes
   WHERE schemaname = 'app' AND indexname = 'knowledge_chunks_embedding_idx'
     AND indexdef ILIKE '%hnsw%' AND indexdef ILIKE '%WHERE (embedding IS NOT NULL)%';
  PERFORM pg_temp.debe(n = 1, 'el índice HNSW existe y es PARCIAL (WHERE embedding IS NOT NULL)');

  SELECT count(*) INTO n FROM pg_indexes
   WHERE schemaname = 'app' AND indexname = 'documents_fts_idx' AND indexdef ILIKE '%spanish%';
  PERFORM pg_temp.debe(n = 1, 'el índice de texto completo en español existe');

  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'app'
     AND c.relname IN ('canonical_values','documents','document_versions','knowledge_chunks','industry_templates')
     AND c.relrowsecurity;
  PERFORM pg_temp.debe(n = 5, format('las 5 tablas de la bóveda tienen RLS activo (%s de 5)', n));

  -- RLS activo SIN políticas = negado para todos menos quien hace bypass.
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'app';
  PERFORM pg_temp.debe(n = 0, 'fail-closed: RLS sin políticas, sólo service_role pasa');
END $$;

\echo ''
\echo '── La llave anónima no lee nada ───────────────────────────────────────'

DO $$
DECLARE ok boolean := false;
BEGIN
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM 1 FROM app.canonical_values LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  RESET ROLE;
  PERFORM pg_temp.debe(ok, 'el rol anon recibe "permission denied" en la bóveda');
END $$;

\echo ''
\echo '✔ TODAS LAS ASERCIONES DE SQL PASARON'
