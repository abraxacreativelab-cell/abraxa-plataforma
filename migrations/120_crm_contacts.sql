-- ═══════════════════════════════════════════════════════════════════════════
--  120_crm_contacts.sql — H15
--
--  LA TABLA QUE NO EXISTÍA.
--
--  H6 declaró `app.threads.contact_id uuid` SIN REFERENCES (040_inbox.sql, y
--  su handoff lo dice en H6-inbox.md:110) porque no había a qué apuntar. Tres
--  nodos de H8 (`assign_owner`, `move_stage`, `add_tag`) y cuatro de sus
--  disparadores (`contact_created`, `stage_changed`, `tag_added`,
--  `form_submitted`) tampoco tenían dónde escribir.
--
--  Aquí nace ese destino.
--
--  ── La decisión de diseño que separa esto de GARDEN ────────────────────────
--
--  GARDEN guarda `email` y `phone` como DOS COLUMNAS PLANAS en `crm_contacts`
--  (src/crm/types.ts:66-67). Consecuencias medidas en ese repo:
--
--    · Una persona con dos teléfonos es dos contactos. No hay dónde poner el
--      segundo.
--    · Instagram y Messenger no caben en ninguna columna: viven en
--      `external_ids jsonb`, que ningún índice único protege. Dos webhooks
--      concurrentes del mismo usuario de IG crean dos contactos.
--    · La deduplicación es un `Set` en memoria sobre TODAS las filas del tenant
--      (contacts/service.ts:243-254). No es una restricción, es una esperanza.
--
--  Aquí la dirección de un canal es una FILA, no una columna, y la unicidad
--  vive en el índice: `UNIQUE (tenant_id, channel, identifier)`. Dos webhooks
--  simultáneos del mismo número chocan contra Postgres (23505), no contra la
--  suerte.
--
--  ── Lo que se dejó fuera a propósito ───────────────────────────────────────
--
--  De las 34 columnas de `crm_contacts` de GARDEN, 9 son de Meta Ads
--  (`fbclid`, `fbc`, `fbp`, `attribution`, `first_landing_event_id`) y 4 son
--  del proceso de cuarentena de leads falsos de Inperio (`quarantined_at`,
--  `quarantine_reason`, `quarantine_rule`, `quarantined_by`). No son de un CRM:
--  son de una inmobiliaria que pauta en Facebook. Se quedan en GARDEN.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 1. El contacto — la persona, no su dirección.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE app.contacts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,

  display_name  text,
  first_name    text,
  last_name     text,
  company_name  text,

  -- Correo del humano responsable. Lo escribe el nodo `assign_owner` de H8.
  -- Es texto y no FK a `memberships` a propósito: un contacto puede seguir
  -- asignado a alguien que ya se fue de la empresa, y perder ese dato al
  -- borrar la membresía sería perder historia.
  owner_email   text,

  lifecycle     text NOT NULL DEFAULT 'lead'
                CHECK (lifecycle IN ('lead','prospect','customer','churned','unknown')),

  -- De dónde salió: 'whatsapp', 'formulario', 'import', 'manual', 'flow:<id>'…
  source        text,
  locale        text,

  /* Campos que el emprendedor invente. Sin tabla de definiciones todavía: el
     CRM de v1 no promete un constructor de campos, y una tabla vacía que nadie
     lee es exactamente la deuda que dejó `crm_workflow_versions` en GARDEN. */
  custom        jsonb NOT NULL DEFAULT '{}',

  -- ── Fusión ───────────────────────────────────────────────────────────────
  -- Un contacto fusionado NO se borra: se apunta al superviviente. Borrarlo
  -- rompería `threads.contact_id`, las corridas de H8 que lo enrolaron y la
  -- línea de tiempo. `resolveByIdentity` sigue esta cadena hasta el vivo.
  merged_into   uuid REFERENCES app.contacts(id) ON DELETE SET NULL,
  merged_at     timestamptz,

  last_activity_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Un contacto fusionado no puede tener a otro fusionado como destino sin que
-- alguien recorra la cadena; el servicio la recorre, pero esto la mantiene
-- corta y hace evidente el estado.
CREATE INDEX contacts_tenant_activity_idx
  ON app.contacts (tenant_id, last_activity_at DESC NULLS LAST);
CREATE INDEX contacts_tenant_owner_idx
  ON app.contacts (tenant_id, owner_email) WHERE owner_email IS NOT NULL;
CREATE INDEX contacts_merged_into_idx
  ON app.contacts (tenant_id, merged_into) WHERE merged_into IS NOT NULL;

-- Búsqueda por nombre desde la UI. `pg_trgm` no está habilitada en 001, así
-- que la búsqueda va por `ilike` sobre este índice de texto en minúsculas —
-- suficiente para los miles de contactos de un negocio chico, y sin agregar
-- una extensión desde un carril que no es el dueño de las extensiones.
CREATE INDEX contacts_tenant_name_idx
  ON app.contacts (tenant_id, lower(display_name));


