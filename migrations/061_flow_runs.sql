-- ═══════════════════════════════════════════════════════════════════════════
--  061_flow_runs.sql — H8 · la corrida y sus pasos
--
--  Una CORRIDA es "este contacto pasando por este flujo". Un PASO es un nodo
--  ejecutado dentro de esa corrida. El panel en vivo de /automatizaciones es,
--  literalmente, estas dos tablas leídas cada segundo.
--
--  ── El índice que hace que reintentar no mande dos mensajes ────────────────
--
--  `flow_steps_hecho_idx` — UNIQUE (tenant_id, run_id, node_id) WHERE
--  status = 'ok'. Es la pieza más importante de este archivo.
--
--  En GARDEN el guard de doble envío es un SELECT COUNT previo
--  (workflows/engine.ts:221-226): "¿ya hay un step_log 'ok' de este nodo? Si
--  sí, no reenvíes". Funciona para el caso normal y PIERDE LA CARRERA en el
--  que importa — dos intentos del mismo job en vuelo a la vez: los dos cuentan
--  cero, los dos envían. El SELECT no es un árbitro; es una esperanza.
--
--  Aquí el árbitro es Postgres. El segundo INSERT del mismo nodo con status
--  'ok' recibe 23505 y el motor lo lee como "ya estaba hecho" en vez de como
--  un fallo. El guard por SELECT se conserva —evita el envío antes de
--  gastarlo—, pero ya no es lo único que separa al cliente de recibir el
--  mismo WhatsApp dos veces.
--
--  Es seguro porque los ciclos están PROHIBIDOS por el validador: un nodo no
--  se ejecuta dos veces con éxito dentro de una corrida legítima.
--
--  ── Por qué los pasos que esperan no son 'ok' ──────────────────────────────
--
--  `waiting` es su propio estado. Un `wait` de 24 h no ha hecho nada todavía y
--  marcarlo 'ok' bloquearía por el índice de arriba su propia reanudación.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 1. La corrida — un contacto recorriendo un flujo.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE app.flow_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  flow_id       uuid NOT NULL REFERENCES app.flows(id) ON DELETE CASCADE,

  -- La versión con la que arrancó, congelada. Si el emprendedor edita el flujo
  -- mientras esta corrida espera un `wait` de 24 h, la corrida termina con el
  -- guion con el que empezó. Cambiar el libreto a mitad de la obra es cómo un
  -- contacto recibe el mensaje 3 de la versión vieja y el 4 de la nueva.
  version       integer NOT NULL DEFAULT 1 CHECK (version >= 1),

  -- FK de verdad, no un uuid suelto: H15 ya existe. H6 tuvo que declarar
  -- `threads.contact_id` sin REFERENCES porque no había a qué apuntar.
  -- Nullable porque un disparador `manual` puede correr sin contacto.
  contact_id    uuid REFERENCES app.contacts(id) ON DELETE CASCADE,

  status        text NOT NULL DEFAULT 'running'
                CHECK (status IN ('running','waiting','paused','completed','exited','error')),

  -- EL PUNTERO. Es la verdad de "en qué nodo va" y el fence de idempotencia:
  -- un job que apunta a otro nodo es un reintento viejo de un paso ya
  -- superado, y se aborta solo.
  current_node  text,

  -- El evento que la disparó, tal cual: {"contactId": "…", "stage": "…"}.
  context       jsonb NOT NULL DEFAULT '{}',
  trigger_type  text NOT NULL,

  -- `true` cuando salió del botón "Probar". Se enrola UN contacto y sólo ése,
  -- y la UI lo separa del historial real: una prueba que se ve como una
  -- corrida de producción es cómo alguien cree que su flujo ya está sirviendo
  -- a clientes.
  is_test       boolean NOT NULL DEFAULT false,

  -- Por qué se detuvo, en español y a la vista del emprendedor.
  error         text,

  started_at    timestamptz NOT NULL DEFAULT now(),
  -- Cuándo debe despertar un `wait`. Lo lee el barrido de reanudación cuando
  -- no hay cola viva (y la cola lo usa como `startAfter`).
  wake_at       timestamptz,
  completed_at  timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- El panel: las corridas de un flujo, la más reciente arriba.
