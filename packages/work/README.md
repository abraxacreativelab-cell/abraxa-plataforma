# @abraxa/work

Tareas y proyectos. Donde el emprendedor y su equipo ven qué hay que hacer.

| | |
|---|---|
| **Handoff** | H9 · `docs/handoffs/H9-work.md` |
| **Rama** | `h9-work` |
| **Migraciones** | `070_work.sql` |
| **Montado en** | `apps/api` → `/work` · pantalla en `apps/web/app/(app)/tareas/` |
| **Port que implementa** | `WorkPort` (`createTask`) |
| **Ports que consume** | `TenancyPort.listMembers` — con `tryPort`, no espera a H2 |

---

## Las cuatro vistas

| Vista | Agrupa por | Responde |
|---|---|---|
| **Proyecto** | `project_id` | ¿Cómo va cada cosa que estoy haciendo? |
| **Responsable** | `assigned_to` | ¿Quién trae qué? |
| **Calendario** | `due_date` | ¿Qué se vence esta semana? |
| **Progreso** | `status` | El tablero de siempre |

Las cuatro leen **el mismo conjunto** y lo derivan en memoria: filtrar → armar el
árbol → agrupar. Por eso cambiar de pestaña es instantáneo y el filtro sobrevive
al cambio.

La agrupación por defecto es sólo el punto de partida: cada vista lleva la suya
y se puede cambiar sin tocarle la de las demás.

---

## El mapa

```
src/
  domain/      lógica PURA y probada — no importa @abraxa/db ni express
    types.ts            vocabulario: estados, prioridades, filas
    view.ts             filtros (10 condiciones, AND/OR a 2 niveles), orden,
                        presets de las 4 vistas, enlace profundo
    group.ts            agrupación, etiquetas, progreso, sort_order al soltar
    calendar.ts         rejilla del mes, vencidas, "qué se vence en N días"
    hierarchy.ts        árbol de un nivel y el guard de subtareas abiertas
    reorder.ts          validación y decisión del 409, antes de escribir
    workspace-state.ts  el reductor de la pantalla (criterios 1 y 2)
    format.ts           fechas y nombres en español, en hora LOCAL
  data/        puente a Postgres
    errors.ts           errores de la base → PlatformError
    rpc.ts              las dos funciones transaccionales de la 070
  services/    el trabajo real, siempre por tenantDb(ctx)
  routes.ts    la API HTTP
  port.ts      WorkPort
```

`@abraxa/work/domain` es una entrada aparte y **client-safe**: no arrastra
Express ni el cliente de Supabase al navegador. `domain/purity.test.ts` lo
verifica en cada corrida.

---

## Lo que se portó de GARDEN, y lo que no

`GARDEN/garden-os/components/tasks/*` + `lib/tasks-view.ts` son ~4,700 líneas.
El trabajo fue sobre todo de **resta**.

**Sí:** las diez condiciones de filtro y los grupos anidados, las vistas
guardadas con enlace profundo, el panel de detalle, el guard 409 y el reorder
transaccional.

**No:** `timeline-view.tsx` (Gantt), `gallery-view.tsx` y `company-board-view.tsx`
(678 líneas de tablero por empresa). Aquí no existe "empresa": el usuario tiene
una. Tampoco los hitos — son del roadmap del negocio (H11).

**Cambios obligatorios que sí se hicieron:**

- `company_id` (text) → `tenant_id` (uuid), transversal.
- Los ids de empresa que `lib/brand.ts` traía escritos en el código → lookup a
  los datos ya cargados (`groupLabelOf`).
- `assigned_by` deja de tener default `'santiago'` (`tasks.ts:210`): lo llena el
  usuario de la sesión.

---

## Las dos cosas que la base impone, no la interfaz

Escriben tareas tres clientes distintos (la pantalla, el `WorkPort` de H8, las
tools del agente maestro de H3). Un invariante que sólo vive en una ruta HTTP se
rompe por la puerta de al lado.

- **Jerarquía de un solo nivel** — trigger `tasks_guard_hierarchy`. Además, una
  subtarea hereda el proyecto de su padre, y padre y proyecto tienen que ser del
  mismo tenant (las FK no lo garantizan).
- **Guard 409 y reorder atómico** — `app.reorder_tasks(p_tenant, p_items)` y
  `app.complete_task_cascade(p_tenant, p_task, p_actor)`.

`service_role` hace bypass de RLS, así que el aislamiento de esas funciones lo
pone `p_tenant`, que inyecta `data/rpc.ts` y el llamador no puede quitar.

---

## Pruebas

```bash
npm test -- packages/work
```

Cubren los siete criterios observables del handoff: el filtro que sobrevive al
cambio de vista, el ida y vuelta por la URL, el 409 con la lista de subtareas,
el reorder que persiste, la vista compartida que ven los del tenant y sólo
ellos, el tenant que no ve las tareas de otro, y la vista "por responsable" que
se esconde cuando no hay equipo.
