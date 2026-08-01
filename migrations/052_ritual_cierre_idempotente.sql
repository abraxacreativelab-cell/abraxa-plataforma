-- ═══════════════════════════════════════════════════════════════════════════
--  052_ritual_cierre_idempotente.sql — H7 · que la fase 6 corra UNA vez
--
--  ── EL DEFECTO, EN UNA LÍNEA ──────────────────────────────────────────────
--
--  `cerrar()` no era idempotente, y la única bandera que impedía volver a
--  entrar —`status='completada'`— se escribía DESPUÉS de todos sus efectos.
--
--  El turno que cierra la fase 5 commitea `phase='sintesis'` con
--  `status='activa'`, y sólo entonces empieza la fase 6: guardar el blueprint,
--  sembrar el giro, mandar el documento madre a la bóveda y correr el modelo
--  OTRA VEZ para narrar el mapa. Entre 5 y 30 segundos en los que la fila le
--  dice a quien pregunte que el Ritual sigue activo.
--
--  Quien caiga en esa ventana pasa el guardia, no choca con el lock optimista
--  —la primera petición ya escribió, así que la segunda lee un `turns` limpio—
--  y como `siguienteFase('sintesis')` es null se queda en 'sintesis' y vuelve a
--  entrar a la fase 6 completa.
--
--  El disparador no es hipotético: es el producto. El BFF corta a los 90 s
--  —y el turno más lento del Ritual es justo el único que puede tardar tanto—
--  y le dice a la emprendedora «vuelve a mandar tu mensaje». Reenviar es un
--  click, y ese click cae dentro de la ventana.
--
--  ── LAS CUATRO PIEZAS DE ESTE ARCHIVO ─────────────────────────────────────
--
--  Tres cierran la ventana y una la hace irrelevante. La cuarta es la que de
--  verdad importa: aunque el guardia falle, el efecto no se duplica.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- 1. `cerrando`: el estado que la 050 no tenía y que faltaba nombrar.
--
-- La 050 modeló tres estados —activa, pausada, completada— y con eso describía
-- todo el Ritual MENOS el minuto que tarda en cerrarse. Ese minuto existía en
-- el tiempo pero no en los datos, así que se veía igual que 'activa'.
--
-- Ahora se escribe en el MISMO UPDATE que lleva la fase a 'sintesis', antes de
-- que ocurra un solo efecto de la fase 6. No hay hueco entre "entré a cerrar" y
-- "está anotado que entré".
--
-- Y es un ARRENDAMIENTO, no una lápida: `updated_at` dice desde cuándo, y un
-- cierre que se murió a media fase 6 se puede retomar cuando vence. Un candado
-- que nadie puede soltar convierte una caída en un Ritual muerto para siempre
-- — que es exactamente el modo permanente que este archivo viene a evitar.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE app.onboarding_sessions
  DROP CONSTRAINT IF EXISTS onboarding_sessions_status_check;

ALTER TABLE app.onboarding_sessions
  ADD CONSTRAINT onboarding_sessions_status_check
  CHECK (status IN ('activa','pausada','cerrando','completada'));

COMMENT ON COLUMN app.onboarding_sessions.status IS
  'activa | pausada | cerrando | completada. `cerrando` es la fase 6 en curso: '
  'se escribe en el mismo UPDATE que pone phase=''sintesis'', antes de cualquier '
  'efecto, y bloquea la re-entrada. Funciona como arrendamiento — si el proceso '
  'se cae, vence por updated_at y el cierre se retoma (es idempotente).';

-- ───────────────────────────────────────────────────────────────────────────
-- 2. `last_turn_id`: distinguir el ENVÍO, no la versión de la fila.
--
-- El lock optimista por `turns` protege escrituras CONCURRENTES. No protege
-- reintentos SECUENCIALES, y no puede: el reintento lee la versión que la
-- primera petición ya dejó escrita y pasa limpio.
--
-- Eso es exactamente lo que produce el 504 del BFF. El abort corta el socket
-- BFF→API y nada más —el handler de Express sigue vivo, termina y COMMITEA—,
-- pero la pantalla ya le pidió a la emprendedora que reenviara. Su frase entra
-- dos veces y el agente le contesta dos cosas distintas a lo mismo.
--
-- El navegador genera un id por ENVÍO y lo conserva mientras ese mensaje no
-- aterrice: un reenvío del mismo texto trae el mismo id. Si el id que llega ya
-- es el último aplicado, se devuelve la foto vigente sin reprocesar nada.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE app.onboarding_sessions
  ADD COLUMN IF NOT EXISTS last_turn_id uuid;

