-- ═══════════════════════════════════════════════════════════════════════════
--  031_vault_values.sql — H4 · La Bóveda (2/4): valores canónicos
--
--  El único lugar donde vive un número del negocio. Se define una vez y se
--  propaga a contratos, mensajes y a los prompts de los agentes vía
--  {valor.*} / {precio.*}.
--
--  TRES DECISIONES QUE NO SON DE ESTILO:
--
--  1. `active` NACE EN false. Cuando la ingesta extrae un valor de un
--     documento, queda PROPUESTO. Lo aprueba el emprendedor con un clic.
--     Nada se activa solo. Un agente citando una cifra que nadie aprobó es
--     exactamente el fallo que esta tabla existe para evitar.
--
--  2. La tabla se llama `canonical_values` y no lo que dice el handoff.
--     `VALUES` es palabra reservada en PostgreSQL: crear una tabla con ese
--     nombre no parsea, y usarla obligaría a escribirla entre comillas dobles
--     en cada referencia, para siempre. (Reportado en el PR.)
--
--  3. `source_doc_id` lleva llave foránea de verdad. Sin ella, borrar un
--     documento dejaría valores huérfanos apuntando a la nada y la
--     trazabilidad —que es el corazón del diseño— se rompería en silencio.
--
--  4. LAS COLUMNAS `conflict_*` NO SON UN LUJO. Reingerir un documento no
--     puede pisar un valor que una persona ya aprobó: si el documento nuevo
--     dice $900 donde el aprobado dice $850, la ingesta NO decide. Deja el
--     $850 vigente, guarda el $900 aquí y lo marca en conflicto para que lo
--     resuelva quien responde por esa cifra. Un upsert a secas haría lo
--     contrario —pisar el número y apagar la aprobación— en silencio, y el
--     emprendedor se enteraría cuando un contrato saliera con el precio que
--     nunca aprobó.
--
--  Alcances: sólo `tenant` y `area`. GARDEN tenía además `socio` y
--  `propiedad`; son vocabulario de una inmobiliaria y no se heredan.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE app.canonical_values (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  key           text NOT NULL,
  label         text NOT NULL,
  kind          text NOT NULL
                CHECK (kind IN ('money','percent','number','text','date','bool','list')),
  value         numeric,
  value_text    text,
  value_json    jsonb,
  currency      text NOT NULL DEFAULT 'MXN',
  unit          text,
  note          text,
  -- Dónde se ARCHIVA el valor (para agrupar en la UI). Distinto de `scope_id`,
  -- que es a qué área APLICA cuando scope_type='area'.
  area_slug     text,
  scope_type    text NOT NULL DEFAULT 'tenant' CHECK (scope_type IN ('tenant','area')),
  scope_id      text NOT NULL DEFAULT '',
  active        boolean NOT NULL DEFAULT false,
  source_doc_id uuid REFERENCES app.documents(id) ON DELETE SET NULL,
  position      int  NOT NULL DEFAULT 0,
  approved_at   timestamptz,
  approved_by   text,

  -- ── Conflicto pendiente de resolver ──────────────────────────────────────
  -- Lo que un documento POSTERIOR propone para un valor que ya estaba
  -- aprobado. Vive aquí, al lado, sin tocar la cifra vigente. `conflict_at`
  -- es el marcador: si es NULL, no hay conflicto.
  conflict_value      numeric,
  conflict_value_text text,
  conflict_currency   text,
  conflict_note       text,
  -- SET NULL y no CASCADE: si el documento que trajo la contradicción se
  -- borra, el conflicto sigue abierto —alguien tiene que decidir— aunque ya
  -- no se pueda enseñar de dónde salió.
  conflict_doc_id     uuid REFERENCES app.documents(id) ON DELETE SET NULL,
  conflict_at         timestamptz,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- snake_case y nada más: la clave se escribe en plantillas como {valor.x}.
  CONSTRAINT canonical_values_key_snake CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  -- Un valor "por área" sin área es un valor que nunca gana nada.
  CONSTRAINT canonical_values_area_needs_id CHECK (scope_type <> 'area' OR scope_id <> ''),
  -- Y uno general no puede traer un scope_id colgando que confunda el ranking.
  CONSTRAINT canonical_values_tenant_no_id CHECK (scope_type <> 'tenant' OR scope_id = ''),
  -- La moneda del conflicto, si existe, va en el mismo formato que la vigente.
  CONSTRAINT canonical_values_conflict_currency CHECK (
    conflict_currency IS NULL OR conflict_currency ~ '^[A-Z]{3}$'
  ),
  -- Un conflicto sin fecha sería invisible para la UI y para el badge: la
  -- contradicción existiría en la base y nadie se enteraría nunca.
  CONSTRAINT canonical_values_conflict_needs_at CHECK (
    conflict_at IS NOT NULL
    OR (conflict_value IS NULL AND conflict_value_text IS NULL
        AND conflict_currency IS NULL AND conflict_note IS NULL
        AND conflict_doc_id IS NULL)
  )
);

ALTER TABLE app.canonical_values ENABLE ROW LEVEL SECURITY;


-- ───────────────────────────────────────────────────────────────────────────
-- El índice único que la ingesta necesita.
--
-- El pipeline hace upsert con onConflict='tenant_id,key,scope_type,scope_id'.
-- Sin este índice el primer documento entra y el segundo revienta. (El handoff
-- lo da por hecho pero no lo declara; reportado en el PR.)
-- ───────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX canonical_values_identity_idx
  ON app.canonical_values (tenant_id, key, scope_type, scope_id);

-- La consulta caliente: el resolver pide todos los valores VIGENTES del tenant.
CREATE INDEX canonical_values_active_idx
  ON app.canonical_values (tenant_id, active) WHERE active;

-- "¿qué valores salieron de este documento?" — la vista de trazabilidad.
CREATE INDEX canonical_values_source_doc_idx
  ON app.canonical_values (source_doc_id) WHERE source_doc_id IS NOT NULL;

-- "¿qué tengo pendiente de aprobar?" — el badge del panel de Dirección.
CREATE INDEX canonical_values_drafts_idx
  ON app.canonical_values (tenant_id) WHERE NOT active;

-- "¿qué documento nuevo contradice algo que ya aprobé?" — el otro badge, y el
-- que de verdad urge: mientras no se resuelva, la bóveda tiene una cifra
-- vigente que un documento posterior desmiente.
CREATE INDEX canonical_values_conflicts_idx
  ON app.canonical_values (tenant_id) WHERE conflict_at IS NOT NULL;

-- "¿qué conflictos trajo este documento?" — la vista de trazabilidad al revés.
CREATE INDEX canonical_values_conflict_doc_idx
  ON app.canonical_values (conflict_doc_id) WHERE conflict_doc_id IS NOT NULL;


CREATE TRIGGER canonical_values_touch_updated_at
  BEFORE UPDATE ON app.canonical_values
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();


COMMENT ON TABLE app.canonical_values IS
  'Valores canónicos del negocio. active=false por defecto: todo valor extraído '
  'de un documento nace en BORRADOR y lo aprueba el emprendedor. Nada se activa solo.';

COMMENT ON COLUMN app.canonical_values.conflict_at IS
  'Marcador de conflicto: un documento posterior propone otra cifra para un '
  'valor YA APROBADO. La vigente no se toca; la propuesta espera en conflict_*. '
  'NULL = sin conflicto.';

COMMENT ON COLUMN app.canonical_values.area_slug IS
  'Dónde se archiva el valor (agrupación en la UI). Para el alcance jerárquico '
  'manda scope_type/scope_id, no esta columna.';
