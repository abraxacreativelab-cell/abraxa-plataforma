-- ═══════════════════════════════════════════════════════════════════════════
--  050_onboarding.sql — H7 · El Ritual de Fundación
--
--  LA TABLA EXISTE PARA QUE EL EMPRENDEDOR PUEDA IRSE.
--
--  El criterio #2 del handoff es el que define este archivo: completar tres
--  fases, cerrar el navegador y volver al día siguiente sin que el agente
--  repita una sola pregunta. Esa promesa no se cumple con una tabla que guarda
--  "en qué fase iba": se cumple guardando, en cada turno y en la MISMA
--  escritura, las tres cosas que hacen falta para retomar sin agujeros.
--
--    phase       en qué punto de la entrevista se quedó
--    state       TODO lo que ya se extrajo del negocio
--    transcript  la conversación literal, para que el modelo la relea
--
--  El bug que esto cierra viene de GARDEN. Su motor de entrevista guarda fase y
--  datos en Postgres, pero el HISTORIAL de la conversación vive en un `Map` en
--  memoria del proceso (extensions/abraxa-bookkeeper/handler.ts:36). Un deploy,
--  un reinicio o un segundo contenedor y el entrevistado vuelve a un agente que
--  conserva sus datos pero perdió el hilo — y vuelve a preguntar. Aquí el
--  historial es una columna.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE app.onboarding_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,

  -- Las 7 fases del handoff §5. El CHECK es la única copia de esa lista fuera
  -- de TypeScript (packages/onboarding/src/interview/fases.ts); si crece una,
  -- crece la otra.
  phase         text NOT NULL DEFAULT 'bienvenida'
                CHECK (phase IN ('bienvenida','identidad','modelo','proceso',
                                 'dolor','gente','sintesis')),

  -- Todo lo extraído del negocio hasta ahora: giro, ticket, dolores, hitos
  -- propuestos, nombre del agente. Es lo que el resumen de regreso le lee al
  -- emprendedor para demostrarle que se le recordó.
  state         jsonb NOT NULL DEFAULT '{}',

  -- La conversación literal, en orden. `[{role,content,at,phase}]`.
  --
  -- Va en la fila y no en app.agent_messages (H3) a propósito: el Ritual pasa
  -- SIEMPRE `history` explícito a `AgentPort.run()`, justamente para que
  -- reanudar no dependa de otra tabla ni de la memoria de ningún proceso.
  transcript    jsonb NOT NULL DEFAULT '[]',

  -- ── Estado de la sesión ────────────────────────────────────────────────
  -- `pausada` es un estado de primera clase, no la ausencia de actividad: el
  -- botón "guardar y seguir después" es una promesa del producto y tiene que
  -- verse en los datos.
  status        text NOT NULL DEFAULT 'activa'
                CHECK (status IN ('activa','pausada','completada')),

  -- El último HITO alcanzado: se sella al cerrar una fase, no en cada turno.
  -- Es "hasta dónde llegó de verdad", que es distinto de "cuándo escribió por
  -- última vez" (updated_at). La UI le enseña éste al volver.
  checkpoint_at timestamptz,
  completed_at  timestamptz,

  -- Cuántos turnos lleva. Sale del transcript, pero tenerlo en columna permite
  -- ver de un vistazo qué rituales se atoraron sin leer un jsonb por fila.
  turns         int NOT NULL DEFAULT 0,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- Un ritual por empresa. Es lo que hace que "reanudar" no tenga que elegir
  -- entre sesiones y que `iniciar()` pueda ser idempotente sin consultar antes.
  UNIQUE (tenant_id)
);

-- La consulta de cada turno: "dame el ritual de esta empresa".
-- El UNIQUE de arriba ya crea el índice; no hace falta otro.

-- ───────────────────────────────────────────────────────────────────────────
-- RLS activo sin políticas = negado para todos menos service_role, que hace
-- bypass. Mismo patrón fail-closed que la 001: nadie habla con esta tabla por
-- PostgREST desde el navegador; todo pasa por la API con tenantDb(ctx).
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE app.onboarding_sessions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE app.onboarding_sessions IS
  'El Ritual de Fundación de cada empresa: fase, datos extraídos y conversación '
  'literal. Las tres en la misma fila para que reanudar al día siguiente no '
  'dependa de la memoria de ningún proceso.';

COMMENT ON COLUMN app.onboarding_sessions.transcript IS
  'Conversación literal [{role,content,at,phase}]. Fuente de verdad del '
  'historial: el Ritual la pasa como `history` explícito a AgentPort.run().';

COMMENT ON COLUMN app.onboarding_sessions.checkpoint_at IS
  'Cuándo cerró la última FASE. Distinto de updated_at (último turno): es el '
  'hito al que se le dice "aquí te quedaste" cuando vuelve.';
