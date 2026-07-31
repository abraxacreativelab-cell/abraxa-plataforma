# H8 — Automatizaciones: motor, builder visual y ejecución observable

> **⚠ ESTE CARRIL BAJÓ A LA OLA 3 el 2026-07-31.** Ya no corre con H6, H7, H9 y H10.
> **No arranques hasta que H6 y H15 hayan mergeado** — el freno de la §10 lo verifica solo.
> Requiere H1, H3, **H6** (`InboxPort` implementado) y **H15** (contactos y embudo) mergeados.
> Rama: `h8-flows` · Migraciones: `060`–`069`
> Directorios: `packages/flows/**` y `apps/web/app/(app)/automatizaciones/**`

---

## 0. ESTADO REAL AL 2026-07-31 — léelo antes que nada

Este handoff se escribió cuando el repo no tenía una sola línea de producto. Lo de abajo está
**verificado contra `origin/main` y contra la base real**, no recordado. Donde el resto del
documento y esta sección se contradigan, **manda esta sección**.

### Por qué bajaste a la Ola 3 — tres razones, ninguna opinable

1. **No hay CRM.** Cuatro de tus diez nodos —`assign_owner`, `move_stage`, `add_tag`,
   `create_task`— y tres de tus ocho disparadores —contacto nuevo, cambio de etapa, etiqueta
   añadida— **operan sobre entidades que no existen**: `grep -rn contacts migrations/` no devuelve
   nada. La §2 de este documento dice *"no construyas el CRM: los pipelines y contactos son de otro
   carril"*… y ese carril no existía. Ya existe: **H15 · CRM** (`packages/crm`, migraciones
   `120`–`129`), abierto el 2026-07-31 justo por este hueco. Sin él, la mitad de tu catálogo de
   nodos es una UI que promete lo que el worker no puede correr — exactamente la ley de GARDEN que
   este handoff te pide conservar.
2. **No hay worker corriendo.** `apps/worker/src/index.ts` existe (andamio de H1, con
   `registerQueue()` y `batchSize: 1`), pero **el schema `pgboss` NO existe en la base**: nadie lo
   ha arrancado nunca. Tú eres el primer carril que de verdad necesita una cola.
3. **La decisión de transporte no estaba tomada.** Ver abajo. Ya está tomada, y no es SSE.

### El SSE en vivo se sustituye por polling de 1 segundo

La §6 pedía *"ejecución en vivo por SSE"*. **No se puede hoy, y un SSE que pasa las pruebas y
falla en producción es peor que un polling honesto.** El detalle mecánico:

- `apps/api` y `apps/worker` son **dos procesos distintos** (`apps/api/src/index.ts` y
  `apps/worker/src/index.ts`, dos entradas, dos builds). Quien ejecuta los pasos es el worker;
  quien tendría el SSE abierto es la API. **Un `EventEmitter` en proceso pasa todos tus tests y no
  emite un solo evento en producción**, porque el emisor y el oyente viven en procesos separados.
  Es la trampa exacta que este carril tenía puesta.
- **No hay `LISTEN`/`NOTIFY` cableado** en ningún lado del repo, ni Supabase Realtime configurado.
  Cablear cualquiera de las dos es una decisión de arquitectura con costo operativo, y Santiago
  está dormido.

**Decisión conservadora, tomada y documentada:** el panel de corridas hace **polling cada 1
segundo** sobre `GET /flows/runs/:id`, con `Cache-Control: no-store`. Es 10× más rápido que el
polling de 10 s de GARDEN (`builder.tsx:829-834`), se ve "en vivo" para un humano, y funciona de
verdad. **Aísla el transporte detrás de una sola función** —`suscribirseACorrida(runId, cb)`— para
que el día que exista `LISTEN`/`NOTIFY` se cambie un archivo y no la UI. Y detén el polling con
`document.visibilityState` y al terminar la corrida: dejar un intervalo de 1 s vivo en una pestaña
olvidada es una factura de Supabase.

