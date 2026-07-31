-- ═══════════════════════════════════════════════════════════════════════════
--  122_crm_timeline.sql — H15
--
--  La línea de tiempo del contacto: todo lo que le pasó, en un solo lugar.
--
--  ── Para qué sirve de verdad ───────────────────────────────────────────────
--
--  El emprendedor abre un contacto a las 9 de la mañana y quiere saber, en dos
--  segundos: quién le escribió, qué le contestó su agente mientras dormía, en
--  qué etapa quedó y quién lo tiene. Sin esta tabla, esa respuesta hay que
--  armarla juntando `app.messages` (H6), `app.contact_stages` (121) y las
--  corridas de H8 — tres consultas y una unión que nadie va a escribir dos
--  veces igual.
--
--  ── Idempotencia ───────────────────────────────────────────────────────────
--
--  `external_id` con índice único parcial es el mismo patrón que H6 usa en
--  `app.messages` (H6-inbox.md:137), y por la misma razón: un webhook
--  reenviado no puede duplicar la línea de tiempo. H6 pasa el `external_id`
--  del proveedor; H8 pasa `run:<runId>:<nodeId>`, que es único por paso de
--  una corrida y sobrevive a un reintento del motor.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE app.contact_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  contact_id  uuid NOT NULL REFERENCES app.contacts(id) ON DELETE CASCADE,

  /* Sin CHECK, y a propósito. El catálogo canónico vive en
     `ContactEventType` (packages/crm/src/types.ts) y H6, H8 y H9 van a
     necesitar tipos que hoy no existen. Un CHECK aquí obligaría a cada uno de
     esos carriles a escribir una migración en el bloque de OTRO para poder
     registrar un evento — exactamente el acoplamiento que el contrato de no
     colisión existe para evitar. La validación va en el servicio, donde se
     cambia sin migrar. */
  type        text NOT NULL,

  -- Una línea legible, ya redactada. La UI no arma frases desde `payload`:
  -- si el resumen se compone en el cliente, cada pantalla lo compone distinto.
  summary     text NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}',

  -- Correo del humano, 'ai', 'system', o 'flow:<id>'. Es lo que permite
  -- distinguir "lo movió Ana" de "lo movió una automatización" en la misma
  -- lista, que es la pregunta que se hace cualquiera al ver algo raro.
  actor       text,

  -- 'crm' | 'inbox' | 'flow' | 'import'. Quién lo escribió, no quién lo hizo.
  source      text NOT NULL DEFAULT 'crm',

  external_id text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- La consulta de la pantalla de contacto: los últimos N de este contacto.
CREATE INDEX contact_events_contact_idx
  ON app.contact_events (tenant_id, contact_id, occurred_at DESC);

-- El feed del negocio completo, para el tablero.
CREATE INDEX contact_events_tenant_idx
  ON app.contact_events (tenant_id, occurred_at DESC);

-- Idempotencia. Parcial porque la mayoría de los eventos los escribe el CRM
-- mismo y no tienen id externo: un UNIQUE completo obligaría a inventar uno.
CREATE UNIQUE INDEX contact_events_external_idx
  ON app.contact_events (tenant_id, external_id)
  WHERE external_id IS NOT NULL;

ALTER TABLE app.contact_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE app.contact_events IS
  'Línea de tiempo del contacto. `external_id` con índice único parcial hace '
  'idempotente el registro desde webhooks (H6) y desde reintentos del motor '
  'de flujos (H8). H15.';
