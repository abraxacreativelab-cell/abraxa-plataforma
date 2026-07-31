# Handoffs — ABRAXA Plataforma

Cada documento es **autosuficiente**: la conversación que lo recibe no ha visto nada de este
proyecto. Contiene contexto, alcance, contrato de no colisión, qué reusar de GARDEN, criterios
observables de "listo" y un prompt de arranque para pegar tal cual.

Plan maestro: `~/.claude/plans/ok-este-producto-debe-dynamic-kazoo.md`

---

## Cómo se usa esto

1. Abre una conversación nueva de Claude Code (o Codex) **en el repo `abraxa-plataforma`**.
2. Pega el **prompt de arranque** que está al final del handoff.
3. La conversación lee su handoff completo y trabaja **sólo dentro de su carril**.
4. Al terminar, abre PR desde su rama. El gate de CI verifica que no se salió.
5. El orquestador (H0) mergea, aplica migraciones y despliega.

### ⚠️ Regla de arranque — no la saltes

**Antes de escribir un solo archivo, toda conversación corre el freno duro que está al final de
su handoff.** Cada uno es distinto porque cada carril depende de otras cosas, pero los tres
verifican lo mismo:

1. que existan **archivos de implementación** de quien dependes — nunca `test -d`;
2. que tu worktree **traiga `origin/main`**;
3. que exista **`node_modules`** y que estés en **Node 22**.

> **Por qué el punto 1 dice "archivos" y está subrayado.** Hasta el 2026-07-31 los cinco frenos
> de la Ola 2 probaban `test -d packages/<algo>/src`. H1 dejó stubs de dos archivos en los 12
> paquetes, así que **ese directorio existe desde el primer commit**: el freno imprimía `LISTO`
> aunque el carril del que dependías no hubiera escrito una línea. Se verificó ejecutándolo, en
> un worktree que además estaba dos commits atrás y sin `node_modules`, y dijo `LISTO`.
>
> Un freno que siempre dice que sí no es un freno.

> Y el arranque en paralelo también pasó de verdad, el 2026-07-30: se lanzaron H1 a H5 al mismo
> tiempo y cuatro conversaciones iban a crear cada una su propio `packages/db/ports.ts` y su
> propio `package.json` raíz — un conflicto a cuatro bandas sobre los archivos más importantes del
> repo. Se detectó a tiempo, y de ahí salió el gate.

---

## Olas — nunca más de 5 conversaciones a la vez

| Ola | Handoffs | Concurrencia | Estado al 2026-07-31 |
|---|---|---|---|
| **0** | H1 | **1 — va solo, todo lo demás espera** | ✅ en `main` |
| **1** | H2, H3, H4, H5 | 4 | ✅ los cuatro en `main` |
| **2** | H6, H7, H9, H10, **H15** | 5 | PRs abiertos y en verde |
| **3** | H8, H11, H12, H13, H14, **H18** | — | no arrancada |
| continuo | **H0 Orquestador** | atraviesa todas | — |

```
H1 → H3 → H6 → H7 → H11 → v1 usable        ← ruta crítica
     H6 → H15 ──► H8

Trámite Meta (Santiago) ──────────► H12     ← espera externa
```

**Dos movimientos del 2026-07-31, con su razón:**

- **H8 (automatizaciones) bajó de la Ola 2 a la Ola 3.** Cuatro de sus diez nodos y tres de sus
  ocho disparadores operan sobre contactos y embudo, que no existían; el worker nunca ha corrido
  (el schema `pgboss` no está creado); y su "ejecución en vivo por SSE" no era construible —
  `apps/api` y `apps/worker` son procesos distintos, así que un `EventEmitter` en proceso pasa las
  pruebas y no emite nada en producción. Se sustituyó por **polling de 1 s** detrás de una sola
  función de transporte. Todo en `H8-flows.md` §0.
- **Dos carriles nuevos.** **H15 · CRM** (contactos, identidades por canal, embudo, línea de
  tiempo) porque H6 y H8 lo daban por hecho el uno del otro y ninguno lo construía; y **H18 ·
  identidad** (login), que salió de H10 porque `apps/web/app/api/auth/**` no le pertenece a nadie
  en `.ownership.json` y un archivo huérfano pone en rojo el `--check-overlap` **de todos los
  PRs**, no sólo del suyo.

**H6 manda.** Es donde el agente empieza a contestar mensajes reales. Si algo se atrasa, que no
sea H6.

---

## Índice

