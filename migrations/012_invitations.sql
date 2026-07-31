-- ═══════════════════════════════════════════════════════════════════════════
--  012_invitations.sql — H2
--
--  Invitar y aceptar, cada una en una transacción.
--
--  Aceptar una invitación es el mismo problema que dar de alta una empresa:
--  toca cuatro tablas (usuario, membresía, grants, la invitación misma) y a
--  medias deja a alguien con membresía sin permisos, o con permisos sin
--  membresía. Por eso también es una función y no una secuencia de llamadas.
--
--  Y hay una razón extra: el asiento. El límite `maxSeats` del plan sólo se
--  puede verificar sin carreras en el mismo lugar donde se consume. Dos
--  invitados aceptando al mismo tiempo con un asiento libre pasarían los dos
--  si la cuenta se hiciera en TypeScript.
--
--  ── Errores que devuelve ──────────────────────────────────────────────────
--
--    ABX03  la invitación no existe                → NOT_FOUND (404)
--    ABX04  el plan se quedó sin asientos          → CONFLICT (409)
--    ABX05  intentaron quitar al dueño             → CONFLICT (409)
--    ABX06  invitación expirada, usada, o de otro  → CONFLICT (409)
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 1. Asientos ocupados contra el límite del plan.
--
--    Se cuenta la membresía real. Las invitaciones pendientes NO cuentan: si
--    contaran, invitar a diez personas que nunca entran dejaría la empresa
--    bloqueada sin que nadie ocupe nada.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION app.asientos_disponibles(p_tenant_id uuid)
RETURNS int
LANGUAGE sql STABLE
SET search_path = ''
AS $$
  SELECT GREATEST(
    0,
    coalesce((p.limits ->> 'maxSeats')::int, 2147483647)
      - (SELECT count(*)::int FROM app.memberships m WHERE m.tenant_id = t.id)
  )
  FROM app.tenants t
  JOIN app.plans   p ON p.id = t.plan
  WHERE t.id = p_tenant_id;
$$;

COMMENT ON FUNCTION app.asientos_disponibles(uuid) IS
  'Asientos libres del plan. Un plan sin maxSeats declarado es ilimitado, no cero: '
  'un límite ausente no puede dejar a un cliente que paga sin poder invitar a nadie.';


