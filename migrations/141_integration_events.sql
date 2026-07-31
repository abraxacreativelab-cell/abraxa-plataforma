-- ═══════════════════════════════════════════════════════════════════════════
--  141_integration_events.sql — H17
--
--  LA BITÁCORA.
--
--  Cuando alguien reclame que "conectó su WhatsApp y no funcionó", esto es lo
--  único que contesta qué pasó: cuándo se conectó, con qué cuenta, cuándo se
--  verificó, cuándo dejó de verificar y con qué código.
--
--  También es donde queda escrito el uso del RESPALDO DE PLATAFORMA. Un
--  respaldo silencioso es exactamente cómo se llega a producción con dos
--  clientes en el mismo número sin que nadie lo haya decidido: si el sistema
--  usa la credencial de la plataforma en vez de la del cliente, la pantalla lo
--  dice y esta tabla lo registra.
--
--  ── Lo que NUNCA entra en `detail` ─────────────────────────────────────────
--
--  El cuerpo crudo de la respuesta del proveedor. Meta y Twilio devuelven el
--  token en el eco de error con más frecuencia de la que uno esperaría, y una
--  bitácora que guarda el error completo acaba siendo un almacén de secretos
--  en claro —con RLS, pero sin cifrado—. Se guarda código, mensaje corto y
--  `request_id`. Lo hace cumplir `limpiarDetalle()`
--  (packages/integrations/src/events.ts), con su prueba.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE app.integration_events (
  id             bigserial PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,

  -- ON DELETE SET NULL y no CASCADE: si la integración se borra, la historia
  -- de lo que pasó con ella no se borra con ella. Es justo cuando más falta
  -- hace.
  integration_id uuid REFERENCES app.tenant_integrations(id) ON DELETE SET NULL,

  provider       text NOT NULL,

  -- connect | verify_ok | verify_fail | rotate | revoke | refresh |
  -- platform_fallback | resolve_miss
  -- Sin CHECK, por lo mismo que `provider`: los tipos crecen con H12 y H13.
  type           text NOT NULL,

  detail         jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(detail) = 'object'),
  actor          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app.integration_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX integration_events_tenant_idx
  ON app.integration_events (tenant_id, created_at DESC);
CREATE INDEX integration_events_integracion_idx
  ON app.integration_events (tenant_id, integration_id, created_at DESC)
  WHERE integration_id IS NOT NULL;


COMMENT ON TABLE app.integration_events IS
  'Bitácora de integraciones: conectar, verificar, rotar, revocar y uso del '
  'respaldo de plataforma. Es lo único que contesta "conecté mi WhatsApp y no '
  'funcionó". H17.';
COMMENT ON COLUMN app.integration_events.detail IS
  'Código, mensaje corto y request_id. NUNCA el cuerpo crudo de la respuesta '
  'del proveedor ni nada derivado del secreto: lo garantiza limpiarDetalle() '
  'en packages/integrations/src/events.ts.';