CREATE INDEX flow_runs_flujo_idx
  ON app.flow_runs (tenant_id, flow_id, started_at DESC);

-- El barrido de reanudación: pausadas y dormidas que ya deben despertar.
CREATE INDEX flow_runs_pendientes_idx
  ON app.flow_runs (tenant_id, status, wake_at)
  WHERE status IN ('paused', 'waiting');

CREATE INDEX flow_runs_contacto_idx
  ON app.flow_runs (tenant_id, contact_id)
  WHERE contact_id IS NOT NULL;

-- Un contacto no se enrola dos veces en el MISMO flujo al mismo tiempo. Sin
-- esto, un formulario enviado tres veces seguidas manda tres veces la
-- bienvenida. Parcial sobre las vivas: cuando la corrida termina, el mismo
-- contacto puede volver a entrar mañana.
--
-- Las corridas de PRUEBA quedan fuera del índice a propósito: probar un flujo
-- dos veces seguidas con el mismo contacto es exactamente lo que hace quien
-- está afinando un mensaje, y que la segunda falle con "duplicado" sería
-- pelearse con su propio trabajo.
CREATE UNIQUE INDEX flow_runs_viva_idx
  ON app.flow_runs (tenant_id, flow_id, contact_id)
  WHERE contact_id IS NOT NULL
    AND is_test = false
    AND status IN ('running', 'waiting', 'paused');


-- ───────────────────────────────────────────────────────────────────────────
-- 2. El paso — un nodo ejecutado. Es lo que se ve moverse en vivo.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE app.flow_steps (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  run_id        uuid NOT NULL REFERENCES app.flow_runs(id) ON DELETE CASCADE,

  node_id       text NOT NULL,
  node_type     text NOT NULL,

  status        text NOT NULL
                CHECK (status IN ('ok','failed','skipped','waiting')),

  -- La config con la que corrió (ya renderizada donde aplica) y lo que
  -- devolvió. `output` es lo que la UI enseña al abrir un paso: a quién se le
  -- mandó, qué decía, qué contestó el webhook.
  input         jsonb NOT NULL DEFAULT '{}',
  output        jsonb NOT NULL DEFAULT '{}',
  error         text,

  started_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);

CREATE INDEX flow_steps_corrida_idx
  ON app.flow_steps (tenant_id, run_id, started_at);

-- ── EL ÍNDICE DE LA CABECERA ──────────────────────────────────────────────
-- Un nodo se completa CON ÉXITO una sola vez por corrida. El segundo intento
-- recibe 23505 y el motor lo interpreta como "ya estaba hecho": ni reenvía ni
-- rompe. Los pasos 'failed', 'skipped' y 'waiting' quedan fuera — reintentar
-- un fallo es justo lo que se quiere poder hacer.
CREATE UNIQUE INDEX flow_steps_hecho_idx
  ON app.flow_steps (tenant_id, run_id, node_id)
  WHERE status = 'ok';


-- ───────────────────────────────────────────────────────────────────────────
-- 3. RLS en las dos, en la misma migración.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE app.flow_runs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.flow_steps ENABLE ROW LEVEL SECURITY;


COMMENT ON TABLE app.flow_runs IS
  'Un contacto recorriendo un flujo. current_node es el fence de idempotencia: '
  'un job que apunta a otro nodo es un reintento de un paso ya superado. H8.';
COMMENT ON COLUMN app.flow_runs.version IS
  'Versión congelada al arrancar. Editar el flujo no cambia el guion de una '
  'corrida en vuelo.';
COMMENT ON TABLE app.flow_steps IS
  'Un nodo ejecutado. El índice único parcial sobre status=''ok'' es lo que '
  'impide que un reintento mande el mismo mensaje dos veces — en GARDEN eso '
  'dependía de un SELECT COUNT que pierde la carrera. H8.';
