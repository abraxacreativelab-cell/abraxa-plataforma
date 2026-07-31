-- ═══════════════════════════════════════════════════════════════════════════
--  140_tenant_integrations.sql — H17
--
--  LAS CREDENCIALES DEJAN DE SER DEL PROCESO.
--
--  Hoy `.env.example:44-51` tiene ocho variables de canal —EVOLUTION_API_URL,
--  EVOLUTION_API_KEY, META_APP_SECRET, META_VERIFY_TOKEN, RESEND_API_KEY,
--  TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER— y ninguna tiene
--  dimensión de tenant. Una de cada cosa, para todos los clientes a la vez.
--
--  Eso funciona con un cliente. Con dos es un incidente, y no uno abstracto:
--  dos empresas dadas de alta hoy comparten instancia de Evolution y, en el
--  peor caso, el mismo número de WhatsApp. Al cliente de la panadería le
--  llegan las conversaciones de la clientela de la inmobiliaria.
--
--  Esta tabla es esa variable convertida en fila: una credencial por empresa,
--  cifrada en reposo, con su estado, su fecha de verificación y su dueño.
--
--  ── Por qué el secreto va cifrado AQUÍ y no con pgcrypto ───────────────────
--
--  `pgp_sym_encrypt(secreto, llave)` mete la llave EN EL TEXTO DEL STATEMENT.
--  Ese texto acaba en `pg_stat_statements`, en el log de consultas lentas y en
--  el explorador de logs de Supabase. Se termina auditando una base donde el
--  secreto está cifrado y la llave está en el log de al lado.
--
--  El cifrado va en la aplicación (AES-256-GCM con `node:crypto`,
--  packages/integrations/src/crypto/secret-box.ts) y la llave vive en un solo
--  lugar: la memoria del proceso, desde `INTEGRATIONS_KEY`. Postgres guarda
--  bytes que no significan nada sin ella.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 1. La credencial de una empresa en un proveedor.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE app.tenant_integrations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,

  -- evolution | meta | twilio | resend | smtp | …
  -- El CHECK es de FORMA, no de catálogo: la lista de proveedores vive en
  -- `packages/integrations/src/providers/catalogo.ts` y crece con H12 y H13.
  -- Una migración de otro carril para agregar un valor a un CHECK es
  -- exactamente el acoplamiento que el contrato de no colisión evita.
  provider    text NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_]{1,30}$'),

  -- Cómo se llama esta conexión para el emprendedor: "WhatsApp de la tienda".
  label       text NOT NULL,

  -- El identificador de la cuenta DEL LADO DEL PROVEEDOR: id de página de
  -- Meta, Account SID de Twilio, nombre de instancia de Evolution, dominio de
  -- Resend. Es la llave del ruteo inverso (ver el índice de abajo) y por eso
  -- es única GLOBALMENTE, no por tenant: una misma página de Facebook no
  -- puede pertenecer a dos empresas.
  external_account_id text,

  -- Lo que NO es secreto y sí hace falta consultar y filtrar: número de
  -- teléfono, dominio, base URL, scopes concedidos. Va en claro a propósito:
  -- cifrar lo que no lo necesita sólo hace imposible depurar.
  config      jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(config) = 'object'),

  -- ── El secreto ───────────────────────────────────────────────────────────
  -- AES-256-GCM: ciphertext, nonce y etiqueta de autenticación. GCM y no CBC
  -- porque AUTENTICA: un byte alterado falla al descifrar en vez de producir
  -- basura silenciosa. Ver el criterio 6 de H17-integraciones.md §11.
  secret_ct   bytea,
  secret_iv   bytea,
  secret_tag  bytea,

  -- Rotar sin versión obliga a un downtime o a un big-bang. Con versión: se
  -- agrega INTEGRATIONS_KEY_2, lo nuevo se cifra con la 2, lo viejo se sigue
  -- leyendo con la 1, y `packages/integrations/src/bin/rotate.ts` re-cifra por
  -- lotes sin apagar nada.
  key_version int NOT NULL DEFAULT 1 CHECK (key_version >= 1),

  status      text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','connected','error','revoked')),

  -- Motivo corto y saneado. NUNCA el cuerpo crudo de la respuesta del
  -- proveedor: Meta y Twilio devuelven el token en el eco de error con más
  -- frecuencia de la que uno esperaría, y una bitácora que guarda el error
  -- completo acaba siendo un almacén de secretos en claro con RLS pero sin
  -- cifrado. Código, mensaje corto y request_id. Nada más.
  last_error  text,

  -- Cuándo se comprobó por última vez que la credencial SIRVE, no cuándo se
  -- capturó. Son dos cosas distintas y confundirlas es la causa número uno de
  -- "el sistema dice conectado y no manda": el emprendedor pega un token, ve
  -- una palomita verde, y tres días después nadie le contestó a nadie.
  verified_at timestamptz,
  expires_at  timestamptz,          -- tokens de página de Meta, que caducan

  connected_by text REFERENCES app.users(email) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  -- Una conexión viva por proveedor y cuenta, por empresa. Reconectar
  -- REEMPLAZA la fila, que además invalida la credencial anterior — que es lo
  -- que uno quiere al reconectar.
  UNIQUE (tenant_id, provider, external_account_id)
);

