# H7 — El Ritual de Fundación

> **Ola 2.** Corre en paralelo con H6, H8, H9 y H10. Requiere H1, H3 y H4 mergeados.
> **Ruta crítica.**
> Rama: `h7-ritual` · Migraciones: `050`–`059`
> Directorios: `packages/onboarding/**` y `apps/web/app/(onboarding)/**`

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

## 10. Prompt de arranque

```
ANTES DE ESCRIBIR NADA: verifica que H1, H3 y H4 hayan mergeado.
  test -f packages/db/ports.ts && test -d packages/agents/src && test -d packages/vault/src \
    && echo LISTO || echo "ESPERA"
Si falta alguno, NO crees estructura. Lee tu handoff, estudia GARDEN, prepara tu plan.

Trabaja SIEMPRE desde /Volumes/FRAGUA/CLAUDE CODE/PLATAFORMA-h7-ritual (tu worktree, rama
h7-ritual ya activa). No hagas checkout ni switch.

Vas a construir H7 — el Ritual de Fundación de ABRAXA Plataforma. Estás en la ruta crítica.

Lee primero, completo:
  docs/handoffs/H7-ritual.md         (tu handoff)
  docs/handoffs/README.md            (el contrato de no colisión)
  packages/db/ports.ts               (consumes AgentPort, VaultPort, TenancyPort)

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
Otras 4 conversaciones trabajan en paralelo.

Dos cosas que no se negocian:
  - El criterio #2: reanudación real. Cerrar el navegador a media entrevista y volver al día
    siguiente sin que el agente repita preguntas. Es la promesa "puedes parar cuando quieras".
  - La fase 4 (abogado del diablo) no se suaviza. Es donde el emprendedor siente que alguien
    de verdad entendió su negocio.

Si algo del handoff está mal o incompleto, dilo y propón el arreglo antes de construir.
```
