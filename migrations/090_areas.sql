-- ═══════════════════════════════════════════════════════════════════════════
--  090_areas.sql — H11 · Áreas, mapa de negocio y gamificación
--
--  El emprendedor no llega con su empresa lista. Empieza con un área encendida
--  y va desbloqueando las demás. Este archivo es el modelo de ese avance.
--
--  ── Las dos decisiones que no se negocian (handoff §5) ─────────────────────
--
--   1. LAS REGLAS DE DESBLOQUEO VIVEN EN DATOS, NO EN CÓDIGO. `requirements`
--      es una lista de condiciones evaluables — `{"type":"value_count","min":3}` —
--      y no un `if` en TypeScript. Así se ajustan por giro sin desplegar, y el
--      agente maestro puede proponer sus propias condiciones escribiendo una
--      fila. El criterio observable 5 del handoff es exactamente eso: cambiar
--      `requirements` cambia el comportamiento sin tocar el código.
--
--   2. LAS ÁREAS BLOQUEADAS SE VEN. Por eso `blurb` (la promesa) se siembra
--      también en las bloqueadas, y por eso el catálogo trae áreas que el giro
--      no incluye: ver "RH · graduarte de solopreneur" con candado le planta
--      una idea que va a querer.
--
--  ── Cómo se relaciona con el giro (H4) ─────────────────────────────────────
--
--  `app.industry_templates.areas` (migración 033, de H4) ya dice QUÉ áreas
--  tiene cada giro, con su etiqueta, su posición y su promesa — por giro y en
--  el lenguaje de ese giro. No se duplica aquí: la siembra lo lee.
--
--  Lo que H4 NO tiene, y aquí se agrega, es CUÁNDO se abre cada área y qué
--  guion la presenta. Eso vive en `app.area_catalog`, con la misma llave
--  (giro × área) que usa el resto del sistema.
--
--  ── Sobre los iconos ───────────────────────────────────────────────────────
--
--  La 033 escribe iconos en PascalCase de lucide (`HeartHandshake`, `ChefHat`,
--  `Boxes`) y el registro de H5 (`packages/ui/.../icon.tsx`) sólo conoce un
--  subconjunto con otra convención. Tres áreas —servicio, cocina e inventario—
--  saldrían con el icono genérico de llave inglesa. No se arregla editando el
--  árbol de H4 ni el de H5: `area_catalog.icon` lo resuelve como DATO, y
--  `catalog.test.ts` falla si alguna vez alguien escribe aquí un icono que el
--  registro de H5 no tiene.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 1. El catálogo: cuándo se abre cada área, y con qué guion
--
--    Llave (industry_id, area_slug). `industry_id = '*'` es la regla base que
--    aplica a todo giro; una fila con el id del giro la sobrescribe. Es la
--    misma precedencia que usa la bóveda de H4: gana lo más específico.
--
--    `seed_always` es lo que hace que las áreas del handoff §5 que ningún giro
--    de la 033 declara —Onboarding y RH— igual aparezcan en el mapa, con su
--    candado y su promesa. Sin esto, la mitad de la tabla de desbloqueo del
--    handoff no se vería nunca.
-- ───────────────────────────────────────────────────────────────────────────

-- tenantless: catálogo de la plataforma. Es el mismo para todos los clientes y
-- existe antes que cualquier tenant, igual que app.industry_templates.
CREATE TABLE app.area_catalog (
  industry_id  text NOT NULL,
  area_slug    text NOT NULL,

  -- Sobrescriben lo que diga la plantilla del giro cuando no vienen nulos.
  -- `icon` casi siempre viene: es el que traduce lucide → registro de H5.
  label        text,
  icon         text,
  blurb        text,
  position     int,

  -- La lista de condiciones evaluables. VACÍA significa "no se abre sola":
  -- hace falta una acción explícita. `[{"type":"always"}]` la abre de entrada.
  requirements jsonb NOT NULL DEFAULT '[]',

  -- Estado con el que nace el área en un tenant nuevo. La siembra igual
  -- re-evalúa los requisitos, así que esto es el piso, no la última palabra.
  initial_state text NOT NULL DEFAULT 'bloqueada'
                CHECK (initial_state IN ('bloqueada','disponible','en_progreso','activa')),

  -- Claves "area:herramienta" que resuelve el tool-registry del front (H5).
  -- Un área sin pantalla propia todavía lleva `[]`, que es la verdad.
  tools        jsonb NOT NULL DEFAULT '[]',

  -- El guion del mini-onboarding (handoff §6): qué es el área en SU empresa,
  -- qué cambia cuando la tiene, TRES preguntas —no veinte— y un primer
  -- resultado visible. Uno por área × giro, en la base y no en el código.
  script       jsonb NOT NULL DEFAULT '{}',

  -- Se siembra aunque la plantilla del giro no la mencione.
  seed_always  boolean NOT NULL DEFAULT false,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (industry_id, area_slug)
);