-- ── El ruteo inverso: del webhook al dueño ─────────────────────────────────
--
-- Es el problema que aparece el día que hay dos clientes. H6 resuelve el
-- tenant por la URL del webhook (`/inbox/webhooks/:channelId?token=…`), y eso
-- funciona porque cada canal tiene su URL propia. Meta NO funciona así: una
-- app de Meta tiene UN webhook para todas las páginas que la autorizaron, y el
-- mensaje llega con el id de la página adentro.
--
-- Este índice es lo que garantiza que ese id lleve a UNA empresa y no a dos.
-- Parcial porque una fila revocada ya no rutea nada, y porque
-- `external_account_id` es null mientras el OAuth no termina.
CREATE UNIQUE INDEX tenant_integrations_cuenta_externa_idx
  ON app.tenant_integrations (provider, external_account_id)
  WHERE external_account_id IS NOT NULL AND status <> 'revoked';

-- La consulta caliente: `resolveFor(ctx, 'evolution')` en cada mensaje que sale.
CREATE INDEX tenant_integrations_por_tenant_idx
  ON app.tenant_integrations (tenant_id, provider) WHERE status = 'connected';

-- El repaso periódico busca por caducidad, no por tenant.
CREATE INDEX tenant_integrations_expiran_idx
  ON app.tenant_integrations (expires_at)
  WHERE expires_at IS NOT NULL AND status = 'connected';


-- ───────────────────────────────────────────────────────────────────────────
-- 2. RLS en la MISMA migración que la crea.
--
--    RLS activo SIN políticas = negado para todos menos `service_role`, que
--    hace bypass. Fail-closed a propósito, igual que en 001 y en 120: nadie
--    habla con esta tabla por PostgREST; todo pasa por la API con
--    `tenantDb(ctx)`.
--
--    Aquí importa el doble que en cualquier otra tabla: una fila filtrada no
--    es un dato de negocio ajeno, es la llave del WhatsApp de otra empresa.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE app.tenant_integrations ENABLE ROW LEVEL SECURITY;


COMMENT ON TABLE app.tenant_integrations IS
  'Credencial de canal POR EMPRESA, cifrada en reposo. Reemplaza las ocho '
  'variables de proceso de .env.example:44-51, que hacían que dos clientes '
  'compartieran el mismo WhatsApp. H17.';
COMMENT ON COLUMN app.tenant_integrations.secret_ct IS
  'Secreto cifrado con AES-256-GCM. La llave NUNCA está en la base: vive en '
  'INTEGRATIONS_KEY y sólo el proceso la tiene. Ver docs/handoffs/H17-integraciones.md §6.';
COMMENT ON COLUMN app.tenant_integrations.external_account_id IS
  'La cuenta del lado del proveedor (id de página de Meta, SID de Twilio, '
  'instancia de Evolution, dominio de Resend). Única globalmente por proveedor '
  'mientras no esté revocada: es la llave del ruteo inverso de un webhook al '
  'tenant dueño, y una misma página no puede pertenecer a dos empresas.';
COMMENT ON COLUMN app.tenant_integrations.verified_at IS
  'Cuándo se comprobó que la credencial SIRVE, no cuándo se capturó. '
  'Capturado no es conectado.';
COMMENT ON COLUMN app.tenant_integrations.last_error IS
  'Motivo corto y saneado: código, mensaje breve y request_id. NUNCA el cuerpo '
  'crudo del proveedor — Meta y Twilio devuelven el token en el eco de error.';
