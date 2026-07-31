-- ═══════════════════════════════════════════════════════════════════════════
--  121_crm_pipeline.sql — H15
--
--  El embudo: dónde va cada contacto y qué sigue.
--
--  ── Por qué el contacto se mueve de etapa y no una "oportunidad" ───────────
--
--  GARDEN modela `crm_opportunities` como entidad aparte: el contacto vive en
--  una tabla y su avance en otra, unidas por `contact_id`. Eso es correcto
--  para una inmobiliaria donde una persona compra tres departamentos y cada
--  uno avanza a su ritmo.
--
--  No es correcto para el negocio de una persona. Ahí "el lead" y "el trato"
--  son la misma cosa, y separarlos obliga a crear una oportunidad vacía para
--  cada contacto sólo para poder arrastrarlo en el tablero. El disparador
--  `stage_changed` de H8 tampoco sabría cuál de las tres oportunidades disparó.
--
--  Aquí un contacto TIENE una etapa dentro de un embudo — `app.contact_stages`,
--  con PK (tenant_id, contact_id, pipeline_id). Un contacto puede estar en
--  varios embudos a la vez (ventas y postventa), pero en UNA etapa de cada uno.
--
--  ── Orden de migraciones ──────────────────────────────────────────────────
--
--  `scripts/migrate.mjs` aplica por NOMBRE de archivo, así que 120 corre antes
--  que 121 y `app.contacts` ya existe cuando `contact_stages` la referencia.
--  Si esto se numerara al revés, la FK fallaría en un ambiente nuevo y sólo
--  ahí — no en el que ya tenía las tablas. Es el modo de fallo que sólo
--  aparece el día del primer despliegue limpio.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 1. Embudos.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE app.pipelines (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,

  -- El slug es la llave estable con la que hablan H8 y el agente. Un nombre
  -- que el emprendedor renombra no puede ser lo que rompa una automatización.
  slug       text NOT NULL,
  name       text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  position   int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, slug)
);

-- Un solo embudo por defecto por tenant: `moveStage` sin embudo explícito
-- tiene que tener una respuesta y no dos.
CREATE UNIQUE INDEX pipelines_default_idx
  ON app.pipelines (tenant_id) WHERE is_default;


-- ───────────────────────────────────────────────────────────────────────────
-- 2. Etapas.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE app.pipeline_stages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  pipeline_id uuid NOT NULL REFERENCES app.pipelines(id) ON DELETE CASCADE,

  slug        text NOT NULL,
  name        text NOT NULL,
  position    int  NOT NULL DEFAULT 0,

  -- 0–100. Es lo que permite que el tablero muestre un valor esperado sin
  -- inventar una tabla de pronósticos.
  probability int  NOT NULL DEFAULT 0 CHECK (probability BETWEEN 0 AND 100),

  -- Etapas terminales. `is_won` e `is_lost` son excluyentes: una etapa no
  -- puede ser las dos, y el CHECK lo impide en vez de confiar en la UI.
  is_won      boolean NOT NULL DEFAULT false,
  is_lost     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, pipeline_id, slug),
  CHECK (NOT (is_won AND is_lost))
);

CREATE INDEX pipeline_stages_pipeline_idx
  ON app.pipeline_stages (tenant_id, pipeline_id, position);


-- ───────────────────────────────────────────────────────────────────────────
-- 3. Dónde está cada contacto.
--
--    La PK compuesta es la regla de negocio: un contacto ocupa UNA etapa de
--    cada embudo. Moverlo es un UPSERT sobre esa llave, no un INSERT que
--    acumula historia — la historia vive en `app.contact_events` (122), que es
--    donde se puede leer sin ensuciar el estado actual.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE app.contact_stages (
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  contact_id  uuid NOT NULL REFERENCES app.contacts(id) ON DELETE CASCADE,
  pipeline_id uuid NOT NULL REFERENCES app.pipelines(id) ON DELETE CASCADE,
  stage_id    uuid NOT NULL REFERENCES app.pipeline_stages(id) ON DELETE CASCADE,

  -- Valor del trato, si el negocio lo maneja. Nullable: la mayoría de los
  -- emprendedores de v1 no lo va a llenar, y forzar un 0 mentiría en la suma.
  amount      numeric(14,2),
  currency    text NOT NULL DEFAULT 'MXN',

  position    int NOT NULL DEFAULT 0,
  entered_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, contact_id, pipeline_id)
);

CREATE INDEX contact_stages_stage_idx
  ON app.contact_stages (tenant_id, stage_id, position);


-- ───────────────────────────────────────────────────────────────────────────
-- 4. RLS. Igual que en 001 y 120: activo y sin políticas.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE app.pipelines       ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.pipeline_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.contact_stages  ENABLE ROW LEVEL SECURITY;


COMMENT ON TABLE app.contact_stages IS
  'Un contacto ocupa UNA etapa de cada embudo. Mover es UPSERT sobre la PK; la '
  'historia del movimiento vive en app.contact_events. H15.';
