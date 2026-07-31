-- ═══════════════════════════════════════════════════════════════════════════
--  024_agent_budgets.sql — H3
--
--  EL TOPE QUE SÍ SE APLICA.
--
--  En GARDEN existe `MONTHLY_BUDGET_USD` en src/config.ts:122. Es su ÚNICA
--  aparición en todo el repo: se declara, se valida con zod, y nunca se lee.
--  Un presupuesto que nadie consulta es un comentario caro.
--
--  Aquí el límite se resuelve en tres saltos, del más específico al más
--  general, y se consulta ANTES de cada llamada al modelo:
--
--      app.agent_budget_overrides   ¿este cliente tiene un trato especial?
--                ↓ si no
--      app.agent_plan_limits        ¿qué le toca por su plan?
--                ↓ si no
--      el default de la plataforma  (packages/agents/src/config.ts)
--
--  Al rebasarlo se lanza BUDGET_EXCEEDED. No se degrada a un modelo más barato
--  en silencio: un cliente que de pronto recibe respuestas peores sin que nadie
--  se lo diga es un problema mucho más caro de diagnosticar que un error claro.
--
--  NOTA SOBRE app.plans: el catálogo de planes es de H10 (billing) y todavía
--  no existe. Esta tabla NO lo sustituye ni le compite: sólo mapea el
--  `app.tenants.plan` que ya existe desde la 001 a los dos límites que el motor
--  de agentes necesita. Cuando H10 aterrice, se puede unir por `plan`.
-- ═══════════════════════════════════════════════════════════════════════════

-- tenantless: catálogo de la plataforma. Los límites por plan son iguales para
-- todos los clientes del mismo plan; no son dato de ninguno.
CREATE TABLE app.agent_plan_limits (
  plan                text PRIMARY KEY,
  monthly_budget_usd  numeric(12,2) NOT NULL CHECK (monthly_budget_usd >= 0),
  requests_per_minute int           NOT NULL CHECK (requests_per_minute > 0),
  max_output_tokens   int           NOT NULL CHECK (max_output_tokens   > 0),
  created_at          timestamptz   NOT NULL DEFAULT now()
);

ALTER TABLE app.agent_plan_limits ENABLE ROW LEVEL SECURITY;

-- `free` tiene que coincidir con el DEFAULT de app.tenants.plan en la 001:
-- un tenant recién creado cae aquí sin que nadie configure nada.
INSERT INTO app.agent_plan_limits (plan, monthly_budget_usd, requests_per_minute, max_output_tokens)
VALUES
  ('free',     5.00,  10, 4096),
  ('starter', 25.00,  30, 8192),
  ('pro',    100.00,  60, 8192),
  ('agency', 400.00, 120, 8192);


-- ───────────────────────────────────────────────────────────────────────────
-- Excepción por cliente. Una fila aquí gana sobre el plan.
--
-- Existe para lo que siempre pasa: un cliente que se pasó por una campaña y no
-- se le va a cortar el servicio a media venta. Sin esta tabla, la única
-- salida sería subirle el plan a todos los que lo comparten.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE app.agent_budget_overrides (
  tenant_id           uuid PRIMARY KEY REFERENCES app.tenants(id) ON DELETE CASCADE,
  monthly_budget_usd  numeric(12,2) CHECK (monthly_budget_usd >= 0),
  requests_per_minute int           CHECK (requests_per_minute > 0),

  -- Obligatoria a propósito. Un tope distinto al del plan siempre tiene una
  -- razón, y dentro de seis meses nadie se acuerda de cuál era.
  note                text NOT NULL,

  updated_by          text,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app.agent_budget_overrides ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE app.agent_plan_limits IS
  'Límites del motor de agentes por plan. En GARDEN el presupuesto se declaraba '
  'en config y nunca se leía (src/config.ts:122, única aparición). Aquí se '
  'consulta antes de cada llamada.';

COMMENT ON TABLE app.agent_budget_overrides IS
  'Excepción de límite por cliente. Gana sobre el plan. La nota es obligatoria: '
  'un tope especial sin razón escrita es un misterio en seis meses.';
