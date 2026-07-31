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

**Antes de escribir un solo archivo, toda conversación verifica que su ola esté habilitada:**

```bash
test -f packages/db/ports.ts && echo "H1 listo, puedes construir" || echo "ESPERA: H1 no ha mergeado"
```

Si `packages/db/ports.ts` no existe, **H1 todavía no termina**. No crees estructura, no
instales dependencias, no escribas migraciones. Usa el tiempo para leer tu handoff y estudiar
el código de GARDEN que vas a portar, y prepara tu plan.

> Esto pasó de verdad el 2026-07-30: se lanzaron H1 a H5 al mismo tiempo. Cuatro conversaciones
> iban a crear cada una su propio `packages/db/ports.ts` y su propio `package.json` raíz — un
> conflicto a cuatro bandas sobre los archivos más importantes del repo. Se detectó a tiempo.

**El freno prueba ARCHIVOS de implementación, nunca directorios.** `test -d packages/agents/src`
pasa en verde desde que H1 dejó los stubs: no prueba que H3 haya mergeado, prueba que existe una
carpeta. Los handoffs H16–H18 ya lo hacen así (`test -f packages/agents/src/ledger/budget.ts`), y
los de H6, H10, H12 y H13 todavía usan `test -d` — si retomas uno de ésos, cambia el freno por el
archivo concreto del que depende tu carril antes de creerle.

---

## Olas — nunca más de 5 conversaciones a la vez

| Ola | Handoffs | Concurrencia |
|---|---|---|
| **0** | H1 | **1 — va solo, todo lo demás espera** |
| **1** | H2, H3, H4, H5 | 4 |
| **2** | H6, H7, H8, H9, H10 | 5 |
| **2·bis** | H15 | 1 — emitido después del reparto original |
| **3** | H11, H12, H13, H14 | 4 |
| **4** | H16, H17, H18 | 3 |
| continuo | **H0 Orquestador** | atraviesa todas |

```
H1 → H3 → H6 → H7 → H11 → v1 usable        ← ruta crítica
     │    └──► H8
     └──────► H15 ──► H8 (nodos de CRM) · H6 (contact_id)

H18 ──────────────────────────────► TODO    ← sin sesión no entra nadie
H17 ──────────────────────────────► H12, H13

Trámite Meta (Santiago) ──────────► H12     ← espera externa
```

**H6 manda.** Es donde el agente empieza a contestar mensajes reales. Si algo se atrasa, que no
sea H6.

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
| H17 | Las credenciales de canal son del proceso, no de la empresa | `.env.example:43-51` — ocho variables globales, cero dimensión de tenant |
| H18 | No existe la sesión sobre la que está construido todo | `session.ts` → `correoDeLaSesion()` es `return null;` |

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
| H8 | [Flows](H8-flows.md) | 2 | |
| H9 | [Work](H9-work.md) | 2 | |
| H10 | [Billing + landing](H10-billing.md) | 2 | |
| H11 | [Áreas y gamificación](H11-areas.md) | 3 | ✅ |
| H12 | [Driver Meta](H12-meta.md) | 3 | |
| H13 | [Drivers email + SMS](H13-email-sms.md) | 3 | |
| H14 | [Panel de agencia](H14-admin.md) | 3 | |
| H15 | [CRM: contactos, embudo y línea de tiempo](H15-crm.md) | 2·bis | ✅ |
| H16 | [Entitlements y ciclo de vida del plan](H16-entitlements.md) | 4 | |
| H17 | [Integraciones por tenant](H17-integraciones.md) | 4 | ✅ |
| H18 | [Identidad: NextAuth, sesión y BFF](H18-identidad.md) | 4 | ✅ |

> **`H15-crm.md` todavía no está en `main`:** llega con el **PR #9**, junto con el carril ya
> construido y su entrada en `.ownership.json`. Se lista aquí porque el carril existe y H16, H17 y
> H18 lo dan por hecho — no para adelantarlo. Hasta que ese PR mergee, el enlace apunta a un
> archivo que sólo vive en la rama `h15-crm`.

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
| H16 | `packages/tenancy/{,src/}entitlements/**`, `app/(app)/ajustes/plan/**` | `130`–`139` | `h16-entitlements` |
| H17 | `packages/integrations/**`, `app/(app)/ajustes/integraciones/**` | `140`–`149` | `h17-integraciones` |
| H18 | `packages/auth/**`, `app/api/**`, `app/(app)/ajustes/**` **excepto** `plan` e `integraciones` | `150`–`159` | `h18-identidad` |

> **Las tres tablas equivalentes de `CONTRIBUTING.md` §1 y `migrations/README.md` son de H1** y
> todavía no traen H15–H18. Está anotado para que H1 las alinee en una pasada; hasta entonces,
> **esta tabla y `.ownership.json` son la fuente**, porque son las que el gate lee.

### Las cinco reglas

1. **Escribe sólo en tu árbol.** La tabla de arriba es la ley.
2. **Numera migraciones sólo en tu rango.** Jamás salgas de tu bloque de 10.
3. **No toques el cableado central.** H1 lo dejó hecho; nadie lo vuelve a editar.
4. **No instales dependencias.** H1 las instaló todas. Si falta una, anótala en el PR y no la instales.
5. **Programa contra interfaces, nunca contra implementaciones.** Los contratos cruzados están
   en `packages/db/ports.ts`. Si necesitas algo de otro handoff, usa su *port* — no esperes su código.

> La regla 5 es la que desbloquea todo. H8 (flows) necesita mandar WhatsApp, pero **no espera a
> H6**: programa contra `InboxPort`. Se encuentran en el merge.
