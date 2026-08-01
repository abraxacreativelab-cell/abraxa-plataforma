-- ═══════════════════════════════════════════════════════════════════════════
--  100_meta.sql — H12 · lo que Instagram y Messenger necesitan y la bandeja no
--
--  Dos tablas pequeñas. Ninguna duplica nada de H6: las dos existen porque
--  Meta tiene dos reglas que WhatsApp no tiene.
--
--  ── 1. La ventana de 24 horas ─────────────────────────────────────────────
--
--  Meta sólo deja escribir libremente dentro de las 24 h posteriores al último
--  mensaje DEL CLIENTE. Fuera de eso hace falta una etiqueta aprobada.
--
--  `app.threads.last_message_at` no sirve para esto y conviene decir por qué,
--  porque es la tentación obvia: esa columna se mueve también con los
--  SALIENTES, y un saliente **no** abre la ventana. Un canal que la usara
--  creería tener ventana abierta justo después de contestar, que es
--  exactamente cuando ya no la tiene.
--
--  Agregarle una columna a `app.threads` tampoco: esa tabla es de H6 y el
--  contrato de no colisión existe para que un carril no le cambie el esquema a
--  otro. La llave de esta tabla —(canal, dirección)— es además la que trae
--  `ChannelDriver.send()`, que recibe `channelId` y `address` y no `threadId`.
--
--  ── 2. Los ecos propios ───────────────────────────────────────────────────
--
--  Meta devuelve por el webhook una copia de todo lo que sale de la página. El
--  eco de UN envío de una sola llamada ya lo filtra el índice único de H6
--  (`messages.external_id`): H6 guarda el `mid` que devuelve `send()` y el eco
--  choca con él.
--
--  El agujero está en los envíos de VARIAS llamadas, que en Meta son
--  inevitables —texto + adjunto, o un texto que pasa de 1000 caracteres en
--  Instagram—. `send()` devuelve UN `externalId`, así que del segundo `mid` en
--  adelante nadie se acuerda: su eco entra como mensaje nuevo `fromMe`, H6 lo
--  lee como «el dueño contestó desde su teléfono» y pausa a la IA una hora. El
--  síntoma es «el agente manda una foto y se muere».
--
--  Migraciones de H12: 100–104.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 1. La ventana de 24 horas, por conversación
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE app.meta_message_windows (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,

  channel_id  uuid NOT NULL REFERENCES app.channels(id) ON DELETE CASCADE,

  -- El PSID/IGSID del cliente, ya normalizado por `normalizarDireccionMeta()`.
  -- Es un id OPACO Y CON ALCANCE: la misma persona tiene uno distinto en cada
  -- página. No es un identificador de la persona — es de la relación entre esa
  -- persona y esa cuenta.
  address     text NOT NULL,

  -- Cuándo escribió el cliente por última vez. Lo que abre la ventana.
  last_inbound_at timestamptz NOT NULL,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  -- La llave con la que pregunta `send()`: canal + dirección. Y la que hace
  -- que dos webhooks concurrentes de la misma persona no creen dos filas.
  UNIQUE (tenant_id, channel_id, address)
);

ALTER TABLE app.meta_message_windows ENABLE ROW LEVEL SECURITY;


-- ── La regla que NO puede vivir en el código ────────────────────────────────
--
-- `last_inbound_at` sólo avanza.
--
-- Meta reintenta un webhook agresivamente y no garantiza el orden. Un reintento
-- de un mensaje viejo llega con su fecha original, y un `upsert` desnudo la
-- escribiría encima de una más reciente: la ventana se cerraría sola en medio
-- de una conversación viva, y el agente dejaría de poder contestar sin que
-- nadie entendiera por qué.
--
-- Escrito como un `if` en el driver sería cierto sólo mientras nadie escriba
-- por otro camino. Aquí es cierto para cualquiera que toque la tabla.
CREATE OR REPLACE FUNCTION app.meta_ventana_solo_avanza()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.last_inbound_at < OLD.last_inbound_at THEN
    NEW.last_inbound_at := OLD.last_inbound_at;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER meta_ventana_solo_avanza
  BEFORE UPDATE ON app.meta_message_windows
  FOR EACH ROW
  EXECUTE FUNCTION app.meta_ventana_solo_avanza();


-- ───────────────────────────────────────────────────────────────────────────
-- 2. Los `mid` que mandamos nosotros
--
--    La tabla es pequeña POR DISEÑO: una fila se consume en cuanto llega su
--    eco, y eso ocurre en segundos. Lo que queda son los envíos cuyo eco nunca
--    volvió, y ésos los barre `barrerViejos()` a los 7 días.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE app.meta_outbound_mids (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,

  channel_id  uuid NOT NULL REFERENCES app.channels(id) ON DELETE CASCADE,

  -- El `message_id` que devolvió Meta al enviar.
  mid         text NOT NULL,

  created_at  timestamptz NOT NULL DEFAULT now(),

  -- Por `tenant_id` y no sólo por `mid`: un `mid` es único del lado de Meta,
  -- pero la unicidad que este sistema necesita garantizar es la suya. Un índice
  -- global sobre `mid` dejaría que la fila de una empresa hiciera fallar el
  -- INSERT de otra, que es un canal encubierto entre clientes.
  UNIQUE (tenant_id, mid)
);

ALTER TABLE app.meta_outbound_mids ENABLE ROW LEVEL SECURITY;

-- Para el barrido de los que nunca se consumieron.
CREATE INDEX meta_outbound_mids_viejos_idx
  ON app.meta_outbound_mids (tenant_id, created_at);


-- ───────────────────────────────────────────────────────────────────────────
--  Sobre RLS: las dos tablas quedan con RLS activo y SIN políticas, igual que
--  las de H6 (040_inbox.sql:218-224). RLS activo sin políticas es NEGADO para
--  todos menos `service_role`, que hace bypass — y `service_role` es
--  exactamente por donde entra `tenantDb(ctx)`, que estampa y filtra el
--  `tenant_id` sin que nadie tenga que escribirlo. Fail-closed.
-- ───────────────────────────────────────────────────────────────────────────
