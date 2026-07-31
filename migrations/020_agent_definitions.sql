-- ═══════════════════════════════════════════════════════════════════════════
--  020_agent_definitions.sql — H3
--
--  EL HUECO QUE CIERRA ESTE ARCHIVO.
--
--  En GARDEN la definición de cada agente vive en un YAML del disco, cargado
--  con `readdirSync` al arrancar (src/bots/bot-factory.ts:39-55). Consecuencia:
--  dar de alta un cliente exige un commit, un deploy y un reinicio. Con un
--  cliente propio eso se aguanta; con clientes de verdad, no.
--
--  Aquí la definición es una FILA. Alta de cliente = INSERT. Cambiar el modelo
--  de un agente = UPDATE. Migrarlo a un modelo local el día que existan =
--  cambiar una columna. Nada de eso vuelve a tocar el código.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE app.agent_definitions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,

  -- Los cinco roles de ports.ts (AgentRole). El CHECK es la única copia de esa
  -- lista fuera de TypeScript; si crece, crece aquí también.
  role          text NOT NULL CHECK (role IN ('master','sales','service','social','analyst')),

  -- El nombre que el emprendedor le puso a SU agente en su primer minuto.
  -- Viaja a toda la UI. Es del cliente, no nuestro.
  name          text NOT NULL,

  -- ── El router de proveedores, en dos columnas ──────────────────────────
  -- `local` está en el CHECK a propósito aunque todavía no exista adaptador:
  -- el día que Santiago corra modelos propios, migrar un agente tiene que ser
  -- este UPDATE y nada más.
  provider      text NOT NULL DEFAULT 'anthropic'
                     CHECK (provider IN ('anthropic','openrouter','local')),
  model         text NOT NULL,

  -- Apunta a la credencial del cliente en app.tenant_integrations (H2).
  -- NULL = usa la llave de la plataforma. Sin FK a propósito: esa tabla la
  -- crea otro handoff y H3 no puede depender de que ya exista.
  key_ref       text,

  system_prompt text NOT NULL,

  -- Nombres de tools del registro. Cada handoff registra las suyas desde su
  -- propio paquete; aquí sólo se dice cuáles ve este agente.
  tools         text[] NOT NULL DEFAULT '{}',

  enabled       boolean NOT NULL DEFAULT true,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- Un agente por rol y por empresa. Es lo que hace que `upsertDefinition`
  -- del port pueda ser idempotente sin leer antes.
  UNIQUE (tenant_id, role)
);

-- La consulta de cada mensaje entrante: "dame el agente de ventas de esta
-- empresa, si está prendido".
CREATE INDEX agent_definitions_tenant_role_idx
  ON app.agent_definitions (tenant_id, role)
  WHERE enabled;

-- ───────────────────────────────────────────────────────────────────────────
-- RLS activo sin políticas = negado para todos menos service_role, que hace
-- bypass. Mismo patrón fail-closed que la 001: nadie habla con esta tabla por
-- PostgREST desde el navegador; todo pasa por la API con tenantDb(ctx).
--
-- El día que el front necesite leer esto directo, se agrega la política aquí.
-- No se "arregla" apagando RLS.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE app.agent_definitions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE app.agent_definitions IS
  'Definiciones de agentes por tenant. Reemplaza los YAML de disco de GARDEN: '
  'un cliente nuevo es un INSERT, no un deploy.';

COMMENT ON COLUMN app.agent_definitions.key_ref IS
  'Credencial del cliente en app.tenant_integrations (H2). NULL = llave de la plataforma.';