COMMENT ON COLUMN app.onboarding_sessions.last_turn_id IS
  'Id del último ENVÍO aplicado, generado por el navegador. Llave de '
  'idempotencia del turno: un reenvío con el mismo id devuelve la foto vigente '
  'en vez de volver a correr el modelo y volver a escribir el mensaje.';

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Un blueprint por Ritual. La defensa que no depende de que el guardia sirva.
--
-- La 051 dejó `UNIQUE (tenant_id, version)` y documentó la re-síntesis: «el
-- emprendedor corrige un dato y pide el mapa otra vez». Esa puerta nunca se
-- abrió —`responder()` corta en seco cuando el status es 'completada', así que
-- hoy NO existe camino de producto que produzca una v2— y mientras tanto el
-- único que sabía calcular `version = v1 + 1` era el defecto. La segunda
-- entrada a la fase 6 insertaba v2 sin violar nada.
--
-- Con `UNIQUE (tenant_id, session_id)`, dos cierres del mismo Ritual son un
-- solo mapa por construcción. `guardarBlueprint` atrapa el choque y devuelve el
-- que ya existía, así que el segundo cierre no falla: no hace nada, que es lo
-- que tenía que hacer desde el principio.
--
-- Lo que esto cuesta, dicho en voz alta: si algún día se quiere re-sintetizar
-- de verdad, tendrá que ser una decisión explícita —una sesión nueva, o un
-- `version` pedido a mano— y no el efecto colateral de una carrera. Ése es
-- justamente el intercambio que se está comprando.
--
-- El de-duplicado de abajo es para las filas que el defecto ya pudo dejar
-- escritas. Se conserva la que H11 ya proyectó si la hay, y si no, la de mayor
-- versión — que es la que `blueprintVigente()` devuelve hoy. Así el mapa que el
-- emprendedor tiene en pantalla sigue siendo el mismo después de migrar.
-- ───────────────────────────────────────────────────────────────────────────
WITH ordenados AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY tenant_id, session_id
           ORDER BY (applied_at IS NOT NULL) DESC, version DESC
         ) AS n
    FROM app.onboarding_blueprints
)
DELETE FROM app.onboarding_blueprints b
 USING ordenados o
 WHERE b.id = o.id
   AND o.n > 1;

ALTER TABLE app.onboarding_blueprints
  DROP CONSTRAINT IF EXISTS onboarding_blueprints_una_por_ritual;

ALTER TABLE app.onboarding_blueprints
  ADD CONSTRAINT onboarding_blueprints_una_por_ritual UNIQUE (tenant_id, session_id);

-- ───────────────────────────────────────────────────────────────────────────
-- 4. El acuse de la bóveda: que el documento madre entre UNA vez.
--
-- `VaultPort.ingestDocument()` no recibe llave de idempotencia. No se la puedo
-- agregar: `packages/db/ports.ts` es de H1 y el gate de propiedad falla el PR
-- por tocarlo (la misma razón por la que la 051 declaró un BlueprintSink en vez
-- de escribir en las tablas de H11). Se propone en el PR.
--
-- Así que la llave vive de este lado, que es donde se puede: el blueprint —una
-- fila por Ritual, garantizado arriba— guarda el id del documento que ya se
-- ingirió. Si la columna tiene algo, el documento madre ya entró y no se manda
-- otra vez. Es el mismo patrón de la 023 y la 040: la idempotencia es una fila
-- con UNIQUE, no un SELECT antes de escribir.
--
-- Importa más de lo que parece porque la bóveda no se queja: acepta el segundo
-- documento, H4 le extrae y clasifica LOS MISMOS valores canónicos, y el
-- emprendedor termina con dos «Mi negocio — panadería» sin un solo error que lo
-- delate.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE app.onboarding_blueprints
  ADD COLUMN IF NOT EXISTS vault_document_id text;

COMMENT ON COLUMN app.onboarding_blueprints.vault_document_id IS
  'Acuse de VaultPort.ingestDocument(): el id del documento madre que YA entró '
  'a la bóveda. Lleno = no se vuelve a mandar. La llave de idempotencia vive '
  'aquí y no en la llamada porque el port es de H1 y no lo recibe.';

COMMENT ON TABLE app.onboarding_blueprints IS
  'El Mapa de Negocio que produjo el Ritual: qué áreas necesita el negocio, en '
  'qué estado nace cada una y su roadmap de hitos. UNA fila por Ritual '
  '(UNIQUE tenant_id, session_id): cerrar dos veces no produce dos mapas. '
  'Fuente de verdad de la DECISIÓN; app.tenant_areas (H11) es su proyección '
  'operable. Los que tienen applied_at NULL esperan el BlueprintSink de H11.';
