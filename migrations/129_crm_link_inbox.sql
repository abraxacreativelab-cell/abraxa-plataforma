-- ═══════════════════════════════════════════════════════════════════════════
--  129_crm_link_inbox.sql — H15
--
--  CIERRA EL HUECO QUE ABRIÓ H6 A SABIENDAS.
--
--  `app.threads.contact_id uuid` se declaró SIN REFERENCES porque cuando se
--  escribió 040 no existía `app.contacts` (H6-inbox.md:110). Ahora existe, y
--  esta migración pone la FK que faltaba.
--
--  ── Por qué está en el bloque 120–129 y no en el de H6 ────────────────────
--
--  `scripts/migrate.mjs` aplica por NOMBRE de archivo. `app.contacts` nace en
--  120, así que la FK sólo puede escribirse en un archivo con número MAYOR que
--  120 — y 049 no lo es. Escribirla en el bloque de H6 fallaría en cualquier
--  ambiente nuevo: 040 correría antes de que existiera la tabla a la que
--  apunta. Por eso vive aquí, al final del bloque de H15.
--
--  ── Por qué todo va dentro de un DO guardado ──────────────────────────────
--
--  H15 y H6 son carriles paralelos y no hay garantía de cuál mergea primero.
--  Si 040 todavía no se aplicó, `app.threads` no existe y un ALTER TABLE
--  desnudo abortaría la migración entera — dejando 120, 121 y 122 aplicadas y
--  el libro de migraciones a medias.
--
--  Guardado, esta migración es un no-op silencioso si H6 aún no aterrizó, y se
--  vuelve efectiva sola en cuanto lo haga. Es idempotente: correrla dos veces
--  no hace nada la segunda.
--
--  NOTA PARA EL ORQUESTADOR: si al aplicar esto `app.threads` todavía no
--  existía, hay que volver a correr esta migración DESPUÉS de mergear H6. El
--  runner no la reaplica sola (ya está en `app.schema_migrations`), así que
--  ejecuta a mano el bloque de abajo o escribe la FK en una migración nueva.
--  El aviso sale en el log de `npm run migrate`.
--
--  ── Por qué NOT VALID ─────────────────────────────────────────────────────
--
--  `NOT VALID` hace que Postgres NO revise las filas que ya están, pero SÍ
--  todas las nuevas — que es exactamente lo que se quiere. Si H6 ya escribió
--  hilos con un `contact_id` que no apunta a nada (posible: hasta hoy no había
--  a dónde apuntar), una FK validada abortaría el despliegue completo por
--  datos históricos. Con `NOT VALID` la puerta queda cerrada de hoy en
--  adelante y la limpieza del pasado se hace cuando alguien la mire:
--
--      UPDATE app.threads t SET contact_id = NULL
--       WHERE contact_id IS NOT NULL
--         AND NOT EXISTS (SELECT 1 FROM app.contacts c WHERE c.id = t.contact_id);
--      ALTER TABLE app.threads VALIDATE CONSTRAINT threads_contact_id_fkey;
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'app' AND table_name = 'threads'
  ) THEN
    RAISE NOTICE
      'H15/129: app.threads todavía no existe (H6 no ha mergeado). La FK '
      'threads.contact_id -> contacts.id NO se creó. Vuelve a aplicar este '
      'bloque después de mergear H6.';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'app' AND table_name = 'threads' AND column_name = 'contact_id'
  ) THEN
    RAISE NOTICE
      'H15/129: app.threads existe pero no tiene la columna contact_id. '
      'No se creó la FK.';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'threads_contact_id_fkey'
       AND conrelid = 'app.threads'::regclass
  ) THEN
    RAISE NOTICE 'H15/129: la FK threads_contact_id_fkey ya existe. Nada que hacer.';
    RETURN;
  END IF;

  -- ON DELETE SET NULL y no CASCADE: borrar un contacto no puede llevarse la
  -- conversación. El historial del mensaje es del negocio, no del contacto —
  -- y de todas formas una fusión NUNCA borra (ver `merged_into` en 120).
  ALTER TABLE app.threads
    ADD CONSTRAINT threads_contact_id_fkey
    FOREIGN KEY (contact_id) REFERENCES app.contacts(id) ON DELETE SET NULL
    NOT VALID;

  RAISE NOTICE 'H15/129: FK threads.contact_id -> contacts.id creada (NOT VALID).';
END
$$;


-- Índice para "todos los hilos de este contacto", que es la consulta de la
-- pantalla de contacto. Guardado por la misma razón que arriba.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'app' AND table_name = 'threads' AND column_name = 'contact_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS threads_contact_idx
      ON app.threads (tenant_id, contact_id) WHERE contact_id IS NOT NULL;
  END IF;
END
$$;
