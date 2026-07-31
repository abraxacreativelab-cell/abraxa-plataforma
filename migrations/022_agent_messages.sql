-- ═══════════════════════════════════════════════════════════════════════════
--  022_agent_messages.sql — H3
--
--  El historial de conversación del agente.
--
--  `AgentPort.run()` recibe `threadId?` y un `history?` opcional. Cuando el
--  llamador NO manda historial (el caso normal de H6: llega un WhatsApp y se
--  invoca al agente del área), alguien tiene que saber de qué venían hablando.
--  Ese alguien es H3, porque H6 es dueño del hilo de la BANDEJA — mensajes de
--  humanos por un canal — y eso no es lo mismo que el hilo de razonamiento del
--  agente, que incluye llamadas a tools y respuestas que nunca se mandaron.
--
--  AVISO A H6: el historial del agente lo persisto yo. No lo dupliquen.
--  Si prefieren pasármelo ya resuelto, manden `history` en el input y esta
--  tabla ni se toca.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE app.agent_messages (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,

  agent_role  text NOT NULL
              CHECK (agent_role IN ('master','sales','service','social','analyst')),

  -- Hilo de la bandeja cuando viene de un mensaje real (H6), o una clave
  -- sintética cuando es una conversación de producto (el Ritual de H7).
  thread_id   text NOT NULL,

  role        text NOT NULL CHECK (role IN ('user','assistant')),
  content     text NOT NULL,

  created_at  timestamptz NOT NULL DEFAULT now()
);

-- La consulta de cada mensaje: "los últimos N de este hilo". El DESC en id es
-- lo que la hace un index scan y no un sort.
CREATE INDEX agent_messages_thread_idx
  ON app.agent_messages (tenant_id, agent_role, thread_id, id DESC);

ALTER TABLE app.agent_messages ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE app.agent_messages IS
  'Historial de conversación por (tenant, rol, hilo). H6 es dueño del hilo de '
  'la bandeja; esto es el hilo del agente y no son lo mismo.';