| # | Documento | Ola | Ruta crítica |
|---|---|---|---|
| H0 | [Orquestador](H0-orquestador.md) | continuo | — |
| H1 | [Fundación del monorepo](H1-fundacion.md) | 0 | ✅ |
| H2 | [Tenancy](H2-tenancy.md) | 1 | |
| H3 | [Agents](H3-agents.md) | 1 | ✅ |
| H4 | [Vault](H4-vault.md) | 1 | |
| H5 | [Design system](H5-design-system.md) | 1 | |
| H6 | [Inbox + WhatsApp + agente↔inbox](H6-inbox.md) | 2 | ✅ |
| H7 | [Ritual de Fundación](H7-ritual.md) | 2 | ✅ |
| H8 | [Flows](H8-flows.md) | **3** ↓ | |
| H9 | [Work](H9-work.md) | 2 | |
| H10 | [Billing + landing](H10-billing.md) | 2 | |
| H11 | [Áreas y gamificación](H11-areas.md) | 3 | ✅ |
| H12 | [Driver Meta](H12-meta.md) | 3 | |
| H13 | [Drivers email + SMS](H13-email-sms.md) | 3 | |
| H14 | [Panel de agencia](H14-admin.md) | 3 | |
| H15 | CRM: contactos, embudo y línea de tiempo | 2 | ✅ |
| H18 | Identidad: inicio de sesión | 3 | |

> H15 y H18 se abrieron el 2026-07-31 (ver arriba). Sus handoffs llegan en el PR de su propio
> carril; hasta entonces esta tabla es lo único que los nombra.

---

## Contrato de no colisión — la ley

Un handoff que escribe fuera de su columna **rompe el plan**. El gate de CI `ownership-gate` lo
detecta y falla el PR con el archivo exacto.

| # | Directorios exclusivos | Migraciones | Rama |
|---|---|---|---|
| H0 | *ninguno* — sólo `docs/` y `deploy/` | *aplica*, no crea | — |
| H1 | raíz, `packages/config`, `packages/db`, `.github/`, stubs | `001`–`009` | `h1-fundacion` |
| H2 | `packages/tenancy/**` | `010`–`019` | `h2-tenancy` |
| H3 | `packages/agents/**` | `020`–`029` | `h3-agents` |
| H4 | `packages/vault/**`, `app/(app)/direccion/**` | `030`–`039` | `h4-vault` |
| H5 | `packages/ui/**`, `app/layout.tsx`, `app/globals.css` | — | `h5-design-system` |
| H6 | `packages/inbox/**` **excepto** `drivers/{meta,email,sms}`, `app/(app)/bandeja/**` | `040`–`049` | `h6-inbox` |
| H7 | `packages/onboarding/**`, `app/(onboarding)/**` | `050`–`059` | `h7-ritual` |
| H8 | `packages/flows/**`, `app/(app)/automatizaciones/**` | `060`–`069` | `h8-flows` |
| H9 | `packages/work/**`, `app/(app)/tareas/**` | `070`–`079` | `h9-work` |
| H10 | `packages/billing/**`, `app/(public)/**` | `080`–`089` | `h10-billing` |
| H11 | `packages/areas/**`, `app/(app)/mapa/**` | `090`–`099` | `h11-areas` |
| H12 | `packages/inbox/drivers/meta/**` | `100`–`104` | `h12-meta` |
| H13 | `packages/inbox/drivers/{email,sms}/**` | `105`–`109` | `h13-email-sms` |
| H14 | `apps/web/app/(admin)/**` | `110`–`119` | `h14-admin` |
| H15 | `packages/crm/**`, `app/(app)/contactos/**` | `120`–`129` | `h15-crm` |
| H18 | `apps/web/app/api/auth/**` (y lo que su PR declare) | `130`–`139` | `h18-identidad` |

> **La tabla no es la ley: `.ownership.json` lo es.** El gate la lee a ella. Si abres un carril
> nuevo, la fila de `.ownership.json` va **en el mismo PR** que el primer archivo — un archivo sin
> dueño hace fallar `--check-overlap`, que corre en el job `verify` **de todos los PRs abiertos**.
> Por eso H18 existe: `apps/web/app/api/auth/**` no era de nadie.

### Las cinco reglas

1. **Escribe sólo en tu árbol.** La tabla de arriba es la ley.
2. **Numera migraciones sólo en tu rango.** Jamás salgas de tu bloque de 10.
3. **No toques el cableado central.** H1 lo dejó hecho; nadie lo vuelve a editar.
4. **No instales dependencias.** H1 las instaló todas. Si falta una, anótala en el PR y no la instales.
5. **Programa contra interfaces, nunca contra implementaciones.** Los contratos cruzados están
   en `packages/db/ports.ts`. Si necesitas algo de otro handoff, usa su *port* — no esperes su código.

> La regla 5 es la que desbloquea todo. H8 (flows) necesita mandar WhatsApp, pero **no espera a
> H6**: programa contra `InboxPort`. Se encuentran en el merge.
