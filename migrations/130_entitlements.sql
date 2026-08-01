-- ═══════════════════════════════════════════════════════════════════════════
--  130_entitlements.sql — H16
--
--  QUÉ compra un plan. No cuánto: eso ya lo dice `app.plans.limits`.
--
--  ── El hueco que cierra esta migración ────────────────────────────────────
--
--  `app.plans.limits` se siembra en 010_tenancy.sql:107-114 con seis llaves y
--  las seis son numéricas: maxSeats, maxContacts, maxChannels, maxFlows,
--  maxAgents, monthlyAiUsd. No hay un solo eje booleano, así que hoy no existe
--  forma de decir "este plan incluye automatizaciones" ni "este plan no incluye
--  Instagram" — y ésas son justo las dos preguntas que un plan contesta. Nadie
--  paga por un contador más alto; se paga por una función que antes no se tenía.
--
--  ── La asimetría deliberada con los límites numéricos ─────────────────────
--
--  En `plans.ts:10-14` un límite AUSENTE es ilimitado. Aquí es al revés: una
--  función que no está en ninguna tabla está APAGADA. No es una inconsistencia,
--  es elegir de qué lado fallar:
--
--    · olvidar declarar un límite  → el cliente recibe servicio de más, y nadie
--      se entera hasta que llega la factura de tokens;
--    · olvidar declarar una función → el cliente la pierde y levanta la mano en
--      minutos.
--
--  Se falla del lado que se descubre rápido.
--
--  ── El patrón de resolución, que NO es nuevo ──────────────────────────────
--
--  Tres saltos, del más específico al más general, exactamente el mismo que H3
--  usó para el presupuesto en 024_agent_budgets.sql:11-18:
--
--      app.tenant_entitlements   ¿este cliente tiene un trato especial vigente?
--                ↓ si no hay fila, o expiró
--      app.plan_features         ¿lo trae su plan?
--                ↓ si no
--      false                     deny por defecto
--
--  Se reusa a propósito. Un sistema con dos formas de resolver una excepción
--  tiene dos formas de equivocarse.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 1. El catálogo de funciones de la plataforma.
--
--    `blurb` no es un mensaje de error: es lo que se le ENSEÑA a quien topa el
--    402, y es copy de producto. Es la misma decisión que tomó H11 para las
--    áreas bloqueadas (ports.ts:AreaState — "las bloqueadas se MUESTRAN con
--    candado y su promesa: la curiosidad es el motor del producto"). Esconder
--    lo que alguien no tiene no le ahorra nada a nadie.
-- ───────────────────────────────────────────────────────────────────────────

-- tenantless: catálogo de la plataforma. Qué funciones EXISTEN, no quién las
-- tiene. Es igual para todos los clientes y no es dato de ninguno.
CREATE TABLE app.features (
  key          text PRIMARY KEY
               CONSTRAINT features_key_formato
               CHECK (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  label        text NOT NULL,
  blurb        text NOT NULL,

  -- Qué le pasa a lo que YA existe cuando la función se apaga. Nunca 'delete':
  -- ese valor no está en el CHECK y no va a estarlo. Ver §7 del handoff.
  on_downgrade text NOT NULL CHECK (on_downgrade IN ('pause', 'readonly', 'keep')),

  position     int  NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app.features ENABLE ROW LEVEL SECURITY;


-- ───────────────────────────────────────────────────────────────────────────
-- 2. Qué incluye cada plan.
-- ───────────────────────────────────────────────────────────────────────────

-- tenantless: la composición de un plan es igual para todos los clientes que
-- lo tienen contratado. La excepción POR cliente vive en tenant_entitlements.
CREATE TABLE app.plan_features (
  plan_id     text NOT NULL REFERENCES app.plans(id)    ON UPDATE CASCADE ON DELETE CASCADE,
  feature_key text NOT NULL REFERENCES app.features(key) ON UPDATE CASCADE ON DELETE CASCADE,
  PRIMARY KEY (plan_id, feature_key)
);

ALTER TABLE app.plan_features ENABLE ROW LEVEL SECURITY;


-- ───────────────────────────────────────────────────────────────────────────
-- 3. La excepción por cliente. Gana sobre el plan, en LOS DOS sentidos.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE app.tenant_entitlements (
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  feature_key text NOT NULL REFERENCES app.features(key) ON UPDATE CASCADE ON DELETE CASCADE,

  -- `true` concede algo que su plan no trae; `false` QUITA algo que su plan sí
  -- trae. Los dos sentidos importan: el segundo es la única forma de apagarle
  -- una función a un cliente que está abusando de ella sin bajarle el plan
  -- entero — que castigaría también todo lo que sí está usando bien.
  granted     boolean NOT NULL,

  -- Obligatoria, con el mismo criterio de app.agent_budget_overrides.note
  -- (024_agent_budgets.sql:63-65). El CHECK de longitud es lo que impide que
  -- la nota se cumpla con un ".": un permiso especial sin razón escrita es un
  -- misterio en seis meses, y "." no es una razón.
  note        text NOT NULL CHECK (length(btrim(note)) >= 8),

  -- Concesión temporal. Una prueba de 14 días es una fila con fecha, no un
  -- recordatorio en la cabeza de alguien.
  expires_at  timestamptz,

  updated_by  text REFERENCES app.users(email) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, feature_key)
);

ALTER TABLE app.tenant_entitlements ENABLE ROW LEVEL SECURITY;

-- El barrido de overrides vencidos (panel de H14) y el aviso de "se te vence la
-- prueba en 3 días" preguntan lo mismo: qué caduca y cuándo.
CREATE INDEX tenant_entitlements_expiran_idx
  ON app.tenant_entitlements (expires_at)
  WHERE expires_at IS NOT NULL;


-- ───────────────────────────────────────────────────────────────────────────
-- 4. La resolución, EN SQL.
--
--    ── Por qué es una vista y no tres consultas encadenadas en TypeScript ──
--
--    Por `expires_at`. El criterio #4 del handoff exige que un override vencido
--    no conceda nada y que eso se evalúe contra `now()` EN LA CONSULTA, no en
--    JavaScript. La razón no es purismo: un proceso con el reloj corrido —o un
--    contenedor con la zona horaria equivocada, que es más común— mantendría
--    viva una prueba de 14 días que ya terminó, y nadie se enteraría. `now()`
--    aquí adentro es el reloj de la base, que es uno solo.
--
--    De paso, la regla 3 de §6 ("un tenant que no está activo no tiene NINGUNA
--    función") queda del lado de la base y no depende de que quien consulte se
--    acuerde de preguntarlo.
--
--    El producto cartesiano es de 12 funciones × N tenants. Con miles de
--    clientes sigue siendo una tabla chica, y la consulta real siempre filtra
--    por `tenant_id`.
-- ───────────────────────────────────────────────────────────────────────────

CREATE VIEW app.tenant_entitlements_effective AS
SELECT
  t.id  AS tenant_id,
  f.key AS feature_key,
  f.label,
  f.blurb,
  f.on_downgrade,
  f.position,

  CASE
    -- Regla 3 de §6: el tenant no activo no tiene nada, sin mirar el catálogo.
    WHEN t.status <> 'active'          THEN false
    WHEN te.feature_key IS NOT NULL    THEN te.granted
    WHEN pf.feature_key IS NOT NULL    THEN true
    ELSE false                          -- regla 1: deny por defecto
  END AS granted,

  -- De dónde salió la respuesta. La pantalla de /ajustes/plan lo enseña, y el
  -- soporte lo necesita para contestar "¿por qué este cliente sí la tiene?"
  -- sin adivinar.
  CASE
    WHEN t.status <> 'active'          THEN 'tenant_inactive'
    WHEN te.feature_key IS NOT NULL    THEN 'override'
    WHEN pf.feature_key IS NOT NULL    THEN 'plan'
    ELSE 'none'
  END AS source,

  te.expires_at AS override_expires_at,
  te.note       AS override_note
FROM app.tenants t
CROSS JOIN app.features f
LEFT JOIN app.tenant_entitlements te
       ON te.tenant_id   = t.id
      AND te.feature_key = f.key
      -- ← AQUÍ. Un override vencido es, para todo efecto, una fila que no
      --   existe. No se borra: se deja de honrar. Borrarla perdería la nota,
      --   que es justo lo que explica por qué se concedió.
      AND (te.expires_at IS NULL OR te.expires_at > now())
LEFT JOIN app.plan_features pf
       ON pf.plan_id     = t.plan
      AND pf.feature_key = f.key;

COMMENT ON VIEW app.tenant_entitlements_effective IS
  'La resolución de tres saltos (override vigente → plan → deny), evaluada en SQL. '
  'El vencimiento se compara contra now() de la base a propósito: en JavaScript, un '
  'proceso con el reloj corrido mantiene viva una prueba que ya terminó.';


-- ───────────────────────────────────────────────────────────────────────────
-- 5. El catálogo inicial.
--
--    Doce llaves, todas derivadas de lo que los otros carriles YA construyeron.
--    Ninguna es especulativa: cada una apaga algo que existe.
--
--    `on_downgrade` no es una etiqueta decorativa — es el contrato de qué pasa
--    con lo que ya está ahí:
--
--      pause     lo que corría se detiene y queda marcado. No se borra.
--      readonly  se puede leer y exportar; no se puede crear ni editar.
--      keep      no pasa nada.
--
--    `readonly` es para lo que el cliente ACUMULÓ: sus documentos, sus
--    proyectos, sus agentes. Quitarle la lectura de lo suyo por dejar de pagar
--    un mes es la forma más rápida de que no vuelva.
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO app.features (key, label, blurb, on_downgrade, position) VALUES
  ('inbox.whatsapp',  'WhatsApp',
   'Recibe y contesta los mensajes de WhatsApp de tu negocio desde la bandeja, sin usar tu teléfono personal.',
   'pause',    10),

  ('inbox.meta',      'Instagram y Messenger',
   'Los mensajes de Instagram y de Messenger caen en la misma bandeja que WhatsApp. Una sola conversación por persona.',
   'pause',    20),

  ('inbox.email',     'Correo',
   'Tu correo de atención entra a la bandeja y sale desde ahí, con el historial completo de cada cliente.',
   'pause',    30),

  ('inbox.sms',       'SMS',
   'Manda y recibe mensajes de texto para confirmaciones y recordatorios que tienen que llegar sí o sí.',
   'pause',    40),

  ('inbox.ai_reply',  'Respuesta automática del agente',
   'Tu agente contesta solo, con los datos reales de tu negocio, mientras tú duermes. Tú tomas el hilo cuando quieras.',
   'pause',    50),

  ('flows.publish',   'Publicar automatizaciones',
   'Deja corriendo un flujo que responde, etiqueta, agenda y da seguimiento sin que tú te acuerdes.',
   'pause',    60),

  ('flows.ai_assist', 'Asistente de automatizaciones',
   'Describe en español lo que quieres que pase y el asistente arma la automatización por ti.',
   'keep',     70),

  ('agents.custom',   'Agentes propios',
   'Crea agentes con su propia personalidad, sus instrucciones y sus herramientas, además del que ya tienes.',
   'readonly', 80),

  ('vault.ingest',    'Ingesta de documentos',
   'Pega un documento y la bóveda extrae precios, políticas y datos para que tus agentes dejen de inventarlos.',
   'readonly', 90),

  ('work.projects',   'Proyectos',
   'Agrupa tus tareas en proyectos con fechas, responsables y avance a la vista.',
   'readonly', 100),

  ('crm.pipelines',   'Más de un embudo',
   'Un embudo por línea de negocio, cada uno con sus etapas. Vender departamentos no se parece a vender helados.',
   'readonly', 110),

  ('team.invite',     'Invitar a tu equipo',
   'Suma gente a tu empresa con el acceso justo por área. Cuántos caben lo dice tu plan.',
   'keep',     120)
ON CONFLICT (key) DO NOTHING;


-- ───────────────────────────────────────────────────────────────────────────
-- 6. Qué trae cada plan HOY.
--
--    `free` trae lo mínimo que hace al producto útil sin costarnos dinero
--    variable: un canal, la bandeja y la posibilidad de invitar a alguien.
--    Deliberadamente NO trae `inbox.ai_reply`: la respuesta automática es
--    literalmente el gasto de tokens, y regalarla es regalar dinero.
--
--    `starter` y `agency` se siembran en la 132, que es donde entran al
--    catálogo — hasta ese momento la FK `tenants_plan_fkey` los prohíbe. Sus
--    filas de plan_features van ahí, no aquí, para que ninguna de las dos
--    migraciones dependa de que la otra haya corrido antes de tiempo.
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO app.plan_features (plan_id, feature_key) VALUES
  ('free', 'inbox.whatsapp'),
  ('free', 'team.invite'),

  ('pro',  'inbox.whatsapp'),
  ('pro',  'inbox.meta'),
  ('pro',  'inbox.email'),
  ('pro',  'inbox.ai_reply'),
  ('pro',  'flows.publish'),
  ('pro',  'flows.ai_assist'),
  ('pro',  'agents.custom'),
  ('pro',  'vault.ingest'),
  ('pro',  'work.projects'),
  ('pro',  'crm.pipelines'),
  ('pro',  'team.invite')
ON CONFLICT (plan_id, feature_key) DO NOTHING;


-- ───────────────────────────────────────────────────────────────────────────
-- 7. Documentación viva.
-- ───────────────────────────────────────────────────────────────────────────

COMMENT ON TABLE app.features IS
  'Catálogo de funciones de la plataforma. Qué existe, no quién lo tiene. '
  'El blurb es copy de producto: es lo que ve quien topa un 402.';

COMMENT ON COLUMN app.features.on_downgrade IS
  'pause | readonly | keep. NUNCA delete, y no es un olvido: una baja de plan puede ser '
  'un webhook de Stripe mal interpretado o un dedo del staff. Pausar se deshace en un '
  'segundo; borrar no se deshace nunca.';

COMMENT ON TABLE app.plan_features IS
  'Qué funciones incluye cada plan. Deny por defecto: lo que no está aquí ni en un '
  'override vigente, está apagado.';

COMMENT ON TABLE app.tenant_entitlements IS
  'La excepción por cliente. Gana sobre el plan en los dos sentidos: granted=true concede '
  'lo que su plan no trae, granted=false quita lo que sí trae. La nota es obligatoria.';

COMMENT ON COLUMN app.tenant_entitlements.expires_at IS
  'Concesión temporal. Se evalúa contra now() dentro de tenant_entitlements_effective: '
  'una prueba de 14 días no puede sobrevivir porque un proceso tenga el reloj corrido.';
