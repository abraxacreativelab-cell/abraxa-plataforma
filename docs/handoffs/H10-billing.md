# H10 — Landing, cobro y alta self-service

> **Ola 2.** Corre en paralelo con H6, H7 y H9 — **H8 se bajó a la Ola 3**, ver `H8-flows.md` §0.
> Requiere H1, H2 y H5 mergeados: **ya lo están, y también H3 y H4.** Lee la §0 antes que nada.
> **Ya no construyes el login con Google**: se movió a un carril nuevo, **H18 · identidad**.
> Rama: `h10-billing` · Migraciones: `080`–`089`
> Directorios: `packages/billing/**` y `apps/web/app/(public)/**`

---

## 0. ESTADO REAL AL 2026-07-31 — léelo antes que nada

Este handoff se escribió cuando el repo no tenía una sola línea de producto. Lo de abajo está
**verificado contra `origin/main` y contra la base real**, no recordado. Donde el resto del
documento y esta sección se contradigan, **manda esta sección**.

### El cambio grande: el login con Google sale de tu alcance

El punto 4 de la §2 —*"Login con Google y entrada al Ritual de Fundación"*— **ya no es tuyo**. Se
va a un carril nuevo, **H18 · identidad**. No es un capricho de organigrama; es que hacerlo desde
aquí **pone el CI en rojo para los 14 carriles a la vez**:

- NextAuth vive en `apps/web/app/api/auth/[...nextauth]/route.ts`. Esa ruta **no le pertenece a
  nadie** en `.ownership.json`: tus globs son `packages/billing/**` y `apps/web/app/(public)/**`,
  y los de H1 son `apps/web/app/**/page.tsx` y `**/layout.tsx`. Un `route.ts` no casa con ninguno.
- El gate lo trata como **archivo huérfano**: `verificarSolapamiento()` en
  `scripts/ownership-gate.mjs` junta `duenos.length === 0` y falla con *"Archivos sin dueño"*.
  Y `--check-overlap` **no corre sólo en tu PR: corre en el job `verify` de TODOS los PRs**
  (`.github/workflows/ci.yml`). En cuanto ese archivo entra a `main`, **todos los carriles se
  ponen rojos y ninguno puede mergear** hasta que alguien lo borre.
- Aparte, tu propio PR moriría antes: el archivo cae fuera de tus globs y el job `ownership-gate`
  te lo dice con el nombre exacto.
- Y no es sólo el gate: **hoy no hay sesión de ningún tipo**. Léelo en
  `apps/web/app/(app)/direccion/_lib/session.ts`, donde `correoDeLaSesion()` devuelve `null` a
  propósito y las pantallas de H4 muestran un estado honesto. Montar auth bien —callback, sesión
  en server components, el `TenantContext` verificado sin `x-user-email` falsificable— es un
  carril entero, no un punto de una lista de cinco.

**Lo que sí haces tú:** entregar al emprendedor en la puerta. El webhook provisiona el tenant y le
manda su link a `/ritual`. Quién es y cómo inicia sesión es de H18; el Ritual es de H7.

### Lo que SÍ está en main

**`origin/main` = `f6affc1e80049396087a1ff507aeeb96770ce326`.**

