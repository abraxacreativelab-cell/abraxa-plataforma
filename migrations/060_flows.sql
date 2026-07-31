-- ═══════════════════════════════════════════════════════════════════════════
--  060_flows.sql — H8 · Automatizaciones: el flujo y sus versiones
--
--  "Cuando entre un lead por mi página, mándale un mensaje, métemelo en la
--   etapa de Contactado, y que el agente de ventas lo contacte."
--
--  Eso, guardado como un grafo que el emprendedor puede ver, editar, probar y
--  ver correr paso por paso.
--
--  ── Dos decisiones que separan esto de GARDEN ──────────────────────────────
--
--  1. TODO FLUJO NACE EN PAUSA, y no por convención del código: la columna
--     `status` tiene DEFAULT 'paused'. Un INSERT que se olvide de ponerlo
--     —incluido el del asistente de IA— produce un flujo apagado. Activar es
--     un acto humano aparte, con `activated_by` y `activated_at` escritos.
--     En GARDEN `is_active` es un boolean sin default explícito en el alta y
--     la garantía vivía en el servicio.
--
--  2. LAS VERSIONES SE LEEN. `crm_workflow_versions` existe en GARDEN y NADIE
--     la consulta (`grep -rn crm_workflow_versions src/` sólo devuelve el
--     INSERT): es un log de auditoría disfrazado de versionado. Aquí
--     `flow_versions` es la fuente de la que se restaura —`POST
--     /flows/:id/rollback/:version`— y de la que el motor lee la definición
--     que estaba vigente cuando arrancó cada corrida. Una tabla que nadie lee
--     es deuda; ésta se lee en dos caminos distintos.
--
--  ── Por qué la definición es jsonb y no tablas de nodos y aristas ──────────
--
--  Porque el grafo se edita, se versiona y se restaura COMO UNA UNIDAD. Con
--  nodos y aristas normalizados, guardar una edición del builder son N DELETEs
--  y M INSERTs sin transacción desde PostgREST, y restaurar una versión es lo
--  mismo otra vez. El catálogo de nodos es CERRADO y está validado en el
--  servidor (`packages/flows/src/validate.ts`) antes de tocar la base: la
--  integridad que daría el esquema relacional aquí la da el validador, que
--  además comprueba lo que ninguna FK puede —que no haya ciclos y que las dos
--  ramas de una condición estén conectadas—.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 1. El flujo — lo que el emprendedor ve en la lista de /automatizaciones.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE app.flows (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,

  name           text NOT NULL,
  description    text,

  -- Uno de los 8 de `TriggerType` (packages/db/ports.ts). SIN CHECK a
  -- propósito, por la misma razón que H15 dejó `contact_identities.channel`
  -- sin él: la lista puede crecer, y una migración de otro carril para
  -- agregarle un valor a un CHECK es justo el acoplamiento que el contrato de
  -- no colisión existe para evitar. El catálogo cerrado se aplica en el
  -- validador, que sí es de este paquete.
  trigger_type   text NOT NULL,

  -- Filtros del disparador: {"stage_id": "…"}, {"tag": "vip"}, {"form_id": "…"}.
  -- Vacío = "cualquiera".
  trigger_config jsonb NOT NULL DEFAULT '{}',

  -- El grafo vigente: { nodes: [...], edges: [...] }.
  definition     jsonb NOT NULL DEFAULT '{"nodes":[],"edges":[]}',

  -- ── La garantía de la §7 del handoff, en el esquema ──────────────────────
  -- No es el servicio quien promete que un flujo nace apagado: es el DEFAULT.
  status         text NOT NULL DEFAULT 'paused'
                 CHECK (status IN ('paused', 'active', 'archived')),

  -- Versión vigente. Apunta a app.flow_versions.version.
  version        integer NOT NULL DEFAULT 1 CHECK (version >= 1),

  created_by     text,
  -- Quién apretó "activar" y cuándo. Activar ejecuta cosas con contactos
  -- REALES: tiene que quedar con nombre y hora.
  activated_by   text,
  activated_at   timestamptz,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- El índice que usa el motor en el camino caliente: llega un evento y hay que
-- encontrar los flujos ACTIVOS de ese tenant que escuchan ese disparador.
-- Parcial sobre 'active' porque los pausados —que son la mayoría mientras el
-- emprendedor construye— no se consultan nunca por esta vía.
CREATE INDEX flows_disparador_idx
  ON app.flows (tenant_id, trigger_type)
  WHERE status = 'active';

CREATE INDEX flows_tenant_actualizado_idx
  ON app.flows (tenant_id, updated_at DESC);


-- ───────────────────────────────────────────────────────────────────────────
-- 2. Las versiones — el historial del que SÍ se restaura.
--
--    Se escribe una fila por cada guardado. `version` es el número que el
--    emprendedor ve ("volver a la v3") y el que `flow_runs.version` congela
--    para que una corrida en vuelo no cambie de guion a media ejecución.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE app.flow_versions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  flow_id        uuid NOT NULL REFERENCES app.flows(id) ON DELETE CASCADE,

  version        integer NOT NULL CHECK (version >= 1),

  -- La foto completa: restaurar no debe depender de que nada más siga vivo.
  name           text NOT NULL,
  trigger_type   text NOT NULL,
  trigger_config jsonb NOT NULL DEFAULT '{}',
  definition     jsonb NOT NULL,

  -- "restaurada de la v2", "propuesta del asistente", "edición a mano".
  note           text,
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now(),

  -- Dos guardados simultáneos del mismo flujo no pueden producir dos "v4".
  -- El segundo choca con 23505 y el servicio reintenta con el número
  -- siguiente, en vez de dejar dos versiones distintas con el mismo nombre.
  UNIQUE (tenant_id, flow_id, version)
);

CREATE INDEX flow_versions_flujo_idx
  ON app.flow_versions (tenant_id, flow_id, version DESC);


-- ───────────────────────────────────────────────────────────────────────────
-- 3. RLS en las dos, en la MISMA migración que las crea.
--
--    Activo y sin políticas = negado para todos menos service_role, que hace
--    bypass. Fail-closed, igual que 001: nadie habla con estas tablas por
--    PostgREST; todo pasa por la API con `tenantDb(ctx)`.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE app.flows         ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.flow_versions ENABLE ROW LEVEL SECURITY;


COMMENT ON TABLE app.flows IS
  'Una automatización. status DEFAULT ''paused'': nace apagada por esquema, no '
  'por disciplina del servicio. H8.';
COMMENT ON COLUMN app.flows.definition IS
  'El grafo vigente {nodes,edges}. Catálogo de nodos CERRADO, validado en '
  'packages/flows/src/validate.ts antes de escribir.';
COMMENT ON TABLE app.flow_versions IS
  'Historial del que SÍ se restaura (POST /flows/:id/rollback/:version) y del '
  'que el motor lee la definición congelada de cada corrida. En GARDEN la '
  'tabla equivalente existía y nadie la leía. H8.';
