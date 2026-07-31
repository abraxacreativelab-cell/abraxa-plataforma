-- ═══════════════════════════════════════════════════════════════════════════
--  070_work.sql — H9 · Tareas y proyectos
--
--  Puerto de `garden.tasks` + `013-tareas-universal.sql`, con tres cambios de
--  fondo:
--
--   1. `company_id text` → `tenant_id uuid`. En GARDEN una tarea pertenecía a
--      una de las empresas de Santiago; aquí el usuario tiene UNA sola empresa
--      y `tenant_id` es la llave de aislamiento entre clientes distintos. No es
--      un renombre: cambia de significado.
--
--   2. Ids `uuid` en vez de `integer` autoincremental. Un id secuencial filtra
--      cuántas tareas tiene el sistema entero y hace adivinables las ajenas.
--      Con RLS + `tenantDb()` no sería explotable, pero no hay razón para
--      dejarlo puesto en una plataforma multi-cliente.
--
--   3. La jerarquía es **Proyecto → Tarea → Subtarea, un solo nivel**, y lo
--      impone la base de datos (`work_guard_hierarchy`), no la interfaz. En
--      GARDEN `parent_task_id` admitía profundidad infinita: bastaba un cliente
--      REST distinto para armar una cadena de 5 niveles que ninguna vista sabía
--      pintar. Aquí un árbol imposible no se puede escribir.
--
--  Los hitos NO están aquí: en esta plataforma los hitos son del roadmap del
--  negocio (H11), no de las tareas.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 1. Proyectos
--
--    Agrupan tareas y son el primer nivel de la jerarquía. `position` es
--    numérico y no entero a propósito: reordenar entre dos vecinos es un
--    promedio, no un UPDATE de toda la lista.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE app.projects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(btrim(name)) > 0),
  description text,
  goal        text,
  status      text NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'paused', 'completed', 'archived')),
  icon        text,
  start_date  date,
  target_date date,
  position    numeric NOT NULL DEFAULT 0,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);


-- ───────────────────────────────────────────────────────────────────────────
-- 2. Tareas
--
--    `parent_id` con ON DELETE CASCADE: borrar una tarea se lleva sus
--    subtareas. Es lo que espera cualquiera que borra el padre, y sin el
--    CASCADE quedarían subtareas huérfanas invisibles en toda vista.
--
--    `assigned_by` NO tiene default. En GARDEN era `'santiago'` (tasks.ts:210)
--    y eso convertía cada tarea creada por un agente o un webhook en una tarea
--    "de Santiago". Aquí lo llena el usuario de la sesión, o se queda nulo.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE app.tasks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  project_id     uuid REFERENCES app.projects(id) ON DELETE SET NULL,
  parent_id      uuid REFERENCES app.tasks(id)    ON DELETE CASCADE,

  title          text NOT NULL CHECK (length(btrim(title)) > 0),
  description    text,

  status         text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'in_progress', 'blocked', 'completed', 'cancelled')),
  priority       text NOT NULL DEFAULT 'media'
                 CHECK (priority IN ('critica', 'alta', 'media', 'baja')),

  assigned_to    text,
  assigned_by    text,

  start_date     date,
  due_date       date,
  estimate_hours numeric CHECK (estimate_hours IS NULL OR estimate_hours >= 0),
  tags           text[] NOT NULL DEFAULT '{}',

  sort_order     numeric NOT NULL DEFAULT 0,
  completed_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  -- Una tarea no puede ser su propia subtarea. La profundidad la cuida el
  -- trigger de abajo; este CHECK atrapa el caso degenerado sin pagar un
  -- disparo de función.
  CONSTRAINT tasks_no_self_parent CHECK (parent_id IS DISTINCT FROM id)
);


