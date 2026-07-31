-- ═══════════════════════════════════════════════════════════════════════════
--  010_tenancy.sql — H2
--
--  Quién es cada quien, a qué empresa pertenece y qué puede tocar.
--
--  La 001 dejó `app.tenants`, `app.memberships` y `app.area_grants`. Esta
--  migración construye encima: agrega las tablas que faltaban (usuarios,
--  planes, invitaciones, bitácora de eventos) y — sobre todo — pone los
--  candados que la 001 no podía poner porque las tablas de las que dependen
--  no existían todavía.
--
--  ── Por qué hay tanto CHECK aquí ──────────────────────────────────────────
--
--  El aislamiento entre clientes se juega en `contextFor()`, que compara un
--  correo contra `app.memberships`. Esa comparación es texto exacto. Si la
--  base acepta 'Ana@x.com' y 'ana@x.com' como dos filas distintas, existe un
--  usuario sombra: alguien con membresía que el código no encuentra, o peor,
--  alguien que el código encuentra y no debería. El CHECK de minúsculas no es
--  higiene, es parte del candado.
--
--  Mismo criterio para el resto: un rol inválido, un acceso inválido o un
--  slug con mayúsculas son datos que rompen una decisión de seguridad más
--  arriba. La base los rechaza y no dependemos de que el código se acuerde.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 1. Predicados reutilizables.
--
--    Un CHECK de Postgres no admite subconsultas, así que la validación de
--    "todos los valores de este jsonb son un acceso válido" tiene que vivir
--    en una función IMMUTABLE.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION app.es_correo(p text)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT p = lower(p)
     AND p = btrim(p)
     AND p ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     AND length(p) <= 320;
$$;

COMMENT ON FUNCTION app.es_correo(text) IS
  'Correo normalizado: minúsculas, sin espacios alrededor, con forma de correo. '
  'La comparación de membresía es texto exacto; un correo sin normalizar es un usuario sombra.';

CREATE OR REPLACE FUNCTION app.es_mapa_de_areas(p jsonb)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT jsonb_typeof(p) = 'object'
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_each_text(p) AS kv
       WHERE kv.value NOT IN ('view', 'edit', 'admin')
     );
$$;

COMMENT ON FUNCTION app.es_mapa_de_areas(jsonb) IS
  'Mapa {area_slug: view|edit|admin}. Un grant malformado tiene que morir en la base: '
  'si llega al RBAC, el código lanza (criterio #6 de H2) y el usuario se queda sin servicio.';


-- ───────────────────────────────────────────────────────────────────────────
-- 2. Usuarios.
--
--    La llave es el correo y no un uuid a propósito: es lo que trae la sesión
--    verificada de NextAuth, lo que viaja en `x-user-email` y lo que ya usan
--    `app.memberships` y `app.area_grants` de la 001. Un id sintético
--    obligaría a una traducción en cada petición y esa traducción es
--    exactamente donde se cuelan los bugs de identidad.
-- ───────────────────────────────────────────────────────────────────────────

