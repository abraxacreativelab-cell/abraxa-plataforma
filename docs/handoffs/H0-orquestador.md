# H0 — Orquestador

> **Rol continuo**, no un handoff de construcción. Se ejecuta cada vez que una rama está lista.
> **No escribe código de producto.** Sólo `docs/`, `deploy/`, los guiones, las leyes del repo
> y —desde el 2026-07-31 y con razón escrita— el borde HTTP compartido (§8.3).

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

> Caso resuelto el 2026-07-31: el alta de **H15 (CRM)** se escribe en `.ownership.json` y en
> `scripts/ownership-gate.test.mjs`, que son de `h0-integracion`. Si la escribía el propio
> carril, su gate marcaba los dos archivos como ajenos; si no la escribía, el mapa fusionado
> dejaba dos archivos con dueños concurrentes y `--check-overlap` —que corre en el PR de los
> **otros 15** carriles— se ponía rojo para todos. **Dar de alta un carril es un acto del
> orquestador**, así que el alta se hizo desde `main` y el PR #9 no tiene que pelearla.

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
| 2026-07-31 | `packages/agents/src/routes.ts:34-48` armaba el `TenantContext` con `x-user-email` **crudo**. Inofensivo sólo porque `usePort('tenancy')` devuelve 501; el merge del PR #6 lo convertía en escalada de privilegios entre clientes | `proxyVerified()` antes de mirar un solo header de identidad, fail-closed en producción, con `routes.test.ts` corriendo **con el port de tenancy registrado** (el único mundo donde la falla es explotable) |
| 2026-07-31 | `packages/db/src/index.ts:6` re-exportaba `serviceClient()` —bypass de RLS— y **ninguna** regla de lint lo impedía. La promesa de H1 ("el aislamiento está en el lint") era falsa | `no-restricted-imports` con `importNames` en `eslint.config.mjs`, más la ruta profunda al barril. Verificado que nadie lo usaba fuera de `packages/db` |
| 2026-07-31 | `.ownership.json` no tenía fila para H0 → el orquestador no podía commitear **ni documentación**: `resolverHandoff` mata la rama que no tiene entrada | Fila `h0-integracion` + `excepcionTransversal` (§8.1) |
| 2026-07-31 | **El mismo agujero, cuatro veces.** El PR #12 cerró `x-user-email` sin verificar en `packages/agents`; la auditoría lo encontró escrito de nuevo desde cero en H6 (PR #10) y H7 (PR #8), y buscándolo apareció una cuarta copia en H4 — **ya en `main`**, montada en `/vault`, con el port de tenancy registrado y sin una sola llamada a `proxyVerified()`: dos cabeceras inventadas leían la bóveda de cualquier empresa | §8.3. Pieza canónica `contextoDePeticion()` en `@abraxa/db`, regla de ESLint sobre las cabeceras de identidad, y las tres copias colapsadas a re-exports |
| 2026-07-31 | La `excepcionTransversal` del PR #12 seguía escrita después de mergear: permiso permanente sobre `packages/agents` para un trabajo terminado | Campo `venceEn` obligatorio. El gate no honra una excepción vencida ni una sin fecha de caducidad, y **falla el siguiente PR de H0 hasta que se retire** |

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

**El orquestador no escribe código de producto de nadie.** Sólo `docs/`, `deploy/`, `scripts/`,
las leyes del repo (`.ownership.json`, `eslint.config.mjs`, `CONTRIBUTING.md`) y el borde HTTP
compartido `packages/db/src/http/**` (§8.3). Si descubre que falta algo, **emite un handoff
nuevo** — no lo construye él.

Así el revisor sigue siendo independiente de quien construye, que es la única razón por la que
una revisión vale algo.

`packages/db/src/http/**` es la única salvedad y no es un permiso amplio: son ~150 líneas que
**todos** los carriles usan y que **ninguno** puede reescribir. Está ahí precisamente para que
H0 no necesite una excepción transversal cada vez que se encuentre un agujero en el borde de
autenticación. Cualquier otra cosa dentro de `packages/db` sigue siendo de H1.

### 8.1 La única excepción: seguridad que no puede esperar

La frontera tiene un agujero honesto, porque el 2026-07-31 se encontró uno real: un header de
identidad sin verificar en el árbol de H3, con el detonador puesto en el merge de H2.

Emitir un handoff para eso significaba dejar el agujero abierto hasta que alguien despertara. Y
"lo dejamos anotado" es exactamente cómo GARDEN acumuló 145 tablas sin RLS.

Por eso `.ownership.json` tiene, dentro de `h0-integracion`, un campo `excepcionTransversal`:

```json
"excepcionTransversal": {
  "fecha": "2026-07-31",
  "venceEn": "2026-08-14",
  "pr": "…",
  "razon": "…",
  "paths": ["packages/agents/src/routes.ts", "…"]
}
```

Seis candados, y ninguno depende de que alguien se acuerde:

1. **Sólo H0.** `pathsEfectivos()` la ignora en cualquier otra rama — un carril de construcción
   no puede concederse permiso para salirse de su carril. Probado en `ownership-gate.test.mjs`.
2. **Rutas explícitas.** Nunca `packages/<otro>/**`. La prueba rechaza el glob de paquete entero.
3. **Fecha, PR y razón escrita**, o la prueba falla.
4. **No transfiere propiedad.** `duenosDe()` no la mira, así que `--check-overlap` sigue diciendo
   la verdad y el archivo sigue siendo de su handoff.
5. **Se anuncia en la salida del gate.** Un permiso que se aplica en silencio es un permiso que
   nadie audita.