ALTER TABLE app.area_catalog ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER area_catalog_touch_updated_at
  BEFORE UPDATE ON app.area_catalog
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();


-- ───────────────────────────────────────────────────────────────────────────
-- 2. El estado de cada área en cada empresa
--
--    `requirements` se COPIA del catálogo al sembrar, no se referencia. Es a
--    propósito: el agente maestro puede endurecer o aflojar las condiciones de
--    UN cliente sin tocar el catálogo de todos, y cambiar el catálogo no le
--    mueve el piso a quien ya lleva medio mapa abierto.
--
--    `progress` guarda lo que ya cumplió y las declaraciones del emprendedor
--    (`{"declared":{"va_a_contratar":true}}`), que son requisitos que ninguna
--    tabla puede contar: sólo él sabe si va a contratar.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE app.tenant_areas (
  tenant_id    uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  area_slug    text NOT NULL,

  state        text NOT NULL DEFAULT 'bloqueada'
               CHECK (state IN ('bloqueada','disponible','en_progreso','activa')),

  label        text NOT NULL DEFAULT '',
  icon         text NOT NULL DEFAULT 'wrench',
  blurb        text NOT NULL DEFAULT '',
  tools        jsonb NOT NULL DEFAULT '[]',

  requirements jsonb NOT NULL DEFAULT '[]',   -- qué falta para abrirla
  progress     jsonb NOT NULL DEFAULT '{}',   -- qué ya cumplió

  unlocked_at  timestamptz,
  position     int NOT NULL DEFAULT 0,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, area_slug)
);

ALTER TABLE app.tenant_areas ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER tenant_areas_touch_updated_at
  BEFORE UPDATE ON app.tenant_areas
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- El sidebar pide las áreas de un tenant ordenadas, en cada carga de página.
CREATE INDEX tenant_areas_position_idx ON app.tenant_areas (tenant_id, position);


