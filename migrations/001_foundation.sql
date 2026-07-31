-- ═══════════════════════════════════════════════════════════════════════════
--  001_foundation.sql — H1
--
--  EL ORDEN DE ESTE ARCHIVO ES EL PUNTO.
--
--  GARDEN dejó 145 de sus 170 tablas sin RLS. No pasó por descuido de una
--  persona: pasó porque las tablas se crearon primero y la seguridad se iba a
--  poner "después". Después nunca llega cuando ya hay 170 tablas.
--
--  Aquí se cierra el schema ANTES de que exista la primera tabla de dominio.
--  Toda tabla nace dentro de un schema que ya está negado por defecto.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS app;

-- Extensiones que van a necesitar los handoffs de las olas 1 y 2.
-- Se habilitan aquí para que nadie tenga que hacerlo desde su carril:
--   vector  → H4 (embeddings de la biblioteca, text-embedding-3-small, 1536)
--   pgcrypto→ gen_random_uuid() y tokens de invitación
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS vector   WITH SCHEMA extensions;


-- ───────────────────────────────────────────────────────────────────────────
-- 1. PRIMERO CERRAR. Antes de crear una sola tabla de dominio.
-- ───────────────────────────────────────────────────────────────────────────

REVOKE ALL ON SCHEMA app FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON FUNCTIONS FROM anon, authenticated;


-- ───────────────────────────────────────────────────────────────────────────
-- 2. Y ABRIR SÓLO PARA service_role.
--
--    Sin esto la API no lee absolutamente nada: service_role hace bypass de
--    RLS, pero los privilegios de tabla y el USAGE del schema siguen siendo
--    obligatorios. Es el paso que se olvida y cuesta media tarde de depurar.
--
--    Las DEFAULT PRIVILEGES son lo que permite que las migraciones 010–119 de
--    los otros 13 handoffs no tengan que acordarse de conceder nada.
-- ───────────────────────────────────────────────────────────────────────────

GRANT USAGE ON SCHEMA app TO service_role;
GRANT ALL ON ALL TABLES    IN SCHEMA app TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA app TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA app TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT ALL ON TABLES    TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT ALL ON FUNCTIONS TO service_role;


-- ───────────────────────────────────────────────────────────────────────────
-- 3. Hacer `app` alcanzable por PostgREST.
--
--    `tenantDb()` habla por supabase-js, y supabase-js habla por PostgREST.
--    Un schema que no está en la lista expuesta no existe para el cliente:
--    devuelve PGRST106 "Invalid schema" incluso con la service key.
--
--    Exponerlo NO afloja nada. Quien decide es el privilegio, y arriba se lo
--    quitamos a anon y authenticated: la prueba real con la llave anon
--    devuelve `42501 permission denied for schema app`. Es el patrón de schema
--    propio que documenta Supabase.
--
--    Va en la migración y no en un clic del panel para que un ambiente nuevo
--    quede igual sin que nadie se acuerde. Ojo: si alguien guarda la sección
--    API del panel, la config del panel gana y hay que volver a correr esto —
--    por eso `app` también debe quedar escrito en Settings → API → Exposed
--    schemas.
-- ───────────────────────────────────────────────────────────────────────────

ALTER ROLE authenticator SET pgrst.db_schemas = 'public, graphql_public, app';
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';


-- ───────────────────────────────────────────────────────────────────────────
-- 4. Libro de migraciones aplicadas. Lo lleva scripts/migrate.mjs.
-- ───────────────────────────────────────────────────────────────────────────

-- tenantless: registro de infraestructura, no es dato de ningún cliente.
CREATE TABLE IF NOT EXISTS app.schema_migrations (
  version     int  PRIMARY KEY,
  name        text NOT NULL,
  checksum    text NOT NULL,
  applied_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app.schema_migrations ENABLE ROW LEVEL SECURITY;


-- ───────────────────────────────────────────────────────────────────────────
-- 5. Tablas base de tenancy. H2 construye encima; no las redefine.
-- ───────────────────────────────────────────────────────────────────────────

-- tenantless: `tenants` ES el tenant. Su llave de aislamiento es `id`.
CREATE TABLE app.tenants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text UNIQUE NOT NULL,
  name          text NOT NULL,
  industry_type text,
  stage         text,
  settings      jsonb NOT NULL DEFAULT '{}',
  plan          text NOT NULL DEFAULT 'free',
  status        text NOT NULL DEFAULT 'active',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.memberships (
  tenant_id  uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  user_email text NOT NULL,
  role       text NOT NULL CHECK (role IN ('owner','admin','member','viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_email)
);

CREATE TABLE app.area_grants (
  tenant_id  uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  user_email text NOT NULL,
  area_slug  text NOT NULL,
  access     text NOT NULL CHECK (access IN ('view','edit','admin')),
  PRIMARY KEY (tenant_id, user_email, area_slug)
);

-- "¿a qué empresas pertenece este correo?" es la consulta de cada login.
CREATE INDEX memberships_user_email_idx ON app.memberships (user_email);
CREATE INDEX area_grants_user_email_idx ON app.area_grants (tenant_id, user_email);


-- ───────────────────────────────────────────────────────────────────────────
-- 6. RLS en todas, desde el primer día.
--
--    RLS activo SIN políticas = negado para todos menos quien hace bypass
--    (service_role). Es fail-closed a propósito: nadie habla con estas tablas
--    por PostgREST, todo pasa por la API con `tenantDb(ctx)`.
--
--    Si algún día se abre acceso directo desde el navegador, la política se
--    agrega aquí — no se "arregla" apagando RLS.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE app.tenants     ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.area_grants ENABLE ROW LEVEL SECURITY;

COMMENT ON SCHEMA app IS
  'Dominio de ABRAXA Plataforma. Cerrado a anon y authenticated desde 001. '
  'Toda tabla nueva lleva tenant_id + ENABLE ROW LEVEL SECURITY en la MISMA '
  'migración que la crea; el gate de CI lo verifica. Excepciones se declaran '
  'con -- tenantless: <razón>.';
