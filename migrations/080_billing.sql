-- ═══════════════════════════════════════════════════════════════════════════
--  080_billing.sql — H10
--
--  El cobro y el alta self-service. Dos tablas y una siembra.
--
--  La decisión que explica la forma de este archivo: `app.plans` NO se crea
--  aquí. Es de H2 (migración 010) y ya existe. H10 es dueño de la DECISIÓN de
--  qué planes hay y qué límites tienen — el catálogo vive en código, en
--  packages/billing/src/catalog.ts — y esta migración es su primer SYNC hacia
--  la tabla que todos consumen. Un dueño de la decisión, varios consumidores.
--
--  Si cambias los planes, cámbialos en catalog.ts. El sync de runtime
--  (`syncPlanCatalog()`) los reconcilia sin necesidad de otra migración; esta
--  siembra existe para que una base recién creada arranque coherente.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 1. Catálogo de planes v1 — la RECONCILIACIÓN.
--
--    Cómo se reparte esto con H2, que ya siembra la tabla en 010:
--
--      · H2 CREA `app.plans` y siembra un catálogo de arranque, porque su
--        `provision_tenant()` se niega a dar de alta contra un plan que no
--        existe. Sin esa siembra, H2 no puede probarse solo. Su INSERT es
--        `ON CONFLICT DO NOTHING`: cede.
--      · H10 es dueño de la DECISIÓN de qué planes hay y qué límites tienen.
--        El catálogo vive en packages/billing/src/catalog.ts y esto es su
--        primer sync. Este INSERT es `DO UPDATE`: gana.
--
--    Un dueño de la decisión, varios consumidores.
--
--    ⚠️ Los valores de abajo son EXACTAMENTE los que sembró H2 a propósito.
--    Su `assertQuota()` ya compara contra `maxChannels`, `maxFlows` y
--    `maxAgents`; escribir aquí un objeto más pobre no "actualizaría" los
--    límites, los BORRARÍA — `limits` es una sola columna jsonb, no un merge.
--    Si mañana cambian, se cambian en catalog.ts y aquí a la vez.
--
--    v1 vende sólo `free` y `pro`. `pro` es de MONTO LIBRE: el emprendedor
--    decide cuánto paga, así que el precio no vive en el catálogo; lo que vive
--    aquí son los límites, que sí son del producto.
--
--    Los planes intermedios (starter/agency) y las banderas de features son de
--    H16. No los agregues: un plan de más es un plan que alguien puede comprar.
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO app.plans (id, name, limits, position, active) VALUES
  ('free', 'Gratis', jsonb_build_object(
      'maxSeats', 2, 'maxContacts', 500, 'maxChannels', 1,
      'maxFlows', 3, 'maxAgents', 1, 'monthlyAiUsd', 5), 0, true),
  ('pro',  'Pro',    jsonb_build_object(
      'maxSeats', 10, 'maxContacts', 10000, 'maxChannels', 3,
      'maxFlows', 25, 'maxAgents', 5, 'monthlyAiUsd', 50), 1, true)
ON CONFLICT (id) DO UPDATE
  SET name     = EXCLUDED.name,
      limits   = EXCLUDED.limits,
      position = EXCLUDED.position,
      active   = EXCLUDED.active;


-- ───────────────────────────────────────────────────────────────────────────
-- 2. La suscripción del tenant.
--
--    `UNIQUE (tenant_id)` es deliberado: en v1 una empresa tiene UNA
--    suscripción. Es lo que hace que reintentar un webhook de Stripe sea
--    seguro — el upsert choca contra esta restricción en vez de crear una
--    segunda fila de cobro para el mismo cliente.
--
--    `amount` es lo que el emprendedor decidió dar. Se guarda porque con
--    monto libre el precio no se puede derivar del plan.
--
--    `currency` NO es decoración, y la columna se llamaba `amount_usd` hasta
--    que una auditoría preguntó qué pasa si la sesión no viene en dólares.
--    Pasaba esto: el webhook leía `currency` de la sesión de Stripe y la
--    tiraba, así que una sesión de $500 MXN quedaba escrita como `amount_usd
--    = 500` — veinte veces el ingreso real, en la columna de la que sale
--    cualquier reporte de facturación, y sin un solo error en el camino.
--
--    Hoy el checkout crea los precios sólo en USD, así que no ha pasado. Pero
--    el webhook procesa la sesión que Stripe le manda, no la que creímos
--    crear, y cobrar en pesos está anotado como decisión de producto
--    pendiente: el día que se tome, el bug se activaba solo y en silencio.
--
--    El CHECK de abajo es la regla completa: una cifra sin su moneda es una
--    suposición, no un dato. O van las dos, o no va ninguna.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE app.subscriptions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  stripe_customer_id     text,
  stripe_subscription_id text,
  plan_id                text NOT NULL REFERENCES app.plans(id),
  status                 text NOT NULL,
  amount                 numeric(10,2),
  -- ISO-4217 en minúsculas, que es como la manda Stripe.
  currency               text
    CONSTRAINT subscriptions_currency_iso CHECK (currency ~ '^[a-z]{3}$'),
  current_period_end     timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id),
  CONSTRAINT subscriptions_monto_con_moneda
    CHECK ((amount IS NULL) = (currency IS NULL))
);