-- ───────────────────────────────────────────────────────────────────────────
-- 3. El roadmap de hitos
--
--    Lo propone el agente maestro y el emprendedor lo edita, lo reordena y lo
--    marca. `position` es numérico y no entero por la misma razón que en la
--    070 de H9: mover un hito entre dos vecinos es un promedio, no un UPDATE
--    de toda la lista.
--
--    `area_slug` es NULLABLE y SIN llave foránea a `tenant_areas`: un hito
--    puede ser del negocio entero ("abrir el segundo local") y no de un área.
--    Y si el mapa se resiembra, un hito no debe desaparecer con ella — lo
--    escribió el dueño del negocio, no el catálogo.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE app.tenant_milestones (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  area_slug    text,
  title        text NOT NULL CHECK (length(btrim(title)) > 0),
  description  text,
  position     numeric NOT NULL DEFAULT 0,
  done_at      timestamptz,
  generated_by text NOT NULL DEFAULT 'master_agent'
               CHECK (generated_by IN ('master_agent','user','seed')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app.tenant_milestones ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER tenant_milestones_touch_updated_at
  BEFORE UPDATE ON app.tenant_milestones
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE INDEX tenant_milestones_order_idx
  ON app.tenant_milestones (tenant_id, position);


-- ───────────────────────────────────────────────────────────────────────────
-- 4. El mini-onboarding de un área
--
--    Cuando desbloquea, no aterriza en una tabla vacía: el agente maestro le
--    da un tutorial sobre SU negocio. Una corrida por área y por empresa.
--
--    `answers` son sus respuestas a las tres preguntas; `result` es el primer
--    resultado visible que se generó antes de terminar (criterio 4). Que el
--    resultado esté GUARDADO y no sólo pintado es lo que permite volver al
--    mapa dos días después y seguir viendo lo que construyó.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE app.area_onboarding_runs (
  tenant_id     uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  area_slug     text NOT NULL,

  step          int  NOT NULL DEFAULT 0,
  answers       jsonb NOT NULL DEFAULT '[]',
  result        jsonb,

  started_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, area_slug)
);

ALTER TABLE app.area_onboarding_runs ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER area_onboarding_runs_touch_updated_at
  BEFORE UPDATE ON app.area_onboarding_runs
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();


-- ═══════════════════════════════════════════════════════════════════════════
--  5. Las señales: lo único que hace falta saber para evaluar un requisito
--
--  El evaluador de requisitos es una función PURA de TypeScript
--  (`domain/requirements.ts`) y no toca la base. Lo que sí toca la base es
--  esto: una foto de siete números del negocio.
--
--  ── Por qué es UNA función de Postgres y no siete consultas ────────────────
--
--  Las tablas que se cuentan aquí son de OTROS carriles: `channels` es de H6,
--  `contacts` y `pipeline_stages` de H15, `canonical_values` y `documents` de
--  H4. Contarlas desde TypeScript obligaría a H11 a declarar cinco tablas
--  ajenas en su `tables.d.ts` y a acoplarse a la forma de cada una. Aquí el
--  acoplamiento queda en UN lugar auditable, del lado del SQL, y el paquete de
--  H11 no conoce ni el nombre de esas tablas.
--
--  ── Por qué cada consulta va con `to_regclass` ─────────────────────────────
--
--  Las migraciones corren en orden y la 120 (CRM) es POSTERIOR a esta. En una
--  base recién levantada que va por la 090, `app.contacts` todavía no existe.
--  Sin el guard, la primera llamada revienta con "relation does not exist" y
--  el mapa entero deja de cargar por un área que ni siquiera está desbloqueada.
--  Con el guard, un carril que no ha aterrizado vale CERO — que es la verdad —
--  y el resto de las señales se responden igual.
--
--  ── Sobre el aislamiento ───────────────────────────────────────────────────
--
--  `service_role` hace bypass de RLS, así que aquí el aislamiento NO lo pone
--  Postgres: lo pone `p_tenant`, y cada consulta de abajo lo lleva en su WHERE.
--  El llamador no puede quitarlo porque no escribe el WHERE: lo escribe esta
--  función. Ver `data/rpc.ts`, que es la única puerta por la que se invoca y
--  que inyecta `ctx.tenantId` ella misma.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION app.areas_signals(p_tenant uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $fn$
DECLARE
  v_channels   int := 0;
  v_stages     int := 0;
  v_values     int := 0;
  v_documents  int := 0;
  v_contacts   int := 0;
  v_won        int := 0;
  v_months     int := 0;
BEGIN
  IF p_tenant IS NULL THEN
    RAISE EXCEPTION 'areas_signals requiere p_tenant';
  END IF;

  -- Meses de operación: desde el alta de la empresa. Es el único que no
  -- depende de otro carril.
  SELECT COALESCE(
           FLOOR(EXTRACT(EPOCH FROM (now() - t.created_at)) / 2592000)::int,
           0)
    INTO v_months
    FROM app.tenants t
   WHERE t.id = p_tenant;
  v_months := COALESCE(v_months, 0);

  -- H6 · canales conectados de verdad (no los que quedaron a medio dar de alta)
  IF to_regclass('app.channels') IS NOT NULL THEN
    EXECUTE 'SELECT count(*)::int FROM app.channels
              WHERE tenant_id = $1 AND status = ''active'''
       INTO v_channels USING p_tenant;
  END IF;

  -- H15 · el embudo está definido cuando tiene etapas, no cuando existe la fila
  IF to_regclass('app.pipeline_stages') IS NOT NULL THEN
    EXECUTE 'SELECT count(*)::int FROM app.pipeline_stages WHERE tenant_id = $1'
       INTO v_stages USING p_tenant;
  END IF;

  -- H4 · valores canónicos VIGENTES. Los borradores que extrajo la bóveda de un
  -- documento nacen con active = false y no cuentan: el emprendedor todavía no
  -- los ha confirmado, y un requisito que se cumple solo no enseña nada.
  IF to_regclass('app.canonical_values') IS NOT NULL THEN
    EXECUTE 'SELECT count(*)::int FROM app.canonical_values
              WHERE tenant_id = $1 AND active'
       INTO v_values USING p_tenant;
  END IF;

  IF to_regclass('app.documents') IS NOT NULL THEN
    EXECUTE 'SELECT count(*)::int FROM app.documents WHERE tenant_id = $1'
       INTO v_documents USING p_tenant;
  END IF;

  -- H15 · contactos activos: los que siguen en juego. `churned` ya se fue y
  -- contarlo haría que "tienes 5 contactos activos" se cumpliera con clientes
  -- perdidos.
  IF to_regclass('app.contacts') IS NOT NULL THEN
    EXECUTE 'SELECT count(*)::int FROM app.contacts
              WHERE tenant_id = $1 AND lifecycle <> ''churned'''
       INTO v_contacts USING p_tenant;
  END IF;

  -- H15 · primera venta cerrada EN EL SISTEMA: un contacto parado en una etapa
  -- marcada `is_won`. Es el criterio del handoff para abrir Onboarding.
  IF to_regclass('app.contact_stages') IS NOT NULL
     AND to_regclass('app.pipeline_stages') IS NOT NULL THEN
    EXECUTE 'SELECT count(*)::int
               FROM app.contact_stages cs
               JOIN app.pipeline_stages ps
                 ON ps.id = cs.stage_id AND ps.tenant_id = cs.tenant_id
              WHERE cs.tenant_id = $1 AND ps.is_won'
       INTO v_won USING p_tenant;
  END IF;

  RETURN jsonb_build_object(
    'channels_active',  COALESCE(v_channels, 0),
    'pipeline_stages',  COALESCE(v_stages, 0),
    'values_active',    COALESCE(v_values, 0),
    'documents',        COALESCE(v_documents, 0),
    'contacts_active',  COALESCE(v_contacts, 0),
    'deals_won',        COALESCE(v_won, 0),
    'months_operating', COALESCE(v_months, 0)
  );
END;
$fn$;

COMMENT ON FUNCTION app.areas_signals(uuid) IS
  'Foto de las senales del negocio que evaluan los requisitos de desbloqueo '
  '(H11). Cada consulta va con to_regclass porque cuenta tablas de carriles '
  'posteriores: lo que no ha aterrizado vale cero, no revienta el mapa.';


-- ═══════════════════════════════════════════════════════════════════════════
--  6. La siembra de un mapa nuevo
--
--  Un tenant nuevo nace con sus áreas puestas según su giro (criterio 1). La
--  lista sale de la UNIÓN de dos fuentes:
--
--    · `app.industry_templates.areas` — las áreas DEL GIRO, con la etiqueta y
--      la promesa en el lenguaje de ese giro. Es de H4 y no se duplica.
--    · `app.area_catalog` con `seed_always` — las áreas que todo negocio
--      debería ver con candado aunque su giro no las liste (Onboarding, RH).
--
--  El catálogo gana en `icon`, y en lo demás gana la plantilla del giro: es la
--  que habla como el negocio del cliente. Dos giros distintos siembran mapas
--  distintos (criterio 6) porque la plantilla es distinta.
--
--  IDEMPOTENTE: correrla dos veces no duplica ni pisa el avance. `ON CONFLICT`
--  sólo refresca lo que es del catálogo —etiqueta, icono, promesa, posición,
--  herramientas— y NO toca `state`, `progress`, `unlocked_at` ni
--  `requirements`: eso es del cliente y de su avance, no del catálogo.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION app.areas_seed_tenant(p_tenant uuid)
RETURNS int
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $fn$
DECLARE
  v_industry text;
  v_insertadas int := 0;
BEGIN
  IF p_tenant IS NULL THEN
    RAISE EXCEPTION 'areas_seed_tenant requiere p_tenant';
  END IF;

  SELECT COALESCE(t.industry_type, 'general') INTO v_industry
    FROM app.tenants t WHERE t.id = p_tenant;

  IF v_industry IS NULL THEN
    RAISE EXCEPTION 'areas_seed_tenant: el tenant % no existe', p_tenant
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Si el giro que trae el tenant no está en el catálogo de H4, se cae a
  -- 'general' — que la 033 siembra justamente para eso. Un giro escrito a mano
  -- por una integración no debe dejar al emprendedor sin mapa.
  IF NOT EXISTS (SELECT 1 FROM app.industry_templates WHERE id = v_industry) THEN
    v_industry := 'general';
  END IF;

  WITH
  -- Las áreas del giro, tal como las declaró H4.
  del_giro AS (
    SELECT a->>'slug'                          AS slug,
           a->>'label'                         AS label,
           a->>'icon'                          AS icon,
           a->>'blurb'                         AS blurb,
           COALESCE((a->>'position')::int, 0)  AS position
      FROM app.industry_templates it,
           LATERAL jsonb_array_elements(it.areas) a
     WHERE it.id = v_industry
  ),
  -- La regla que le toca a cada área: la del giro si existe, si no la de '*'.
  regla AS (
    SELECT DISTINCT ON (c.area_slug)
           c.area_slug, c.label, c.icon, c.blurb, c.position,
           c.requirements, c.initial_state, c.tools, c.seed_always
      FROM app.area_catalog c
     WHERE c.industry_id IN (v_industry, '*')
     ORDER BY c.area_slug, (c.industry_id = '*')   -- false < true: gana el giro
  ),
  -- La unión: las del giro, más las que el catálogo manda sembrar siempre.
  todas AS (
    SELECT g.slug,
           COALESCE(g.label, r.label, initcap(g.slug))      AS label,
           COALESCE(r.icon,  g.icon,  'wrench')             AS icon,
           COALESCE(g.blurb, r.blurb, '')                   AS blurb,
           COALESCE(g.position, r.position, 0)              AS position,
           COALESCE(r.requirements, '[]'::jsonb)            AS requirements,
           COALESCE(r.initial_state, 'bloqueada')           AS initial_state,
           COALESCE(r.tools, '[]'::jsonb)                   AS tools
      FROM del_giro g
      LEFT JOIN regla r ON r.area_slug = g.slug

    UNION ALL

    SELECT r.area_slug,
           COALESCE(r.label, initcap(r.area_slug)),
           COALESCE(r.icon, 'wrench'),
           COALESCE(r.blurb, ''),
           COALESCE(r.position, 50),
           r.requirements,
           r.initial_state,
           r.tools
      FROM regla r
     WHERE r.seed_always
       AND NOT EXISTS (SELECT 1 FROM del_giro g WHERE g.slug = r.area_slug)
  ),
  escritas AS (
    INSERT INTO app.tenant_areas AS ta
      (tenant_id, area_slug, state, label, icon, blurb, tools, requirements, position)
    SELECT p_tenant, t.slug, t.initial_state, t.label, t.icon, t.blurb,
           t.tools, t.requirements, t.position
      FROM todas t
    ON CONFLICT (tenant_id, area_slug) DO UPDATE SET
      -- Del catálogo: se refresca.
      label   = EXCLUDED.label,
      icon    = EXCLUDED.icon,
      blurb   = EXCLUDED.blurb,
      tools   = EXCLUDED.tools,
      position = EXCLUDED.position
      -- De lo demás: NADA. state, progress, unlocked_at y requirements son del
      -- avance del cliente. Resembrar no le cierra un área que ya abrió.
    RETURNING (xmax = 0) AS fue_insert
  )
  SELECT count(*)::int INTO v_insertadas FROM escritas WHERE fue_insert;

  RETURN v_insertadas;
END;
$fn$;

COMMENT ON FUNCTION app.areas_seed_tenant(uuid) IS
  'Siembra el mapa de areas de un tenant desde la plantilla de su giro (H4) '
  'mas el catalogo de H11. Idempotente: no duplica ni pisa el avance.';


-- ═══════════════════════════════════════════════════════════════════════════
--  7. El catálogo sembrado
--
--  La tabla del handoff §5, en datos. La regla base va en `'*'`; sólo se
--  escribe una fila por giro cuando ese giro de verdad cambia la condición.
--
--  Los iconos son del registro de H5 (`icon.tsx`), no de lucide en crudo, y
--  `catalog.test.ts` lo verifica leyendo ese archivo. Las promesas son las del
--  handoff, textuales: es lo que el emprendedor ve junto al candado.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO app.area_catalog
  (industry_id, area_slug, icon, label, blurb, requirements, initial_state, tools, seed_always, script)
VALUES

-- ── Ventas · "un equipo de ventas que nunca duerme" ────────────────────────
--    Se abre con canal conectado Y embudo definido: las dos, porque un canal
--    sin embudo es una bandeja y un embudo sin canal no tiene por dónde entrar
--    nadie.
(
  '*', 'ventas', 'target', 'Ventas',
  'Un equipo de ventas que nunca duerme: contesta, da seguimiento y no deja caer a nadie.',
  '[{"type":"has_channel","min":1},{"type":"pipeline_defined"}]'::jsonb,
  'bloqueada',
  '["ventas:resumen","ventas:bandeja","ventas:contactos","ventas:pipeline"]'::jsonb,
  false,
  $s${
    "intro": "Ventas en tu negocio no es un CRM: es que nadie que levante la mano se te quede sin respuesta.",
    "promise": "Tus prospectos dejan de perderse el fin de semana.",
    "questions": [
      {"key":"como_llegan","prompt":"Cuando alguien quiere comprarte, ¿por dónde te escribe primero?"},
      {"key":"que_preguntan","prompt":"¿Qué es lo primero que te preguntan casi siempre?"},
      {"key":"cuando_cierras","prompt":"¿En qué momento sabes que una venta ya es tuya?"}
    ],
    "result": {"kind":"pipeline_draft","label":"Tu embudo, con las etapas que acabas de describir"}
  }$s$::jsonb
),

-- ── Dirección · "tus números en un solo lugar" ─────────────────────────────
--    El único `any_of` del catálogo, y es del handoff: "carga 1 documento O
--    define 3 valores". Son dos caminos al mismo lugar —que la bóveda deje de
--    estar vacía— y exigir los dos sería exigir el doble por el mismo aprendizaje.
(
  '*', 'direccion', 'compass', 'Dirección',
  'Tus números en un solo lugar, para que nada más mienta.',
  '[{"type":"any_of","of":[{"type":"document_count","min":1},{"type":"value_count","min":3}]}]'::jsonb,
  'disponible',
  '["direccion:resumen","direccion:valores","direccion:biblioteca","direccion:tareas"]'::jsonb,
  true,
  $s${
    "intro": "Dirección es la bóveda: lo que tu negocio da por cierto. Precios, márgenes, políticas.",
    "promise": "Cuando un dato vive aquí, tus agentes dejan de inventarlo.",
    "questions": [
      {"key":"precio_ancla","prompt":"¿Cuánto cuesta lo que más vendes?"},
      {"key":"no_negociable","prompt":"¿Qué es lo que NUNCA vas a hacer por un cliente, aunque pague?"},
      {"key":"como_ganas","prompt":"De cada cien pesos que entran, ¿cuántos te quedas?"}
    ],
    "result": {"kind":"values_draft","label":"Tus tres primeros valores canónicos, listos para activar"}
  }$s$::jsonb
),

-- ── Onboarding · "cómo se siente entrar a tu negocio siendo cliente" ───────
--    seed_always: NINGÚN giro de la 033 la declara, y es de las que más
--    curiosidad plantan. Verla con candado es el punto.
(
  '*', 'onboarding', 'door-open', 'Onboarding',
  'Cómo se siente entrar a tu negocio siendo cliente.',
  '[{"type":"deal_won","min":1}]'::jsonb,
  'bloqueada',
  '[]'::jsonb,
  true,
  $s${
    "intro": "Ya vendiste. Lo que pasa en los siguientes siete días decide si te recomienda o no vuelve.",
    "promise": "El cliente nuevo deja de sentir que te desapareciste al cobrar.",
    "questions": [
      {"key":"primer_dia","prompt":"Acaba de pagarte. ¿Qué es lo primero que recibe de ti?"},
      {"key":"que_no_sabe","prompt":"¿Qué se le olvida siempre a un cliente nuevo?"},
      {"key":"cuando_listo","prompt":"¿Cuándo consideras que ya quedó bien atendido?"}
    ],
    "result": {"kind":"sequence_draft","label":"Tu secuencia de bienvenida, escrita"}
  }$s$::jsonb
),

-- ── Servicio · "dejar de perder clientes por no contestar" ─────────────────
(
  '*', 'servicio', 'headset', 'Atención a clientes',
  'Dejar de perder clientes por no contestar.',
  '[{"type":"contact_count","min":5}]'::jsonb,
  'bloqueada',
  '["servicio:resumen","servicio:conversaciones"]'::jsonb,
  false,
  $s${
    "intro": "Servicio no es un buzón de quejas: es lo que hace que el cliente que ya te compró vuelva.",
    "promise": "Nadie se queda esperando respuesta el fin de semana.",
    "questions": [
      {"key":"queja_comun","prompt":"¿De qué se queja más seguido tu cliente?"},
      {"key":"cuanto_tardas","prompt":"¿En cuánto tiempo deberías contestar para que no se enoje?"},
      {"key":"que_no_cedes","prompt":"¿Qué sí resuelves siempre, y qué no?"}
    ],
    "result": {"kind":"faq_draft","label":"Tus respuestas a lo que más te preguntan"}
  }$s$::jsonb
),

-- ── RH · "graduarte de solopreneur" ───────────────────────────────────────
--    Requisito DECLARADO: ninguna tabla puede contar si va a contratar. Sólo
--    él lo sabe, y decirlo es el acto que abre el área.
(
  '*', 'rh', 'users', 'Recursos humanos',
  'Graduarte de solopreneur.',
  '[{"type":"declared","key":"va_a_contratar"}]'::jsonb,
  'bloqueada',
  '[]'::jsonb,
  true,
  $s${
    "intro": "Contratar no es publicar una vacante: es poder soltar algo que hoy sólo tú sabes hacer.",
    "promise": "Dejas de ser el cuello de botella de tu propio negocio.",
    "questions": [
      {"key":"que_sueltas","prompt":"¿Qué haces tú hoy que preferirías no hacer la semana que entra?"},
      {"key":"como_sabes","prompt":"¿Cómo sabrías que esa persona lo está haciendo bien?"},
      {"key":"cuanto_pagas","prompt":"¿Cuánto puedes pagar al mes por eso, sin apretarte?"}
    ],
    "result": {"kind":"role_draft","label":"El perfil del puesto, con lo que sí y lo que no"}
  }$s$::jsonb
),

-- ── Finanzas · "saber si de verdad ganas" ─────────────────────────────────
(
  '*', 'finanzas', 'wallet', 'Finanzas',
  'Saber si de verdad ganas.',
  '[{"type":"months_operating","min":3}]'::jsonb,
  'bloqueada',
  '[]'::jsonb,
  true,
  $s${
    "intro": "Finanzas no es contabilidad: es saber si el mes que acabas de trabajar te dejó algo.",
    "promise": "Dejas de confundir que entre dinero con que estés ganando.",
    "questions": [
      {"key":"gasto_fijo","prompt":"¿Cuánto se te va al mes, vendas o no vendas?"},
      {"key":"cuanto_cuesta","prompt":"De lo que más vendes, ¿cuánto te cuesta a ti?"},
      {"key":"cuanto_quieres","prompt":"¿Cuánto querrías que te quedara al mes?"}
    ],
    "result": {"kind":"breakeven","label":"Tu punto de equilibrio: lo que tienes que vender para no perder"}
  }$s$::jsonb
),

-- ── Marketing ─────────────────────────────────────────────────────────────
(
  '*', 'marketing', 'megaphone', 'Marketing',
  'Que te encuentren sin que tengas que salir a buscar.',
  '[{"type":"has_channel","min":1}]'::jsonb,
  'bloqueada',
  '[]'::jsonb,
  false,
  $s${
    "intro": "Marketing aquí es una cosa: que llegue gente nueva sin que tú la persigas.",
    "promise": "Dejas de depender de que alguien te recomiende.",
    "questions": [
      {"key":"como_te_conocen","prompt":"Los clientes que ya tienes, ¿cómo te encontraron?"},
      {"key":"a_quien","prompt":"¿A quién le sirve más lo que vendes?"},
      {"key":"cuanto_inviertes","prompt":"¿Cuánto puedes poner al mes para que te conozcan?"}
    ],
    "result": {"kind":"audience_draft","label":"A quién le hablas y por dónde"}
  }$s$::jsonb
),

-- ── Operaciones ───────────────────────────────────────────────────────────
--    Abierta de entrada: es lo que el negocio YA hace. Bloquear la entrega de
--    lo que vende sería bloquear el negocio.
(
  '*', 'operaciones', 'wrench', 'Operaciones',
  'Que lo que vendes se entregue igual de bien cuando no estás tú.',
  '[{"type":"always"}]'::jsonb,
  'disponible',
  '[]'::jsonb,
  false,
  $s${
    "intro": "Operaciones es cómo se entrega lo que vendes, escrito para que no dependa de tu memoria.",
    "promise": "Puedes irte una semana y el negocio entrega igual.",
    "questions": [
      {"key":"paso_a_paso","prompt":"Desde que te pagan, ¿qué pasa hasta que el cliente tiene lo suyo?"},
      {"key":"donde_falla","prompt":"¿En qué paso se atora más seguido?"},
      {"key":"quien_lo_hace","prompt":"¿Qué parte sólo la sabes hacer tú?"}
    ],
    "result": {"kind":"sop_draft","label":"Tu proceso de entrega, en pasos"}
  }$s$::jsonb
),

-- ── Inventario ────────────────────────────────────────────────────────────
(
  '*', 'inventario', 'store', 'Inventario',
  'Dejar de vender lo que no tienes y de comprar lo que no se mueve.',
  '[{"type":"always"}]'::jsonb,
  'disponible',
  '[]'::jsonb,
  false,
  $s${
    "intro": "Inventario es saber qué tienes, qué se está acabando y qué lleva meses parado.",
    "promise": "Dejas de quedar mal por vender algo que ya no había.",
    "questions": [
      {"key":"que_mas_sale","prompt":"¿Qué es lo que más se te vende?"},
      {"key":"cuando_pides","prompt":"¿Cuándo te das cuenta de que se está acabando algo?"},
      {"key":"cuanto_tarda","prompt":"¿Cuánto tarda tu proveedor en surtirte?"}
    ],
    "result": {"kind":"stock_draft","label":"Tus mínimos de resurtido"}
  }$s$::jsonb
),

-- ═══ Ajustes por giro ══════════════════════════════════════════════════════
--
-- Sólo se escribe una fila cuando el giro CAMBIA de verdad la condición. Un
-- catálogo con una fila por área × giro sería el mismo hardcode de GARDEN, en
-- otra tabla.

-- Un restaurante opera desde el día uno y sus números aprietan desde el primer
-- mes: esperar tres meses para abrirle Finanzas es tarde. Su punto de
-- equilibrio es la pregunta que decide si sigue abierto.
(
  'restaurante', 'finanzas', 'wallet', 'Finanzas',
  'Saber si de verdad ganas — antes de que se te acabe el mes.',
  '[{"type":"months_operating","min":1}]'::jsonb,
  'bloqueada', '[]'::jsonb, true,
  $s${
    "intro": "En un restaurante el margen se pierde en la cocina, no en la caja.",
    "promise": "Sabes cuánto te deja cada platillo, no cuánto entró en el día.",
    "questions": [
      {"key":"gasto_fijo","prompt":"Entre renta, nómina y servicios, ¿cuánto se va al mes?"},
      {"key":"costo_platillo","prompt":"Tu platillo estrella, ¿cuánto te cuesta hacerlo?"},
      {"key":"cuantos_dias","prompt":"¿Cuántos días a la semana abres?"}
    ],
    "result": {"kind":"breakeven","label":"Cuántos platillos al día tienes que vender para no perder"}
  }$s$::jsonb
),

-- El comercio vive del inventario: es su área central, no una de apoyo.
(
  'comercio', 'inventario', 'store', 'Inventario',
  'Dejar de vender lo que no tienes y de tener parado tu dinero.',
  '[{"type":"always"}]'::jsonb,
  'disponible', '[]'::jsonb, false,
  $s${
    "intro": "En una tienda tu dinero no está en el banco: está en el anaquel.",
    "promise": "Dejas de tener capital dormido en lo que no se mueve.",
    "questions": [
      {"key":"que_mas_sale","prompt":"¿Cuáles son los cinco que más se venden?"},
      {"key":"que_no_sale","prompt":"¿Qué llevas meses sin poder sacar?"},
      {"key":"cuanto_tarda","prompt":"¿Cuánto tarda tu proveedor en surtirte?"}
    ],
    "result": {"kind":"stock_draft","label":"Tus mínimos de resurtido y lo que hay que rematar"}
  }$s$::jsonb
),

-- Una agencia vive de la relación con la cuenta desde el primer cliente, no
-- desde el quinto contacto.
(
  'agencia', 'servicio', 'headset', 'Atención a clientes',
  'Que ninguna cuenta se te enfríe sin que te des cuenta.',
  '[{"type":"deal_won","min":1}]'::jsonb,
  'bloqueada',
  '["servicio:resumen","servicio:conversaciones"]'::jsonb,
  false,
  $s${
    "intro": "En una agencia no se pierde una cuenta por un mal entregable: se pierde por silencio.",
    "promise": "Te enteras de que una cuenta se está enfriando antes de que te lo digan.",
    "questions": [
      {"key":"cada_cuando","prompt":"¿Cada cuándo deberías hablar con cada cuenta?"},
      {"key":"que_reportas","prompt":"¿Qué les enseñas para que vean que sí sirvió?"},
      {"key":"cuando_mal","prompt":"¿Cuál es la primera señal de que un cliente está molesto?"}
    ],
    "result": {"kind":"faq_draft","label":"Tu ritmo de contacto por cuenta"}
  }$s$::jsonb
)

ON CONFLICT (industry_id, area_slug) DO UPDATE SET
  icon          = EXCLUDED.icon,
  blurb         = EXCLUDED.blurb,
  requirements  = EXCLUDED.requirements,
  initial_state = EXCLUDED.initial_state,
  tools         = EXCLUDED.tools,
  seed_always   = EXCLUDED.seed_always,
  script        = EXCLUDED.script;


COMMENT ON TABLE app.area_catalog IS
  'Cuando se abre cada area y con que guion, por giro x area. Las reglas de '
  'desbloqueo viven AQUI y no en TypeScript: ajustar un giro es un UPDATE, no '
  'un deploy (handoff H11 §5).';

COMMENT ON TABLE app.tenant_areas IS
  'El estado del mapa de un cliente. requirements se COPIA del catalogo al '
  'sembrar para que el agente maestro pueda ajustar UN cliente sin mover el '
  'piso de los demas.';

COMMENT ON TABLE app.tenant_milestones IS
  'El roadmap del negocio. Lo propone el agente maestro y el emprendedor lo '
  'edita, reordena y marca.';

COMMENT ON TABLE app.area_onboarding_runs IS
  'La corrida del mini-onboarding de un area. `result` se guarda y no solo se '
  'pinta: el primer resultado visible sigue ahi dos dias despues.';
