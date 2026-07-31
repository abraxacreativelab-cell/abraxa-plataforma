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

**El freno prueba ARCHIVOS de implementación, nunca directorios.** `test -d packages/agents/src`
pasa en verde desde que H1 dejó los stubs: no prueba que H3 haya mergeado, prueba que existe una
carpeta. Los handoffs H16–H18 ya lo hacen así (`test -f packages/agents/src/ledger/budget.ts`), y
los de H6, H10, H12 y H13 todavía usan `test -d` — si retomas uno de ésos, cambia el freno por el
archivo concreto del que depende tu carril antes de creerle.

---

## Olas — nunca más de 5 conversaciones a la vez

| Ola | Handoffs | Concurrencia | Estado al 2026-07-31 |
|---|---|---|---|
| **0** | H1 | **1 — va solo, todo lo demás espera** | ✅ en `main` |
| **1** | H2, H3, H4, H5 | 4 | ✅ los cuatro en `main` |
| **2** | H6, H7, H9, H10, **H15** | 5 | PRs abiertos y en verde |
| **3** | H8, H11, H12, H13, H14 | — | no arrancada |
| **4** | **H16**, **H17**, **H18** | 3 | emitidos el 2026-07-31, no arrancados |
| continuo | **H0 Orquestador** | atraviesa todas | — |

```
H1 → H3 → H6 → H7 → H11 → v1 usable        ← ruta crítica
     H6 → H15 ──► H8

H18 ──────────────────────────────► TODO    ← sin sesión no entra nadie
H17 ──────────────────────────────► H12, H13

Trámite Meta (Santiago) ──────────► H12     ← espera externa
```

**Dos movimientos del 2026-07-31, con su razón:**

- **H8 (automatizaciones) bajó de la Ola 2 a la Ola 3.** Cuatro de sus diez nodos y tres de sus
  ocho disparadores operan sobre contactos y embudo, que no existían; el worker nunca ha corrido
  (el schema `pgboss` no está creado); y su "ejecución en vivo por SSE" no era construible —
  `apps/api` y `apps/worker` son procesos distintos, así que un `EventEmitter` en proceso pasa las
  pruebas y no emite nada en producción. Se sustituyó por **polling de 1 s** detrás de una sola
  función de transporte. Todo en `H8-flows.md` §0.
- **Cuatro carriles nuevos** — H15, H16, H17 y H18, uno por hueco, con su evidencia en la tabla
  de más abajo. El primero, **H15 · CRM**, porque H6 y H8 lo daban por hecho el uno del otro y
  ninguno lo construía. El último, **H18 · identidad** (login), salió de H10 porque
  `apps/web/app/api/**` no le pertenecía a nadie en `.ownership.json` y un archivo huérfano pone
  en rojo el `--check-overlap` **de todos los PRs**, no sólo del suyo.

**H6 manda.** Es donde el agente empieza a contestar mensajes reales. Si algo se atrasa, que no
sea H6.

**H17 se adelanta a su ola.** Está en la 4, pero **tiene que mergear antes que H12 y H13**
(`H17-integraciones.md` §Entregables, punto 6-7): mientras las credenciales de canal sean
variables del proceso, dos clientes comparten el mismo WhatsApp. Si la Ola 3 arranca antes que la
4, H12 y H13 esperan a H17 — no al revés.

**Y H18 es la puerta.** Hoy `correoDeLaSesion()` devuelve `null`
(`apps/web/app/(app)/direccion/_lib/session.ts`) y por lo tanto **nadie puede iniciar sesión en el
producto**. Todo lo demás funciona por debajo y no se puede tocar desde un navegador.

### Los cuatro carriles emitidos después del reparto original

H1–H14 salieron del plan maestro. H15–H18 salieron de huecos que se encontraron **construyendo**,
y ninguno se podía cerrar desde la columna de nadie:

| # | El hueco, en una frase | Evidencia |
|---|---|---|
| H15 | No hay tabla de contactos | `H6-inbox.md:110` declara `contact_id` sin `REFERENCES` porque no había a qué apuntar |
| H16 | Los planes sólo tienen números, y un tenant suspendido sigue gastando | `assertQuota` no tiene un solo llamador de producción; el webhook no pasa por `contextFor()` |
| H17 | Las credenciales de canal son del proceso, no de la empresa | `.env.example:44-51` — ocho variables globales, cero dimensión de tenant |
| H18 | No existe la sesión sobre la que está construido todo | `session.ts` → `correoDeLaSesion()` es `return null;` |

---

## Antes de escribir una ruta: `contextoDePeticion()`

> **Ningún router de dominio escribe su propio `contextoDe`. Se importa el canónico.**

```ts
import { contextoDePeticion, responderError } from '@abraxa/db';
const ctx = await contextoDePeticion(req);
```

