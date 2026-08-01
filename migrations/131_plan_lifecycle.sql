-- ═══════════════════════════════════════════════════════════════════════════
--  131_plan_lifecycle.sql — H16
--
--  QUÉ PASA cuando alguien deja de pagar. Y qué pasa cuando vuelve.
--
--  ── La regla que define este carril ───────────────────────────────────────
--
--  PAUSAR, NUNCA BORRAR. Ni una fila de nadie se borra por una razón de plan,
--  jamás, y no es sentimentalismo:
--
--    1. El emprendedor que se atrasó un mes vuelve. Si al volver sus
--       automatizaciones ya no existen y sus documentos desaparecieron, no
--       vuelve — se va, y con razón. Guardar sus filas tres meses más cuesta
--       aproximadamente cero.
--
--    2. Una baja puede ser un ERROR. Un webhook de Stripe mal interpretado, una
--       tarjeta que rebotó y se cobró al segundo intento, un staff que le picó
--       al plan equivocado en el panel de H14. Pausar se deshace en un segundo.
--       Borrar no se deshace nunca.
--
--  Por eso `app.features.on_downgrade` no tiene el valor 'delete', y por eso
--  ninguna función de este archivo contiene un DELETE.
--
--  ── El detalle que separa una reactivación buena de una mala ──────────────
--
--  Al volver a subir de plan hay que despausar lo que la BAJA pausó, y NO tocar
--  lo que el emprendedor había pausado ÉL. Encenderle de vuelta el flujo que
--  apagó a propósito es peor que no reactivar nada: es el producto haciendo
--  cosas a su nombre que él no pidió.
--
--  Eso obliga a que cada pausa sepa quién la puso — `paused_by` — y es toda la
--  razón por la que existe `app.feature_pauses` en vez de un booleano.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 1. Bitácora de cambios de plan.
--
--    No es auditoría decorativa: es lo que contesta "¿por qué este cliente
--    perdió su función?" sin adivinar. `effects` guarda lo que se apagó DE
--    VERDAD, resuelto en el momento del cambio — sin eso, reconstruir el efecto
--    de una baja de hace tres meses exigiría saber cómo estaba el catálogo
--    entonces, y el catálogo cambia.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE app.plan_changes (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,

  from_plan   text,
  to_plan     text NOT NULL REFERENCES app.plans(id) ON UPDATE CASCADE,
  from_status text,
  to_status   text NOT NULL CHECK (to_status IN ('active', 'suspended', 'archived')),

  reason      text NOT NULL
              CHECK (reason IN ('checkout', 'payment_failed', 'cancel', 'staff', 'trial_end')),

  -- Correo de quien lo hizo, o NULL si lo hizo el sistema (un webhook de
  -- Stripe no tiene cara). Sin FK a app.users a propósito: el staff de la
  -- plataforma puede no ser usuario de esta empresa, y la bitácora no debe
  -- poder fallar por eso.
  actor       text,

  effects     jsonb NOT NULL DEFAULT '[]'
              CONSTRAINT plan_changes_effects_arreglo CHECK (jsonb_typeof(effects) = 'array'),

  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app.plan_changes ENABLE ROW LEVEL SECURITY;

CREATE INDEX plan_changes_tenant_idx ON app.plan_changes (tenant_id, created_at DESC);


-- ───────────────────────────────────────────────────────────────────────────
-- 2. Las pausas.
--
--    ── Por qué H16 no apaga nada en las tablas de nadie ──────────────────────
--
--    Un flujo es de H8, un canal es de H6, un agente es de H3. H16 no escribe
--    en sus tablas y no debe: abrir catorce árboles para poder poner un
--    booleano sería exactamente el tipo de acoplamiento que el contrato de no
--    colisión existe para impedir.
--
--    Así que la pausa vive AQUÍ, como un hecho consultable, y el carril dueño
--    la respeta preguntando. Tiene dos ventajas sobre apagar en su tabla:
--
--      · no se pierde nada, ni siquiera el estado original del recurso;
--      · reactivar es borrar un hecho, no reconstruir un estado.
--
--    `resource_ref` es opaco a propósito: '*' es "toda la función", y un id
--    cualquiera es "este flujo en concreto". H16 no interpreta su contenido —
--    interpretarlo sería conocer el modelo de otro carril.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE app.feature_pauses (
  id           bigserial PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  feature_key  text NOT NULL REFERENCES app.features(key) ON UPDATE CASCADE ON DELETE CASCADE,

  resource_ref text NOT NULL DEFAULT '*',

  -- QUIÉN la puso. Es el campo que hace posible el criterio #9: al reactivar,
  -- se sueltan las 'plan' y NO se tocan las 'user'.
  paused_by    text NOT NULL CHECK (paused_by IN ('plan', 'user')),

  plan_change_id bigint REFERENCES app.plan_changes(id) ON DELETE SET NULL,
  note         text,

  created_at   timestamptz NOT NULL DEFAULT now(),
  released_at  timestamptz,
  released_by  bigint REFERENCES app.plan_changes(id) ON DELETE SET NULL,

  CONSTRAINT feature_pauses_liberada_coherente
    CHECK (released_at IS NOT NULL OR released_by IS NULL)
);

ALTER TABLE app.feature_pauses ENABLE ROW LEVEL SECURITY;

/*
 * Una sola pausa VIVA por (empresa, función, recurso, quién).
 *
 * Este índice es lo que hace idempotente a `apply_plan_change`: H10 puede
 * reintentar el mismo webhook de Stripe y el segundo intento choca contra el
 * índice en vez de abrir una segunda pausa. La idempotencia se apoya en una
 * restricción de la base y no en que el código se acuerde de comprobar antes.
 *
 * `paused_by` va en la llave a propósito: una pausa del plan y una pausa del
 * usuario sobre el mismo recurso TIENEN que poder convivir. Si no pudieran,
 * soltar la del plan encendería algo que el dueño apagó él.
 */
CREATE UNIQUE INDEX feature_pauses_viva_idx
  ON app.feature_pauses (tenant_id, feature_key, resource_ref, paused_by)
  WHERE released_at IS NULL;

CREATE INDEX feature_pauses_tenant_vivas_idx
  ON app.feature_pauses (tenant_id, feature_key)
  WHERE released_at IS NULL;


-- ───────────────────────────────────────────────────────────────────────────
-- 3. Lo que se dejó de hacer, y por qué.
--
--    §2.5 del handoff: un job encolado el martes con plan `pro`, que corre el
--    jueves después de una baja a `free`, hoy corre igual. El único momento en
--    que alguien mira el plan es al encolar.
--
--    `withEntitlement()` cierra eso verificando AL EJECUTAR. Cuando decide no
--    correr, escribe aquí. Es deliberado que sea una fila y no un log: un job
--    que "no hizo nada" sin rastro es indistinguible de un job que se perdió, y
--    el emprendedor que pregunta "¿por qué no salió mi campaña?" merece una
--    respuesta y no una teoría.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE app.plan_skips (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  feature_key text REFERENCES app.features(key) ON UPDATE CASCADE ON DELETE SET NULL,

  -- Nombre de la cola de pg-boss. Texto libre porque las colas son de otros
  -- carriles y H16 no tiene por qué conocer su lista.
  queue       text NOT NULL,
  job_id      text,

  reason      text NOT NULL
              CHECK (reason IN (
                'feature_not_in_plan',   -- el plan no lo incluye
                'tenant_suspended',      -- dejó de pagar
                'tenant_archived',       -- se dio de baja
                'tenant_unknown'         -- el job trae un tenant que no existe
              )),

  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app.plan_skips ENABLE ROW LEVEL SECURITY;

CREATE INDEX plan_skips_tenant_idx ON app.plan_skips (tenant_id, created_at DESC);


-- ───────────────────────────────────────────────────────────────────────────
-- 4. `app.apply_plan_change()` — todo o nada, e idempotente.
--
--    ── Por qué es una función de plpgsql y no cuatro llamadas de TypeScript ──
--
--    Porque toca cuatro tablas —tenants, plan_changes, feature_pauses y otra
--    vez plan_changes para los efectos— y a medias deja a una empresa con el
--    plan nuevo y las pausas del viejo, que es el peor estado posible: el
--    cliente pagó y no recuperó nada. Es el mismo razonamiento con el que H2
--    puso `provision_tenant` y `accept_invitation` en SQL (migraciones 011 y
--    012), y se copia a propósito.
--
--    ── La idempotencia, que H10 necesita de verdad ──────────────────────────
--
--    Stripe reintenta. Un webhook entregado dos veces tiene que dejar el mismo
--    estado y UNA sola fila de bitácora. Aquí se resuelve mirando el estado
--    actual: si la empresa YA está en el plan y el estado pedidos, no hay nada
--    que aplicar — se devuelve el último cambio registrado con `applied=false`
--    y no se escribe nada.
--
--    Eso deja fuera el caso "el mismo cambio, dos veces, con algo en medio"
--    (suspender → reactivar → suspender), que SÍ son dos cambios reales y
--    tienen que quedar los dos en la bitácora. Distinguirlos por el estado y no
--    por una llave de idempotencia es lo que hace que ese caso salga bien solo.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION app.apply_plan_change(
  p_tenant_id uuid,
  p_to_plan   text,
  p_to_status text,
  p_reason    text,
  p_actor     text DEFAULT NULL
)
RETURNS TABLE (change_id bigint, applied boolean, effects jsonb)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
/*
 * `effects` y `change_id` son nombres de RETURNS TABLE, y por lo tanto
 * variables de plpgsql dentro del cuerpo. `effects` es TAMBIÉN una columna de
 * app.plan_changes, así que sin esta línea el UPDATE del final es ambiguo y la
 * función revienta en tiempo de ejecución con 42702 — el mismo error que H2
 * documentó en 012_invitations.sql:70-84 después de que le pasara de verdad.
 */
#variable_conflict use_column
DECLARE
  v_tenant  app.tenants%ROWTYPE;
  v_change  bigint;
  v_effects jsonb := '[]'::jsonb;
  v_antes   jsonb := '{}'::jsonb;
  v_abierta boolean;
  r         record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.plans p WHERE p.id = p_to_plan) THEN
    RAISE EXCEPTION 'El plan "%" no existe en el catálogo.', p_to_plan USING ERRCODE = 'ABX31';
  END IF;

  -- FOR UPDATE: dos webhooks de Stripe llegando a la vez se serializan aquí.
  -- Sin esto, los dos leerían el estado viejo y los dos escribirían bitácora.
  SELECT * INTO v_tenant FROM app.tenants t WHERE t.id = p_tenant_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La empresa % no existe.', p_tenant_id USING ERRCODE = 'ABX30';
  END IF;

  -- ── Idempotencia ─────────────────────────────────────────────────────────
  IF v_tenant.plan = p_to_plan AND v_tenant.status = p_to_status THEN
    SELECT c.id, c.effects INTO v_change, v_effects
      FROM app.plan_changes c
     WHERE c.tenant_id = p_tenant_id
     ORDER BY c.created_at DESC, c.id DESC
     LIMIT 1;

    RETURN QUERY SELECT v_change, false, coalesce(v_effects, '[]'::jsonb);
    RETURN;
  END IF;

  /*
   * FOTO DE ANTES — hay que tomarla antes del UPDATE.
   *
   * Sin ella, "lo que se pierde" se calcula sólo con el estado nuevo y se
   * acaba pausando cualquier función que el plan nuevo no traiga, la tuviera o
   * no la tuviera antes. Suena inofensivo porque una pausa sobre algo que no
   * está concedido no apaga nada… hasta que se mira la pantalla: el tercer
   * bloque de /ajustes/plan le diría al emprendedor "SMS pausado por tu plan"
   * a alguien que nunca contrató SMS. Eso no es un dato de más, es decirle que
   * perdió algo que nunca tuvo.
   *
   * §7 lo dice literal: "lo que estaba corriendo se detiene". Lo que no estaba
   * corriendo no se detiene — se queda como estaba.
   */
  SELECT coalesce(jsonb_object_agg(e.feature_key, e.granted), '{}'::jsonb)
    INTO v_antes
    FROM app.tenant_entitlements_effective e
   WHERE e.tenant_id = p_tenant_id;

  INSERT INTO app.plan_changes (
    tenant_id, from_plan, to_plan, from_status, to_status, reason, actor
  )
  VALUES (
    p_tenant_id, v_tenant.plan, p_to_plan, v_tenant.status, p_to_status, p_reason, p_actor
  )
  RETURNING id INTO v_change;

  UPDATE app.tenants
     SET plan = p_to_plan, status = p_to_status
   WHERE id = p_tenant_id;

  /*
   * A partir de aquí, `app.tenant_entitlements_effective` ya ve el plan NUEVO:
   * la vista lee app.tenants y estamos dentro de la misma transacción que
   * acaba de actualizarla. Los efectos se resuelven contra el estado nuevo, que
   * es justo lo que hay que registrar.
   */

  -- ── Lo que se PIERDE ─────────────────────────────────────────────────────
  FOR r IN
    SELECT e.feature_key, e.on_downgrade
      FROM app.tenant_entitlements_effective e
     WHERE e.tenant_id = p_tenant_id
       AND e.granted = false
       AND e.on_downgrade <> 'keep'
       -- …y que ANTES sí la tuviera. Ver la foto de arriba.
       AND coalesce((v_antes ->> e.feature_key)::boolean, false) = true
     ORDER BY e.position
  LOOP
    -- ¿Ya hay una pausa viva PUESTA POR EL PLAN para esta función?
    SELECT EXISTS (
      SELECT 1 FROM app.feature_pauses fp
       WHERE fp.tenant_id    = p_tenant_id
         AND fp.feature_key  = r.feature_key
         AND fp.resource_ref = '*'
         AND fp.paused_by    = 'plan'
         AND fp.released_at IS NULL
    ) INTO v_abierta;

    IF NOT v_abierta THEN
      INSERT INTO app.feature_pauses (
        tenant_id, feature_key, resource_ref, paused_by, plan_change_id, note
      )
      VALUES (
        p_tenant_id, r.feature_key, '*', 'plan', v_change,
        'Pausada por el cambio de plan #' || v_change::text
      );

      v_effects := v_effects || jsonb_build_object(
        'feature', r.feature_key,
        -- 'pause' → 'paused'; 'readonly' se queda como está. Son los dos
        -- valores que declara el tipo de TypeScript en lifecycle.ts.
        'action', CASE WHEN r.on_downgrade = 'pause' THEN 'paused' ELSE 'readonly' END
      );
    END IF;
  END LOOP;

  /*
   * ── Lo que se RECUPERA ───────────────────────────────────────────────────
   *
   * Sólo las pausas con `paused_by = 'plan'`. Las del usuario se quedan
   * exactamente donde estaban, y ésa es la línea entera del criterio #9: si
   * este UPDATE no filtrara por `paused_by`, subir de plan le volvería a
   * encender al emprendedor el flujo que él había apagado a propósito.
   *
   * No se borra la fila: se marca liberada. La pausa es historia, y la
   * historia de por qué algo se apagó tres meses es lo que contesta la
   * siguiente pregunta de soporte.
   */
  FOR r IN
    SELECT e.feature_key
      FROM app.tenant_entitlements_effective e
     WHERE e.tenant_id = p_tenant_id
       AND e.granted = true
     ORDER BY e.position
  LOOP
    UPDATE app.feature_pauses fp
       SET released_at = now(),
           released_by = v_change
     WHERE fp.tenant_id   = p_tenant_id
       AND fp.feature_key = r.feature_key
       AND fp.paused_by   = 'plan'
       AND fp.released_at IS NULL;

    IF FOUND THEN
      v_effects := v_effects || jsonb_build_object(
        'feature', r.feature_key,
        'action',  'restored'
      );
    END IF;
  END LOOP;

  UPDATE app.plan_changes SET effects = v_effects WHERE id = v_change;

  RETURN QUERY SELECT v_change, true, v_effects;
END;
$$;

COMMENT ON FUNCTION app.apply_plan_change(uuid, text, text, text, text) IS
  'Aplica un cambio de plan/estado en una transacción: bitácora → tenant → pausas → efectos. '
  'Idempotente: si la empresa ya está en ese plan y estado, no escribe nada y devuelve '
  'applied=false. Pausa, nunca borra, y al reactivar suelta SÓLO las pausas puestas por el plan.';


-- ───────────────────────────────────────────────────────────────────────────
-- 5. Pausar y despausar a mano — lo que hace el emprendedor.
--
--    Existe para que la pausa del usuario y la del plan se escriban en la misma
--    tabla y con las mismas reglas. Si el usuario pausara en otra parte, la
--    reactivación tendría que saber de dos modelos y el criterio #9 volvería a
--    depender de que alguien se acuerde.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION app.set_user_pause(
  p_tenant_id    uuid,
  p_feature_key  text,
  p_resource_ref text,
  p_paused       boolean,
  p_note         text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_ref text := coalesce(nullif(btrim(p_resource_ref), ''), '*');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.features f WHERE f.key = p_feature_key) THEN
    RAISE EXCEPTION 'La función "%" no existe en el catálogo.', p_feature_key
      USING ERRCODE = 'ABX32';
  END IF;

  IF p_paused THEN
    INSERT INTO app.feature_pauses (tenant_id, feature_key, resource_ref, paused_by, note)
    VALUES (p_tenant_id, p_feature_key, v_ref, 'user', p_note)
    ON CONFLICT DO NOTHING;   -- pausar dos veces es pausar una vez
    RETURN true;
  END IF;

  UPDATE app.feature_pauses fp
     SET released_at = now()
   WHERE fp.tenant_id    = p_tenant_id
     AND fp.feature_key  = p_feature_key
     AND fp.resource_ref = v_ref
     AND fp.paused_by    = 'user'
     AND fp.released_at IS NULL;

  RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION app.set_user_pause(uuid, text, text, boolean, text) IS
  'Pausa o despausa a petición del emprendedor. Escribe en la misma tabla que la pausa por '
  'plan pero con paused_by=user, que es lo que impide que una reactivación se la pise.';


-- ───────────────────────────────────────────────────────────────────────────
-- 6. Documentación viva.
-- ───────────────────────────────────────────────────────────────────────────

COMMENT ON TABLE app.plan_changes IS
  'Bitácora de cambios de plan y estado. `effects` guarda lo que se apagó de verdad, '
  'resuelto en el momento: sin eso, explicar una baja de hace tres meses exige saber cómo '
  'estaba el catálogo entonces.';

COMMENT ON TABLE app.feature_pauses IS
  'Pausas vigentes e históricas. H16 no apaga nada en las tablas de otros carriles: deja el '
  'hecho aquí y el dueño lo respeta preguntando. Pausar, nunca borrar.';

COMMENT ON COLUMN app.feature_pauses.paused_by IS
  'plan | user. Al reactivar se sueltan SÓLO las del plan. Encenderle al emprendedor el flujo '
  'que él apagó a propósito es peor que no reactivar nada.';

COMMENT ON COLUMN app.feature_pauses.resource_ref IS
  '`*` = toda la función; cualquier otro texto = un recurso del carril dueño. H16 no interpreta '
  'su contenido: interpretarlo sería conocer el modelo de otro carril.';

COMMENT ON TABLE app.plan_skips IS
  'Trabajos que no se corrieron y por qué. Un job que no hizo nada sin rastro es '
  'indistinguible de un job que se perdió.';
