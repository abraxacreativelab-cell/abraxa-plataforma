-- ═══════════════════════════════════════════════════════════════════════════
--  011_provision.sql — H2
--
--  El alta completa de un cliente, en UNA transacción.
--
--  ── Por qué esto es SQL y no TypeScript ───────────────────────────────────
--
--  El criterio #1 del handoff pide todo-o-nada sobre cinco escrituras. Eso no
--  se puede hacer con supabase-js: PostgREST no expone transacciones, cada
--  `.insert()` es su propia unidad y no hay BEGIN que las agrupe. El seed de
--  GARDEN hace exactamente esas cinco llamadas sueltas, y si truena en la
--  tercera deja un tenant sin membresía: una empresa a la que su propio dueño
--  no puede entrar.
--
--  El cuerpo de una función de Postgres ES una transacción. Aquí la
--  atomicidad no se implementa: se hereda. No hay forma de escribir mal el
--  rollback porque no hay rollback que escribir.
--
--  ── Errores que devuelve ──────────────────────────────────────────────────
--
--    ABX01  el slug ya existe y su dueño es otro   → CONFLICT (409)
--    ABX02  entrada inválida                        → VALIDATION (422)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION app.provision_tenant(
  p_slug          text,
  p_name          text,
  p_owner_email   text,
  p_industry_type text DEFAULT NULL,
  p_plan          text DEFAULT 'free'
)
RETURNS TABLE (tenant_id uuid, created boolean)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
-- `tenant_id` es a la vez columna y nombre de salida de esta función. Ver la
-- explicación larga en 012_invitations.sql: sin esto, el día que alguien
-- agregue aquí un ON CONFLICT que lo mencione, la función revienta con 42702.
#variable_conflict use_column
DECLARE
  v_slug   text := lower(btrim(coalesce(p_slug, '')));
  v_email  text := lower(btrim(coalesce(p_owner_email, '')));
  v_name   text := btrim(coalesce(p_name, ''));
  v_plan   text := lower(btrim(coalesce(p_plan, 'free')));
  v_id     uuid;
  v_owner  text;
