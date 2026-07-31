-- ═══════════════════════════════════════════════════════════════════════════
--  123_crm_tenant_fk.sql — H15
--
--  LA INVARIANTE QUE NADIE SOSTENÍA: una fila hija nunca apunta a un contacto
--  de OTRA empresa.
--
--  ── El agujero ─────────────────────────────────────────────────────────────
--
--  120, 121 y 122 declaran las cuatro tablas hijas así:
--
--      tenant_id  uuid NOT NULL REFERENCES app.tenants(id)
--      contact_id uuid NOT NULL REFERENCES app.contacts(id)
--
--  Las dos columnas son correctas por separado y la pareja no lo es. La FK
--  simple sólo exige que el `contact_id` exista EN ALGÚN LADO de app.contacts
--  — no que exista dentro del mismo tenant. `tenantDb(ctx)` estampa
--  `tenant_id` en cada INSERT, así que la fila entra como del tenant A
--  apuntando a un contacto del tenant B, y Postgres la acepta.
--
--  Cómo se alcanza, sin tocar nada raro:
--
--      POST /crm/contacts/<uuid-de-un-contacto-del-tenant-B>/identities
--      { "channel": "whatsapp", "identifier": "+528146811675" }
--
--  desde una sesión del tenant A. No hay fuga de LECTURA —todos los SELECT van
--  por `tenantDb` y filtran por tenant— pero la fila queda escrita. Cuando
--  después llegue un webhook de ese número al tenant A, `resolveByIdentity` la
--  encuentra y devuelve el id del contacto de B como si fuera bueno. H6
--  escribiría `app.threads.contact_id = <contacto de B>` en un hilo del tenant
--  A, y basta un solo join `threads → contacts` sin filtro de tenant —un
--  reporte, un `select` embebido de PostgREST— para que el nombre de un
--  cliente de B aparezca en la bandeja de A.
--
--  Explotarlo exige conocer un UUID ajeno, así que no es alcanzable a ciegas.
--  Eso lo hace poco probable, no imposible: la diferencia entre "difícil" y
--  "no representable" es exactamente esta migración.
--
--  ── El arreglo ─────────────────────────────────────────────────────────────
--
--  `app.contacts` gana `UNIQUE (tenant_id, id)` —redundante para Postgres,
--  porque `id` ya es PK, pero es lo que permite que otra tabla referencie la
--  PAREJA— y las cinco FK hacia contactos pasan a ser compuestas. A partir de
--  aquí, el INSERT de arriba muere con 23503 en la base, no en una revisión de
--  código que alguien tiene que acordarse de hacer.
--
--  La defensa en el servicio (`exigirContacto()` en contacts/service.ts) llega
--  antes y da un 404 legible. Ésta es la que queda cuando alguien escriba una
--  ruta nueva y se le olvide llamarla.
--
--  ── Por qué no rompe nada ──────────────────────────────────────────────────
--
--  Es aditiva sobre tablas que todavía no existen en producción (120-122 no se
--  han aplicado). Toda fila que hoy sea válida lo sigue siendo: el servicio
--  nunca escribió una fila cruzada a propósito. Si al aplicarla alguna FK
--  fallara, ESA fila es precisamente el bug que esta migración existe para
--  impedir.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 1. La llave que hace referenciable la pareja (tenant_id, id).
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE app.contacts
  ADD CONSTRAINT contacts_tenant_id_key UNIQUE (tenant_id, id);


-- ───────────────────────────────────────────────────────────────────────────
-- 2. Las cinco FK hacia contactos, ahora compuestas.
--
--    `ON DELETE CASCADE` se conserva tal cual venía de 120/121/122: borrar el
--    tenant sigue llevándose todo, que es lo que hace que dar de baja a un
--    cliente no deje huérfanos.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE app.contact_identities
  DROP CONSTRAINT IF EXISTS contact_identities_contact_id_fkey,
  ADD CONSTRAINT contact_identities_contact_fkey
    FOREIGN KEY (tenant_id, contact_id)
    REFERENCES app.contacts (tenant_id, id) ON DELETE CASCADE;