-- ───────────────────────────────────────────────────────────────────────────
-- 2. Aceptar.
--
--    Recibe el HASH del token, nunca el token. El claro sólo existió una vez,
--    en la respuesta a quien invitó.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION app.accept_invitation(
  p_token_hash text,
  p_email      text,
  p_name       text DEFAULT NULL
)
RETURNS TABLE (tenant_id uuid, tenant_slug text, role text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
/*
 * Los nombres de un RETURNS TABLE son variables de plpgsql dentro del cuerpo.
 * Como aquí se llaman `tenant_id` y `role` — que también son columnas de
 * `app.memberships` — un `ON CONFLICT (tenant_id, user_email)` se vuelve
 * ambiguo y la función revienta en tiempo de ejecución con 42702.
 *
 * No es teórico: esta función se escribió sin esta línea, compiló sin una
 * queja, y falló al primer intento real de aceptar una invitación. Lo destapó
 * `pg.test.ts` contra Postgres de verdad; ninguna prueba en memoria lo habría
 * visto.
 *
 * Con `use_column`, un nombre desnudo se resuelve como columna. Las variables
 * propias van todas prefijadas con `v_`/`p_`, así que no hay nada más que
 * pueda cambiar de significado.
 */
#variable_conflict use_column
DECLARE
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_inv   app.invitations%ROWTYPE;
  v_slug  text;
  v_area  record;
BEGIN
  IF NOT app.es_correo(v_email) THEN
    RAISE EXCEPTION 'Correo inválido: %', v_email USING ERRCODE = 'ABX02';
  END IF;

  -- FOR UPDATE: dos clics en el mismo enlace de invitación se serializan aquí.
  SELECT * INTO v_inv
    FROM app.invitations
   WHERE token_hash = p_token_hash
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La invitación no existe.' USING ERRCODE = 'ABX03';
  END IF;

  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Esa invitación ya fue usada.' USING ERRCODE = 'ABX06';
  END IF;

  IF v_inv.expires_at <= now() THEN
    RAISE EXCEPTION 'La invitación expiró.' USING ERRCODE = 'ABX06';
  END IF;

  /*
   * La invitación es para un correo concreto.
   *
   * Sin esta comparación, quien intercepte el enlace entra a la empresa con el
   * rol que se le dio a otra persona: el token dejaría de ser una invitación y
   * pasaría a ser una llave al portador. El correo que llega aquí viene de la
   * sesión verificada, no del formulario.
   */
  IF v_inv.email IS DISTINCT FROM v_email THEN
    RAISE EXCEPTION 'Esta invitación es para otra persona.' USING ERRCODE = 'ABX06';
  END IF;

  -- Un miembro que ya existe no consume un asiento nuevo (cambio de rol).
  IF NOT EXISTS (
    SELECT 1 FROM app.memberships m
     WHERE m.tenant_id = v_inv.tenant_id AND m.user_email = v_email
  ) AND app.asientos_disponibles(v_inv.tenant_id) < 1 THEN
    RAISE EXCEPTION 'El plan de esta empresa se quedó sin asientos.' USING ERRCODE = 'ABX04';
  END IF;

  -- 1. La persona.
  INSERT INTO app.users (email, name)
  VALUES (v_email, nullif(btrim(coalesce(p_name, '')), ''))
  ON CONFLICT (email) DO UPDATE
    SET name = coalesce(app.users.name, excluded.name),
        updated_at = now();

  -- 2. La membresía.
  INSERT INTO app.memberships (tenant_id, user_email, role)
  VALUES (v_inv.tenant_id, v_email, v_inv.role)
  ON CONFLICT (tenant_id, user_email) DO UPDATE SET role = excluded.role;

  -- 3. Los accesos por área que traía la invitación.
  FOR v_area IN SELECT key AS slug, value AS access FROM jsonb_each_text(v_inv.areas)
  LOOP
    INSERT INTO app.area_grants (tenant_id, user_email, area_slug, access)
    VALUES (v_inv.tenant_id, v_email, v_area.slug, v_area.access)
    ON CONFLICT (tenant_id, user_email, area_slug) DO UPDATE SET access = excluded.access;
  END LOOP;

  -- 4. Quemar la invitación.
  UPDATE app.invitations SET accepted_at = now() WHERE id = v_inv.id;

  SELECT t.slug INTO v_slug FROM app.tenants t WHERE t.id = v_inv.tenant_id;

  INSERT INTO app.tenant_events (tenant_id, type, payload)
  VALUES (
    v_inv.tenant_id,
    'member_joined',
    jsonb_build_object('email', v_email, 'role', v_inv.role, 'via', 'invitation')
  );

  RETURN QUERY SELECT v_inv.tenant_id, v_slug, v_inv.role;
END;
$$;

COMMENT ON FUNCTION app.accept_invitation(text, text, text) IS
  'Acepta una invitación en una transacción: usuario → membresía → grants → invitación quemada. '
  'Verifica vigencia, que el correo sea el invitado y que quede asiento en el plan.';


-- ───────────────────────────────────────────────────────────────────────────
-- 3. Quitar a un miembro.
--
--    En SQL porque tiene que ser atómico con su regla: una empresa no se
--    puede quedar sin dueño. Si la verificación viviera en TypeScript, dos
--    bajas simultáneas de los dos únicos owners pasarían las dos.
--    (Hoy el índice único ya garantiza un solo owner; la regla sigue siendo
--    necesaria para que ese único owner no se pueda borrar.)
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION app.remove_member(
  p_tenant_id uuid,
  p_email     text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_role  text;
BEGIN
  SELECT m.role INTO v_role
    FROM app.memberships m
   WHERE m.tenant_id = p_tenant_id AND m.user_email = v_email
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_role = 'owner' THEN
    RAISE EXCEPTION 'No puedes quitar al dueño de la empresa. Transfiere la propiedad primero.'
      USING ERRCODE = 'ABX05';
  END IF;

  DELETE FROM app.memberships WHERE tenant_id = p_tenant_id AND user_email = v_email;

  /*
   * Los grants se van con la membresía.
   *
   * GARDEN los borraba también (crm/memberships.ts:74) y hacía bien: sin
   * membresía el middleware ya niega la entrada, así que dejarlos es inerte —
   * pero es inerte hasta que alguien reinvita a esa persona y se encuentra con
   * los permisos de su etapa anterior, que nadie recuerda haber dado.
   */
  DELETE FROM app.area_grants WHERE tenant_id = p_tenant_id AND user_email = v_email;

  /*
   * Y también sus invitaciones, incluidas las ya aceptadas.
   *
   * La pendiente, porque una invitación viva a alguien que acabas de sacar es
   * una puerta abierta. La aceptada, porque `UNIQUE (tenant_id, email)` la
   * dejaría bloqueando una reinvitación futura de la misma persona — y el
   * rastro de quién entró y cuándo ya vive en `app.tenant_events`, que es
   * donde debe vivir.
   */
  DELETE FROM app.invitations WHERE tenant_id = p_tenant_id AND email = v_email;

  INSERT INTO app.tenant_events (tenant_id, type, payload)
  VALUES (p_tenant_id, 'member_removed', jsonb_build_object('email', v_email));

  RETURN true;
END;
$$;

COMMENT ON FUNCTION app.remove_member(uuid, text) IS
  'Baja de un miembro con sus grants e invitaciones pendientes. Niega quitar al dueño.';
