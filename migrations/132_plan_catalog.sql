-- ═══════════════════════════════════════════════════════════════════════════
--  132_plan_catalog.sql — H16
--
--  DOS catálogos de planes que no coinciden, y dos números que dicen lo mismo
--  sin decir lo mismo.
--
--  ── El hueco, con archivo y línea ─────────────────────────────────────────
--
--  `024_agent_budgets.sql:44-48` siembra `app.agent_plan_limits` con CUATRO
--  planes: free, starter, pro, agency.
--  `010_tenancy.sql:107-114`     siembra `app.plans` con DOS: free y pro.
--
--  Y la 010 también pone la llave foránea:
--
--      ALTER TABLE app.tenants
--        ADD CONSTRAINT tenants_plan_fkey FOREIGN KEY (plan) REFERENCES app.plans(id);
--
--  Como el runner aplica por nombre de archivo, la 010 corre ANTES que la 024.
--  Resultado comprobable: **ningún tenant puede tener plan = 'starter' ni
--  'agency'**. La FK lo impide. Las dos filas de `agent_plan_limits` son código
--  muerto que se ve vivo — el peor tipo, porque un plan que aparece en una
--  tabla se lee como un plan que se puede vender.
--
--  Ninguna de las dos migraciones está mal por su cuenta. H3 escribió la suya
--  cuando `app.plans` no existía y lo dejó dicho en su propio encabezado
--  (024:23-26: "el catálogo de planes es de H10 y todavía no existe"). Lo que
--  faltaba era el archivo que las junta. Es éste.
--
--  ── Por qué esta migración es ADITIVA ─────────────────────────────────────
--
--  No borra `app.agent_plan_limits`. `packages/agents/src/ledger/budget.ts:104`
--  la lee en CADA corrida, y borrarla apagaría el único tope de gasto que hoy
--  funciona de verdad. La reconciliación es de datos, no de esquema.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 1. Los dos planes que la FK prohibía.
--
--    `ON CONFLICT DO NOTHING` para que aplicar dos veces sea inofensivo, y para
--    que si H10 llegara a sembrarlos primero esta migración no le pise nada.
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO app.plans (id, name, limits, position) VALUES
  ('starter', 'Inicial', jsonb_build_object(
      'maxSeats',      5,
      'maxContacts',   2500,
      'maxChannels',   2,
      'maxFlows',      10,
      'maxAgents',     3,
      'monthlyAiUsd',  25), 1),

  ('agency',  'Agencia', jsonb_build_object(
      'maxSeats',      50,
      'maxContacts',   100000,
      'maxChannels',   10,
      'maxFlows',      200,
      'maxAgents',     25,
      'monthlyAiUsd',  400), 3)
ON CONFLICT (id) DO NOTHING;

-- `pro` estaba en la posición 1 desde la 010, que ahora ocupa `starter`.
UPDATE app.plans SET position = 2 WHERE id = 'pro';


-- ───────────────────────────────────────────────────────────────────────────
-- 2. Qué incluye cada uno de los dos planes nuevos.
--
--    La escalera completa queda así — cada peldaño ES el anterior más algo, que
--    es la única forma en que un cliente entiende por qué subir:
--
--      free     WhatsApp + invitar
--      starter  … + que el agente conteste solo, publicar flujos, la bóveda
--      pro      … + Instagram/Messenger, correo, asistente, agentes propios,
--               proyectos y más de un embudo
--      agency   … + SMS
--
--    `inbox.sms` sólo en `agency` a propósito: cada mensaje cuesta dinero por
--    unidad y no se regala en un plan de entrada.
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO app.plan_features (plan_id, feature_key) VALUES
  ('starter', 'inbox.whatsapp'),
  ('starter', 'inbox.ai_reply'),
  ('starter', 'flows.publish'),
  ('starter', 'vault.ingest'),
  ('starter', 'team.invite'),

  ('agency',  'inbox.whatsapp'),
  ('agency',  'inbox.meta'),
  ('agency',  'inbox.email'),
  ('agency',  'inbox.sms'),
  ('agency',  'inbox.ai_reply'),
  ('agency',  'flows.publish'),
  ('agency',  'flows.ai_assist'),
  ('agency',  'agents.custom'),
  ('agency',  'vault.ingest'),
  ('agency',  'work.projects'),
  ('agency',  'crm.pipelines'),
  ('agency',  'team.invite')
ON CONFLICT (plan_id, feature_key) DO NOTHING;


