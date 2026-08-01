-- ═══════════════════════════════════════════════════════════════════════════
--  027_agent_definitions_provider_model.sql — H3
--
--  EL PAR (provider, model) ES UNA SOLA DECISIÓN, Y HASTA HOY NADIE LA VALIDABA.
--
--  La 020 partió el router en dos columnas y le puso CHECK a una sola:
--
--      provider  text CHECK (provider IN ('anthropic','openrouter','local'))
--      model     text                        ← libre, sin CHECK, sin FK
--
--  Cada columna por separado era válida. La COMBINACIÓN no:
--
--      provider = 'openrouter'  +  model = 'claude-haiku-4-5'
--
--  Ese id no existe en OpenRouter —ahí el mismo modelo se llama
--  'anthropic/claude-haiku-4.5'—. La fila entraba sin una queja, y el costo
--  aparecía en el SIGUIENTE mensaje del cliente final: `400 not a valid model
--  ID`, PROVIDER_ERROR NO reintentable, y una conversación muerta por cada
--  mensaje de ese rol hasta que alguien leyera el log.
--
--  Lo peor no era poder escribirla a mano: era que el upsert la FABRICABA SOLO.
--  Cambiar únicamente `provider` heredaba el `model` anterior
--  (repository.ts:139-140), así que un cambio de proveedor de una línea dejaba
--  la fila rota sin que nadie escribiera la combinación.
--
--  Se cierra en las dos capas, porque ninguna basta sola:
--
--    · CÓDIGO (repository.ts): cambiar de proveedor EXIGE modelo explícito, y
--      el par se valida antes del upsert. Es la capa que da un mensaje que se
--      entiende y la que puede evolucionar sin migración.
--    · BASE (este archivo): el invariante estructural. Es la que sobrevive a un
--      psql a mano, a un script de importación y al próximo camino de escritura
--      que alguien agregue sin acordarse de validar.
--
--  ── Por qué un CHECK y no una FK a un catálogo ────────────────────────────
--
--  Una FK (provider, model) contra un app.supported_models sería más estricta y
--  peor: cada modelo nuevo pediría una migración, que es EXACTAMENTE el YAML de
--  disco de GARDEN con otro disfraz — y H3 existe para que estrenar un modelo
--  sea un UPDATE. Lo que sí sabemos con certeza es el DIALECTO de ids de cada
--  proveedor, y eso no caduca:
--
--      anthropic   'claude-haiku-4-5'            sin prefijo de vendor
--      openrouter  'anthropic/claude-haiku-4.5'  siempre 'vendor/modelo'
--      local       lo que el runtime propio use  no lo conocemos; no opinamos
--
--  `local` queda libre a propósito: el día que Santiago corra modelos propios
--  no sabemos si los va a nombrar 'mi-llama' o 'meta-llama/Llama-3-8B', y
--  bloquear hoy una forma que todavía no existe es inventarse un problema.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- Primero, decir la verdad sobre lo que ya hay.
--
-- Si producción tiene filas rotas, ADD CONSTRAINT falla con "check constraint
-- is violated by some row" y no dice cuál — que es la peor forma de enterarse a
-- media madrugada de despliegue. Esto falla igual de fuerte pero nombrando
-- tenant, rol y par, que es lo que se necesita para arreglarlo.
-- ───────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  rotas text;
  cuantas int;
BEGIN
  SELECT count(*), string_agg(format('tenant=%s role=%s %s/%s', tenant_id, role, provider, model), E'\n      ')
    INTO cuantas, rotas
  FROM app.agent_definitions
  WHERE (provider = 'openrouter' AND model NOT LIKE '%/%')
     OR (provider = 'anthropic'  AND model LIKE '%/%');

  IF cuantas > 0 THEN
    RAISE EXCEPTION E'Hay % definicion(es) con una combinación proveedor/modelo que el proveedor rechaza:\n      %\n\n  Corrige el modelo de cada una antes de aplicar esta migración. OpenRouter usa\n  ids ''vendor/modelo'' (anthropic/claude-haiku-4.5); Anthropic los usa sin prefijo\n  (claude-haiku-4-5). Es la misma fila que ya estaba devolviendo 400 en cada mensaje.',
      cuantas, rotas;
  END IF;
END
$$;

-- El `btrim(model) <> ''` de la primera línea no es adorno: sin él, `model = ''`
-- pasaba como id válido de Anthropic (no trae barra) y `model = 'x/'` como id
-- válido de OpenRouter (trae barra). Los dos son 400 del proveedor en el
-- siguiente mensaje del cliente. La contraparte en código es canonizarModelo().
ALTER TABLE app.agent_definitions
  ADD CONSTRAINT agent_definitions_provider_model_ck
  CHECK (
    btrim(model) <> ''
    AND (
         -- OpenRouter: 'vendor/modelo', con las dos mitades no vacías.
         (provider = 'openrouter'
            AND model LIKE '%/%'
            AND split_part(model, '/', 1) <> ''
            AND split_part(model, '/', 2) <> '')
      OR (provider = 'anthropic'  AND model NOT LIKE '%/%')
      OR  provider = 'local'
    )
  );

COMMENT ON CONSTRAINT agent_definitions_provider_model_ck ON app.agent_definitions IS
  'El par (provider, model) es una sola decisión. Cada proveedor nombra al mismo '
  'modelo distinto, y mandarle el id del otro es 400 en cada mensaje del cliente '
  'final. La contraparte en código es dialectoValido() de capabilities.ts.';

COMMENT ON COLUMN app.agent_definitions.model IS
  'Id del modelo EN EL DIALECTO DEL PROVEEDOR de la columna provider. No es texto '
  'libre: lo restringe agent_definitions_provider_model_ck.';
