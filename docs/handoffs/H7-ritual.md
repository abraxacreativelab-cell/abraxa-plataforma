# H7 — El Ritual de Fundación

> **Ola 2.** Corre en paralelo con H6, H9 y H10 — **H8 se bajó a la Ola 3**, ver `H8-flows.md` §0.
> Requiere H1, H3 y H4 mergeados: **ya lo están, y también H2 y H5.** Lee la §0 antes que nada.
> **Ruta crítica.**
> Rama: `h7-ritual` · Migraciones: `050`–`059`
> Directorios: `packages/onboarding/**` y `apps/web/app/(onboarding)/**`

---

## 0. ESTADO REAL AL 2026-07-31 — léelo antes que nada

Este handoff se escribió cuando el repo no tenía una sola línea de producto. Lo de abajo está
**verificado contra `origin/main` y contra la base real**, no recordado. Donde el resto del
documento y esta sección se contradigan, **manda esta sección**.

### Lo que SÍ está en main

**`origin/main` = `f6affc1e80049396087a1ff507aeeb96770ce326`.**

| Carril | Lo que te dejó — archivos que puedes abrir hoy |
|---|---|
| **H1 · fundación** | `packages/db/ports.ts` (los 8 ports), `packages/db/src/port-registry.ts` (`registerPort` / `usePort` / `tryPort`), `apps/api`, `apps/worker`, el CI y el gate |
| **H3 · agentes** | `packages/agents/src/service.ts`, `loop/agent-loop.ts`, `prompt/compose.ts`, `prompt/cache.ts`, `definitions/repository.ts`, `providers/{anthropic,openrouter,local}.ts`. `AgentPort` **registrado**, con `upsertDefinition()` — el bautizo pasa por ahí |
| **H4 · bóveda** (PR #7) | `packages/vault/src/{values/service,ingest/pipeline,industry/gaps,resolver,agent-inject}.ts`. `VaultPort` **registrado** |
| **H2 · tenancy** (PR #6) | `packages/tenancy/src/services/{provision,memberships,plans}.ts`, `middleware/{tenant,rbac}.ts`. `TenancyPort` **registrado** |
| **H5 · design system** | `packages/ui/src/components/primitives/*`, `shell/app-shell.tsx`, `lib/accent.ts` |
| **H0 · seguridad** (PR #12) | `packages/agents/src/routes.ts` ya no arma el `TenantContext` con el header `x-user-email` crudo |

**La base real ya está migrada** (proyecto Supabase `ievnkmodselrlkazkzoy`):

- **13 migraciones aplicadas** — `001, 010, 011, 012, 020, 021, 022, 023, 024, 030, 031, 032, 033`.
  `npm run migrate` responde **0 pendientes**.
- **19 tablas y `tablas_sin_rls = 0`.** Tus `050`+ se suman a esa cuenta: el gate rechaza toda tabla
  nueva sin `tenant_id` y sin `ENABLE ROW LEVEL SECURITY` **en el mismo archivo**.
- **`app.tenants.industry_type` ya existe** (`migrations/001_foundation.sql:103`), igual que
  `stage` y `settings`. La fase 1 escribe ahí; no agregues la columna.
- **`app.industry_templates` ya existe y trae 5 filas** (migración `033`, de H4). La fase 6 apunta
  a ese catálogo — **no lo dupliques**, léelo por `VaultPort`.
- **`app.agent_definitions` ya existe** (migración `020`). El bautizo del agente crea una fila ahí,
  pero **por `AgentPort.upsertDefinition()`**, no con SQL crudo: el archivo es de H3.
- **`app.tenants` está VACÍA.** No hay datos de prueba de nadie. Si necesitas un tenant, créalo tú:
  `SELECT app.provision_tenant(...)` (migración `011`).

### Lo que NO existe todavía, aunque el documento lo dé por hecho

- `packages/onboarding/src/` tiene **exactamente dos archivos**: `index.ts` y `meta.ts`, los stubs
  de H1. Igual `inbox`, `flows`, `work`, `billing` y `areas`. **Por eso el freno de arranque de
  este handoff mentía**: probaba `test -d packages/vault/src`, y ese directorio existe siempre. El
  freno corregido está en §11.
- **`app.tenant_areas` y `app.tenant_milestones` NO existen.** La §7 las nombra como si estuvieran;
  las creas **tú**, en tu bloque `050`–`059`, y H11 las lee. No esperes a nadie.
- **`apps/web/app/(onboarding)/ritual/page.tsx` YA EXISTE**: es el andamio de H1, con el comentario
  *"ANDAMIO DE H1 — bórralo y escribe lo tuyo"*. Lo reemplazas, no lo creas. El `layout.tsx` del
  grupo también existe.
- **No hay `.env` en el repo** (sólo `.env.example`) y GitHub **no tiene secretos**: no hay
  `ANTHROPIC_API_KEY` ni `OPENROUTER_API_KEY`. Un test que llame a un modelo de verdad **no puede
  correr en CI**. Ver §10.
- No hay protección de rama (repo privado sin GitHub Pro): **el gate de CI es la única ley**, y
  nadie te va a impedir mergear en rojo. No lo hagas.

### Carriles en vuelo mientras lees esto

Al 2026-07-31 hay PRs abiertos y en verde de `h6-inbox` (#10), `h7-ritual` (#8), `h9-work` (#13),
`h10-billing` (#11) y un carril nuevo, `h15-crm` (#9).

**H10 ya no te entrega el login con Google**: esa pieza se movió a un carril de identidad, **H18**
(ver `H10-billing.md` §0). Y hay algo más grande que eso: **hoy no existe sesión de ningún tipo**.
Léelo tú mismo en `apps/web/app/(app)/direccion/_lib/session.ts` — `correoDeLaSesion()` devuelve
`null` a propósito, y las pantallas de H4 muestran un estado honesto en vez de inventarse un
usuario. **No inventes el tuyo, y sobre todo no leas un `x-user-email` del navegador**: eso
convierte el aislamiento entre clientes en una sugerencia, y es exactamente el agujero que H0 ya
cerró una vez (PR #12). El patrón que copias es el de ese archivo: contexto de **desarrollo**
fail-closed (`NODE_ENV !== 'production'` **y** una variable puesta a mano), y cuando H18 aterrice,
un solo lugar que cambiar.

---

## 1. Contexto

Es lo primero que vive un emprendedor en el producto, y lo que decide si se queda.

Entra por su link. Un agente aparece, se presenta, y **le pide que le ponga nombre**. Ese
agente lo entrevista sobre su negocio —a qué se dedica, cómo gana dinero, cómo son sus
procesos, qué le roba tiempo— y al final le entrega su **Mapa de Negocio**: qué áreas necesita,
cuáles ya puede usar hoy, cuáles se desbloquean después y qué le falta para abrirlas.

**Puede parar en cualquier momento y volver mañana.** Como un videojuego: llega a un hito,
empieza a usar su app, y retoma la construcción cuando quiera.

---

## 2. Alcance

### Sí

1. La máquina de estados de la entrevista, **con checkpoints reanudables**.
2. Bautizo del agente maestro y creación de su `agent_definition`.
3. Extracción estructurada: giro, modelo de negocio, procesos, dolores, equipo.
4. **Síntesis final** → Mapa de Negocio: áreas propuestas, hitos, roadmap.
5. La UI conversacional del onboarding.

### No

- **No** el desbloqueo de áreas ni su gamificación. Eso es H11 — tú generas los datos, él los usa.
- **No** el motor de agentes. Es H3 — tú lo consumes.
- **No** la ingesta de documentos. Es H4 — tú la llamas si el emprendedor pega algo.

---

## 3. Contrato de no colisión

| | |
|---|---|
| **Escribes sólo en** | `packages/onboarding/**` y `apps/web/app/(onboarding)/**` |
| **Migraciones** | `050`–`059` |
| **Rama** | `h7-ritual` · worktree `PLATAFORMA-h7-ritual` |

**Consumes:** `AgentPort` (H3) · `VaultPort` (H4) · `TenancyPort` (H2) — contra las interfaces.
**Te consume:** H11 lee los `tenant_areas` y `tenant_milestones` que tú generas.

---

## 4. Qué portar de GARDEN — ya existe y es lo mejor que hay

`GARDEN/abraxa/extensions/abraxa-bookkeeper/` son **2,188 líneas de motor de entrevista
funcionando**. No lo reescribas: parametrízalo.

| Pieza | Dónde | Qué es |
|---|---|---|
| Máquina de estados | `state-machine.ts:10-18` | 7 fases con condiciones de cierre explícitas por fase |
| **Marcadores** | `state-machine.ts:149-217` | El modelo emite `[PHASE_COMPLETE:x]`, `[UPDATE_FIELD:k=v]`, `[DISCOVERY_CONFIRMED]`; el código los parsea **y los borra antes de mostrar el mensaje**. Patrón muy reusable |
| Condiciones de cierre | `state-machine.ts:21-84` | Cada fase exige datos concretos, no "sensación de que ya" |
| Constructor de documento | `document-builder.ts` | Arma el manual maestro en markdown al final |
| Persona editable | `INPERIO/skills/bundled/karen-interviewer/SKILL.md` | El prompt de personalidad, en archivo, cacheado |

**Lo que hay que des-inperiar (tres cosas):**
1. `INPERIO_AREAS` hardcodeado a las 8 áreas de una inmobiliaria (`karen/src/types.ts:86-95`).
2. El prompt que se autodescribe como *"bookkeeper de Inperio (property management)"*
   (`ingest.ts:59`).
3. La persona de "Karen" — **aquí el agente lo bautiza el emprendedor.**

> **Decisión de producto:** Karen **no** existe como personaje aparte. Su motor se vuelve una
> capacidad del agente maestro. El emprendedor conoce **un solo agente**, el suyo, con su nombre.

---

## 5. Las fases

```
 FASE            QUÉ SACA                                    CHECKPOINT
 ─────────────────────────────────────────────────────────────────────────
 0 bienvenida    el nombre del agente                        ✓ agent_definitions
 1 identidad     giro, nicho, etapa, tamaño                  ✓ tenants.industry_type
 2 modelo        cómo gana dinero, ticket, margen            ✓ valores canónicos (H4)
 3 proceso       customer journey actual, de punta a punta   ✓ mapa de proceso
 4 dolor         qué le roba tiempo y dinero                 ✓ hitos priorizados
 5 gente         solo / con equipo / va a contratar          ✓ áreas candidatas
 6 síntesis      el MAPA DE NEGOCIO                          ✓ tenant_areas + milestones
```

**La fase 4 es la que da el "wow".** Es el *abogado del diablo* de Karen: en vez de aceptar lo
que le contaron, ataca los puntos débiles del proceso descrito. *"Me dijiste que das seguimiento
por WhatsApp. ¿Qué pasa cuando te escriben cinco a la vez un sábado?"* Ahí es donde el
emprendedor siente que alguien de verdad entendió su negocio. No la suavices.

---

## 6. Reanudable — el requisito que define el diseño

```sql
-- 050_onboarding.sql
CREATE TABLE app.onboarding_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  phase         text NOT NULL DEFAULT 'bienvenida',
  state         jsonb NOT NULL DEFAULT '{}',   -- todo lo extraído hasta ahora
  transcript    jsonb NOT NULL DEFAULT '[]',
  checkpoint_at timestamptz,
  completed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)
);
ALTER TABLE app.onboarding_sessions ENABLE ROW LEVEL SECURITY;
```

**Al reanudar, el agente resume lo que ya sabe y sigue.** No vuelve a preguntar. Que el
emprendedor sienta que lo recordaron es la mitad del valor.

**Al terminar la fase 6 puede empezar a usar su app**, aunque le falten áreas por configurar.
El resto del roadmap queda visible como siguiente paso, no como bloqueo.

---

## 7. La síntesis — lo que produces

Al cerrar la fase 6, el agente genera y persiste:

```
tenants.industry_type    ← el giro detectado, apuntando a industry_templates (H4)
tenant_areas[]           ← qué áreas necesita y en qué estado nace cada una
tenant_milestones[]      ← el roadmap ordenado, con el área a la que pertenece cada hito
valores canónicos        ← lo que salió de la fase 2, vía VaultPort (en borrador)
documento madre          ← el resumen de su negocio, vía VaultPort
```

El estado inicial de cada área lo decides tú a partir de la entrevista. Un solopreneur de
servicios probablemente arranca con Ventas `disponible` y RH `bloqueada`. H11 define la mecánica
de desbloqueo; tú defines el punto de partida.

---

## 8. La UI

Conversación a pantalla completa, no un formulario. Con:

- **Progreso visible** — en qué fase va y cuántas faltan. Sin esto se siente infinito.
- **"Guardar y seguir después"** siempre a la vista. Es una promesa, cúmplela.
- El bautizo del agente como un momento, no como un campo de texto.
- La entrega del Mapa de Negocio como **cierre con peso** — es el pago emocional de 20 minutos
  de preguntas.

---

## 9. Criterios observables de "listo"

1. Un emprendedor completa las 7 fases y termina con áreas, hitos y valores creados.
2. **Reanudación real:** completa 3 fases, cierra el navegador, vuelve al día siguiente y el
   agente retoma con el contexto intacto, sin repetir preguntas.
3. El agente responde con el nombre que le puso, en toda la UI.
4. Dos emprendedores de giros distintos obtienen **mapas distintos** — no una plantilla igual.
5. Los marcadores del modelo **nunca** se ven en pantalla.
6. Una fase no avanza si faltan sus datos de cierre, aunque la conversación fluya.
7. Al terminar, puede entrar a su app y usar al menos un área.
8. La fase 4 genera al menos un hito que el emprendedor no había pedido explícitamente.

---

## 10. LO QUE NO PUEDES CERRAR DORMIDO

Santiago está dormido, no hay llave de ningún modelo y no hay sesión. Cuatro de los ocho criterios
de §9 dependen de eso. No los des por cerrados ni los tapes con un mock disfrazado de prueba de
integración: márcalos y entrega el sustituto de la derecha, que **sí** es verificable hoy.

| Criterio de §9 | Por qué no se puede | Sustituto que SÍ entregas |
|---|---|---|
| **#1 · un emprendedor completa las 7 fases** | Exige `ANTHROPIC_API_KEY` u `OPENROUTER_API_KEY`, y una persona escribiendo | **Transcripción dorada**: un guion fijo de respuestas de emprendedor, servido por `packages/agents/src/providers/local.ts` (H3 ya lo dejó). Corre la máquina completa de la fase 0 a la 6 y **verifica el estado final en la base**: `tenants.industry_type`, `tenant_areas`, `tenant_milestones`, valores en la bóveda. La máquina se prueba entera; lo único sin probar es la elocuencia del modelo |
| **#4 · dos giros → mapas distintos** | Igual: exige modelo real | **Dos transcripciones doradas** de giros opuestos (una panadería, un despacho de servicios) y una aserción de que los `tenant_areas` resultantes **no son iguales**. Prueba que la síntesis depende de la entrevista y no de una plantilla, que es lo que de verdad importa del criterio |
| **#8 · la fase 4 saca un hito no pedido** | Es una propiedad de la *calidad* de un modelo real | Lo que sí pruebas dormido: que la fase 4 **no cierra** sin al menos un hito con `origen: 'abogado_del_diablo'`, y que su prompt vive en un **archivo editable** (como `karen-interviewer/SKILL.md` en GARDEN), no incrustado en el código. Así Santiago lo afila sin un deploy. Deja el criterio abierto en el PR |
| **#7 · al terminar entra a su app** | No hay login: `correoDeLaSesion()` devuelve `null` (§0). Es de **H18** | Cierra el paso anterior —el tenant queda provisionado, con áreas y con al menos una disponible— y verifica la redirección. El "entra" real se cierra cuando exista H18; anótalo |

**Los otros cuatro se cierran hoy, completos y automatizados**, y son los que más se rompen:
**#2 reanudación real** (la promesa entera del "puedes parar cuando quieras"), **#3 el nombre que
le puso en toda la UI**, **#5 los marcadores nunca visibles** —GARDEN ya resuelve el parseo en
`state-machine.ts:149-217`, cópialo con sus pruebas— y **#6 una fase no avanza sin sus datos**.
El #2 y el #5 no admiten excusa: no dependen de nada externo.

**Regla que no se negocia mientras él duerme:** ningún test que necesite red entra a CI. CI no
tiene ni un secreto, y el job `verify` corre `npm run build` justamente para probar que el repo
compila sin ninguno. Si tu módulo valida `process.env.ANTHROPIC_API_KEY` al importarse, rompes el
build **de los 15 carriles**. Valida en la llamada, nunca en el import.

**Y una decisión de producto que no puedes consultar:** el texto de la persona del agente. La
tomas conservadora — se porta el tono de `karen-interviewer/SKILL.md` de GARDEN, **des-inperiado**,
sin nombre propio (lo bautiza el emprendedor) — y la dejas en un archivo suelto, no en un string
del código, con una línea en el PR diciendo dónde está para que él la reescriba.

---

## 11. Prompt de arranque

```
ANTES DE ESCRIBIR NADA — freno duro. Pégalo tal cual; si imprime ESPERA, no escribas una línea.

(
  set -u
  W="/Volumes/FRAGUA/CLAUDE CODE/PLATAFORMA-h7-ritual"
  cd "$W" || { echo "ESPERA · no existe el worktree $W"; exit 1; }
  ok=1; mal() { echo "  ✖ $1"; ok=0; }
  echo "freno de arranque · H7 · $(git rev-parse --abbrev-ref HEAD)"
  for f in \
    packages/db/ports.ts \
    packages/agents/src/service.ts \
    packages/agents/src/definitions/repository.ts \
    packages/agents/src/prompt/compose.ts \
    packages/vault/src/values/service.ts \
    packages/vault/src/ingest/pipeline.ts \
    packages/tenancy/src/services/provision.ts \
    packages/ui/src/components/primitives/button.tsx \
    migrations/010_tenancy.sql \
    migrations/020_agent_definitions.sql \
    migrations/030_vault_documents.sql \
    migrations/033_industry_templates.sql
  do [ -f "$f" ] || mal "falta $f"; done
  echo "  … actualizando origin/main (es red: en un disco externo puede tardar un minuto)"
  GIT_TERMINAL_PROMPT=0 git fetch --no-tags -q origin main \
    || mal "no pude 'git fetch origin main' — sin eso, el cotejo de abajo usa una referencia vieja"
  [ "$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 99)" = 0 ] \
    || mal "tu árbol NO trae origin/main ($(git rev-parse --short origin/main)) → git merge --no-edit origin/main"
  [ -d node_modules ] || mal "no hay node_modules → npm ci"
  case "$(node -v)" in v22.*) ;; *) mal "Node $(node -v); el repo exige Node 22 → nvm use 22";; esac
  [ "$ok" = 1 ] \
    && echo "LISTO · H1·H2·H3·H4·H5 en el árbol, en $(git rev-parse --short HEAD), con node_modules. Construye." \
    || echo "ESPERA · no escribas una línea hasta que lo de arriba esté resuelto."
)

Prueba ARCHIVOS DE IMPLEMENTACIÓN, no directorios: los 12 paquetes traen stubs de H1, así que
packages/vault/src existe desde el día uno y `test -d` siempre dijo LISTO aunque no hubiera nada.
Y verifica dos cosas más que el freno viejo no miraba: que tu worktree traiga origin/main (los
worktrees se quedaron clavados dos commits atrás) y que exista node_modules (ninguno lo tenía).

Trabaja SIEMPRE desde /Volumes/FRAGUA/CLAUDE CODE/PLATAFORMA-h7-ritual (tu worktree, rama
h7-ritual ya activa). No hagas checkout ni switch.

Vas a construir H7 — el Ritual de Fundación de ABRAXA Plataforma. Estás en la ruta crítica.

Lee primero, completo:
  docs/handoffs/H7-ritual.md         (tu handoff — la §0 ESTADO REAL manda sobre el resto)
  docs/handoffs/README.md            (el contrato de no colisión)
  packages/db/ports.ts               (consumes AgentPort, VaultPort, TenancyPort)
  apps/web/app/(app)/direccion/_lib/session.ts   (por qué HOY no hay sesión, y qué hacer)

Contexto: es lo PRIMERO que vive un emprendedor en el producto, y lo que decide si se queda.
Un agente aparece, le pide que le ponga nombre, lo entrevista sobre su negocio y le entrega su
Mapa de Negocio. Puede parar cuando quiera y volver mañana — como un videojuego.

Buena noticia: el motor ya existe. GARDEN tiene 2,188 líneas de máquina de entrevista de 7
fases funcionando en abraxa/extensions/abraxa-bookkeeper/. NO la reescribas: parametrízala.
GARDEN está en "/Volumes/FRAGUA/CLAUDE CODE/GARDEN" — consúltalo, NO lo edites.

Lo que hay que des-inperiar: las áreas hardcodeadas de una inmobiliaria, el prompt que se
autodescribe como "property management", y la persona de "Karen". Decisión de producto: Karen
NO existe como personaje aparte — su motor se vuelve una capacidad del agente maestro, y el
emprendedor conoce UN SOLO agente, el suyo, con el nombre que él le puso.

Trabajas SÓLO en packages/onboarding/** y apps/web/app/(onboarding)/**. Migraciones 050–059.
Otras conversaciones trabajan en paralelo (H6, H9, H10 y el carril nuevo H15 · CRM).

apps/web/app/(onboarding)/ritual/page.tsx YA EXISTE: es el andamio de H1, con el comentario
"ANDAMIO DE H1 — bórralo y escribe lo tuyo". Lo reemplazas, no lo creas.
Las tablas tenant_areas y tenant_milestones NO existen: las creas TÚ en tu bloque 050–059.
tenants.industry_type y app.industry_templates (5 filas) SÍ existen ya — no los dupliques.

Dos cosas que no se negocian, y las dos se pueden cerrar hoy sin credenciales:
  - El criterio #2: reanudación real. Cerrar el navegador a media entrevista y volver al día
    siguiente sin que el agente repita preguntas. Es la promesa "puedes parar cuando quieras".
  - La fase 4 (abogado del diablo) no se suaviza. Es donde el emprendedor siente que alguien
    de verdad entendió su negocio.

Lo que NO puedes cerrar dormido está en la §10: no hay llave de ningún modelo ni sesión de
usuario. Los criterios #1, #4, #7 y #8 se sustituyen por transcripciones doradas contra
packages/agents/src/providers/local.ts, y se dejan marcados como abiertos en el PR. No los
declares cerrados.

Si algo del handoff está mal o incompleto, dilo y propón el arreglo antes de construir.
```
