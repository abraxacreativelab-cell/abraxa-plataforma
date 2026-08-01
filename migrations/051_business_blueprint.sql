-- ═══════════════════════════════════════════════════════════════════════════
--  051_business_blueprint.sql — H7 · El Mapa de Negocio, persistido
--
--  ── EL HUECO ESTRUCTURAL, Y CÓMO SE RESUELVE ──────────────────────────────
--
--  El §7 del handoff de H7 dice que al cerrar la fase 6 hay que persistir
--  `tenant_areas[]` y `tenant_milestones[]`. Esas dos tablas NO existen: las
--  crea H11 en su migración 090, en la ola 3, y el `AreasPort` de
--  packages/db/ports.ts sólo declara LECTURA (`listAreas`, `unlockArea`) — no
--  hay método para escribirlas.
--
--  Las tres salidas que había:
--
--    a) Crearlas yo. Rompe el contrato de propiedad: son de H11 y su PR
--       chocaría contra el mío en el archivo más importante de su carril.
--    b) Agregarle un método de escritura a AreasPort. ports.ts es de H1 y el
--       gate de propiedad falla el PR. La regla lo dice explícito: anótalo, no
--       lo edites.
--    c) Declarar el contrato en MI carril y programar contra él. Es la regla #5
--       del plan —"programa contra interfaces, nunca contra implementaciones"—
--       aplicada al caso en que la interfaz todavía no existe.
--
--  Se tomó la (c). El Ritual produce un BLUEPRINT: la decisión completa y
--  estructurada de qué áreas necesita el negocio, en qué estado nace cada una y
--  cuál es su roadmap de hitos. Esa decisión es de H7 y vive aquí, en su tabla.
--  Materializarla en `tenant_areas` / `tenant_milestones` es un paso aparte que
--  ejecuta un `BlueprintSink` (packages/onboarding/src/ports/blueprint-sink.ts).
--
--  Mientras H11 no aterrice, el sink registrado es el de archivo: el blueprint
--  queda guardado, íntegro y con `applied_at` en NULL. Cuando H11 llegue,
--  registra su sink y hace UN barrido de los blueprints pendientes — sin
--  entrevistar a nadie otra vez y sin que este archivo cambie.
--
--  El orden importa: la fuente de verdad de lo que el Ritual DECIDIÓ es esta
--  tabla; `tenant_areas` es la proyección operable de esa decisión. Si mañana
--  H11 cambia su mecánica de desbloqueo, se re-proyecta desde aquí. Al revés no
--  se puede: una fila de `tenant_areas` no dice por qué el agente la propuso.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE app.onboarding_blueprints (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  session_id    uuid NOT NULL REFERENCES app.onboarding_sessions(id) ON DELETE CASCADE,

  -- Sube de uno cada vez que se re-sintetiza. El Ritual se puede volver a
  -- cerrar (el emprendedor corrige un dato y pide el mapa otra vez) y la
  -- versión anterior no se pisa: es el registro de qué se le prometió y cuándo.
  version       int NOT NULL DEFAULT 1,

  -- El giro detectado, apuntando a app.industry_templates (H4).
  industry_type text,

  -- [{ slug, label, state, blurb, position, reason, requirements[] }]
  -- `state` usa el vocabulario de AreaState de ports.ts:
  -- bloqueada | disponible | en_progreso | activa.
  areas         jsonb NOT NULL DEFAULT '[]',

  -- [{ areaSlug, title, description, position, origin }]
  -- `origin` distingue lo que el emprendedor pidió de lo que el agente detectó
  -- solo en la fase 4. El criterio #8 del handoff se verifica contando los que
  -- traen origin='abogado_del_diablo'.
  milestones    jsonb NOT NULL DEFAULT '[]',

  -- El resumen en prosa del negocio: el documento madre que se manda a la
  -- bóveda por VaultPort.ingestDocument().
  summary       text NOT NULL DEFAULT '',

  -- ── Materialización ────────────────────────────────────────────────────
  -- NULL = decidido pero todavía no proyectado a las tablas de H11. No es un
  -- error: es el estado normal hasta la ola 3.
  applied_at    timestamptz,
  applied_by    text,
  -- Si el sink falló, el motivo queda escrito. Un blueprint que no se pudo
  -- aplicar no puede desaparecer en un log: es el trabajo de 20 minutos de
  -- entrevista del cliente.
  apply_error   text,

  created_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, version)
);

-- "¿qué blueprints faltan por proyectar?" — la consulta con la que H11 hace su
-- barrido de una sola pasada el día que aterrice.
CREATE INDEX onboarding_blueprints_pendientes_idx
  ON app.onboarding_blueprints (tenant_id, created_at)
  WHERE applied_at IS NULL;

ALTER TABLE app.onboarding_blueprints ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE app.onboarding_blueprints IS
  'El Mapa de Negocio que produjo el Ritual: qué áreas necesita el negocio, en '
  'qué estado nace cada una y su roadmap de hitos. Fuente de verdad de la '
  'DECISIÓN; app.tenant_areas (H11) es su proyección operable. Los que tienen '
  'applied_at NULL están esperando a que H11 registre su BlueprintSink.';

COMMENT ON COLUMN app.onboarding_blueprints.milestones IS
  'Roadmap [{areaSlug,title,description,position,origin}]. origin='
  '''abogado_del_diablo'' marca los hitos que el emprendedor NO pidió y el '
  'agente detectó atacando su proceso en la fase 4.';
