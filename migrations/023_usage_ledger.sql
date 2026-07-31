-- ═══════════════════════════════════════════════════════════════════════════
--  023_usage_ledger.sql — H3
--
--  EL LIBRO DE CONSUMO. Es la tabla que decide si el negocio es negocio.
--
--  En GARDEN el costo se calcula con `estimateCost()` sobre una tabla
--  hardcodeada y estuvo roto meses sin que nadie lo notara. Que nadie lo
--  notara no fue mala suerte: fue que la fila guardaba un NÚMERO YA COCINADO.
--  Cuando el número está mal, no queda nada con qué recalcularlo, y un número
--  equivocado se ve exactamente igual que uno correcto.
--
--  Aquí la fila guarda LOS TOKENS. El costo es una columna derivada que se
--  puede volver a calcular contra app.model_pricing cuando quieras. Un precio
--  mal capturado deja de ser una pérdida de datos y pasa a ser un UPDATE.
--
--  Tres columnas que no estaban en el diseño original y sin las cuales el
--  criterio #3 ("la suma cuadra con la consola de Anthropic ±5%") no se puede
--  cumplir:
--
--    request_id   el id que devuelve el proveedor. Es la llave para reconciliar
--                 fila por fila contra la consola, Y la llave de idempotencia:
--                 un reintento no cobra dos veces.
--    cost_source  si el costo lo reportó el proveedor o lo calculamos nosotros.
--    pricing_id   con qué fila de precio se calculó. Sin esto, "¿por qué esta
--                 llamada costó eso?" no tiene respuesta.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE app.usage_ledger (
  id                    bigserial PRIMARY KEY,
  tenant_id             uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,

  agent_role            text NOT NULL
                        CHECK (agent_role IN ('master','sales','service','social','analyst')),
  -- SET NULL y no CASCADE: si borran la definición del agente, el consumo que
  -- ya generó no se borra. El dinero gastado es historia, no una dependencia.
  agent_definition_id   uuid REFERENCES app.agent_definitions(id) ON DELETE SET NULL,

  provider              text NOT NULL CHECK (provider IN ('anthropic','openrouter','local')),
  model                 text NOT NULL,

  -- ── Lo real. Leído de `usage` en la respuesta. Nunca estimado. ──────────
  input_tokens          int NOT NULL CHECK (input_tokens          >= 0),
  output_tokens         int NOT NULL CHECK (output_tokens         >= 0),
  cache_read_tokens     int NOT NULL DEFAULT 0 CHECK (cache_read_tokens     >= 0),
  cache_write_5m_tokens int NOT NULL DEFAULT 0 CHECK (cache_write_5m_tokens >= 0),
  cache_write_1h_tokens int NOT NULL DEFAULT 0 CHECK (cache_write_1h_tokens >= 0),

  -- ── Lo derivado. Recalculable a partir de lo de arriba. ─────────────────
  cost_usd              numeric(12,6) NOT NULL CHECK (cost_usd >= 0),
  cost_source           text NOT NULL
                        CHECK (cost_source IN ('provider','priced','unpriced')),
  pricing_id            uuid REFERENCES app.model_pricing(id) ON DELETE SET NULL,

  -- ── Reconciliación y observabilidad ─────────────────────────────────────
  request_id            text,
  thread_id             text,
  -- Para el día que se resuelva si los workspaces de Anthropic se pueden
  -- aprovisionar por API (riesgo R3 del plan). Hasta entonces, NULL.
  workspace_id          text,
  iterations            int NOT NULL DEFAULT 1 CHECK (iterations >= 0),
  latency_ms            int CHECK (latency_ms >= 0),
  status                text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','error','partial')),

  created_at            timestamptz NOT NULL DEFAULT now()
);

-- "¿cuánto lleva gastado este cliente este mes?" — la consulta que corre ANTES
-- de cada llamada al modelo, así que tiene que ser barata.
CREATE INDEX usage_ledger_tenant_created_idx
  ON app.usage_ledger (tenant_id, created_at DESC);

-- Idempotencia. Parcial porque request_id puede faltar (un error de red antes
-- de recibir respuesta también se registra, con status='error' y sin id).
CREATE UNIQUE INDEX usage_ledger_request_id_key
  ON app.usage_ledger (provider, request_id)
  WHERE request_id IS NOT NULL;

ALTER TABLE app.usage_ledger ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE app.usage_ledger IS
  'Consumo real por tenant. Guarda TOKENS (leídos de la respuesta), no sólo el '
  'costo: un precio equivocado se corrige y el costo se recalcula. En GARDEN el '
  'costo cocinado se veía igual estando mal.';

COMMENT ON COLUMN app.usage_ledger.cost_source IS
  'provider = lo reportó el proveedor (OpenRouter). priced = tokens x app.model_pricing. '
  'unpriced = no había precio vigente; se registró en 0 y una prueba del paquete falla.';

COMMENT ON COLUMN app.usage_ledger.request_id IS
  'Id de la respuesta del proveedor. Llave de reconciliación contra la consola '
  'y llave de idempotencia: un reintento no cobra dos veces.';
