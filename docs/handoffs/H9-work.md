# H9 — Tareas y proyectos

> **Ola 2.** Corre en paralelo con H6, H7, H8 y H10. Requiere H1 y H5 mergeados.
> Rama: `h9-work` · Migraciones: `070`–`079`
> Directorios: `packages/work/**` y `apps/web/app/(app)/tareas/**`

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

## 7. Prompt de arranque

```
ANTES DE ESCRIBIR NADA: verifica que H1 y H5 hayan mergeado.
  test -f packages/db/ports.ts && test -d packages/ui/src && echo LISTO || echo "ESPERA"
Si falta alguno, NO crees estructura. Lee tu handoff, estudia GARDEN, prepara tu plan.

Trabaja SIEMPRE desde /Volumes/FRAGUA/CLAUDE CODE/PLATAFORMA-h9-work (tu worktree, rama
h9-work ya activa). No hagas checkout ni switch.

Vas a construir H9 — Tareas y proyectos de ABRAXA Plataforma.

Lee primero, completo:
  docs/handoffs/H9-work.md           (tu handoff)
  docs/handoffs/README.md            (el contrato de no colisión)

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
default 'santiago'.

Conserva dos cosas bien resueltas del original: el guard 409 al completar una tarea con
subtareas abiertas (con el modal que ofrece cerrarlas todas), y el reorder transaccional.

Trabajas SÓLO en packages/work/** y apps/web/app/(app)/tareas/**. Migraciones 070–079.
Otras 4 conversaciones trabajan en paralelo.

Si algo del handoff está mal o incompleto, dilo y propón el arreglo antes de construir.
```