ALTER TABLE app.contact_tags
  DROP CONSTRAINT IF EXISTS contact_tags_contact_id_fkey,
  ADD CONSTRAINT contact_tags_contact_fkey
    FOREIGN KEY (tenant_id, contact_id)
    REFERENCES app.contacts (tenant_id, id) ON DELETE CASCADE;

ALTER TABLE app.contact_stages
  DROP CONSTRAINT IF EXISTS contact_stages_contact_id_fkey,
  ADD CONSTRAINT contact_stages_contact_fkey
    FOREIGN KEY (tenant_id, contact_id)
    REFERENCES app.contacts (tenant_id, id) ON DELETE CASCADE;

ALTER TABLE app.contact_events
  DROP CONSTRAINT IF EXISTS contact_events_contact_id_fkey,
  ADD CONSTRAINT contact_events_contact_fkey
    FOREIGN KEY (tenant_id, contact_id)
    REFERENCES app.contacts (tenant_id, id) ON DELETE CASCADE;

-- La bitácora de fusiones apunta DOS veces a contactos. Una fusión que cruzara
-- la frontera sería la peor de todas: mueve identidades y línea de tiempo.
-- `merge.ts` ya lo impide leyendo ganador y perdedor por `tenantDb` (los dos
-- salen NOT_FOUND si son de otra empresa); esto lo vuelve irrepresentable.
ALTER TABLE app.contact_merges
  DROP CONSTRAINT IF EXISTS contact_merges_winner_id_fkey,
  ADD CONSTRAINT contact_merges_winner_fkey
    FOREIGN KEY (tenant_id, winner_id)
    REFERENCES app.contacts (tenant_id, id) ON DELETE CASCADE;

ALTER TABLE app.contact_merges
  DROP CONSTRAINT IF EXISTS contact_merges_loser_id_fkey,
  ADD CONSTRAINT contact_merges_loser_fkey
    FOREIGN KEY (tenant_id, loser_id)
    REFERENCES app.contacts (tenant_id, id) ON DELETE CASCADE;


-- ───────────────────────────────────────────────────────────────────────────
-- 3. Las etapas y los embudos, por la misma razón.
--
--    `contact_stages` referencia `pipelines` y `pipeline_stages` con la misma
--    forma simple, y el agujero es idéntico: colocar un contacto del tenant A
--    en una etapa del embudo del tenant B. `resolverEmbudo`/`resolverEtapa` ya
--    leen por `tenantDb` y no lo permiten desde el servicio; aquí se cierra en
--    la base.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE app.pipelines
  ADD CONSTRAINT pipelines_tenant_id_key UNIQUE (tenant_id, id);

ALTER TABLE app.pipeline_stages
  ADD CONSTRAINT pipeline_stages_tenant_id_key UNIQUE (tenant_id, id);

ALTER TABLE app.pipeline_stages
  DROP CONSTRAINT IF EXISTS pipeline_stages_pipeline_id_fkey,
  ADD CONSTRAINT pipeline_stages_pipeline_fkey
    FOREIGN KEY (tenant_id, pipeline_id)
    REFERENCES app.pipelines (tenant_id, id) ON DELETE CASCADE;

ALTER TABLE app.contact_stages
  DROP CONSTRAINT IF EXISTS contact_stages_pipeline_id_fkey,
  ADD CONSTRAINT contact_stages_pipeline_fkey
    FOREIGN KEY (tenant_id, pipeline_id)
    REFERENCES app.pipelines (tenant_id, id) ON DELETE CASCADE;

ALTER TABLE app.contact_stages
  DROP CONSTRAINT IF EXISTS contact_stages_stage_id_fkey,
  ADD CONSTRAINT contact_stages_stage_fkey
    FOREIGN KEY (tenant_id, stage_id)
    REFERENCES app.pipeline_stages (tenant_id, id) ON DELETE CASCADE;


COMMENT ON CONSTRAINT contacts_tenant_id_key ON app.contacts IS
  'Redundante para Postgres (id ya es PK) y necesaria para las FK compuestas '
  'de las tablas hijas: es lo que hace que una identidad, una etiqueta, una '
  'posición de embudo o un evento NO puedan apuntar a un contacto de otra '
  'empresa. H15, migración 123.';