ALTER TABLE app.subscriptions ENABLE ROW LEVEL SECURITY;

-- "¿de quién es este cliente de Stripe?" es la consulta de cada webhook que
-- llega DESPUÉS del alta (renovación, cancelación, pago fallido).
CREATE INDEX subscriptions_stripe_customer_idx
  ON app.subscriptions (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE UNIQUE INDEX subscriptions_stripe_subscription_idx
  ON app.subscriptions (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;


-- ───────────────────────────────────────────────────────────────────────────
-- 3. La bitácora de Stripe.
--
--    Ésta es la tabla que salva la reputación del producto el día que alguien
--    escriba "pagué y no tengo cuenta". Se registra TODO evento, incluidos los
--    que se ignoran, porque el que se ignoró es justo el que vas a querer ver.
--
--    `stripe_event_id UNIQUE` es el mecanismo de idempotencia: Stripe
--    reintenta, y el segundo intento choca aquí antes de tocar nada más.
-- ───────────────────────────────────────────────────────────────────────────

-- Los eventos llegan ANTES de que el tenant exista: el pago es lo que lo crea.
-- Exigirles tenant_id haría imposible registrar justo el evento que da de alta
-- al cliente — y también el de firma inválida, que no pertenece a nadie.
-- A qué negocio correspondió cada uno se lee del propio `payload`, que es la
-- evidencia cruda de Stripe:
--
--   SELECT payload->'data'->'object'->'metadata'->>'businessName', created_at
--     FROM app.billing_events
--    WHERE processed_at IS NULL;
--
-- Es `businessName` y no el slug a propósito: el slug se deriva al procesar el
-- webhook —resolver colisiones necesita la base—, así que en el momento de
-- crear la sesión de pago todavía no existe.
--
-- tenantless: bitácora de un proveedor externo, previa a la existencia del tenant.
CREATE TABLE app.billing_events (
  id                bigserial PRIMARY KEY,
  stripe_event_id   text UNIQUE NOT NULL,
  type              text NOT NULL,
  payload           jsonb NOT NULL,
  processed_at      timestamptz,
  error             text,
  attempts          int NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app.billing_events ENABLE ROW LEVEL SECURITY;

-- "¿qué se quedó sin procesar?" — la consulta del que investiga un reclamo.
CREATE INDEX billing_events_pendientes_idx
  ON app.billing_events (created_at DESC)
  WHERE processed_at IS NULL;

CREATE INDEX billing_events_type_idx ON app.billing_events (type, created_at DESC);


COMMENT ON TABLE app.billing_events IS
  'Bitácora cruda de webhooks de Stripe. SIN tenant_id obligatorio a propósito: '
  'los eventos llegan antes de que el tenant exista. Ver 080_billing.sql §3.';

COMMENT ON TABLE app.subscriptions IS
  'Una suscripción por tenant (UNIQUE tenant_id). amount guarda el monto libre '
  'que eligió el emprendedor, que no se puede derivar del plan, y currency dice '
  'en qué moneda es: van juntas o ninguna. Ver 080_billing.sql §2.';

COMMENT ON COLUMN app.subscriptions.currency IS
  'ISO-4217 en minúsculas, la moneda REAL de la sesión de Stripe — no la del '
  'catálogo. Sin ella, amount es una suposición.';