BEGIN
  -- ── Validación ───────────────────────────────────────────────────────────
  -- Se valida aquí y no sólo en zod porque esta función es una puerta pública
  -- del schema: H10 la llama desde un webhook y el día que alguien la invoque
  -- desde psql tiene que fallar igual.

  IF v_slug = '' THEN
    RAISE EXCEPTION 'El slug es obligatorio.' USING ERRCODE = 'ABX02';
  END IF;
  IF v_name = '' THEN
    RAISE EXCEPTION 'El nombre de la empresa es obligatorio.' USING ERRCODE = 'ABX02';
  END IF;
  IF NOT app.es_correo(v_email) THEN
    RAISE EXCEPTION 'Correo del dueño inválido: %', v_email USING ERRCODE = 'ABX02';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app.plans WHERE id = v_plan AND active) THEN
    RAISE EXCEPTION 'El plan "%" no existe en el catálogo.', v_plan USING ERRCODE = 'ABX02';
  END IF;

  -- ── 0. ¿Ya existe? ───────────────────────────────────────────────────────
  --
  -- Idempotencia por slug: H10 reintenta un webhook de Stripe y no puede
  -- quedar con dos empresas.
  --
  -- Pero idempotente significa "misma entrada, mismo resultado", NO "cualquier
  -- entrada, lo que haya". Si el slug existe y su dueño es otro, devolver el
  -- tenantId le entregaría a quien acaba de pagar una empresa ajena — y H10,
  -- que confía en esta respuesta, le daría acceso. Eso es el mismo agujero que
  -- el criterio #3 cierra, entrando por la puerta de atrás. Por eso: conflicto.

  SELECT t.id INTO v_id FROM app.tenants t WHERE t.slug = v_slug;

  IF FOUND THEN
    SELECT m.user_email INTO v_owner
      FROM app.memberships m
     WHERE m.tenant_id = v_id AND m.role = 'owner';

    IF v_owner IS DISTINCT FROM v_email THEN
      RAISE EXCEPTION 'El slug "%" ya está tomado por otra empresa.', v_slug
        USING ERRCODE = 'ABX01';
    END IF;

    RETURN QUERY SELECT v_id, false;
    RETURN;
  END IF;

  -- ── 1. El usuario ────────────────────────────────────────────────────────
  -- Primero la persona: `app.memberships` tiene una FK hacia aquí (migración
  -- 010) y el orden importa. Es la misma secuencia que GARDEN resolvió bien
  -- en crm/memberships.ts:51-56.

  INSERT INTO app.users (email, name)
  VALUES (v_email, nullif(btrim(coalesce(p_name, '')), ''))
  ON CONFLICT (email) DO UPDATE
    SET name = coalesce(app.users.name, excluded.name),
        updated_at = now();

  -- ── 2. La empresa ────────────────────────────────────────────────────────
  --
  -- Dos altas simultáneas con el mismo slug llegan las dos hasta aquí: el
  -- SELECT de arriba no bloquea nada. Gana una por la restricción única y la
  -- otra cae al handler, que relee y aplica la MISMA regla de dueño. Sin esto,
  -- dos webhooks de Stripe en paralelo — que es justo como Stripe reintenta —
  -- devolverían un error 500 en vez de ser idempotentes.

  BEGIN
    INSERT INTO app.tenants (slug, name, industry_type, plan)
    VALUES (v_slug, v_name, nullif(btrim(coalesce(p_industry_type, '')), ''), v_plan)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT t.id INTO v_id FROM app.tenants t WHERE t.slug = v_slug;

    SELECT m.user_email INTO v_owner
      FROM app.memberships m
     WHERE m.tenant_id = v_id AND m.role = 'owner';

    IF v_owner IS DISTINCT FROM v_email THEN
      RAISE EXCEPTION 'El slug "%" ya está tomado por otra empresa.', v_slug
        USING ERRCODE = 'ABX01';
    END IF;

    RETURN QUERY SELECT v_id, false;
    RETURN;
  END;

  -- ── 3. La membresía de dueño ─────────────────────────────────────────────

  INSERT INTO app.memberships (tenant_id, user_email, role)
  VALUES (v_id, v_email, 'owner');

  -- ── 4. Acceso total al dueño ─────────────────────────────────────────────
  --
  -- El comodín `'*'` es el mismo que resuelve `hasArea()` (portado de GARDEN).
  -- El RBAC además le da acceso total a `owner` por su rol, sin leer la tabla;
  -- esta fila existe para que el permiso se VEA en la base y para que el panel
  -- de permisos no muestre al dueño sin accesos.

  INSERT INTO app.area_grants (tenant_id, user_email, area_slug, access)
  VALUES (v_id, v_email, '*', 'admin');

  -- ── 5. El evento ─────────────────────────────────────────────────────────
  --
  -- Dentro de la transacción a propósito. H11 siembra las áreas del giro
  -- escuchando esto; si el evento viviera en memoria y el proceso muriera
  -- entre el COMMIT y el emit, existiría una empresa que nunca recibe sus
  -- áreas y nadie se enteraría.

  INSERT INTO app.tenant_events (tenant_id, type, payload)
  VALUES (
    v_id,
    'tenant_provisioned',
    jsonb_build_object(
      'tenantId',     v_id,
      'slug',         v_slug,
      'name',         v_name,
      'ownerEmail',   v_email,
      'industryType', nullif(btrim(coalesce(p_industry_type, '')), ''),
      'plan',         v_plan
    )
  );

  RETURN QUERY SELECT v_id, true;
END;
$$;

COMMENT ON FUNCTION app.provision_tenant(text, text, text, text, text) IS
  'Alta completa de un cliente en una sola transacción: usuario → empresa → membresía owner '
  '→ grants totales → plan, más el evento tenant_provisioned en el outbox. '
  'Idempotente por slug SÓLO si el dueño coincide; si no, ABX01 (conflicto).';
