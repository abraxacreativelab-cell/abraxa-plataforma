# H9 — Tareas y proyectos

> **Ola 2.** Corre en paralelo con H6, H7 y H10 — **H8 se bajó a la Ola 3**, ver `H8-flows.md` §0.
> Requiere H1 y H5 mergeados: **ya lo están, y también H2, H3 y H4.** Lee la §0 antes que nada.
> Rama: `h9-work` · Migraciones: `070`–`079`
> Directorios: `packages/work/**` y `apps/web/app/(app)/tareas/**`

---

## 0. ESTADO REAL AL 2026-07-31 — léelo antes que nada

Este handoff se escribió cuando el repo no tenía una sola línea de producto. Lo de abajo está
**verificado contra `origin/main` y contra la base real**, no recordado. Donde el resto del
documento y esta sección se contradigan, **manda esta sección**.

### Lo que SÍ está en main

**`origin/main` = `f6affc1e80049396087a1ff507aeeb96770ce326`.**

| Carril | Lo que te dejó — archivos que puedes abrir hoy |
|---|---|
| **H1 · fundación** | `packages/db/ports.ts` (los 8 ports), `packages/db/src/port-registry.ts` (`registerPort` / `usePort` / `tryPort`), `packages/db/src/tenant-db.ts`, el CI y el gate |
| **H5 · design system** | `packages/ui/src/components/primitives/{button,badge,card,input,select,separator,skeleton,icon}.tsx`, `shell/app-shell.tsx`, `feedback/{empty-state,async-boundary,load-error}.tsx`, `lib/accent.ts`. **Es más de lo que crees: úsalo, no inventes primitivas** |
| **H2 · tenancy** (PR #6) | `packages/tenancy/src/services/{memberships,provision,plans}.ts`, `middleware/{tenant,rbac}.ts`. `TenancyPort` **registrado** — de aquí salen los miembros del equipo |
| **H3 · agentes** (ya estaba) | `packages/agents/**`. No lo consumes, pero existe |
| **H4 · bóveda** (PR #7) | `packages/vault/**`, y **el ejemplo a copiar**: `apps/web/app/(app)/direccion/**` es la primera sección real del producto. Mira cómo resuelve contexto, errores y tablas antes de escribir la tuya |

**La base real ya está migrada** (proyecto Supabase `ievnkmodselrlkazkzoy`):

- **13 migraciones aplicadas** — `001, 010, 011, 012, 020, 021, 022, 023, 024, 030, 031, 032, 033`.
  `npm run migrate` responde **0 pendientes**.
- **19 tablas y `tablas_sin_rls = 0`.** Tu `070` se suma: el gate rechaza toda tabla nueva sin
  `tenant_id` y sin `ENABLE ROW LEVEL SECURITY` **en el mismo archivo**
  (`scripts/ownership-gate.mjs`, `revisarMigracion`).
- **El equipo se identifica por CORREO, no por id.** `app.memberships` es
  `(tenant_id, user_email, role)` y `app.users` tiene `email` como llave primaria. Tu
  `assigned_to` y tu `assigned_by` guardan **el correo**, no un uuid, y no un nombre suelto: eso
  es lo que sustituye al `'santiago'` hardcodeado de GARDEN (`tasks.ts:210`).
- **`app.tenants` está VACÍA.** No hay datos de prueba de nadie. Si necesitas un tenant con dos
  miembros para el criterio #5, provisiónalo tú: `SELECT app.provision_tenant(...)` (migración
  `011`) y agrega la segunda membresía.

### Lo que NO existe todavía, aunque el documento lo dé por hecho

- `packages/work/src/` tiene **exactamente dos archivos**: `index.ts` y `meta.ts`, los stubs de H1.
  Igual `inbox`, `onboarding`, `flows`, `billing` y `areas`. **Por eso el freno de arranque de este
  handoff mentía**: probaba `test -d packages/ui/src`, y ese directorio existe siempre. El freno
  corregido está en §8.
- `apps/web/app/(app)/tareas/page.tsx` existe, pero es el **andamio de H1** ("bórralo y escribe lo
  tuyo"). Lo reemplazas, no lo creas. El `(app)/layout.tsx` es de H5: **no lo toques**.
- **No hay sesión de usuario.** `apps/web/app/(app)/direccion/_lib/session.ts` lo dice y lo
  demuestra: `correoDeLaSesion()` devuelve `null` a propósito, porque el login es de un carril de
  identidad (**H18**) que todavía no existe. **No leas un `x-user-email` del navegador para saber
  quién asigna una tarea**: es el agujero que H0 ya cerró una vez (PR #12). Copia el patrón de ese
  archivo — contexto de desarrollo fail-closed — y deja **un solo lugar** que cambiar.
- **No hay `.env`** (sólo `.env.example`) y GitHub **no tiene secretos**: en CI no hay base. Todo
  test tuyo corre con doble; H2 te dejó `packages/tenancy/src/testing/fake-postgrest.ts` y H4
  `packages/vault/src/testing/fake-db.ts` — léelos antes de escribir el tuyo.
- No hay protección de rama (repo privado sin GitHub Pro): **el gate de CI es la única ley**, y
  nadie te va a impedir mergear en rojo. No lo hagas.

### Carriles en vuelo mientras lees esto

Al 2026-07-31 hay PRs abiertos y en verde de `h6-inbox` (#10), `h7-ritual` (#8), `h9-work` (#13),
`h10-billing` (#11) y un carril nuevo, `h15-crm` (#9). **H15 trae contactos y embudo**: si tu
tarea alguna vez cuelga de un contacto, es de él, no tuyo. Hoy no cuelga de nada — el `create_task`
de H8 llegará por port, más adelante.

---

## 1. Contexto

Donde el emprendedor y su equipo ven qué hay que hacer. Suena simple y es el módulo que más
se usa a diario, así que la calidad de detalle importa más que la cantidad de funciones.

**Tu trabajo es sobre todo de resta.** GARDEN ya tiene un sistema de tareas nivel Notion — 7
vistas, filtros anidados, vistas guardadas compartibles. Es más de lo que el producto necesita.
**Portas y simplificas.**

---

## 2. Alcance

### Sí

1. Modelo de tareas y proyectos con jerarquía.
2. **Cuatro vistas, no siete**: por proyecto · por responsable · calendario · progreso.
3. Filtros que se prenden y apagan, y jerarquía configurable por vista.
4. Vistas guardadas.
5. Panel de detalle con subtareas, comentarios e historial.

### No

- **No** portes timeline (Gantt), galería ni tablero-por-empresa. **No** existe "empresa" aquí:
  el usuario tiene una sola.
- **No** el sistema de metas ni el roadmap del onboarding. Eso es H7 y H11.

---

## 3. Contrato de no colisión

| | |
|---|---|
| **Escribes sólo en** | `packages/work/**` y `apps/web/app/(app)/tareas/**` |
| **Migraciones** | `070`–`079` |
| **Rama** | `h9-work` · worktree `PLATAFORMA-h9-work` |

**Consumes:** `TenancyPort` (H2) para el contexto y los miembros del equipo.

---

## 4. Qué portar de GARDEN

`GARDEN/garden-os/components/tasks/*` + `lib/tasks-view.ts` son **~4,700 líneas** y el módulo
más reutilizable del repo. La lógica pura está en `lib/tasks-view.ts` (482 líneas) y **está
testeada** (`lib/__tests__/tasks-view.test.ts`).

| Portas | De |
|---|---|
| Tabla, tablero, lista, calendario | `components/tasks/{table,board,list,calendar}-view.tsx` |
| **Constructor de filtros anidado** | `filter-builder.tsx` (423) — 10 condiciones, AND/OR por grupo, 2 niveles |
| Vistas guardadas + deep-link | `view-tabs.tsx` + `lib/task-views-client.ts` |
| Pills editables in-place | `inline.tsx` (341) |
| Panel de detalle | `task-detail.tsx` (423) |
| API | `src/api/routes/{tasks,projects,task-views}.ts` |

**No portes:** `timeline-view.tsx`, `gallery-view.tsx`, `company-board-view.tsx` (678 líneas de
tablero por empresa — no aplica).

**Cambios obligatorios:**
- `company_id` (string) → `tenant_id` (uuid). Transversal.
- `companyBrand()` de `lib/brand.ts` tiene ids de empresa hardcodeados → lookup a datos.
- `assigned_by` default `'santiago'` (`tasks.ts:210`) → el usuario de la sesión.

**Conserva** dos cosas bien resueltas: el guard 409 al completar una tarea con subtareas
abiertas (con el modal *"Hay subtareas abiertas → Completar todas"*), y el reorder transaccional
por RPC.

---

## 5. Las cuatro vistas

| Vista | Agrupa por | Para qué |
|---|---|---|
| **Proyecto** | `project_id` | "¿cómo va cada cosa que estoy haciendo?" |
| **Responsable** | `assigned_to` | "¿quién trae qué?" — aparece cuando hay equipo |
| **Calendario** | `due_date` | "¿qué se vence esta semana?" |
| **Progreso** | `status` | El kanban de siempre |

Cada una con filtros on/off y jerarquía configurable. GARDEN ya tiene `groupBy` por responsable
y todo el constructor de filtros — es configuración, no código nuevo.

Jerarquía: `Proyecto → Tarea → Subtarea`. **Un solo nivel de subtareas.** GARDEN también tenía
hitos; aquí los hitos son del roadmap del negocio (H11), no de tareas.

---

## 6. Criterios observables de "listo"

1. Las cuatro vistas funcionan y comparten estado: filtrar en una y cambiar de vista conserva
   el filtro.
2. Deep-link: copiar la URL de una vista filtrada, abrirla en otra pestaña y ver lo mismo.
3. Completar una tarea con subtareas abiertas devuelve **409** y ofrece cerrarlas todas.
4. Reordenar en el tablero **persiste** y sobrevive a recargar.
5. Una vista guardada compartida la ven los demás miembros del tenant.
6. Un tenant no ve tareas de otro. Test automatizado.
7. Sin equipo, la vista "por responsable" no estorba — se degrada con elegancia.

---

## 7. LO QUE NO PUEDES CERRAR DORMIDO

**Buena noticia: eres el carril de la Ola 2 que menos depende de que Santiago despierte.** No
necesitas ninguna credencial externa: ni modelo, ni WhatsApp, ni Stripe. **Los siete criterios de
§6 se cierran hoy**, salvo por dos matices que hay que nombrar en vez de fingir.

| Criterio de §6 | El matiz | Sustituto que SÍ entregas |
|---|---|---|
| **#5 · una vista guardada compartida la ven los demás miembros** | No hay login (§0), así que no hay "los demás" de verdad: no puedes abrir dos navegadores con dos personas | Provisiona **un tenant con dos membresías** (`app.provision_tenant` + una fila en `app.memberships`) y prueba la visibilidad **en la capa de servicio**, con dos `TenantContext` distintos. Es donde vive la regla; la UI sólo la muestra. Deja anotado en el PR que la prueba con dos sesiones reales se cierra con **H18** |
| **#4 · reordenar persiste y sobrevive a recargar** | En CI no hay base, y el reorder transaccional de GARDEN es un RPC de Postgres | Dos niveles: el RPC va en tu migración `070`+ y se prueba **contra la base real** desde tu máquina (está migrada y vacía, es tuya para eso); y en CI, el doble de `packages/tenancy/src/testing/fake-postgrest.ts` cubre la lógica. **No dejes el reorder en JavaScript por comodidad**: dos personas arrastrando a la vez es exactamente lo que la transacción evita |

**Y una decisión de producto que no puedes consultar y ya está tomada en este documento:** cuatro
vistas, no siete; un solo nivel de subtareas; sin Gantt, sin galería, sin tablero-por-empresa. **Es
resta deliberada, no falta de tiempo.** Si al portar te dan ganas de traerte una octava vista
"porque ya estaba hecha", la respuesta es no: anótala en el PR y que él decida.

**Regla que no se negocia mientras él duerme:** ningún test que necesite base o red entra a CI.
El job `verify` corre `npm run build` justamente para probar que el repo compila sin un solo
secreto. Si tu módulo valida `process.env.DATABASE_URL` al importarse, rompes el build **de los 15
carriles**. Valida en la llamada, nunca en el import.

---

## 8. Prompt de arranque

```
ANTES DE ESCRIBIR NADA — freno duro. Pégalo tal cual; si imprime ESPERA, no escribas una línea.

(
  set -u
  W="/Volumes/FRAGUA/CLAUDE CODE/PLATAFORMA-h9-work"
  cd "$W" || { echo "ESPERA · no existe el worktree $W"; exit 1; }
  ok=1; mal() { echo "  ✖ $1"; ok=0; }
  echo "freno de arranque · H9 · $(git rev-parse --abbrev-ref HEAD)"
  for f in \
    packages/db/ports.ts \
    packages/db/src/tenant-db.ts \
    packages/ui/src/components/primitives/button.tsx \
    packages/ui/src/components/shell/app-shell.tsx \
    packages/ui/src/components/feedback/empty-state.tsx \
    packages/tenancy/src/services/memberships.ts \
    packages/tenancy/src/middleware/rbac.ts \
    packages/tenancy/src/testing/fake-postgrest.ts \
    migrations/010_tenancy.sql
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
packages/ui/src existe desde el día uno y `test -d` siempre dijo LISTO aunque no hubiera nada.
Y verifica dos cosas más que el freno viejo no miraba: que tu worktree traiga origin/main (los
worktrees se quedaron clavados dos commits atrás) y que exista node_modules (ninguno lo tenía).

Trabaja SIEMPRE desde /Volumes/FRAGUA/CLAUDE CODE/PLATAFORMA-h9-work (tu worktree, rama
h9-work ya activa). No hagas checkout ni switch.

Vas a construir H9 — Tareas y proyectos de ABRAXA Plataforma.

Lee primero, completo:
  docs/handoffs/H9-work.md           (tu handoff — la §0 ESTADO REAL manda sobre el resto)
  docs/handoffs/README.md            (el contrato de no colisión)
  apps/web/app/(app)/direccion/**    (la primera sección real del producto: cópiale el patrón)

Contexto: es donde el emprendedor y su equipo ven qué hay que hacer. Es el módulo que más se
usa a diario, así que la calidad de detalle importa más que la cantidad de funciones.

Tu trabajo es sobre todo de RESTA. GARDEN ya tiene un sistema de tareas nivel Notion — 7 vistas,
filtros anidados, vistas guardadas compartibles, ~4,700 líneas, con la lógica pura ya testeada.
Portas y simplificas a CUATRO vistas: por proyecto, por responsable, calendario y progreso.
GARDEN está en "/Volumes/FRAGUA/CLAUDE CODE/GARDEN" — consúltalo, NO lo edites.

NO portes: timeline (Gantt), galería, ni el tablero-por-empresa (678 líneas). Aquí no existe
"empresa" — el usuario tiene UNA sola.

Cambios obligatorios al portar: company_id (string) pasa a tenant_id (uuid) en todo; los ids de
empresa hardcodeados en lib/brand.ts pasan a lookup de datos; y assigned_by deja de tener
default 'santiago'. Ojo con el tipo: el equipo se identifica por CORREO — app.memberships es
(tenant_id, user_email, role) y app.users tiene email como llave primaria. assigned_to y
assigned_by guardan el correo, no un uuid.

Conserva dos cosas bien resueltas del original: el guard 409 al completar una tarea con
subtareas abiertas (con el modal que ofrece cerrarlas todas), y el reorder transaccional.

Trabajas SÓLO en packages/work/** y apps/web/app/(app)/tareas/**. Migraciones 070–079.
Otras conversaciones trabajan en paralelo (H6, H7, H10 y el carril nuevo H15 · CRM).

apps/web/app/(app)/tareas/page.tsx YA EXISTE: es el andamio de H1, con el comentario "ANDAMIO DE
H1 — bórralo y escribe lo tuyo". Lo reemplazas, no lo creas. El (app)/layout.tsx es de H5: no lo
toques.

Eres el carril de la Ola 2 que menos depende de credenciales: los 7 criterios se cierran hoy.
Lee la §7 por los dos matices honestos (no hay login, así que "los demás miembros" se prueba en
la capa de servicio con dos TenantContext; y el reorder transaccional va como RPC de verdad, no
en JavaScript).

Si algo del handoff está mal o incompleto, dilo y propón el arreglo antes de construir.
```