Entre el 2026-07-30 y el 07-31, **cuatro carriles** escribieron cada uno su propio resolvedor de
contexto a partir de las cabeceras, y **tres salieron mal igual**: leían `x-user-email` sin
comprobar antes el secreto compartido del BFF. Uno llegó a `main` y estuvo sirviendo la bóveda a
cualquiera con `curl`. Un carril que se equivoca es un error; cuatro es un defecto de diseño —el
patrón correcto no existía como pieza importable—, y por eso ahora existe.

`contextoDePeticion` exige `proxyVerified()` **antes** de mirar una sola cabecera de identidad,
falla cerrado en producción sin `PROXY_SECRET`, y resuelve la membresía por
`usePort('tenancy')`. Para identidad **sin** empresa (alta, invitación, ritual):
`correoVerificadoDe(req)`.

**ESLint marca la lectura directa** de esas cabeceras fuera de la pieza canónica: falla tu PR.
El detalle está en [CONTRIBUTING.md](../../CONTRIBUTING.md#quién-pide-contextodepeticion) y en
[H0 §8.3](H0-orquestador.md).

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
| H16 | [Entitlements y ciclo de vida del plan](H16-entitlements.md) | 4 | |
| H17 | [Integraciones por tenant](H17-integraciones.md) | 4 | ✅ |
| H18 | [Identidad: NextAuth, sesión y BFF](H18-identidad.md) | 4 | ✅ |

> **H15 va sin enlace a propósito.** Su carril y su entrada en `.ownership.json` ya están dados de
> alta desde `main`, pero **`H15-crm.md` todavía no existe aquí**: llega con el **PR #9**, escrito
> por el carril que lo construyó. Se lista porque el carril existe y H16, H17 y H18 lo dan por
> hecho; se deja sin enlazar para no dejar un enlace roto en `main`. En cuanto el PR #9 mergee,
> esta fila se enlaza como las demás.

---

## Contrato de no colisión — la ley

Un handoff que escribe fuera de su columna **rompe el plan**. El gate de CI `ownership-gate` lo
detecta y falla el PR con el archivo exacto.

| # | Directorios exclusivos | Migraciones | Rama |
|---|---|---|---|
| H0 | `docs/`, `deploy/`, `scripts/`, `.ownership.json`, `eslint.config.mjs`, `CONTRIBUTING.md`, `packages/db/src/http/**` | *aplica*, no crea | `h0-integracion` |
| H1 | raíz, `packages/config`, `packages/db` **excepto** `src/http/`, `.github/`, stubs | `001`–`009` | `h1-fundacion` |
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
| H16 | `packages/tenancy/{,src/}entitlements/**`, `app/(app)/ajustes/plan/**` | `130`–`139` | `h16-entitlements` |
| H17 | `packages/integrations/**`, `app/(app)/ajustes/integraciones/**` | `140`–`149` | `h17-integraciones` |
| H18 | `packages/auth/**`, `app/api/**`, `app/(app)/ajustes/**` **excepto** `plan` e `integraciones` | `150`–`159` | `h18-identidad` |

> **La tabla no es la ley: `.ownership.json` lo es.** El gate la lee a ella. Si abres un carril
> nuevo, la fila de `.ownership.json` va **en el mismo PR** que el primer archivo — un archivo sin
> dueño hace fallar `--check-overlap`, que corre en el job `verify` **de todos los PRs abiertos**.
> Por eso H18 existe: `apps/web/app/api/**` no era de nadie.
>
> **H18 se lleva `apps/web/app/api/**` entero, no sólo `api/auth`.** Es lo que decidió su handoff
> al emitirse, y por la misma razón: un subárbol sin dueño bloquea al primero que escriba en él.
> Si otro carril necesita ahí una ruta de servidor propia, se le excluye un subárbol, como H6 hizo
> con H12 y H13. Y su bloque de migraciones es `150`–`159`, no `130`–`139`: ése es de H16.
>
> **`migrations/README.md` es de H1 y todavía no trae H15–H18.** Hasta que lo alinee, la fuente es
> esta tabla y `.ownership.json`, que son las que el gate lee.

### Las cinco reglas

1. **Escribe sólo en tu árbol.** La tabla de arriba es la ley.
2. **Numera migraciones sólo en tu rango.** Jamás salgas de tu bloque de 10.
3. **No toques el cableado central.** H1 lo dejó hecho; nadie lo vuelve a editar.
4. **No instales dependencias.** H1 las instaló todas. Si falta una, anótala en el PR y no la instales.
5. **Programa contra interfaces, nunca contra implementaciones.** Los contratos cruzados están
   en `packages/db/ports.ts`. Si necesitas algo de otro handoff, usa su *port* — no esperes su código.

> La regla 5 es la que desbloquea todo. H8 (flows) necesita mandar WhatsApp, pero **no espera a
> H6**: programa contra `InboxPort`. Se encuentran en el merge.