-- tenantless: una persona existe antes de pertenecer a una empresa, y puede
-- ser invitada a otra. El usuario no es dato de ningún cliente.
CREATE TABLE app.users (
  email      text PRIMARY KEY CONSTRAINT users_email_normalizado CHECK (app.es_correo(email)),
  name       text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app.users ENABLE ROW LEVEL SECURITY;


-- ───────────────────────────────────────────────────────────────────────────
-- 3. Planes.
--
--    El MODELO de los límites, no el cobro: quién cobra es H10. Aquí sólo
--    vive qué puede hacer un tenant según su plan, para que `assertQuota()`
--    tenga contra qué comparar y para que H10 no tenga que inventar el
--    catálogo.
-- ───────────────────────────────────────────────────────────────────────────

-- tenantless: catálogo de la plataforma, igual para todos los clientes.
CREATE TABLE app.plans (
  id         text PRIMARY KEY CONSTRAINT plans_id_slug CHECK (id ~ '^[a-z][a-z0-9_]{1,30}$'),
  name       text NOT NULL,
  limits     jsonb NOT NULL DEFAULT '{}' CONSTRAINT plans_limits_objeto CHECK (jsonb_typeof(limits) = 'object'),
  position   int  NOT NULL DEFAULT 0,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app.plans ENABLE ROW LEVEL SECURITY;

INSERT INTO app.plans (id, name, limits, position) VALUES
  ('free', 'Gratis', jsonb_build_object(
      'maxSeats', 2, 'maxContacts', 500, 'maxChannels', 1,
      'maxFlows', 3, 'maxAgents', 1, 'monthlyAiUsd', 5), 0),
  ('pro',  'Pro',    jsonb_build_object(
      'maxSeats', 10, 'maxContacts', 10000, 'maxChannels', 3,
      'maxFlows', 25, 'maxAgents', 5, 'monthlyAiUsd', 50), 1)
ON CONFLICT (id) DO NOTHING;


-- ───────────────────────────────────────────────────────────────────────────
-- 4. Invitaciones.
--
--    El token se guarda HASHEADO. Una invitación pendiente es una llave que
--    abre una empresa: si la tabla se filtra en claro, se filtran todas las
--    llaves vivas. GARDEN ya resolvió esto para sus API keys
--    (crm_api_keys.key_hash) y aquí se aplica el mismo criterio.
--
--    `UNIQUE (tenant_id, email)`: una invitación viva por persona y empresa.
--    Reinvitar reemite el token sobre la misma fila (ver 012), lo cual además
--    invalida el token anterior — que es lo que uno quiere al reinvitar.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE app.invitations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  email       text NOT NULL CONSTRAINT invitations_email_normalizado CHECK (app.es_correo(email)),
  role        text NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  areas       jsonb NOT NULL DEFAULT '{}' CONSTRAINT invitations_areas_validas CHECK (app.es_mapa_de_areas(areas)),
  token_hash  text UNIQUE NOT NULL CONSTRAINT invitations_token_hasheado CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  invited_by  text REFERENCES app.users(email) ON DELETE SET NULL,
  accepted_at timestamptz,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

ALTER TABLE app.invitations ENABLE ROW LEVEL SECURITY;


-- ───────────────────────────────────────────────────────────────────────────
-- 5. Bitácora de eventos del tenant — el outbox.
--
--    El handoff pide que `provision()` sea todo-o-nada Y que emita
--    `tenant.provisioned` para que H11 siembre las áreas. Las dos cosas sólo
--    son ciertas a la vez si el evento se escribe DENTRO de la misma
--    transacción que crea el tenant: un bus en memoria se pierde si el
--    proceso muere entre el COMMIT y el emit, y entonces existe una empresa
--    que nunca recibió sus áreas.
--
--    Por eso el evento es una fila. Quien lo consume lo drena y lo marca.
--    `TriggerType` de ports.ts todavía no incluye 'tenant_provisioned'
--    (anotado en el PR); mientras tanto este outbox es la fuente.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE app.tenant_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  type         text NOT NULL CHECK (type ~ '^[a-z][a-z0-9_.]{2,60}$'),
  payload      jsonb NOT NULL DEFAULT '{}' CONSTRAINT tenant_events_payload_objeto CHECK (jsonb_typeof(payload) = 'object'),
  created_at   timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);

ALTER TABLE app.tenant_events ENABLE ROW LEVEL SECURITY;


-- ───────────────────────────────────────────────────────────────────────────
-- 6. Los candados que la 001 no pudo poner.
--
--    Las llaves foráneas hacia `app.users` no existían porque la tabla se
--    crea aquí. Sin ellas se puede insertar una membresía de un correo que no
--    es usuario de nada — y ese es justo el estado que hace que un `JOIN` de
--    nombres devuelva vacío y que nadie sepa por qué.
-- ───────────────────────────────────────────────────────────────────────────

-- Correos ya normalizados también en las tablas de la 001.
ALTER TABLE app.memberships
  ADD CONSTRAINT memberships_email_normalizado CHECK (app.es_correo(user_email));

ALTER TABLE app.area_grants
  ADD CONSTRAINT area_grants_email_normalizado CHECK (app.es_correo(user_email));

-- Toda membresía y todo grant apuntan a un usuario real.
ALTER TABLE app.memberships
  ADD CONSTRAINT memberships_user_email_fkey
  FOREIGN KEY (user_email) REFERENCES app.users(email) ON DELETE CASCADE;

ALTER TABLE app.area_grants
  ADD CONSTRAINT area_grants_user_email_fkey
  FOREIGN KEY (user_email) REFERENCES app.users(email) ON DELETE CASCADE;

-- `'*'` = todas las áreas (lo hereda el RBAC de GARDEN). El resto, slugs.
ALTER TABLE app.area_grants
  ADD CONSTRAINT area_grants_slug_valido
  CHECK (area_slug = '*' OR area_slug ~ '^[a-z][a-z0-9-]{1,38}$');

-- El plan del tenant tiene que existir en el catálogo.
ALTER TABLE app.tenants
  ADD CONSTRAINT tenants_plan_fkey
  FOREIGN KEY (plan) REFERENCES app.plans(id) ON UPDATE CASCADE;

-- Estado del tenant: el middleware niega la entrada a lo que no esté activo.
ALTER TABLE app.tenants
  ADD CONSTRAINT tenants_status_valido
  CHECK (status IN ('active', 'suspended', 'archived'));

/*
 * El slug viaja en `x-tenant-slug` y en la URL del producto. Un slug con
 * mayúsculas o con espacios convierte una comparación de identidad en una
 * lotería, y un slug igual a una ruta del producto ('api', 'bandeja') hace
 * que la empresa de alguien tape una pantalla. Se cierra aquí, no en el
 * formulario: el formulario no es la única puerta.
 */
ALTER TABLE app.tenants
  ADD CONSTRAINT tenants_slug_formato
  CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$');

ALTER TABLE app.tenants
  ADD CONSTRAINT tenants_slug_no_reservado
  CHECK (slug NOT IN (
    'api', 'admin', 'app', 'auth', 'www', 'static', 'assets', 'public',
    'login', 'logout', 'signin', 'signup', 'health', 'internal', 'webhook',
    'webhooks', 'stripe', 'tenants', 'tenant', 'invitations', 'invite',
    'onboarding', 'ritual', 'bandeja', 'mapa', 'tareas', 'automatizaciones',
    'direccion', 'settings', 'ajustes', 'billing', 'cobro', 'support',
    'soporte', 'docs', 'blog', 'status', 'null', 'undefined'
  ));

/*
 * Un solo owner por empresa.
 *
 * `MembershipRole` lo declara en ports.ts ("owner es único por tenant") y el
 * producto lo necesita: la baja de miembros se niega si dejaría a la empresa
 * sin dueño, y esa regla no se puede evaluar si hay dos.
 */
CREATE UNIQUE INDEX memberships_un_solo_owner_idx
  ON app.memberships (tenant_id)
  WHERE role = 'owner';


-- ───────────────────────────────────────────────────────────────────────────
-- 7. Índices de las consultas que corren en cada petición.
-- ───────────────────────────────────────────────────────────────────────────

-- El login pregunta "¿a qué empresas pertenece este correo?" y el selector de
-- empresa pregunta lo mismo. La 001 ya indexó memberships(user_email).

-- Aceptar una invitación llega con el hash del token y nada más.
CREATE INDEX invitations_pendientes_idx
  ON app.invitations (tenant_id)
  WHERE accepted_at IS NULL;

-- El drenado del outbox sólo mira lo no entregado.
CREATE INDEX tenant_events_pendientes_idx
  ON app.tenant_events (created_at)
  WHERE delivered_at IS NULL;


-- ───────────────────────────────────────────────────────────────────────────
-- 8. Documentación viva.
-- ───────────────────────────────────────────────────────────────────────────

COMMENT ON TABLE app.users IS
  'Personas. La llave es el correo verificado por la sesión, no un uuid sintético.';
COMMENT ON TABLE app.plans IS
  'Catálogo de planes y sus límites. El modelo, no el cobro: cobrar es H10.';
COMMENT ON TABLE app.invitations IS
  'Invitaciones pendientes. El token vive hasheado (sha256 hex); el claro se muestra una vez.';
COMMENT ON TABLE app.tenant_events IS
  'Outbox transaccional del tenant. Se escribe dentro de la misma transacción que el hecho '
  'que describe, para que "todo o nada" y "emite un evento" sean ciertas a la vez.';
COMMENT ON COLUMN app.area_grants.area_slug IS
  '`*` = todas las áreas. El RBAC lo resuelve como comodín (portado de GARDEN).';
