-- ═══════════════════════════════════════════════════════════════════════════
--  040_inbox.sql — H6 · canales, hilos y mensajes
--
--  El modelo es MULTICANAL DESDE EL DISEÑO, no "WhatsApp con espacio para
--  crecer". La diferencia se ve en una sola columna: `external_address`.
--
--  GARDEN la llamaba `external_contact` y guardaba un JID de WhatsApp
--  (`5215512345678@s.whatsapp.net`). Funcionaba, y por eso mismo el supuesto se
--  filtró a todo el código: `phoneToJid()` aparece en el inbox (service.ts:201)
--  y en el motor de workflows (engine.ts:472). El día que entra un correo o un
--  DM de Instagram, esas dos líneas no se "adaptan": hay que reescribir los
--  caminos que las rodean.
--
--  Aquí la dirección es lo que el canal considere una dirección — un teléfono
--  E.164, un correo, un id opaco de Instagram — y el JID vuelve a ser lo que
--  siempre debió ser: un detalle de transporte que sólo conoce el driver de
--  WhatsApp. H12 y H13 enchufan sus canales sin tocar este esquema.
--
--  Migraciones de H6: 040–049.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 1. Canales
--
--    Un canal es una línea conectada: una instancia de WhatsApp, un buzón de
--    correo, una cuenta de Instagram. `driver` dice QUIÉN habla con el
--    proveedor; `type` dice QUÉ es para el producto. Se separan porque un mismo
--    tipo puede tener varios drivers (whatsapp por Evolution hoy, por la Cloud
--    API mañana) y el resto del sistema no debería enterarse del cambio.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE app.channels (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,

  type        text NOT NULL
              CHECK (type IN ('whatsapp','instagram','messenger','email','sms')),
  driver      text NOT NULL,
  name        text NOT NULL,

  -- Configuración del driver. Guarda secretos (`webhook_token`, `instance`):
  -- NUNCA se sirve cruda al navegador. `sanearCanal()` la limpia antes de salir.
  config      jsonb NOT NULL DEFAULT '{}',

  -- La dirección propia de la línea: el número conectado, el correo, el id de
  -- la página. La llena el driver al conectar.
  external_id text,

  status      text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','active','disconnected','error')),

  -- ── La política de la IA, por canal ────────────────────────────────────
  --
  -- Qué agente contesta aquí. Un canal de soporte y uno de ventas no deberían
  -- hablar igual, y eso se resuelve con una fila, no con un `if` en el código.
  agent_role  text NOT NULL DEFAULT 'sales'
              CHECK (agent_role IN ('master','sales','service','social','analyst')),

  -- Interruptor general del canal. `false` calla a la IA en TODOS sus hilos
  -- sin tener que tocarlos uno por uno.
  ai_enabled  boolean NOT NULL DEFAULT true,

  -- Horario de atención: {"tz":"America/Mexico_City","semana":{"lun":[["09:00","18:00"]],…}}
  -- Vacío = 24/7. Es el default a propósito: la promesa que vende el producto
  -- es que el agente contesta MIENTRAS EL DUEÑO DUERME.
  business_hours   jsonb NOT NULL DEFAULT '{}',

  -- Y fuera de ese horario, ¿contesta? `true` por la misma razón. El
  -- emprendedor que prefiere silencio de noche lo apaga aquí.
  ai_outside_hours boolean NOT NULL DEFAULT true,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX channels_tenant_idx ON app.channels (tenant_id, type, status);

ALTER TABLE app.channels ENABLE ROW LEVEL SECURITY;


-- ───────────────────────────────────────────────────────────────────────────
-- 2. Hilos
--
--    Una conversación con una dirección, por un canal. `ai_enabled` es la
--    columna por la que existe este handoff: en GARDEN está declarada en el
--    tipo (src/crm/types.ts:281) y NO SE LEE EN NINGÚN LADO — esa es su única
--    aparición en todo el repo. Aquí la lee `decidirSiContesta()` en cada
--    mensaje que entra.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE app.threads (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,

  -- Sin FK a propósito: en v1 no existe `app.contacts` y ningún handoff la
  -- reclama. Cuando el CRM aterrice, se agrega la FK en su migración sin tocar
  -- una sola fila de aquí.
  contact_id   uuid,
  -- Con qué nombre se muestra el hilo mientras no haya contacto. Lo trae el
  -- canal (el `pushName` de WhatsApp, el nombre del remitente del correo).
  contact_name text,

  -- SIN `ON DELETE CASCADE`, y es deliberado (2026-07-31).
  --
  -- La implementación lo traía; el handoff §6 no lo pedía. La diferencia no es
  -- cosmética: convertía «reconectar mi WhatsApp» —borrar el canal y volverlo a
  -- crear para escanear un QR nuevo, que es lo que cualquiera intenta cuando la
  -- línea se cae— en «borrar seis meses de conversaciones con mis clientes»,
  -- irreversible y con la API respondiendo `{ ok: true }`. El historial de
  -- conversaciones ES el producto.
  --
  -- Sin la cascada, un DELETE sobre un canal con hilos falla con 23503 y nadie
  -- pierde nada. `borrarCanal()` ya no lo intenta: da de baja la línea con el
  -- proveedor y deja el canal `disconnected` conservando las filas; el borrado
  -- destructivo existe, pero hay que pedirlo con `?purge=true`.
  --
  -- Se deja NO ACTION (el default) y NO `RESTRICT` a propósito: NO ACTION
  -- difiere la comprobación al final de la sentencia, así que borrar un TENANT
  -- —que cascadea a `channels` y a `threads` en la misma sentencia— sigue
  -- funcionando. `RESTRICT` comprueba de inmediato y lo rompería.
  channel_id   uuid NOT NULL REFERENCES app.channels(id),
  channel_type text NOT NULL,

  -- ← GENÉRICO. Teléfono E.164, correo, id de Instagram. No un JID.
  external_address text NOT NULL,

  status       text NOT NULL DEFAULT 'open'
               CHECK (status IN ('open','pending','closed','snoozed')),

  -- El correo del humano que tomó el hilo. Mientras no sea NULL, la IA se
  -- calla. Nada peor que el agente contestando encima de su dueño.
  assigned_to  text,

  -- ← ESTE campo es el trabajo de H6.
  ai_enabled      boolean NOT NULL DEFAULT true,
  -- Pausa temporal: "cállate una hora, yo me encargo". Vencida, la IA vuelve
  -- sola. Una pausa que hay que acordarse de quitar no se usa.
  ai_paused_until timestamptz,

  unread           int NOT NULL DEFAULT 0,
  last_message_at  timestamptz,
  last_message     text,
  last_direction   text CHECK (last_direction IN ('in','out')),

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  -- La llave que hace converger al mismo hilo el mensaje entrante y el
  -- saliente iniciado desde la bandeja.
  UNIQUE (tenant_id, channel_id, external_address)
);

-- La consulta de la bandeja: los hilos del tenant, el más reciente arriba.
CREATE INDEX threads_recientes_idx
  ON app.threads (tenant_id, last_message_at DESC NULLS LAST);

ALTER TABLE app.threads ENABLE ROW LEVEL SECURITY;


-- ───────────────────────────────────────────────────────────────────────────
-- 3. Mensajes
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE app.messages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  thread_id    uuid NOT NULL REFERENCES app.threads(id) ON DELETE CASCADE,

  direction    text NOT NULL CHECK (direction IN ('in','out')),
  body         text,
  media        jsonb NOT NULL DEFAULT '[]',

  -- `true` = lo escribió un agente. La UI marca la burbuja.
  ai_generated boolean NOT NULL DEFAULT false,
  -- Correo del humano, 'contact', 'phone' (eco del teléfono del dueño) o NULL
  -- cuando lo escribió la IA.
  author       text,

  external_id  text,
  status       text NOT NULL DEFAULT 'queued'
               CHECK (status IN ('queued','sent','delivered','read','failed')),
  error        text,

  -- ── Qué hizo la IA con este mensaje ────────────────────────────────────
  --
  -- Sólo en los entrantes. Es lo que hace verificable el criterio #5: si el
  -- agente falla, el mensaje queda MARCADO sin responder. No sale un texto
  -- genérico de disculpa — un silencio es mejor que un robot roto, pero un
  -- silencio sin registro es un misterio.
  ai_outcome   text CHECK (ai_outcome IN ('answered','skipped','failed')),
  ai_reason    text,

  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════════
--  EL ÍNDICE QUE SOSTIENE TODO EL CRITERIO #4.
--
--  Un webhook reenviado dos veces no puede duplicar el mensaje NI disparar dos
--  respuestas del agente. Las dos cosas cuelgan de aquí: el segundo INSERT
--  choca con 23505, `ingerir()` corta, y el agente ni se entera.
--
--  Es también lo que hace idempotente el eco `fromMe` de WhatsApp: el mensaje
--  que nosotros mandamos vuelve por el webhook con el mismo id del proveedor.
--
--  Sin este índice la deduplicación sería un SELECT antes del INSERT, y dos
--  entregas concurrentes lo pasarían las dos. La unicidad tiene que vivir en
--  la base.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE UNIQUE INDEX messages_external_unico
  ON app.messages (tenant_id, external_id)
  WHERE external_id IS NOT NULL;

-- La consulta del panel de conversación.
CREATE INDEX messages_hilo_idx ON app.messages (tenant_id, thread_id, created_at);

ALTER TABLE app.messages ENABLE ROW LEVEL SECURITY;


-- ───────────────────────────────────────────────────────────────────────────
-- 4. Nadie habla con estas tablas por PostgREST.
--
--    RLS activo SIN políticas = negado para todos menos service_role, que hace
--    bypass. Todo pasa por la API con `tenantDb(ctx)`, que es donde el filtro
--    por tenant no se puede olvidar porque no se escribe.
-- ───────────────────────────────────────────────────────────────────────────

COMMENT ON TABLE app.channels IS
  'Líneas conectadas del tenant. `config` guarda secretos del driver: se sanea '
  'antes de servirla. La política de la IA (agente, horario) vive aquí.';
COMMENT ON TABLE app.threads IS
  'Conversaciones por canal. `external_address` es GENÉRICO — E.164, correo o '
  'id de red social. El JID de WhatsApp sólo lo conoce su driver.';
COMMENT ON TABLE app.messages IS
  'Mensajes. El índice único parcial sobre (tenant_id, external_id) es lo que '
  'hace que un webhook reenviado no duplique ni dispare dos respuestas.';