-- ───────────────────────────────────────────────────────────────────────────
-- 3. Un solo número para el presupuesto de IA.
--
--    Hoy hay dos y no coinciden:
--
--      plan     app.plans.limits.monthlyAiUsd   agent_plan_limits.monthly_budget_usd
--      free                                 5                                   5.00
--      pro                                 50                                 100.00   ← ✗
--
--    (`free` coincide por casualidad, no por diseño: nadie los ató.)
--
--    ── Se elige 100 para `pro`, y aquí está el porqué ────────────────────────
--
--    Es el número que el ÚNICO código que aplica el tope ha usado desde el día
--    uno: `budget.ts:104` lee `agent_plan_limits`, no `app.plans`. Alinear
--    hacia arriba no cambia el comportamiento de nada que esté corriendo.
--
--    Bajar la aplicación a 50 sí lo cambiaría: le cortaría el gasto a la mitad,
--    a mitad de mes, a cualquiera que ya estuviera usando el producto — y le
--    llegaría como "esto ya no sirve", que es exactamente el fallo que H3 se
--    negó a introducir cuando decidió no degradar el modelo en silencio
--    (024:19-21). Un límite que se aprieta sin avisar es la misma clase de
--    error que un modelo que empeora sin avisar.
--
--    El 50 de la 010 tampoco fue una decisión de precio: se escribió junto a
--    `maxSeats: 10` como parte de un catálogo de ejemplo, en un momento en que
--    `agent_plan_limits` ni siquiera existía.
--
--    A partir de aquí `app.plans.limits.monthlyAiUsd` es EL número, y
--    `app.agent_plan_limits` es una proyección suya para el motor de agentes.
-- ───────────────────────────────────────────────────────────────────────────

UPDATE app.plans
   SET limits = jsonb_set(limits, '{monthlyAiUsd}', to_jsonb(100))
 WHERE id = 'pro';

-- Y al revés para los que ya existían sólo en la tabla de H3: que la proyección
-- diga exactamente lo que dice el catálogo, para los cuatro planes.
UPDATE app.agent_plan_limits apl
   SET monthly_budget_usd = (p.limits ->> 'monthlyAiUsd')::numeric(12,2)
  FROM app.plans p
 WHERE p.id = apl.plan
   AND p.limits ? 'monthlyAiUsd'
   AND apl.monthly_budget_usd IS DISTINCT FROM (p.limits ->> 'monthlyAiUsd')::numeric(12,2);

COMMENT ON COLUMN app.agent_plan_limits.monthly_budget_usd IS
  'PROYECCIÓN de app.plans.limits->>monthlyAiUsd, que es la fuente única desde la '
  'migración 132. Vive duplicada aquí porque budget.ts la lee antes de cada llamada al '
  'modelo y no debe depender de un JOIN con el catálogo. Si los dos números difieren, '
  'app.plans manda: app.presupuesto_desalineado() lo detecta.';


-- ───────────────────────────────────────────────────────────────────────────
-- 4. El guardia contra la próxima divergencia.
--
--    Reconciliar los números hoy no impide que vuelvan a separarse mañana: eso
--    es exactamente lo que pasó entre la 010 y la 024, y las dos estaban bien
--    escritas. Un CHECK no puede cruzar dos tablas, así que el guardia es una
--    función de diagnóstico que devuelve las filas desalineadas — vacía cuando
--    todo está en orden.
--
--    La usa la prueba del criterio #14, y sirve igual como consulta de salud en
--    el despliegue. Es barata y no tiene efectos.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION app.presupuesto_desalineado()
RETURNS TABLE (plan text, en_plans numeric, en_agent_plan_limits numeric)
LANGUAGE sql STABLE
SET search_path = ''
AS $$
  SELECT p.id,
         (p.limits ->> 'monthlyAiUsd')::numeric,
         apl.monthly_budget_usd
    FROM app.plans p
    JOIN app.agent_plan_limits apl ON apl.plan = p.id
   WHERE p.limits ? 'monthlyAiUsd'
     AND (p.limits ->> 'monthlyAiUsd')::numeric IS DISTINCT FROM apl.monthly_budget_usd;
$$;

COMMENT ON FUNCTION app.presupuesto_desalineado() IS
  'Planes donde app.plans.limits->>monthlyAiUsd y agent_plan_limits.monthly_budget_usd no '
  'dicen el mismo número. Vacío = en orden. Existe porque la divergencia entre la 010 y la '
  '024 no la detectó nadie durante semanas: dos números que dicen lo mismo se separan solos.';
