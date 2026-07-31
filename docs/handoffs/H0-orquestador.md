# H0 — Orquestador

> **Rol continuo**, no un handoff de construcción. Se ejecuta cada vez que una rama está lista.
> **No escribe código de producto.** Sólo `docs/`, `deploy/` y el plan.

---

## 1. Por qué existe este documento

Por defecto lo hace la conversación que escribió el plan. Existe escrito porque **esa
conversación se acaba** —se queda sin contexto, o se cierra— y el rol tiene que ser reanudable
por una conversación nueva sin perder el criterio.

---

## 2. Lo que NO debe ser juicio de nadie

GARDEN ya pagó esta lección, y está en su propio código
(`BOB/src/fragua/orchestrator.ts:477-484`): entre el 2026-07-16 y el 07-29, **el reviewer mató
17 de 71 corridas** con `review_never_passed`, porque corría en sandbox de sólo lectura, no
podía verificar, y ante la duda pedía rework.

> **Un revisor que no puede verificar de forma determinista se vuelve un cuello de botella que
> rechaza trabajo bueno.**

Por eso el contrato de no colisión se aplica con el gate de CI `ownership-gate`, no con opinión:

| Verifica | Falla si |
|---|---|
| Propiedad | el diff toca algo fuera de los globs del handoff |
| Migraciones | un archivo cae fuera de su bloque de 10 |
| Lockfile | `package-lock.json` cambió |
| Secretos | el diff trae `sk-`, `sbp_`, `whsec_`, `gh[pousr]_` o `PRIVATE KEY` |
| Calidad | typecheck, lint, test o build en rojo |

**Si los cinco pasan, se mergea. No hay debate en el PR.**

---

## 3. Lo que sí requiere al orquestador

Cinco cosas que ninguna máquina decide y que ningún handoff puede hacer desde su carril:

**1. Orden de migraciones.** El merge puede ir en cualquier orden —los árboles son disjuntos—
pero las migraciones se aplican en **orden numérico estricto** contra Supabase
(`ievnkmodselrlkazkzoy`).

**2. Despliegue y rollback.** Con el aislamiento de §9.1 del plan: `/opt/plataforma`, procesos
`plat-*`, puertos 3040-3042, bloque nginx propio para `mi.abraxa.club`. **Un deploy del producto
no reinicia ningún proceso de Garden.**

**3. Verificación de integración.** Los 7 criterios del §12 del plan. Son cruzados por
naturaleza: probar que el agente contesta un WhatsApp real toca inbox + agents + tenancy +
usage_ledger a la vez.

**4. Arbitraje real.** Si dos handoffs necesitan de verdad el mismo archivo, **se corrige la
tabla de propiedad y se re-emiten los dos documentos.** No se negocia dentro de un PR.

**5. Mantener el plan honesto.** Cuando la realidad contradiga al plan, gana la realidad y el
documento se actualiza. Es el fallo que este proyecto hereda de GARDEN y no repite.

---

## 4. Secuencia de olas

```
OLA 0   H1                          ← SOLA. Todo lo demás espera
OLA 1   H2 · H3 · H4 · H5           ← 4 en paralelo
OLA 2   H6 · H7 · H8 · H9 · H10     ← 5 en paralelo
OLA 3   H11 · H12 · H13 · H14       ← 4 en paralelo
```

**Antes de soltar una ola, verifica que sus dependencias estén en `main`.** El comando está en
cada prompt; córrelo tú también.

---

## 5. Worktrees — la lección del 2026-07-30

Cinco conversaciones en el mismo directorio comparten **un solo `HEAD` de git**. No pueden estar
en ramas distintas. Cada handoff tiene su worktree:

```bash
git worktree add ../PLATAFORMA-<rama> -b <rama> origin/main
```

Ya están creados los 14. La conversación **nunca** hace `checkout` ni `switch`: ya está donde
debe.

---

## 6. Incidentes registrados

Vale la pena que la siguiente conversación los conozca — los dos costaron cero porque se
detectaron antes de que se escribiera código, y los dos eran evitables.

| Fecha | Qué pasó | Corrección |
|---|---|---|
| 2026-07-30 | Se lanzaron H1–H5 al mismo tiempo. Las cuatro de la ola 1 iban a crear cada una su propio `packages/db/ports.ts` | Freno duro al inicio de cada prompt: `test -f packages/db/ports.ts` |
| 2026-07-30 | Las 5 conversaciones en el mismo directorio → un solo `HEAD` de git | 14 worktrees aislados |
| 2026-07-30 | Nadie estaba construyendo H1 — se asumió que lo hacía el orquestador | H1 es una conversación de construcción, **no** es H0 |

---

## 7. Estado de la infraestructura

| Pieza | Valor |
|---|---|
| Supabase | proyecto `abraxa-plataforma`, ref `ievnkmodselrlkazkzoy`, `us-east-1` |
| Repo | `abraxacreativelab-cell/abraxa-plataforma` (privado) |
| Dominio | `mi.abraxa.club` → `187.77.9.8` (DNS propagado) |
| VPS | compartido con Garden, aislamiento en §9.1 del plan |
| Plan maestro | `~/.claude/plans/ok-este-producto-debe-dynamic-kazoo.md` |

**Pendiente de Santiago:** trámite de Meta (el más largo) · key de Anthropic + verificar si hay
API de workspaces · Stripe · Supabase a Pro antes del primer cobro · Twilio A2P · Resend.

---

## 8. Frontera

**El orquestador no escribe código de producto.** Sólo `docs/`, `deploy/` y el plan. Si descubre
que falta algo, **emite un handoff nuevo** — no lo construye él.

Así el revisor sigue siendo independiente de quien construye, que es la única razón por la que
una revisión vale algo.

---

## 9. Prompt de arranque (para retomar el rol)

```
Vas a tomar el rol de H0 — Orquestador de ABRAXA Plataforma.

Lee primero, completo:
  docs/handoffs/H0-orquestador.md    (este rol)
  docs/handoffs/README.md            (el contrato de no colisión y el índice)
  ~/.claude/plans/ok-este-producto-debe-dynamic-kazoo.md   (el plan maestro)

No escribes código de producto. Revisas, mergeas, aplicas migraciones, despliegas y verificas.
Si descubres que falta algo, emites un handoff nuevo — no lo construyes tú.

Estado actual: revisa qué ramas existen en origin, qué PRs están abiertos y qué ola está
corriendo. Compáralo con la secuencia de olas de la sección 4.

Tu criterio central: el contrato de no colisión se aplica con el gate de CI, no con opinión.
Si los cinco chequeos pasan, se mergea sin debate. Tu juicio se reserva para las cinco cosas
de la sección 3 — orden de migraciones, despliegue, verificación de integración, arbitraje y
mantener el plan honesto.
```
