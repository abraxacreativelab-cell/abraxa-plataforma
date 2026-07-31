-- ═══════════════════════════════════════════════════════════════════════════
--  021_model_pricing.sql — H3
--
--  POR QUÉ ESTA TABLA EXISTE.
--
--  El handoff pide "leer el costo REAL de la respuesta de la API". La Messages
--  API de Anthropic no devuelve dinero: devuelve `usage` con conteos de tokens.
--  El precio por token tiene que vivir en algún lado, y si vive en TypeScript
--  volvemos a tener el bug de GARDEN nada más que en otro archivo.
--
--  El bug de GARDEN, verificado (src/services/openrouter.ts:83-100): una tabla
--  de 8 modelos, escrita a mano, con un fallback SILENCIOSO de
--  {input: 1.0, output: 3.0} para cualquier modelo que no esté en la lista. Y
--  las entradas que sí están, están mal: claude-opus-4.6 figura a $15/$75
--  cuando cuesta $5/$25. Tres veces el precio real, sin una sola alarma.
--
--  Aquí el reparto es:
--    · lo REAL son los tokens        → leídos de la respuesta, jamás estimados
--    · el PRECIO es un dato          → esta tabla, versionada por fecha
--    · el COSTO es una proyección    → recalculable, porque el ledger guarda
--                                      los tokens crudos (ver 023)
--
--  Y un modelo sin precio NO se cobra a un número inventado: se marca
--  `cost_source = 'unpriced'` con costo 0, se registra igual, y una prueba del
--  paquete rompe el build. Un precio que falta es ruidoso, no silencioso.
-- ═══════════════════════════════════════════════════════════════════════════

-- tenantless: catálogo de precios de la plataforma. Es el mismo para todos los
-- clientes; no es dato de ninguno.
CREATE TABLE app.model_pricing (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider                 text NOT NULL CHECK (provider IN ('anthropic','openrouter','local')),
  model                    text NOT NULL,

  -- USD por millón de tokens. numeric, no float: el dinero no se redondea a
  -- gusto del binario.
  input_per_mtok           numeric(12,6) NOT NULL,
  output_per_mtok          numeric(12,6) NOT NULL,

  -- Escribir en caché cuesta MÁS que el input normal, y depende del TTL:
  -- 1.25× a 5 minutos, 2× a 1 hora. Leer del caché cuesta 0.1×.
  -- Con una sola columna de "cache_write" el costo sale mal para el TTL largo,
  -- por eso van separadas.
  cache_write_5m_per_mtok  numeric(12,6) NOT NULL,
  cache_write_1h_per_mtok  numeric(12,6) NOT NULL,
  cache_read_per_mtok      numeric(12,6) NOT NULL,

  currency                 text NOT NULL DEFAULT 'USD',

  -- Un precio que cambia no pisa al anterior: se agrega una fila nueva. Así el
  -- costo de una llamada de hace dos meses se sigue pudiendo reconstruir con
  -- el precio que de verdad estaba vigente ese día.
  effective_from           date NOT NULL,

  source                   text,
  created_at               timestamptz NOT NULL DEFAULT now(),

  UNIQUE (provider, model, effective_from)
);

CREATE INDEX model_pricing_lookup_idx
  ON app.model_pricing (provider, model, effective_from DESC);

ALTER TABLE app.model_pricing ENABLE ROW LEVEL SECURITY;


-- ───────────────────────────────────────────────────────────────────────────
-- Semilla. Precios de lista de Anthropic al 2026-07-30.
--
-- Las columnas de caché no se teclean: son el input por su multiplicador
-- (1.25× / 2× / 0.1×). Se dejan escritas y no calculadas para que una fila
-- siga siendo legible sola, sin tener que conocer la regla.
-- ───────────────────────────────────────────────────────────────────────────
INSERT INTO app.model_pricing
  (provider, model, input_per_mtok, output_per_mtok,
   cache_write_5m_per_mtok, cache_write_1h_per_mtok, cache_read_per_mtok,
   effective_from, source)
VALUES
  -- ── Anthropic ────────────────────────────────────────────────────────────
  ('anthropic', 'claude-opus-5',    5.00, 25.00,  6.25, 10.00, 0.50, DATE '2026-01-01', 'lista Anthropic 2026-07-30'),
  ('anthropic', 'claude-opus-4-8',  5.00, 25.00,  6.25, 10.00, 0.50, DATE '2026-01-01', 'lista Anthropic 2026-07-30'),
  ('anthropic', 'claude-fable-5',  10.00, 50.00, 12.50, 20.00, 1.00, DATE '2026-01-01', 'lista Anthropic 2026-07-30'),
  ('anthropic', 'claude-haiku-4-5', 1.00,  5.00,  1.25,  2.00, 0.10, DATE '2026-01-01', 'lista Anthropic 2026-07-30'),

  -- Sonnet 5 trae precio introductorio hasta el 2026-08-31. En vez de dejarlo
  -- en un comentario que nadie va a leer el 1 de septiembre, van las DOS filas:
  -- el resolver toma la vigente por fecha y el precio sube solo.
  ('anthropic', 'claude-sonnet-5',  2.00, 10.00,  2.50,  4.00, 0.20, DATE '2026-01-01', 'precio introductorio, vigente hasta 2026-08-31'),
  ('anthropic', 'claude-sonnet-5',  3.00, 15.00,  3.75,  6.00, 0.30, DATE '2026-09-01', 'precio de lista tras el introductorio'),

  -- ── OpenRouter ───────────────────────────────────────────────────────────
  -- Estos son RESPALDO. OpenRouter sí reporta el costo real de la llamada
  -- (`usage: {include: true}` → `usage.cost`), y cuando lo hace se registra
  -- con cost_source='provider' y estas filas ni se consultan. Sirven para que
  -- una llamada sin costo reportado no caiga en 'unpriced'.
  ('openrouter', 'anthropic/claude-haiku-4.5',  1.00,  5.00, 1.25, 2.00, 0.10, DATE '2026-01-01', 'respaldo; OpenRouter reporta costo real'),
  ('openrouter', 'anthropic/claude-sonnet-5',   3.00, 15.00, 3.75, 6.00, 0.30, DATE '2026-01-01', 'respaldo; OpenRouter reporta costo real'),
  ('openrouter', 'deepseek/deepseek-chat',      0.14,  0.28, 0.18, 0.28, 0.014, DATE '2026-01-01', 'respaldo; OpenRouter reporta costo real'),
  ('openrouter', 'google/gemini-2.5-flash',     0.15,  0.60, 0.19, 0.30, 0.015, DATE '2026-01-01', 'respaldo; OpenRouter reporta costo real');

COMMENT ON TABLE app.model_pricing IS
  'Precio por millón de tokens, versionado por fecha. Existe porque la API de '
  'Anthropic devuelve tokens, no dinero. El ledger guarda los tokens crudos, '
  'así que un precio equivocado se corrige y el costo se RECALCULA.';