6. **Caduca sola.** `venceEn` es obligatorio: sin él la excepción **no se honra** (fail-closed), y
   vencida tampoco. Además el gate **falla el siguiente PR de H0** hasta que se retire, aunque
   ese PR no toque ninguna de sus rutas.

El candado 6 se puso el 2026-07-31 porque el 5 no bastó: el PR #12 se concedió una excepción, la
usó, mergeó — y la dejó escrita. **Un permiso temporal que nadie retira es un permiso
permanente**, y "acuérdate de borrarlo" no es un mecanismo. Ahora lo es
(`excepcionVigente()` en `scripts/ownership-gate.mjs`, con su tabla de casos en el test).

**No aplica a nada que no sea seguridad.** Un bug, un refactor o una mejora vuelven a la regla
de siempre: se emite un handoff.

### 8.2 Deuda declarada (abierta)

| Qué | Dónde | Se cierra cuando |
|---|---|---|
| `adminDb()` sigue permitido fuera de `routes/` y `services/` — 7 archivos legítimos lo usan para tablas globales (`app.model_pricing`, `app.tenants`, `app.plans`). Prohibirlo del todo rompería `main`, el PR #6 y el PR #7 | `eslint.config.mjs` | Alguien decida si las tablas globales merecen su propio helper tipado (`globalDb()`) en `packages/db`. Es de H1, no de H0 |
| La regla de lint de las cabeceras de identidad **no cubre `apps/web`**, que es donde vivirá el BFF. Ahí poner `x-user-email` es lo correcto, así que la regla haría ruido; pero tampoco hay nada que verifique que el BFF lo saca de la sesión y no de la query | `eslint.config.mjs`, `apps/web` | Exista el BFF (H5/H10). Entonces se le escribe su propia prueba: la cabecera sale de `getServerSession()`, nunca de `req` |
| `packages/tenancy/src/middleware/tenant.ts` sigue leyendo las cabeceras por su cuenta en vez de usar `correoVerificadoDe()`. Es correcto —hace `proxyVerified()` primero— y es el árbol de H2, no de H0 | `packages/tenancy/src/middleware/tenant.ts` | H2 despierte para otra cosa. No es urgente: el orden de las puertas está bien y `proxy.test.ts` lo cubre |

**Saldada el 2026-07-31:** `proxyVerified()` estaba duplicado en `packages/agents` y en
`packages/tenancy`. Las dos copias son hoy un `export … from '@abraxa/db'` de una línea (§8.3).

### 8.3 La pieza canónica del contexto (2026-07-31)

El PR #12 cerró un agujero. La auditoría encontró **el mismo agujero, escrito de nuevo desde
cero, en otros tres carriles** — y el cuarto ya estaba en `main` sirviendo la bóveda.

> Un carril que se equivoca es un error. **Cuatro es un defecto de diseño.**

La causa raíz no era descuido: cada carril tenía que escribir su propio `contextoDe` porque el
patrón correcto no estaba disponible como pieza importable. Mientras eso siguiera así, cada
carril nuevo lo iba a volver a escribir mal.

**El símbolo canónico:**

```ts
import { contextoDePeticion } from '@abraxa/db';
const ctx = await contextoDePeticion(req);
```

| | |
|---|---|
| Símbolo | `contextoDePeticion(req): Promise<TenantContext>` |
| Ruta de import | `@abraxa/db` |
| Implementación | `packages/db/src/http/tenant-context.ts` |
| Acompañantes | `correoVerificadoDe(req)` (identidad sin empresa), `proxyVerified(req)`, `responderError(res, err)` |
| Dueño | `h0-integracion` — `packages/db/src/http/**` es el único código de producto que es de H0 |

**Por qué en `@abraxa/db` y no en `@abraxa/tenancy`,** que es el dueño natural de la identidad:
porque `@abraxa/db` es el único paquete del que **ya dependen los catorce carriles**. Un carril
lo adopta con una línea de `import` dentro de su propio árbol. Puesta en `@abraxa/tenancy`,
adoptarla exigía editarle su `package.json` —que es de H1— **y el lockfile**, es decir una
intervención del orquestador por carril. Una pieza que no se puede adoptar sola no evita que la
vuelvan a escribir; que la hayan reescrito cuatro veces es la prueba.

La identidad sigue siendo de H2: `contextoDePeticion` resuelve la membresía por
`usePort('tenancy').contextFor()` —la regla 5 del contrato—, nunca importando el paquete.

**Tres cosas la sostienen, y ninguna es disciplina:**

1. **ESLint** marca la lectura directa de `x-user-email` / `x-tenant-slug` / `x-proxy-secret`
   fuera de la pieza canónica. Verificado contra el código real de los PRs #10 y #8: marca
   exactamente las líneas del hallazgo (`inbox/routes/index.ts:180,181,186` y
   `onboarding/routes.ts:31,32,37`).
2. **La tabla de casos** vive en `packages/db/src/http/*.test.ts`. Las de `tenancy` y `agents`
   quedaron como pruebas de contrato sobre el re-export (`expect(proxyVerified).toBe(canonico)`).
3. **La propiedad**: `packages/db/src/http/**` es de H0 con dueño único, así que un agujero aquí
   se arregla en un archivo y queda arreglado en los catorce carriles.

**Lo que tienen que hacer los PRs abiertos al rebasar:** borrar su `contextoDe` y su copia de
`proxy-verified`, e importar `contextoDePeticion` de `@abraxa/db`. Es un borrado, no un
refactor. Afecta a **#10 (H6 inbox)**, **#8 (H7 ritual)** y **#9 (H15 CRM)**.

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
