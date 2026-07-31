-- ═══════════════════════════════════════════════════════════════════════════
--  025_pricing_sonnet_4_6.sql — H3
--
--  EL HUECO QUE CIERRA ESTE ARCHIVO.
--
--  `claude-sonnet-4-6` estaba en el catálogo de capacidades del código
--  (packages/agents/src/capabilities.ts) y NO tenía fila en app.model_pricing.
--  Verificado contra la base de producción el 2026-07-31: seis modelos en el
--  catálogo, cinco con precio.
--
--  Ese hueco de una sola fila APAGABA EL TOPE DE GASTO de la empresa que lo
--  usara. La cadena, entera:
--
--    pricing.lookup() → null
--      → calcularCosto() devolvía cost_usd 0 con cost_source='unpriced'
--        → gastoDesde() sumaba 0
--          → verificarPresupuesto() comparaba 0 contra el tope
--            → SIEMPRE dejaba pasar
--
--  Un tenant de plan free ($5.00/mes, migración 024) podía quemar cientos de
--  dólares reales —Sonnet 4.6 factura $3/$15 por Mtok— mientras
--  `GET /agents/budget` reportaba gastadoUsd = 0 y restanteUsd = 5. La única
--  señal era un log.warn por corrida.
--
--  Esta migración tapa la fila que faltaba. Lo que impide que el hueco vuelva a
--  abrirse son las otras dos piezas del mismo PR, porque una semilla se olvida
--  y una prueba no:
--
--    · packages/agents/src/pricing/seeds.test.ts cruza modelosConocidos() con
--      las semillas de ESTE directorio y ROMPE EL BUILD si falta alguna. Corre
--      en `npm test`, o sea en CI, y sin base.
--    · packages/agents/src/pricing/compute.ts registra un PISO conservador en
--      usage_ledger.budgeted_usd para todo lo que caiga en 'unpriced', de modo
--      que ni un precio faltante ni un modelo desconocido dejen ciego al tope.
--
--  ── LA MENTIRA DE LA 021 Y LA 023, Y POR QUÉ SE CORRIGE AQUÍ ──────────────
--
--  Las dos afirman por escrito que esa prueba YA EXISTÍA:
--
--    021, encabezado:  «…se registra igual, y una prueba del paquete rompe el
--                       build. Un precio que falta es ruidoso, no silencioso.»
--    023, COMMENT ON cost_source:
--                      «…se registró en 0 y una prueba del paquete falla.»
--
--  Era falso. `capabilities.test.ts` sólo valida campos internos del catálogo y
--  nunca lo cruza con `model_pricing`; `bin/check-pricing.ts` sí lo detectaría
--  pero no estaba cableado a ningún script ni a CI. Un comentario que promete
--  un guardián inexistente es PEOR que no tener guardián: hace que nadie lo
--  busque. Eso es lo que dejó a `claude-sonnet-4-6` meses sin precio.
--
--  Lo correcto sería borrar esas dos líneas de sus archivos. **No se puede**, y
--  no por disciplina sino por mecánica: la 021 y la 023 ya están aplicadas en
--  producción, y `scripts/migrate.mjs:88-98` compara el checksum de cada
--  migración aplicada contra el archivo. Cambiar un solo byte de cualquiera de
--  las dos aborta `npm run migrate` ENTERO —«una migración aplicada es historia,
--  no borrador»— y con él estas tres migraciones nuevas. El arreglo del tope se
--  quedaría sin desplegar por corregir un comentario.
--
--  Así que la corrección va donde sí llega:
--
--    · el COMMENT ON de abajo PISA el texto de la 021 en la base viva, y el de
--      la 026 pisa el de `cost_source` de la 023. En el esquema desplegado —que
--      es lo que alguien consulta con \d+— la afirmación falsa deja de existir.
--    · packages/agents/README.md y el encabezado de seeds.test.ts lo dicen con
--      todas sus letras, con el nombre del archivo y el número de línea.
--
--  Queda un residuo consciente: el TEXTO de migrations/021 y /023 sigue
--  mintiendo en el repositorio. Es historia inmutable por diseño, y ésta es la
--  nota que la desmiente.
-- ═══════════════════════════════════════════════════════════════════════════

-- Precio de lista de Anthropic al 2026-07-31, mismo esquema de multiplicadores
-- que la 021: escritura de caché 1.25× a 5 min y 2× a 1 h, lectura 0.1×.
--
-- `effective_from` es 2026-01-01 y no hoy a propósito: el modelo ya existía y
-- ya se podía configurar, así que las corridas anteriores a esta migración
-- tienen que poder RECALCULARSE con el precio que de verdad estaba vigente.
-- Los tokens crudos siguen en el ledger justo para eso.
INSERT INTO app.model_pricing
  (provider, model, input_per_mtok, output_per_mtok,
   cache_write_5m_per_mtok, cache_write_1h_per_mtok, cache_read_per_mtok,
   effective_from, source)
VALUES
  ('anthropic', 'claude-sonnet-4-6', 3.00, 15.00, 3.75, 6.00, 0.30,
   DATE '2026-01-01', 'lista Anthropic 2026-07-31; faltaba desde la 021')
ON CONFLICT (provider, model, effective_from) DO NOTHING;


-- ───────────────────────────────────────────────────────────────────────────
-- Recálculo hacia atrás.
--
-- Es la promesa que la 021 y la 023 hacen por escrito —"un precio equivocado se
-- corrige y el costo se RECALCULA"— y aquí se cumple por primera vez. Sin esto,
-- las corridas de Sonnet 4.6 anteriores a hoy se quedarían en 0 para siempre y
-- la promesa sería decorativa.
--
-- Se recalcula sólo lo que está marcado 'unpriced' de ESE modelo: nada que ya
-- tenga precio o costo del proveedor se toca.
-- ───────────────────────────────────────────────────────────────────────────
UPDATE app.usage_ledger l
SET
  cost_usd = round(
    (l.input_tokens            * p.input_per_mtok
   + l.output_tokens           * p.output_per_mtok
   + l.cache_read_tokens       * p.cache_read_per_mtok
   + l.cache_write_5m_tokens   * p.cache_write_5m_per_mtok
   + l.cache_write_1h_tokens   * p.cache_write_1h_per_mtok) / 1000000.0, 6),
  cost_source = 'priced',
  pricing_id  = p.id
FROM app.model_pricing p
WHERE p.provider = 'anthropic'
  AND p.model    = 'claude-sonnet-4-6'
  AND p.effective_from = DATE '2026-01-01'
  AND l.provider = 'anthropic'
  AND l.model    = 'claude-sonnet-4-6'
  AND l.cost_source = 'unpriced';

COMMENT ON TABLE app.model_pricing IS
  'Precio por millón de tokens, versionado por fecha. Existe porque la API de '
  'Anthropic devuelve tokens, no dinero. El ledger guarda los tokens crudos, '
  'así que un precio equivocado se corrige y el costo se RECALCULA. Que un '
  'modelo del catálogo de capabilities.ts tenga fila aquí lo verifica '
  'packages/agents/src/pricing/seeds.test.ts, que rompe el build si falta.';