El criterio §8 #3 cambia en consecuencia (ver la §8, ya reescrita).

### Lo que SÍ está en main

**`origin/main` = `f6affc1e80049396087a1ff507aeeb96770ce326`.**

| Carril | Lo que te dejó — archivos que puedes abrir hoy |
|---|---|
| **H1 · fundación** | `packages/db/ports.ts` (los 8 ports), `packages/db/src/port-registry.ts`, `apps/api`, **`apps/worker/src/index.ts` con `registerQueue()`**, el CI y el gate |
| **H3 · agentes** | `packages/agents/src/service.ts`, `loop/agent-loop.ts`, `ledger/usage-ledger.ts`. `AgentPort` **registrado** — tu nodo `ai_step` lo consume |
| **H2 · tenancy** (PR #6) | `packages/tenancy/src/services/*`, `middleware/{tenant,rbac}.ts` — tu "activar exige rol admin" sale de aquí, no lo reimplementes |
| **H4 · bóveda** (PR #7) | `packages/vault/src/{values/service,resolver,render}.ts` — de aquí salen tus `{valor.*}` y `{precio.*}`. **`render.ts` ya resuelve plantillas**: no escribas otro |
| **H5 · design system** | `packages/ui/src/components/primitives/*`. Y **`@xyflow/react` ya está instalado** en `apps/web/package.json`: no instales nada (regla 4) |

**La base real ya está migrada:** 13 migraciones (`001, 010–012, 020–024, 030–033`), 19 tablas,
`tablas_sin_rls = 0`, `npm run migrate` dice 0 pendientes. `app.tenants` está **vacía**.

### Lo que NO existe todavía

- `packages/flows/src/` tiene **exactamente dos archivos**: `index.ts` y `meta.ts`, los stubs de H1.
  Igual `inbox` y los demás. **Por eso el freno de arranque de este handoff mentía**: probaba
  `test -d packages/agents/src`, y ese directorio existe siempre. El freno corregido está en §10, y
  ahora sí verifica que H6 y H15 hayan aterrizado.
- `apps/web/app/(app)/automatizaciones/page.tsx` existe, pero es el **andamio de H1** ("bórralo y
  escribe lo tuyo"). Lo reemplazas.
- **No hay `.env`** (sólo `.env.example`) y GitHub **no tiene secretos**. Sin `DATABASE_URL` el
  worker no arranca: `apps/worker/src/index.ts` lanza *"DATABASE_URL es obligatorio"*. Tus pruebas
  de motor corren **sin cola**, contra el ejecutor directo. Ver §10.
- No hay protección de rama (repo privado sin GitHub Pro): **el gate de CI es la única ley**.

---

## 1. Contexto

El emprendedor describe en español lo que quiere que pase solo:

> *"Cuando entre un lead por mi página, mándale un mensaje, métemelo en la etapa de Contactado,
> y que el agente de ventas lo contacte por WhatsApp."*

…y el sistema lo arma como un flujo de nodos que él puede ver, editar a mano, probar y ver
correr **paso por paso en vivo**.

Es la función que convierte el producto de "un CRM bonito" a "mi negocio trabaja solo".

---

## 2. Alcance

### Sí

1. Motor de ejecución con cola, idempotencia y reanudación.
2. **Builder visual tipo n8n** con nodos, ramas y configuración por nodo.
3. **Asistente en español** que arma la propuesta desde una descripción.
4. **Ejecución observable paso a paso** — el emprendedor ve cada nodo cambiar de estado.
   **Por polling de 1 segundo, no por SSE** (§0), detrás de una sola función de transporte.
5. Historial de corridas.
6. Activación segura: siempre se guarda en pausa.

### No

- **No** implementes canales. Mandas mensajes por `InboxPort` (H6).
- **No** construyas el CRM. Contactos, embudo y etiquetas son de **H15** (`packages/crm`,
  migraciones `120`–`129`), que ya existe: consúmelo por su port, como haces con `InboxPort`.
- **No** montes SSE, `LISTEN`/`NOTIFY` ni Realtime. Es la decisión de la §0, y no es tuya.
- **No** des ejecución de código arbitrario al cliente. El catálogo de nodos es cerrado.

---

## 3. Contrato de no colisión

| | |
|---|---|
| **Escribes sólo en** | `packages/flows/**` y `apps/web/app/(app)/automatizaciones/**` |
| **Migraciones** | `060`–`069` |
| **Rama** | `h8-flows` · worktree `PLATAFORMA-h8-flows` |

**Implementas:** `FlowPort`.
**Consumes:** `InboxPort` (H6) · `AgentPort` (H3) · `VaultPort` (H4) — **contra las interfaces.**
No esperes a H6: si su implementación no existe, tus tests usan un doble.

---

## 4. Qué portar de GARDEN — está casi todo hecho

| Archivo | Líneas | Veredicto |
|---|---|---|
| `src/crm/workflows/engine.ts` | — | **El motor completo. Cero Inperio.** Idempotencia por `current_node`, guard de doble envío, pausa y reanudación cuando el canal cae, anti-loop de 100 pasos, clasificación de errores transitorios vs permanentes |
| `src/crm/workflows/events.ts` | — | Matching de trigger + filtros, creación de enrollment |
| `src/crm/queue.ts` + `workflows/worker.ts` | — | pg-boss con `batchSize:1` **deliberado** para no re-ejecutar vecinos al fallar |
| `src/crm/workflows/assist.ts` | 370 | El asistente IA. Carga el catálogo real del tenant e inyecta IDs reales; valida con zod **y** semánticamente (1 trigger, sin ciclos, ramas conectadas, IDs existentes); 2 intentos con re-prompt |
| `garden-os/components/crm/flow/*` | 1,037 | Builder React Flow completo: paleta, config por nodo, panel de asistente, panel de runs |

**Sólo hay que cambiar una línea del prompt del asistente:** se autodescribe como *"CRM
inmobiliario/ventas"* (`assist.ts:217`).

---

## 5. Nodos y disparadores

**10 nodos**, todos ejecutables. El comentario original de GARDEN vale como ley:
*"la UI no promete nada que el worker no corra."*

`send_message` · `wait` · `condition` · `assign_owner` · `move_stage` · `add_tag` ·
`create_task` · `webhook` · `ai_step` · `end`

**8 disparadores:** contacto nuevo · cambio de etapa · formulario enviado · cita agendada ·
cita cancelada · etiqueta añadida · **mensaje entrante** · manual.

**Variables de plantilla**, incluidos los valores canónicos de H4:
`{nombre} {fecha} {hora} {vendedor} {link}` + `{valor.*}` y `{precio.*}`.

**Cambio respecto a GARDEN:** su `send_whatsapp` era específico. Aquí es **`send_message` con
canal como parámetro**, despachado por `InboxPort`. Así los canales de H12 y H13 funcionan sin
tocarte.

---

## 6. Lo que hay que agregar sobre GARDEN

Tres huecos reales del original:

1. **Ejecución observable de verdad.** GARDEN hace polling de 10 segundos
   (`builder.tsx:829-834`) y se siente muerto. Aquí el emprendedor ve cada paso ocurrir: es la
   diferencia entre "confío en que sirve" y "lo vi funcionar".
   **Con polling de 1 s, no con SSE** — la razón mecánica está en la §0: la API y el worker son
   procesos distintos, y un `EventEmitter` en proceso pasa tus tests y no emite nada en
   producción. Encapsúlalo en `suscribirseACorrida(runId, cb)` y en el futuro se cambia un archivo.
2. **Rollback de versión.** `crm_workflow_versions` existe en GARDEN y **nadie la lee** — es un
   log de auditoría, no versionado usable. Aquí se puede volver a una versión anterior.
3. **`send_email` deja de ser un stub.** En GARDEN devuelve `skipped`. Aquí despacha por
   `InboxPort` y funciona en cuanto H13 conecte el driver.

---

## 7. Seguridad — el cliente edita flujos, no código

- **Todo flujo se guarda en pausa.** Activarlo es un clic humano aparte, con modal que advierte
  que va a ejecutarse con contactos **reales**.
- **Sin ciclos.** El validador los rechaza (DFS tricolor, ya está en `assist.ts`).
- **Anti-loop de 100 pasos** en tiempo de ejecución, además.
- **Guard anti-SSRF** en el nodo `webhook` (`isBlockedSsrfHost` de GARDEN).
- **Probar** = enrolar un contacto real en ese flujo y sólo ese.
- Activar y probar exigen rol admin, y el botón se **deshabilita con explicación** en vez de dar
  un 403 sorpresa.

---

## 8. Criterios observables de "listo"

1. Describir un flujo en español y obtener una propuesta **válida y ejecutable**, con los IDs
   reales del tenant.
2. Editar un nodo a mano, guardar, y que el motor corra la versión editada.
3. **Ver la ejecución paso a paso**: disparar el flujo y ver cada nodo cambiar de estado sin
   recargar, con retraso máximo de ~1 s. **Y dos cosas que se prueban aparte, porque son donde
   esto se cae:** que el polling se detenga solo al terminar la corrida y con la pestaña oculta,
   y que **todo el transporte esté detrás de `suscribirseACorrida()`** — un test que sustituye esa
   función y confirma que la UI no sabe cómo llegan los datos.
4. Un flujo nuevo **nace en pausa**. Activarlo exige confirmación explícita.
5. Reintentar un paso fallido **no** duplica el mensaje ya enviado.
6. Si el canal se cae a media corrida, el flujo **pausa y reanuda** cuando vuelve.
7. Volver a una versión anterior y que el motor use esa.
8. Un flujo del tenant A **no** puede tocar datos del B. Test automatizado.

---

## 9. LO QUE NO PUEDES CERRAR DORMIDO

Santiago está dormido, no hay `.env`, no hay `DATABASE_URL` y no hay llaves de ningún proveedor.
Además tú dependes de dos carriles que todavía no mergean. Esto es lo que **no** se cierra hoy y
con qué se sustituye.

| Criterio de §8 | Por qué no se puede | Sustituto que SÍ entregas |
|---|---|---|
| **#1 · propuesta en español con IDs reales del tenant** | El asistente llama a un modelo. No hay `ANTHROPIC_API_KEY` ni `OPENROUTER_API_KEY` | `packages/agents/src/providers/local.ts` (H3) devolviendo un JSON de flujo fijo. **Lo que de verdad prueba este criterio es el validador, no el modelo**: GARDEN ya valida con zod **y** semánticamente (1 trigger, sin ciclos por DFS tricolor, ramas conectadas, IDs existentes en el catálogo del tenant) en `assist.ts`, con reintento y re-prompt. Porta eso con sus pruebas y aliméntalo con propuestas **malas a propósito**: la que inventa un ID, la que trae un ciclo, la que deja una rama colgando |
| **#5 · reintentar no duplica el mensaje** y **#6 · pausa y reanuda si el canal cae** | Mandar de verdad exige el driver de WhatsApp de H6 **y** credenciales de Evolution | Doble de `InboxPort` que cuenta envíos por `external_id` y que puede fallar a voluntad (transitorio vs permanente). El guard de doble envío y la clasificación de errores son **tuyos**, no del canal: se prueban enteros con el doble. La regla 5 del contrato existe justo para esto |
| **cualquier cosa que necesite la cola** | El worker exige `DATABASE_URL` y **el schema `pgboss` no existe** en la base (§0) | Separa **ejecutor** de **cola**: el motor es una función pura `ejecutarPaso(estado) → estado` que se prueba sin pg-boss, y `registerQueue()` sólo la envuelve. Así el 100% de la lógica de idempotencia, anti-loop de 100 pasos y reanudación se prueba en CI sin base |
| **#3 · verlo ocurrir** | No hay transporte en vivo (§0) | Polling de 1 s detrás de `suscribirseACorrida()`, con la prueba de que la UI no conoce el transporte y con corte automático al terminar y con la pestaña oculta |

**Lo que sí se cierra hoy, completo:** #2 (editar un nodo y que el motor corra la versión editada),
#4 (nace en pausa, activar exige confirmación explícita y rol admin por el RBAC de H2), #7
(rollback de versión — la tabla existía en GARDEN y **nadie la leía**) y #8 (aislamiento entre
tenants). Y el **guard anti-SSRF** del nodo `webhook` (`isBlockedSsrfHost` de GARDEN): ése se
prueba entero sin red y no se pospone, porque es el único nodo que deja al cliente apuntar a una
URL que él escribe.

**Regla que no se negocia mientras él duerme:** ningún test que necesite red o base entra a CI.
CI no tiene ni un secreto, y el job `verify` corre `npm run build` para probar que el repo compila
sin ninguno. Si tu módulo valida `process.env.DATABASE_URL` al importarse, rompes el build **de
los 15 carriles**. Valida en la llamada, nunca en el import.

---

## 10. Prompt de arranque

```
ANTES DE ESCRIBIR NADA — freno duro. Este carril bajó a la OLA 3: además de H1 y H3, exige que
H6 y H15 hayan mergeado. Pégalo tal cual; si imprime ESPERA, no escribas una línea.

(
  set -u
  W="/Volumes/FRAGUA/CLAUDE CODE/PLATAFORMA-h8-flows"
  cd "$W" || { echo "ESPERA · no existe el worktree $W"; exit 1; }
  ok=1; mal() { echo "  ✖ $1"; ok=0; }
  echo "freno de arranque · H8 · $(git rev-parse --abbrev-ref HEAD)"
  for f in \
    packages/db/ports.ts \
    packages/agents/src/service.ts \
    packages/agents/src/loop/agent-loop.ts \
    packages/tenancy/src/middleware/rbac.ts \
    packages/vault/src/render.ts \
    packages/ui/src/components/primitives/button.tsx \
    apps/worker/src/index.ts \
    migrations/010_tenancy.sql \
    migrations/020_agent_definitions.sql \
    migrations/030_vault_documents.sql
  do [ -f "$f" ] || mal "falta $f"; done
  # H6 · la bandeja: sin InboxPort implementado, send_message no existe
  { [ -f migrations/040_inbox.sql ] && grep -q "registerPort('inbox'" packages/inbox/src/index.ts; } \
    || mal "H6 no ha mergeado (falta migrations/040_inbox.sql o el registerPort('inbox'))"
  # H15 · el CRM: sin contactos ni embudo, 4 de tus 10 nodos no tienen sobre qué operar
  { [ -f migrations/120_crm_contacts.sql ] && [ -f packages/crm/src/port.ts ]; } \
    || mal "H15 no ha mergeado (falta migrations/120_crm_contacts.sql o packages/crm/src/port.ts)"
  echo "  … actualizando origin/main (es red: en un disco externo puede tardar un minuto)"
  GIT_TERMINAL_PROMPT=0 git fetch --no-tags -q origin main \
    || mal "no pude 'git fetch origin main' — sin eso, el cotejo de abajo usa una referencia vieja"
  [ "$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 99)" = 0 ] \
    || mal "tu árbol NO trae origin/main ($(git rev-parse --short origin/main)) → git merge --no-edit origin/main"
  [ -d node_modules ] || mal "no hay node_modules → npm ci"
  case "$(node -v)" in v22.*) ;; *) mal "Node $(node -v); el repo exige Node 22 → nvm use 22";; esac
  [ "$ok" = 1 ] \
    && echo "LISTO · H1·H2·H3·H4·H5·H6·H15 en el árbol, en $(git rev-parse --short HEAD), con node_modules. Construye." \
    || echo "ESPERA · no escribas una línea hasta que lo de arriba esté resuelto."
)

Prueba ARCHIVOS DE IMPLEMENTACIÓN, no directorios: los 12 paquetes traen stubs de H1, así que
packages/agents/src existe desde el día uno y `test -d` siempre dijo LISTO aunque no hubiera nada.
Y verifica dos cosas más que el freno viejo no miraba: que tu worktree traiga origin/main (los
worktrees se quedaron clavados dos commits atrás) y que exista node_modules (ninguno lo tenía).

Trabaja SIEMPRE desde /Volumes/FRAGUA/CLAUDE CODE/PLATAFORMA-h8-flows (tu worktree, rama
h8-flows ya activa). No hagas checkout ni switch.

Vas a construir H8 — las Automatizaciones de ABRAXA Plataforma: motor, builder visual tipo n8n
y ejecución en vivo.

Lee primero, completo:
  docs/handoffs/H8-flows.md          (tu handoff — la §0 ESTADO REAL manda sobre el resto)
  docs/handoffs/README.md            (el contrato de no colisión)
  packages/db/ports.ts               (implementas FlowPort; consumes InboxPort y AgentPort)
  apps/worker/src/index.ts           (registerQueue y por qué batchSize:1 no se sube)

Contexto: el emprendedor describe en español lo que quiere que pase solo, y el sistema lo arma
como un flujo de nodos que puede ver, editar, probar y ver correr paso por paso. Es la función
que convierte el producto de "un CRM bonito" a "mi negocio trabaja solo".

Buena noticia: en GARDEN esto está casi todo hecho y es bueno. El motor no tiene ni una
referencia a Inperio: idempotencia, pausa y reanudación cuando el canal cae, anti-loop,
clasificación de errores transitorios vs permanentes. Y el asistente IA valida con zod Y
semánticamente contra el catálogo real del tenant. GARDEN está en
"/Volumes/FRAGUA/CLAUDE CODE/GARDEN" — consúltalo, NO lo edites.

Tres cosas que hay que AGREGAR sobre el original:
  1. Ejecución observable de verdad. GARDEN hace polling de 10s y se siente muerto. Aquí es
     polling de 1 SEGUNDO, no SSE — lee la §0: apps/api y apps/worker son procesos distintos y un
     EventEmitter en proceso pasa tus tests y no emite nada en producción. Encapsúlalo todo en
     suscribirseACorrida(runId, cb) para cambiar un solo archivo el día que haya LISTEN/NOTIFY.
     Y corta el polling al terminar la corrida y con la pestaña oculta.
  2. Rollback de versión. La tabla existe en GARDEN y nadie la lee.
  3. send_email deja de ser un stub que devuelve 'skipped'.

Y un cambio: send_whatsapp se vuelve send_message con el canal como parámetro, despachado por
InboxPort — así los canales de H12 y H13 funcionan sin tocarte. Consumes InboxPort y el port del
CRM (H15) CONTRA LA INTERFAZ, con dobles en tus tests, aunque el freno ya exija que hayan
mergeado: los dobles son los que hacen que tus pruebas corran en CI, que no tiene ni un secreto.

Separa el EJECUTOR de la COLA: el motor es una función pura ejecutarPaso(estado) → estado que se
prueba sin pg-boss, y registerQueue() sólo la envuelve. El schema pgboss NO existe en la base
todavía; tú eres el primer carril que de verdad necesita una cola.

Trabajas SÓLO en packages/flows/** y apps/web/app/(app)/automatizaciones/**.
Migraciones 060–069. Estás en la Ola 3, con H11, H12, H13 y H14.

Conserva la ley de GARDEN: la UI no promete ningún nodo que el worker no corra de verdad. Y
todo flujo nace en pausa — activarlo es un clic humano aparte, con advertencia de que va a
ejecutarse con contactos REALES.

Si algo del handoff está mal o incompleto, dilo y propón el arreglo antes de construir.
```
