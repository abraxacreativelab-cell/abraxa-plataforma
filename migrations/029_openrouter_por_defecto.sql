-- ═══════════════════════════════════════════════════════════════════════════
--  029_openrouter_por_defecto.sql — H3
--
--  OPENROUTER ES EL PROVEEDOR POR DEFECTO. Decisión de Santiago, 2026-08-01.
--
--  EL DEFECTO QUE CIERRA, medido en producción:
--
--  La migración 020 declaró `provider text NOT NULL DEFAULT 'anthropic'`
--  (020_agent_definitions.sql:32). Todo tenant nuevo nacía con su agente maestro
--  apuntando a Anthropic — y NO existe `ANTHROPIC_API_KEY`, a propósito, porque
--  todo el tráfico del sistema sale por OpenRouter. Resultado, en el PRIMER
--  mensaje del Ritual de CADA invitado:
--
--      502 PROVIDER_ERROR — "No hay llave para 'anthropic'"
--
--  Y no había override global: el proveedor sale EXCLUSIVAMENTE de la fila del
--  agente, así que la única cura era editar la fila a mano, tenant por tenant.
--  Con un evento de varios invitados eso no es una cura, es una carrera perdida.
--
--  ── Por qué el modelo se TRADUCE y no se copia ────────────────────────────
--
--  Cambiar sólo `provider` y dejar el id sin prefijo produce exactamente la
--  combinación inválida que la 027 vino a prohibir: `provider='openrouter'` con
--  un id de Anthropic es un 400 «not a valid model ID» del proveedor, a media
--  corrida y en la cara del cliente final. Cada proveedor nombra al mismo modelo
--  distinto, y el par (provider, model) es UNA sola decisión:
--
--      anthropic   claude-haiku-4-5              sin prefijo, guiones
--      openrouter  anthropic/claude-haiku-4.5    vendor/modelo, puntos
--
--  Si esta migración escribiera el par roto, `agent_definitions_provider_model_ck`
--  (027) la abortaría entera — que es la restricción haciendo su trabajo, pero un
--  despliegue fallido a media madrugada no es la forma de enterarse. Por eso
--  traduce, y por eso el pre-vuelo de abajo revisa ANTES de escribir.
--
--  ── Los dos modelos tienen PRECIO, y eso no es un detalle ─────────────────
--
--  Verificado contra app.model_pricing el 2026-08-01:
--      openrouter  anthropic/claude-sonnet-5    $3 / $15 por Mtok
--      openrouter  anthropic/claude-haiku-4.5   $1 / $5  por Mtok
--
--  Un par sin precio cae en `cost_source='unpriced'`, y aunque la 026 ya le puso
--  el piso conservador a `budgeted_usd`, el número que el cliente concilia con su
--  factura se iría a 0. Migrar a un modelo sin precio habría cambiado un defecto
--  ruidoso (502) por uno callado (contabilidad muda).
--
--  La contraparte en código es `A_OPENROUTER` en
--  packages/agents/src/definitions/defaults.ts, que falla RUIDOSO ante un modelo
--  sin traducción en vez de inventarle un id.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- Pre-vuelo: decir la verdad sobre lo que hay ANTES de tocarlo.
--
-- Si existe una fila con un modelo de Anthropic que esta migración no sabe
-- traducir, migrarla a 'openrouter' produciría un par que el CHECK rechaza —o,
-- peor, uno que el CHECK acepta y el proveedor no—. Falla aquí, nombrando la
-- fila, en vez de reventar veinte líneas más abajo con un mensaje que no dice
-- cuál.
-- ───────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  rotas text;
  cuantas int;
BEGIN
  SELECT count(*), string_agg(format('tenant=%s role=%s model=%s', tenant_id, role, model), E'\n      ')
    INTO cuantas, rotas
  FROM app.agent_definitions
  WHERE provider = 'anthropic'
    AND model NOT IN ('claude-sonnet-5', 'claude-haiku-4-5');

  IF cuantas > 0 THEN
    RAISE EXCEPTION E'Hay % definicion(es) en Anthropic con un modelo que esta migración no sabe traducir a OpenRouter:\n      %\n\n  Agrega su equivalente a A_OPENROUTER (packages/agents/src/definitions/defaults.ts),\n  siembra su precio en app.model_pricing, y añade su par aquí. Migrarla a ciegas daría\n  un 400 ''not a valid model ID'' en la cara del cliente final, o un costo sin precio.',
      cuantas, rotas;
  END IF;
END
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Lo que ya existe: traducido, no reetiquetado.
--    El WHERE por modelo es lo que garantiza que el par resultante sea válido.
-- ───────────────────────────────────────────────────────────────────────────
UPDATE app.agent_definitions
   SET provider = 'openrouter',
       model    = 'anthropic/claude-sonnet-5'
 WHERE provider = 'anthropic'
   AND model    = 'claude-sonnet-5';

UPDATE app.agent_definitions
   SET provider = 'openrouter',
       model    = 'anthropic/claude-haiku-4.5'
 WHERE provider = 'anthropic'
   AND model    = 'claude-haiku-4-5';

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Lo que nazca de aquí en adelante.
--
--    El DEFAULT de la columna es la última red: el código ya manda `provider`
--    explícito en cada semilla (defaults.ts), pero un INSERT a mano, un script
--    de importación o un carril futuro que olvide la columna caerían en él. Que
--    apunte a un proveedor sin llave es precisamente cómo nació este defecto.
--
--    NO se le pone DEFAULT a `model`: el id correcto depende del rol, y un
--    default de modelo sería una segunda lista que se desincroniza con
--    DEFAULT_MODEL_BY_ROLE. La columna sigue exigiendo valor explícito.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE app.agent_definitions
  ALTER COLUMN provider SET DEFAULT 'openrouter';

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Verificación dentro de la misma transacción.
--    Si algo quedó apuntando a un proveedor sin llave, se revierte todo.
-- ───────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  huerfanas int;
  sin_precio int;
BEGIN
  SELECT count(*) INTO huerfanas
  FROM app.agent_definitions WHERE provider = 'anthropic';

  IF huerfanas > 0 THEN
    RAISE EXCEPTION 'Quedaron % definicion(es) en provider=''anthropic'', que no tiene llave. La migración se revierte.', huerfanas;
  END IF;

  -- Todo par vigente tiene que tener precio, o el costo que ve el cliente sale
  -- en 0 y el tope se apoya sólo en el piso conservador de la 026.
  SELECT count(*) INTO sin_precio
  FROM app.agent_definitions d
  WHERE NOT EXISTS (
    SELECT 1 FROM app.model_pricing p
     WHERE p.provider = d.provider AND p.model = d.model
  );

  IF sin_precio > 0 THEN
    RAISE EXCEPTION 'Hay % definicion(es) cuyo par (provider, model) no tiene fila en app.model_pricing. El costo saldría en 0. La migración se revierte.', sin_precio;
  END IF;
END
$$;

COMMENT ON COLUMN app.agent_definitions.provider IS
  'Quién atiende la llamada. Por defecto ''openrouter'' desde la 029 (2026-08-01): '
  'todo el tráfico del sistema sale por ahí y no existe ANTHROPIC_API_KEY. El '
  'dialecto del id de `model` DEPENDE de esta columna — ver '
  'agent_definitions_provider_model_ck (027).';
