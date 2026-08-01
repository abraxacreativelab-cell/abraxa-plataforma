-- ═══════════════════════════════════════════════════════════════════════════
--  028_model_pricing_solo_anthropic.sql — H3
--
--  BORRA LAS SEMILLAS QUE HACÍAN PARECER SOPORTADO LO QUE NADIE AUTORIZÓ.
--
--  El ledger de producción tiene corridas contra dos modelos que ningún
--  `agent_definition` declara hoy:
--
--      openrouter · google/gemini-2.5-flash    5 corridas
--      openrouter · deepseek/deepseek-chat     2 corridas
--
--  ── Cómo llegaron ahí ─────────────────────────────────────────────────────
--
--  No fue un fallback: `providers/router.ts` sólo mapea proveedor → adaptador,
--  y no hay ningún default no-Anthropic en el código. El único insumo de la
--  selección es `agent_definitions.model`, que era `text` LIBRE (migración
--  020:34) y que hasta este PR nadie validaba ni al escribir ni al elegir. Una
--  fila tuvo esos modelos, corrió, y después se cambió: `usage_ledger` guarda
--  la historia, `agent_definitions` sólo el presente.
--
--  Lo que convirtió "cualquier cadena" en "estas dos cadenas" fueron ESTAS
--  filas. Son los únicos modelos no-Anthropic nombrados en todo el repositorio,
--  y estar sembradas con precio las hacía parecer una opción soportada — tanto,
--  que el propio `packages/agents` las citaba como razón para dejar pasar ids
--  no-Anthropic. Mientras existan, la siguiente persona que lea el esquema va a
--  concluir, razonablemente, que DeepSeek es una opción de la casa.
--
--  ── Por qué importa más de lo que parece ──────────────────────────────────
--
--  DeepSeek procesa en China. La declaración de tratamiento de datos que se
--  está firmando tiene que enumerar TODOS los países donde se procesan datos de
--  la plataforma, y para una app de mensajería incluir China es rechazo casi
--  seguro. Mientras exista un camino de código que pueda mandar allá la
--  conversación de un cliente, hay que declararlo. Este PR cierra el camino
--  (lista blanca en `providers/allowlist.ts`, aplicada donde se ELIGE el
--  modelo) y esta migración quita lo que lo insinuaba.
--
--  ── Qué pasa con las corridas ya registradas ──────────────────────────────
--
--  `usage_ledger.pricing_id` es `REFERENCES app.model_pricing(id) ON DELETE SET
--  NULL` (023:52), así que las 7 filas históricas NO se pierden ni se tocan:
--  conservan sus tokens crudos, su `cost_usd` y su `cost_source`. Sólo quedan
--  sin el puntero al renglón de precio. Y para estas dos en particular el
--  puntero era decorativo: OpenRouter reporta el costo real de la llamada, así
--  que se registraron con `cost_source = 'provider'` y estas filas ni se
--  consultaron. La evidencia de que las corridas ocurrieron se conserva entera
--  — que es justo lo que hay que poder auditar.
-- ═══════════════════════════════════════════════════════════════════════════

DELETE FROM app.model_pricing WHERE (provider, model) IN (
  ('openrouter', 'deepseek/deepseek-chat'),
  ('openrouter', 'google/gemini-2.5-flash')
);

COMMENT ON TABLE app.model_pricing IS
  'Precio por millón de tokens, versionado por fecha. Existe porque la API de '
  'Anthropic devuelve tokens, no dinero. El ledger guarda los tokens crudos, '
  'así que un precio equivocado se corrige y el costo se RECALCULA. '
  'SÓLO se siembran modelos de la lista blanca de proveedores '
  '(packages/agents/src/providers/allowlist.ts): sembrar un precio es afirmar '
  'que ese proveedor está autorizado a procesar conversaciones de clientes, y '
  'eso hay que declararlo. Que cada semilla esté permitida lo verifica '
  'packages/agents/src/pricing/seeds.test.ts, que rompe el build.';
