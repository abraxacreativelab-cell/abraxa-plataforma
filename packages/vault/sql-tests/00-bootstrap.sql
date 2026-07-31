-- Lo que Supabase ya trae puesto y un Postgres vanilla no.
-- Sirve para correr las migraciones tal cual contra un contenedor limpio y
-- comprobar que el SQL de verdad parsea y hace lo que dice.

CREATE ROLE anon           NOLOGIN NOINHERIT;
CREATE ROLE authenticated  NOLOGIN NOINHERIT;
CREATE ROLE service_role   NOLOGIN NOINHERIT BYPASSRLS;
CREATE ROLE authenticator  LOGIN   NOINHERIT PASSWORD 'authpass';

GRANT anon, authenticated, service_role TO authenticator;

CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
