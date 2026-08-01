-- ═══════════════════════════════════════════════════════════════════════════
--  026_usage_ledger_budgeted.sql — H3
--
--  DOS NÚMEROS, PORQUE SIEMPRE FUERON DOS PREGUNTAS.
--
--  La 023 guarda `cost_usd` y lo usa para todo: para reportar el gasto y para
--  aplicar el tope del plan. Funciona mientras haya precio. En cuanto no lo hay
--  —modelo del catálogo sin fila sembrada, modelo nuevo que un cliente puso en
--  su fila, precio borrado por error— el mismo número tiene que ser dos cosas
--  incompatibles a la vez:
--
--    · honesto para la CONTABILIDAD → 0, marcado 'unpriced', porque inventar un
--      precio es el pecado exacto de GARDEN (fallback silencioso de
--      {input:1.0, output:3.0}) y hace imposible distinguir un costo correcto
--      de uno equivocado.
--    · útil para el TOPE            → algo mayor que 0, porque un tope que suma
--      ceros no es un tope.
--
--  Con una sola columna ganaba la contabilidad y el tope quedaba CIEGO: un
--  tenant de plan free podía quemar cientos de dólares con `GET /agents/budget`
--  reportando gastadoUsd = 0. Se separan.
--
--    cost_usd      ¿cuánto costó?          0 y marcado si no hay precio. Como
--                                          los tokens crudos siguen en la fila,
--                                          se recalcula hacia atrás en cuanto
--                                          se capture el precio (lo hace la
--                                          025 para Sonnet 4.6).
--    budgeted_usd  ¿cuánto cuenta al tope? El costo real cuando se conoce; el
--                                          PISO conservador cuando no. No
--                                          pretende ser el costo: es la cota
--                                          que impide que el tope se apague.
--
--  El piso vive en packages/agents/src/pricing/compute.ts (PRECIO_DE_PISO) y es
--  el modelo MÁS CARO del catálogo, Fable 5. Falla hacia caro a propósito:
--  cortarle el servicio de más a un cliente se atiende en una llamada; una
--  factura de $500 en un plan de $5, no.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE app.usage_ledger
  ADD COLUMN IF NOT EXISTS budgeted_usd numeric(12,6);

-- Backfill. Para todo lo ya escrito, lo que cuenta contra el tope es lo que ya
-- se había contado: su costo. No se reinterpreta la historia.
--
-- Las filas históricas marcadas 'unpriced' quedan en 0, y eso es correcto: ese
-- mes ya se cerró con ese número y cambiarlo ahora movería un corte que ya se
-- comunicó. El piso aplica de aquí en adelante. (Las de Sonnet 4.6 sí traen
-- costo real: la 025 las recalculó antes de llegar aquí.)
UPDATE app.usage_ledger
SET budgeted_usd = COALESCE(cost_usd, 0)
WHERE budgeted_usd IS NULL;

-- NOT NULL después del backfill, y con DEFAULT 0 para que un INSERT viejo que
-- todavía no mande la columna no truene. El código la manda siempre
-- (usage-ledger.ts), pero la base no depende de eso.
ALTER TABLE app.usage_ledger
  ALTER COLUMN budgeted_usd SET DEFAULT 0;

ALTER TABLE app.usage_ledger
  ALTER COLUMN budgeted_usd SET NOT NULL;

ALTER TABLE app.usage_ledger
  ADD CONSTRAINT usage_ledger_budgeted_usd_no_negativo CHECK (budgeted_usd >= 0);

-- NO se agrega índice. Se intentó uno `(tenant_id, created_at DESC) INCLUDE
-- (budgeted_usd)` y era peor que inútil: su clave es IDÉNTICA a la de
-- `usage_ledger_tenant_created_idx` de la 023:69-70 —mismas columnas, mismo
-- DESC— así que habría quedado un btree redundante que cada INSERT paga para
-- siempre, y siendo el más ancho por el payload el planeador habría preferido
-- igual el de la 023. Además el INCLUDE no servía: sólo habilita index-only
-- scan, y la consulta real pide también `cost_usd`, que no estaba en el índice.
--
-- La lectura del tope (`leerFilasDelMes`) ya usa el índice de la 023.

COMMENT ON COLUMN app.usage_ledger.budgeted_usd IS
  'Lo que esta corrida cuenta contra el tope del plan. Igual a cost_usd salvo '
  'en cost_source=''unpriced'', donde trae el piso conservador de '
  'PRECIO_DE_PISO (packages/agents/src/pricing/compute.ts). Existe porque '
  'cost_usd tiene que poder ser 0 y honesto sin apagar el presupuesto.';

COMMENT ON COLUMN app.usage_ledger.cost_source IS
  'provider = lo reportó el proveedor (OpenRouter). priced = tokens x app.model_pricing. '
  'unpriced = no había precio vigente; cost_usd quedó en 0 y budgeted_usd trae el piso.';