-- ───────────────────────────────────────────────────────────────────────────
-- 3. Comentarios e historial
--
--    Separados a propósito. En GARDEN `task_updates` mezclaba los dos con una
--    columna `update_type`, y por eso el panel de detalle tenía que filtrar en
--    memoria para pintar dos listas distintas. Un comentario lo escribe una
--    persona y se puede borrar; un evento lo escribe el sistema y es historia.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE app.task_comments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  task_id    uuid NOT NULL REFERENCES app.tasks(id)   ON DELETE CASCADE,
  author     text,
  body       text NOT NULL CHECK (length(btrim(body)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.task_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  task_id    uuid NOT NULL REFERENCES app.tasks(id)   ON DELETE CASCADE,
  actor      text,
  -- 'created' | 'status' | 'assigned_to' | 'due_date' | 'priority' | 'project_id' | 'deleted'
  field      text NOT NULL,
  from_value text,
  to_value   text,
  created_at timestamptz NOT NULL DEFAULT now()
);


-- ───────────────────────────────────────────────────────────────────────────
-- 4. Vistas guardadas
--
--    `shared = true` la ve todo el tenant; `false` sólo su dueño. El alcance
--    es el tenant y NO la empresa: aquí sólo hay una.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE app.task_views (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  owner_email text NOT NULL,
  name        text NOT NULL CHECK (length(btrim(name)) > 0),
  kind        text NOT NULL DEFAULT 'progreso'
              CHECK (kind IN ('proyecto', 'responsable', 'calendario', 'progreso')),
  config      jsonb NOT NULL DEFAULT '{}',
  shared      boolean NOT NULL DEFAULT false,
  position    numeric NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);


-- ───────────────────────────────────────────────────────────────────────────
-- 5. RLS — en la MISMA migración que crea las tablas.
--
--    Activa y sin políticas = negado para todos menos `service_role`, que hace
--    bypass. Nadie habla con estas tablas por PostgREST directo: todo pasa por
--    la API con `tenantDb(ctx)`.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE app.projects      ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.tasks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.task_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.task_views    ENABLE ROW LEVEL SECURITY;


-- ───────────────────────────────────────────────────────────────────────────
-- 6. Índices
--
--    Uno por cada consulta que de verdad hace el producto. Las cuatro vistas
--    leen el mismo conjunto (las tareas abiertas del tenant) y lo agrupan en
--    memoria, así que el índice que importa es (tenant_id, status).
-- ───────────────────────────────────────────────────────────────────────────

CREATE INDEX projects_tenant_pos_idx    ON app.projects (tenant_id, position);
CREATE INDEX tasks_tenant_status_idx    ON app.tasks (tenant_id, status);
CREATE INDEX tasks_tenant_project_idx   ON app.tasks (tenant_id, project_id);
CREATE INDEX tasks_tenant_assignee_idx  ON app.tasks (tenant_id, assigned_to);
CREATE INDEX tasks_tenant_due_idx       ON app.tasks (tenant_id, due_date);
CREATE INDEX tasks_parent_idx           ON app.tasks (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX task_comments_task_idx     ON app.task_comments (task_id, created_at);
CREATE INDEX task_events_task_idx       ON app.task_events (task_id, created_at);
CREATE INDEX task_views_tenant_idx      ON app.task_views (tenant_id, position);

-- Dos vistas con el mismo nombre y el mismo dueño son un error de dedo, no una
-- intención. Con distinto dueño sí se permite: son de personas distintas.
CREATE UNIQUE INDEX task_views_owner_name_idx
  ON app.task_views (tenant_id, owner_email, lower(btrim(name)));


-- ───────────────────────────────────────────────────────────────────────────
-- 7. `updated_at` sin depender de que el llamador se acuerde.
-- ───────────────────────────────────────────────────────────────────────────

CREATE FUNCTION app.work_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER projects_touch   BEFORE UPDATE ON app.projects
  FOR EACH ROW EXECUTE FUNCTION app.work_touch_updated_at();
CREATE TRIGGER tasks_touch      BEFORE UPDATE ON app.tasks
  FOR EACH ROW EXECUTE FUNCTION app.work_touch_updated_at();
CREATE TRIGGER task_views_touch BEFORE UPDATE ON app.task_views
  FOR EACH ROW EXECUTE FUNCTION app.work_touch_updated_at();


-- ───────────────────────────────────────────────────────────────────────────
-- 8. La jerarquía, impuesta por la base
--
--    Cuatro invariantes que la interfaz no puede garantizar sola porque no es
--    el único cliente (están el port de H9, las tools del agente maestro y el
--    nodo `create_task` de H8):
--
--      a. Un solo nivel de subtareas.
--      b. Una subtarea vive en el proyecto de su padre. Siempre.
--      c. Padre y proyecto son del MISMO tenant. Las FK no lo garantizan:
--         apuntan a `app.tasks(id)` y `app.projects(id)` sin mirar de quién
--         son. Sin esta comprobación, un id filtrado permitiría colgar una
--         subtarea del árbol de otro cliente.
--      d. `completed_at` sigue a `status`, y se LIMPIA al reabrir. Un
--         `completed_at` viejo en una tarea reabierta ensucia todo reporte.
-- ───────────────────────────────────────────────────────────────────────────

CREATE FUNCTION app.work_guard_hierarchy() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
DECLARE
  v_parent_tenant  uuid;
  v_parent_parent  uuid;
  v_parent_project uuid;
  v_project_tenant uuid;
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    SELECT tenant_id, parent_id, project_id
      INTO v_parent_tenant, v_parent_parent, v_parent_project
      FROM app.tasks WHERE id = NEW.parent_id;

    IF NOT FOUND OR v_parent_tenant IS DISTINCT FROM NEW.tenant_id THEN
      RAISE EXCEPTION 'parent_not_found:%', NEW.parent_id USING ERRCODE = 'P0002';
    END IF;

    -- (a) el padre no puede ser a su vez subtarea
    IF v_parent_parent IS NOT NULL THEN
      RAISE EXCEPTION 'subtask_depth:%', NEW.parent_id USING ERRCODE = 'P0001';
    END IF;

    -- (a) y una tarea que ya tiene hijos no puede volverse subtarea
    IF EXISTS (SELECT 1 FROM app.tasks WHERE parent_id = NEW.id) THEN
      RAISE EXCEPTION 'has_subtasks:%', NEW.id USING ERRCODE = 'P0001';
    END IF;

    -- (b) la subtarea hereda el proyecto del padre, pase lo que pase
    NEW.project_id := v_parent_project;
  END IF;

  -- (c) el proyecto también tiene que ser del mismo tenant
  IF NEW.project_id IS NOT NULL THEN
    SELECT tenant_id INTO v_project_tenant FROM app.projects WHERE id = NEW.project_id;
    IF NOT FOUND OR v_project_tenant IS DISTINCT FROM NEW.tenant_id THEN
      RAISE EXCEPTION 'project_not_found:%', NEW.project_id USING ERRCODE = 'P0002';
    END IF;
  END IF;

  -- (d) completed_at sigue a status.
  --
  --     Las dos ramas están separadas a propósito: en un disparo de INSERT el
  --     registro OLD no existe, y PL/pgSQL no garantiza el corto-circuito de un
  --     `OR`. Escrito como `TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM
  --     OLD.status`, cada INSERT reventaría con "record old is not assigned
  --     yet".
  IF TG_OP = 'INSERT' THEN
    NEW.completed_at := CASE WHEN NEW.status = 'completed' THEN now() ELSE NULL END;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.completed_at := CASE WHEN NEW.status = 'completed' THEN now() ELSE NULL END;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER tasks_guard_hierarchy BEFORE INSERT OR UPDATE ON app.tasks
  FOR EACH ROW EXECUTE FUNCTION app.work_guard_hierarchy();

-- Mover un proyecto de tarea padre arrastra a sus subtareas: el invariante (b)
-- tiene que seguir siendo cierto DESPUÉS del UPDATE, no sólo durante.
CREATE FUNCTION app.work_cascade_project() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
BEGIN
  IF NEW.parent_id IS NULL AND NEW.project_id IS DISTINCT FROM OLD.project_id THEN
    UPDATE app.tasks SET project_id = NEW.project_id
     WHERE parent_id = NEW.id AND project_id IS DISTINCT FROM NEW.project_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER tasks_cascade_project AFTER UPDATE OF project_id ON app.tasks
  FOR EACH ROW EXECUTE FUNCTION app.work_cascade_project();


-- ───────────────────────────────────────────────────────────────────────────
-- 9. RPC · reorder transaccional
--
--    Reordenar un tablero es N escrituras que valen como UNA. Si la quinta
--    falla, las cuatro anteriores tienen que deshacerse — si no, el usuario
--    recarga y ve un tablero a medio mover que él nunca dejó así.
--
--    Guard 409: si algún movimiento completa una tarea con subtareas abiertas,
--    lanza `open_subtasks:<ids>` y revierte TODO. La ruta lo traduce a 409 con
--    la lista, y la interfaz ofrece "Completar todas".
--
--    `p_tenant` es obligatorio y filtra cada UPDATE. `service_role` hace bypass
--    de RLS, así que el aislamiento de esta función no lo pone Postgres: lo
--    pone este parámetro. Una tarea de otro tenant no se encuentra y la
--    transacción entera muere con `task_not_found`.
--
--    `search_path` fijo: es la defensa estándar de una función SECURITY DEFINER.
-- ───────────────────────────────────────────────────────────────────────────

CREATE FUNCTION app.reorder_tasks(p_tenant uuid, p_items jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $$
DECLARE
  item            jsonb;
  v_id            uuid;
  v_sort          numeric;
  v_status        text;
  v_assigned_to   text;
  v_priority      text;
  v_project_id    uuid;
  v_parent        uuid;
  v_current_status text;
  open_ids        uuid[];
  v_count         integer := 0;
BEGIN
  IF p_tenant IS NULL THEN
    RAISE EXCEPTION 'invalid_tenant' USING ERRCODE = '22023';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'invalid_moves:p_items debe ser un array no vacío' USING ERRCODE = '22023';
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    IF jsonb_typeof(item) <> 'object' OR NOT (item ? 'id') OR NOT (item ? 'sort_order') THEN
      RAISE EXCEPTION 'invalid_move:cada item requiere id y sort_order' USING ERRCODE = '22023';
    END IF;

    v_id          := (item->>'id')::uuid;
    v_sort        := (item->>'sort_order')::numeric;
    v_status      := item->>'status';
    v_assigned_to := item->>'assigned_to';
    v_priority    := item->>'priority';
    v_project_id  := (item->>'project_id')::uuid;

    IF v_status IS NOT NULL
       AND v_status NOT IN ('pending','in_progress','blocked','completed','cancelled') THEN
      RAISE EXCEPTION 'invalid_status:%', v_status USING ERRCODE = '22023';
    END IF;
    IF v_priority IS NOT NULL AND v_priority NOT IN ('critica','alta','media','baja') THEN
      RAISE EXCEPTION 'invalid_priority:%', v_priority USING ERRCODE = '22023';
    END IF;

    -- Bloquea la fila ANTES de decidir. Dos usuarios arrastrando la misma
    -- tarjeta se serializan aquí en vez de pisarse.
    SELECT status, parent_id INTO v_current_status, v_parent
      FROM app.tasks WHERE id = v_id AND tenant_id = p_tenant FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'task_not_found:%', v_id USING ERRCODE = 'P0002';
    END IF;

    -- Guard 409. Sólo aplica a tareas padre: una subtarea no tiene subtareas.
    IF v_status = 'completed' AND v_current_status <> 'completed' AND v_parent IS NULL THEN
      SELECT array_agg(id) INTO open_ids
        FROM app.tasks
       WHERE parent_id = v_id
         AND tenant_id = p_tenant
         AND status IN ('pending','in_progress','blocked');

      IF open_ids IS NOT NULL AND array_length(open_ids, 1) > 0 THEN
        RAISE EXCEPTION 'open_subtasks:%', array_to_string(open_ids, ',')
          USING ERRCODE = 'P0001';
      END IF;
    END IF;

    UPDATE app.tasks SET
      sort_order  = v_sort,
      status      = COALESCE(v_status, status),
      priority    = COALESCE(v_priority, priority),
      assigned_to = CASE WHEN item ? 'assigned_to' THEN v_assigned_to ELSE assigned_to END,
      project_id  = CASE WHEN item ? 'project_id'  THEN v_project_id  ELSE project_id  END
     WHERE id = v_id AND tenant_id = p_tenant;

    -- El historial se escribe aquí dentro para que un reorder revertido no
    -- deje eventos contando un cambio que no ocurrió.
    IF v_status IS NOT NULL AND v_status IS DISTINCT FROM v_current_status THEN
      INSERT INTO app.task_events (tenant_id, task_id, actor, field, from_value, to_value)
      VALUES (p_tenant, v_id, item->>'actor', 'status', v_current_status, v_status);
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;


-- ───────────────────────────────────────────────────────────────────────────
-- 10. RPC · "Completar todas"
--
--     La salida del 409. Cierra las subtareas abiertas y el padre en una sola
--     transacción: o queda todo cerrado o no se cierra nada. Hacerlo desde el
--     cliente con N llamadas deja el árbol a medias en cuanto una falle — que
--     es exactamente el estado del que el guard 409 nos estaba protegiendo.
-- ───────────────────────────────────────────────────────────────────────────

CREATE FUNCTION app.complete_task_cascade(p_tenant uuid, p_task uuid, p_actor text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $$
DECLARE
  v_status text;
  v_parent uuid;
  sub      record;
  v_count  integer := 0;
BEGIN
  IF p_tenant IS NULL OR p_task IS NULL THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;

  SELECT status, parent_id INTO v_status, v_parent
    FROM app.tasks WHERE id = p_task AND tenant_id = p_tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'task_not_found:%', p_task USING ERRCODE = 'P0002';
  END IF;

  IF v_parent IS NULL THEN
    FOR sub IN
      SELECT id, status FROM app.tasks
       WHERE parent_id = p_task AND tenant_id = p_tenant
         AND status IN ('pending','in_progress','blocked')
       FOR UPDATE
    LOOP
      UPDATE app.tasks SET status = 'completed' WHERE id = sub.id AND tenant_id = p_tenant;
      INSERT INTO app.task_events (tenant_id, task_id, actor, field, from_value, to_value)
      VALUES (p_tenant, sub.id, p_actor, 'status', sub.status, 'completed');
      v_count := v_count + 1;
    END LOOP;
  END IF;

  IF v_status <> 'completed' THEN
    UPDATE app.tasks SET status = 'completed' WHERE id = p_task AND tenant_id = p_tenant;
    INSERT INTO app.task_events (tenant_id, task_id, actor, field, from_value, to_value)
    VALUES (p_tenant, p_task, p_actor, 'status', v_status, 'completed');
    v_count := v_count + 1;
  END IF;

  RETURN v_count;
END;
$$;


-- ───────────────────────────────────────────────────────────────────────────
-- 11. Privilegios de las funciones
--
--     Postgres concede EXECUTE a PUBLIC en toda función nueva. En dos
--     SECURITY DEFINER que escriben tareas de cualquier tenant, eso no se deja
--     puesto. (Las tablas no lo necesitan: la `001` dejó las DEFAULT
--     PRIVILEGES del schema `app` en su sitio.)
-- ───────────────────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION app.reorder_tasks(uuid, jsonb)              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION app.complete_task_cascade(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION app.reorder_tasks(uuid, jsonb)              TO service_role;
GRANT  EXECUTE ON FUNCTION app.complete_task_cascade(uuid, uuid, text) TO service_role;

COMMENT ON TABLE app.tasks IS
  'Tareas del tenant. Jerarquía Proyecto → Tarea → Subtarea, un solo nivel, '
  'impuesta por el trigger tasks_guard_hierarchy. Toda escritura pasa por '
  'tenantDb(ctx) desde packages/work (H9).';