-- ───────────────────────────────────────────────────────────────────────────
-- 2. Las identidades — N por contacto, una por canal y dirección.
--
--    `whatsapp:+528146811675`, `email:hola@abraxa.club`, `instagram:abraxa`…
--
--    ESTA TABLA ES EL PUNTO DE ENTRADA DE H6. Cuando entra un webhook, el
--    puente pregunta por (channel, identifier) y recibe un contact_id — creado
--    en ese mismo instante si no existía.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE app.contact_identities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  contact_id  uuid NOT NULL REFERENCES app.contacts(id) ON DELETE CASCADE,

  -- whatsapp | instagram | messenger | email | sms | web
  -- Deliberadamente SIN check: `ChannelType` crece con H12 y H13, y una
  -- migración de otro carril para agregar un valor a un CHECK es exactamente
  -- el acoplamiento que el contrato de no colisión existe para evitar.
  channel     text NOT NULL,

  -- Normalizado por `normalizarIdentidad()` (packages/crm/src/identity.ts):
  -- teléfonos a E.164 sin separadores, correos en minúsculas, arrobas fuera.
  -- La normalización vive en UN lugar y la prueba de este índice depende de
  -- ella: si dos caminos normalizan distinto, el índice no sirve de nada.
  identifier  text NOT NULL,

  -- Lo que llegó del canal, sin tocar. Sirve para depurar un choque de
  -- normalización sin tener que adivinar qué mandó el proveedor.
  raw         text,
  display     text,

  verified    boolean NOT NULL DEFAULT false,
  is_primary  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),

  -- ── La restricción que sostiene todo ─────────────────────────────────────
  -- Sin ella, dos webhooks concurrentes del mismo número crean dos contactos y
  -- el emprendedor ve su conversación partida en dos. Con ella, el segundo
  -- recibe 23505 y el servicio lo resuelve leyendo el ganador.
  UNIQUE (tenant_id, channel, identifier)
);

CREATE INDEX contact_identities_contact_idx
  ON app.contact_identities (tenant_id, contact_id);

-- Una sola identidad principal por contacto y canal. Es lo que hace que
-- "mándale un WhatsApp a este contacto" (nodo `send_message` de H8) tenga una
-- respuesta y no dos.
CREATE UNIQUE INDEX contact_identities_primary_idx
  ON app.contact_identities (tenant_id, contact_id, channel)
  WHERE is_primary;


-- ───────────────────────────────────────────────────────────────────────────
-- 3. Etiquetas — el disparador `tag_added` de H8 escribe aquí.
--
--    Texto libre y no una tabla de catálogo con FK: en GARDEN `crm_tags` es
--    una tabla de catálogo y `add_tag` recibe un `tagId`, lo que obliga al
--    asistente de flujos a resolver un UUID antes de poder etiquetar. Aquí la
--    etiqueta ES su nombre. El catálogo se deriva con un DISTINCT.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE app.contact_tags (
  tenant_id  uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES app.contacts(id) ON DELETE CASCADE,
  tag        text NOT NULL,
  added_by   text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, contact_id, tag)
);

CREATE INDEX contact_tags_tag_idx ON app.contact_tags (tenant_id, tag);


-- ───────────────────────────────────────────────────────────────────────────
-- 4. Bitácora de fusiones.
--
--    Fusionar es la única operación de este paquete que destruye información
--    percibida: dos tarjetas se vuelven una. Si se hizo mal, alguien tiene que
--    poder ver QUÉ se fusionó, CUÁNDO y QUIÉN lo pidió — y `payload` guarda la
--    fila del perdedor completa para poder reconstruirla a mano.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE app.contact_merges (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  winner_id  uuid NOT NULL REFERENCES app.contacts(id) ON DELETE CASCADE,
  loser_id   uuid NOT NULL REFERENCES app.contacts(id) ON DELETE CASCADE,
  merged_by  text,
  payload    jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX contact_merges_winner_idx ON app.contact_merges (tenant_id, winner_id);


-- ───────────────────────────────────────────────────────────────────────────
-- 5. RLS en las cuatro, en la MISMA migración que las crea.
--
--    RLS activo SIN políticas = negado para todos menos service_role, que hace
--    bypass. Fail-closed a propósito, igual que en 001: nadie habla con estas
--    tablas por PostgREST; todo pasa por la API con `tenantDb(ctx)`.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE app.contacts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.contact_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.contact_tags       ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.contact_merges     ENABLE ROW LEVEL SECURITY;


COMMENT ON TABLE app.contacts IS
  'La persona. Sus direcciones viven en app.contact_identities, una fila por '
  'canal. H15.';
COMMENT ON TABLE app.contact_identities IS
  'Dirección de un contacto en un canal. UNIQUE (tenant_id, channel, '
  'identifier) es lo que impide que dos webhooks del mismo número creen dos '
  'contactos. H15.';
COMMENT ON COLUMN app.contacts.merged_into IS
  'Superviviente de una fusión. Un contacto fusionado no se borra: se apunta. '
  'ContactsPort.resolveByIdentity sigue la cadena hasta el vivo.';