| Carril | Lo que te dejó — archivos que puedes abrir hoy |
|---|---|
| **H1 · fundación** | `packages/db/ports.ts` (los 8 ports), `packages/db/src/port-registry.ts`, el CI y el gate. Y tus dependencias **ya declaradas y en el lockfile**: `packages/billing/package.json` trae `stripe@^17.5.0`, `resend@^4.0.1` y `zod`. **No instales nada** (regla 4) y **no muevas el lockfile**: sólo H1 puede |
| **H2 · tenancy** (PR #6) | `packages/tenancy/src/services/provision.ts` — **`TenancyPort.provision()` existe y está registrado**, con la función SQL `app.provision_tenant` (migración `011`) detrás, idempotente por slug |
| **H5 · design system** | `packages/ui/src/components/primitives/*`, `lib/accent.ts`, `styles.css`. **Tokens listos: no inventes ni un hex** |
| **H3 · agentes** y **H4 · bóveda** | Ya en main; no los consumes, pero `apps/web/app/(app)/direccion/**` es la primera sección real del producto y vale como referencia de estilo |

**La base real ya está migrada** (proyecto Supabase `ievnkmodselrlkazkzoy`):

- **13 migraciones aplicadas** — `001, 010, 011, 012, 020, 021, 022, 023, 024, 030, 031, 032, 033`.
  `npm run migrate` responde **0 pendientes**.
- **`app.plans` YA EXISTE y trae 2 filas** (migración `010`, de H2). **No la crees**: tu
  `080_billing.sql` sólo la referencia, como ya está escrito en la §6. La migración `024` de H3 lo
  dice explícito: *"el catálogo de planes es de H10 y todavía no existe"* — eso ya cambió, el
  catálogo lo sembró H2 y tú lo consumes.
- **19 tablas y `tablas_sin_rls = 0`.** Tus dos tablas se suman a esa cuenta.
- **`app.tenants` está VACÍA.** Tu webhook será el primero en escribir ahí de verdad.

### Lo que NO existe todavía, aunque el documento lo dé por hecho

- `packages/billing/src/` tiene **exactamente dos archivos**: `index.ts` y `meta.ts`, los stubs de
  H1. Igual `inbox`, `onboarding`, `flows`, `work` y `areas`. **Por eso el freno de arranque de
  este handoff mentía**: probaba `test -d packages/tenancy/src`, y ese directorio existe siempre.
  El freno corregido está en §10.
- `apps/web/app/(public)/page.tsx` **ya existe**: es el andamio de H1 ("bórralo y escribe lo
  tuyo"), con el título *"Tu negocio, operando solo"*. Lo reemplazas, no lo creas.
- **No hay `.env`** (sólo `.env.example`) y GitHub **no tiene secretos**: `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET` y `RESEND_API_KEY` no están puestos en ningún lado. Ver §9.
- **No hay dominio.** `mi.abraxa.club` no apunta a nada todavía; el DNS es de Santiago.
- No hay protección de rama (repo privado sin GitHub Pro): **el gate de CI es la única ley**, y
  nadie te va a impedir mergear en rojo. No lo hagas.

---

## 1. Contexto

La puerta de entrada. Un emprendedor llega a `mi.abraxa.club`, entiende en treinta segundos qué
es esto, paga **lo que quiera** (donación de monto libre, por ahora), y en el siguiente clic ya
está conversando con su agente maestro.

**Sin intervención humana.** Ese es el criterio: si tú tienes que meter la mano para dar de
alta a alguien, no está listo.

---

## 2. Alcance

### Sí

1. **Landing de venta** — qué es, para quién, qué cambia en su negocio.
2. **Stripe Checkout con monto libre.**
3. **Webhook → alta automática del tenant.**
4. **Suscripciones**: tu modelo cuelga de `app.plans`, que **ya existe con 2 filas** (H2). No la
   creas; la referencias.
5. **El correo de bienvenida con su link a `/ritual`** — ahí termina tu carril.

### No

- **No** el login con Google. **Se movió a H18 · identidad**, y la razón está en la §0: crear
  `apps/web/app/api/auth/[...nextauth]/` desde aquí deja un archivo sin dueño y pone en rojo el
  `--check-overlap` de **todos** los PRs, no sólo el tuyo.
- **No** el panel de agencia. Es H14.
- **No** el provisioning en sí. Es `TenancyPort.provision()` de H2 — tú lo llamas.
- **No** el onboarding conversacional. Es H7 — tú lo entregas ahí y te quitas.
- **No** el catálogo de planes. Ya está sembrado en la migración `010`.

---

## 3. Contrato de no colisión

| | |
|---|---|
| **Escribes sólo en** | `packages/billing/**` y `apps/web/app/(public)/**` |
| **Migraciones** | `080`–`089` |
| **Rama** | `h10-billing` · worktree `PLATAFORMA-h10-billing` |

**Implementas:** `BillingPort`.
**Consumes:** `TenancyPort.provision()` (H2) — contra la interfaz.

---

## 4. El flujo completo

```
mi.abraxa.club  (landing)
   ↓ "Empieza"
Stripe Checkout — monto libre (customer chooses price)
   ↓ pago
webhook checkout.session.completed
   ↓
BillingPort.onCheckoutCompleted()
   ↓
TenancyPort.provision({ slug, name, ownerEmail })   ← H2
   ↓
crea subscription + marca el plan
   ↓
correo al emprendedor con su link            ← AQUÍ TERMINA TU CARRIL
   ↓
inicio de sesión                              ← H18 · identidad (no existe todavía)
   ↓
/(onboarding)/ritual → su agente lo saluda    ← H7
```

**Dónde te detienes exactamente.** Mientras H18 no exista no hay sesión de ningún tipo
(`apps/web/app/(app)/direccion/_lib/session.ts`: `correoDeLaSesion()` devuelve `null` a
propósito). Tu correo lleva un link a `/ritual` con un **token de un solo uso, con expiración,
guardado en tu tabla**, y ese token es lo que H18 canjeará por una sesión de verdad. No inventes
cookies, no leas `x-user-email`, no montes NextAuth. Un token firmado con expiración es lo
conservador y es lo que se puede probar dormido.

**El slug** se deriva del nombre del negocio que capturas antes del pago, normalizado y con
sufijo si choca. Que sea legible: `mi.abraxa.club/panaderia-lupita`, no un uuid.

---

## 5. Reglas del webhook — donde se rompen las integraciones de pago

1. **Verifica la firma.** Siempre. `stripe.webhooks.constructEvent` con el signing secret.
2. **Idempotencia.** Stripe reintenta. Guarda el `event.id` y descarta repetidos. `provision()`
   ya es idempotente por slug (H2), pero no dependas sólo de eso.
3. **Responde 200 rápido**, haz el trabajo pesado después. Si tardas, Stripe reintenta y tienes
   dos altas en vuelo.
4. **Si `provision()` falla, NO devuelvas 200.** Deja que Stripe reintente. Un pago cobrado sin
   cuenta creada es el peor estado posible.
5. **Registra todo evento**, incluidos los que ignoras. Cuando alguien reclame que pagó y no
   tiene cuenta, ese log es la única forma de saber qué pasó.

---

## 6. Modelo de datos

```sql
-- 080_billing.sql
-- app.plans NO se crea aquí: existe desde la migración 010 (H2), con 2 filas.
CREATE TABLE app.subscriptions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  stripe_customer_id     text,
  stripe_subscription_id text,
  plan_id                text NOT NULL REFERENCES app.plans(id),
  status                 text NOT NULL,
  amount_usd             numeric(10,2),
  current_period_end     timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)
);

-- tenantless: los eventos de Stripe llegan ANTES de que el tenant exista.
CREATE TABLE app.billing_events (
  id            bigserial PRIMARY KEY,
  stripe_event_id text UNIQUE NOT NULL,
  type          text NOT NULL,
  payload       jsonb NOT NULL,
  processed_at  timestamptz,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
```

`billing_events` **no lleva `tenant_id`** — llegan antes de que el tenant exista. **La escotilla
del gate no es "documéntalo": es una línea exacta**, un comentario `-- tenantless: <razón>` en
alguna de las **3 líneas justo antes** del `CREATE TABLE` (`scripts/ownership-gate.mjs`,
`revisarMigracion`). Ya está escrita arriba, cópiala tal cual. Lo que **no** perdona el gate es
la RLS: `ALTER TABLE app.billing_events ENABLE ROW LEVEL SECURITY;` va en el mismo archivo, sin
excepción, y no la hay para `app.subscriptions` tampoco.

> Dato para que no te asustes: en el schema `app` hoy hay **19 tablas, 19 con RLS y 0 políticas**.
> Es fail-closed a propósito (`migrations/README.md`), no un olvido. El acceso va por el service
> role desde el servidor; `anon` y `authenticated` ni siquiera tienen `USAGE` sobre el schema.

---

## 7. La landing

Público: un emprendedor mexicano, probablemente solo, que trabaja demasiado y sospecha que
podría automatizar algo pero no sabe qué.

**Habla de su vida, no de tu tecnología.** No "plataforma multi-agente con RAG". Sí "tu negocio
contesta mientras duermes".

Lo mínimo: qué es en una frase · qué cambia en su día · cómo se ve · cuánto cuesta (lo que quiera
dar) · empezar.

Usa el design system de H5. **No inventes tokens ni metas hex.**

**Sobre "cómo se ve": hoy no hay producto que capturar.** Cuando se escribió esto se pedían
*"capturas reales, no mockups"*, y la única sección terminada es `/direccion` (la bóveda de H4).
La regla al 2026-07-31 es: **una captura real de lo que ya existe, o un hueco honesto** con el
`empty-state` de H5. **Nada inventado**: ni testimonios, ni logos de clientes, ni números de
resultados. Un espacio vacío se lee como "está en construcción"; un testimonio falso es fraude, y
además hay que borrarlo después.

Pon **todo el texto en un solo archivo de contenido** (un `contenido.ts` que exporte las cadenas),
no repartido en el JSX. Es lo que hace que Santiago pueda reescribir la landing entera en diez
minutos sin tocar código — y va a querer hacerlo.

Cuando exista contenido real de un cliente piloto, cámbialo por eso. Nada vende como algo que
de verdad está funcionando.

---

## 8. Criterios observables de "listo"

1. **La prueba que importa:** pagar con una tarjeta de prueba de Stripe y terminar conversando
   con el agente maestro, **sin que nadie meta la mano**.
2. Un webhook reenviado dos veces **no** crea dos tenants.
3. Firma inválida → rechazado y registrado.
4. Si `provision()` falla, el webhook **no** devuelve 200 y Stripe reintenta.
5. Dos negocios con el mismo nombre obtienen slugs distintos, ambos legibles.
6. La landing carga en menos de 2 segundos y se ve bien en un teléfono de gama media.
7. El correo de bienvenida llega con un link que funciona.

> El criterio *"login con Google"* que estaba implícito en el #1 **ya no es tuyo**: es de H18.
> Tu #1 termina cuando el tenant existe y el correo salió con su link.

---

## 9. LO QUE NO PUEDES CERRAR DORMIDO

Eres el carril que más depende de credenciales externas, y **no hay ni una**: no existe `.env`, y
el repositorio de GitHub no tiene secretos. Esto es lo que **no** se cierra hoy, y con qué se
sustituye sin fingir.

| Criterio de §8 | Por qué no se puede | Sustituto que SÍ entregas |
|---|---|---|
| **#1 · pagar con tarjeta de prueba y terminar en el agente** | Exige `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` y una cuenta de Stripe. Y su último tramo depende de H18 (sesión) y H7 (ritual) | La cadena **desde el webhook** sí se prueba entera y sin red: `stripe.webhooks.generateTestHeaderString()` firma un `checkout.session.completed` con **tu** secreto de prueba, y `constructEvent` lo verifica de verdad — es criptografía local, no un mock. De ahí: `provision()`, `subscriptions`, correo, token. Lo único sin cubrir es la UI de Checkout, que es de Stripe. Deja en `packages/billing/README.md` el runbook exacto para correrlo con `stripe listen` cuando haya llaves |
| **#3 · firma inválida → rechazado y registrado** | — | **Éste sí se cierra hoy, entero.** Firma buena, firma mala, firma vieja fuera de la ventana de tolerancia, cuerpo alterado. Es la prueba más barata y la que más veces salva un cobro |
| **#7 · el correo de bienvenida llega** | Exige `RESEND_API_KEY` | Transporte detrás de una interfaz con dos implementaciones: la de Resend y una que **escribe el correo a un log/archivo**. En CI corre la segunda y se verifica el destinatario, el asunto y que **el link del token funcione**. Que Resend entregue es de Resend |
| **#6 · la landing carga en 2 s y se ve en un teléfono** | No hay dominio (`mi.abraxa.club` no apunta a nada) ni capturas reales del producto | Mide en `next build` + local, no en producción. **Y la trampa de contenido: la §7 pide "capturas reales, no mockups", y hoy no hay producto que capturar.** Deja los huecos marcados con el `empty-state` de H5 y **NO inventes**: ni testimonios, ni logos de clientes, ni métricas. Un espacio vacío es honesto; un testimonio falso es fraude |

**Decisiones de producto que no puedes consultar y que tomas conservadoras**, anotándolas en el PR:

- **Monto libre**: sugiere un monto por defecto pero **permite cualquiera ≥ el mínimo que Stripe
  acepta**. No pongas un mínimo alto "por si acaso" — el documento dice *"paga lo que quiera"*.
- **Plan asignado al alta**: el más bajo de los **2 que ya existen** en `app.plans`. Que pagar más
  no desbloquee nada todavía es correcto: es una donación, no un plan.
- **Copy de la landing**: escríbelo, no lo dejes vacío. Habla de su vida, no de la tecnología.
  Y ponlo **todo en un solo archivo de contenido** para que Santiago lo reescriba sin tocar JSX.

**Regla que no se negocia mientras él duerme:** ningún test que necesite red entra a CI, y el job
`verify` corre `npm run build` justamente para probar que el repo compila sin un solo secreto. Si
tu módulo hace `new Stripe(process.env.STRIPE_SECRET_KEY!)` **en el import**, rompes el build de
**los 15 carriles**. Instancia perezosamente, dentro de la función.

---

## 10. Prompt de arranque

```
ANTES DE ESCRIBIR NADA — freno duro. Pégalo tal cual; si imprime ESPERA, no escribas una línea.

(
  set -u
  W="/Volumes/FRAGUA/CLAUDE CODE/PLATAFORMA-h10-billing"
  cd "$W" || { echo "ESPERA · no existe el worktree $W"; exit 1; }
  ok=1; mal() { echo "  ✖ $1"; ok=0; }
  echo "freno de arranque · H10 · $(git rev-parse --abbrev-ref HEAD)"
  for f in \
    packages/db/ports.ts \
    packages/tenancy/src/services/provision.ts \
    packages/tenancy/src/services/plans.ts \
    packages/tenancy/src/routes/index.ts \
    packages/ui/src/components/primitives/button.tsx \
    packages/ui/src/lib/accent.ts \
    migrations/010_tenancy.sql \
    migrations/011_provision.sql
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
packages/tenancy/src existe desde el día uno y `test -d` siempre dijo LISTO aunque no hubiera nada.
Y verifica dos cosas más que el freno viejo no miraba: que tu worktree traiga origin/main (los
worktrees se quedaron clavados dos commits atrás) y que exista node_modules (ninguno lo tenía).

Trabaja SIEMPRE desde /Volumes/FRAGUA/CLAUDE CODE/PLATAFORMA-h10-billing (tu worktree, rama
h10-billing ya activa). No hagas checkout ni switch.

Vas a construir H10 — la landing, el cobro y el alta self-service de ABRAXA Plataforma.

Lee primero, completo:
  docs/handoffs/H10-billing.md       (tu handoff — la §0 ESTADO REAL manda sobre el resto)
  docs/handoffs/README.md            (el contrato de no colisión)
  packages/db/ports.ts               (implementas BillingPort, consumes TenancyPort)
  packages/tenancy/src/services/provision.ts  (provision() YA existe: lo llamas, no lo escribes)

Contexto: eres la puerta de entrada. Un emprendedor llega a mi.abraxa.club, entiende en 30
segundos qué es esto, paga lo que quiera (donación de monto libre por ahora) y en el siguiente
clic ya está conversando con su agente maestro. SIN INTERVENCIÓN HUMANA — ese es el criterio.

El flujo: landing → Stripe Checkout monto libre → webhook → TenancyPort.provision() → correo
con su link. AHÍ TERMINA TU CARRIL. El inicio de sesión es de H18 (identidad) y el Ritual de
Fundación es de H7.

NO construyas el login con Google. Se movió a H18 y la razón es dura: NextAuth vive en
apps/web/app/api/auth/[...nextauth]/route.ts, esa ruta no le pertenece a NADIE en
.ownership.json, y el gate la trata como archivo huérfano. --check-overlap corre en el job
`verify` de TODOS los PRs, así que en cuanto ese archivo entra a main se ponen rojos los 14
carriles y ninguno puede mergear. Tu correo lleva un token de un solo uso con expiración,
guardado en tu tabla; H18 lo canjea por una sesión de verdad.

app.plans YA EXISTE con 2 filas (migración 010, de H2). No la crees: la referencias.
apps/web/app/(public)/page.tsx YA EXISTE: es el andamio de H1 ("bórralo y escribe lo tuyo").

Sobre la landing: el público es un emprendedor mexicano que trabaja demasiado y sospecha que
podría automatizar algo pero no sabe qué. Habla de su vida, no de nuestra tecnología. No
"plataforma multi-agente con RAG"; sí "tu negocio contesta mientras duermes". Usa el design
system de H5 — no inventes tokens ni metas hex.

Trabajas SÓLO en packages/billing/** y apps/web/app/(public)/**. Migraciones 080–089.
Otras conversaciones trabajan en paralelo (H6, H7, H9 y el carril nuevo H15 · CRM).

Las cinco reglas del webhook de la sección 5 son donde se rompen todas las integraciones de
pago. La #4 sobre todo: si provision() falla, NO devuelvas 200 — deja que Stripe reintente. Un
pago cobrado sin cuenta creada es el peor estado posible del sistema.

NO hay STRIPE_SECRET_KEY, ni STRIPE_WEBHOOK_SECRET, ni RESEND_API_KEY, ni .env, ni secretos en
GitHub. Lee la §9: el webhook se prueba ENTERO y sin red firmando eventos con
stripe.webhooks.generateTestHeaderString() y verificándolos con constructEvent — es criptografía
local, no un mock. El correo va detrás de una interfaz con dos implementaciones (Resend y una que
escribe a un log). Y nunca instancies Stripe en el import: si lo haces, rompes `npm run build` de
los 15 carriles. Instancia dentro de la función.

En la landing NO inventes contenido: no hay producto que capturar todavía, así que nada de
testimonios, logos de clientes ni métricas falsas. Hueco honesto con el empty-state de H5, y todo
el copy en un solo archivo de contenido para que Santiago lo reescriba sin tocar JSX.

Si algo del handoff está mal o incompleto, dilo y propón el arreglo antes de construir.
```
