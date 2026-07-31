# H16 — Entitlements y ciclo de vida del plan

> **Ola 4.** Corre en paralelo con H17 y H18. Requiere H1, H2 y H3 mergeados.
> Rama: `h16-entitlements` · Migraciones: `130`–`139`
> Directorios: `packages/tenancy/entitlements/**`, `packages/tenancy/src/entitlements/**`
> y `apps/web/app/(app)/ajustes/plan/**`
> Worktree: `/Volumes/FRAGUA/CLAUDE CODE/PLATAFORMA-h16-entitlements`

---

## 1. Contexto

El producto ya sabe **cuánto** puede hacer una empresa. No sabe **qué** puede hacer, y no sabe
qué pasa cuando deja de pagar.

Ese es tu carril entero. No es una función más: es la diferencia entre un producto con planes y
un producto que cobra. Hoy un cliente que canceló sigue teniendo exactamente el mismo sistema
que uno que paga, y sigue gastando dinero nuestro en tokens.

**No construyes el cobro.** Cobrar es H10, que ya está construido y esperando merge (PR #11). Tú
construyes lo que el cobro **compra**, y lo que se apaga cuando deja de pagarse.

---

## 2. El hueco, con archivo y línea

Cinco cosas verificadas en el repo el 2026-07-31. Ninguna es una opinión: cada una tiene su
línea.

### 2.1 Los límites son sólo números

`app.plans.limits` se siembra en `migrations/010_tenancy.sql:107-114` con seis llaves, y las
seis son numéricas:

```
maxSeats · maxContacts · maxChannels · maxFlows · maxAgents · monthlyAiUsd
```

`PlanLimits` en `packages/tenancy/src/types.ts:92-98` es exactamente ese objeto, y
`QuotaKey = keyof PlanLimits` (`types.ts:100`).

**No hay un solo eje booleano.** No existe forma de expresar "este plan incluye automatizaciones"
o "este plan no incluye Instagram". Y esas dos preguntas son las que un plan de verdad contesta:
la gente no paga por un contador más alto, paga por una función que antes no tenía.

### 2.2 De seis límites, uno se aplica

`assertQuota(ctx, key, used)` (`packages/tenancy/src/services/plans.ts:83`) recibe el consumo de
quien llama, y está bien que así sea: H2 no es dueño de `contacts` ni de `flows`, no puede
contarlos sin invadir otro carril.

El problema es que **nadie llama**. La única llamada de producción en todo el repo es
`assertSeatAvailable` desde `packages/tenancy/src/services/invitations.ts:96`. `assertQuota`
aparece 4 veces más y las 4 están en `plans.test.ts`.

| Límite | ¿Quién lo cuenta? | ¿Se aplica? |
|---|---|---|
| `maxSeats` | `seatsFor()` — H2, porque las membresías son suyas | **Sí** |
| `maxContacts` | nadie | no |
| `maxChannels` | nadie | no |
| `maxFlows` | nadie | no |
| `maxAgents` | nadie | no |
| `monthlyAiUsd` | nadie *por esta vía* — ver 2.3 | no |

### 2.3 Hay dos catálogos de planes y no coinciden

`migrations/024_agent_budgets.sql:44-48` siembra `app.agent_plan_limits` con **cuatro** planes:

```
free · starter · pro · agency
```

`migrations/010_tenancy.sql:107-114` siembra `app.plans` con **dos**: `free` y `pro`. Y la 010
también pone la llave foránea:

```sql
ALTER TABLE app.tenants
  ADD CONSTRAINT tenants_plan_fkey FOREIGN KEY (plan) REFERENCES app.plans(id);
```

Como el runner aplica por nombre de archivo, la 010 corre **antes** que la 024. Resultado
comprobable: **ningún tenant puede tener `plan = 'starter'` ni `'agency'`.** La FK lo impide. Las
dos filas de `agent_plan_limits` son código muerto que se ve vivo — el peor tipo.

Peor todavía: `monthlyAiUsd` vive en `app.plans.limits` y `monthly_budget_usd` vive en
`app.agent_plan_limits`, con valores distintos para el mismo plan (`free`: 5 y 5.00 —
coinciden hoy por casualidad; `pro`: 50 contra 100.00 — **ya no coinciden**). Dos números que
dicen lo mismo y no dicen lo mismo. Unificarlos es tuyo.

### 2.4 El tenant suspendido sigue contestando y sigue gastando

Ésta es la que cuesta dinero real.

`contextFor()` (`packages/tenancy/src/services/context.ts:63-79`) sí niega la entrada a un tenant
cuyo `status` no es `active`. Es correcto y está bien hecho.

Pero **el webhook entrante no pasa por `contextFor()`**. Pasa por `contextoDeCanal()`
(`packages/inbox/src/context.ts`, rama `h6-inbox`), que arma el `TenantContext` a partir de la
fila del canal y de nada más:

```ts
return { tenantId, tenantSlug: canal.tenant_slug ?? '', userEmail: null, role: null, areas: {} };
```

No mira `app.tenants.status`. No puede: la fila del canal no lo trae. Es un atajo **correcto**
para lo que fue diseñado —acotar a un tenant sin sesión— y su archivo lo explica con honestidad.
Lo que nadie escribió es el paso siguiente.

**Consecuencia hoy:** suspendes una empresa por falta de pago, esa empresa se queda fuera del
producto… y su WhatsApp sigue recibiendo mensajes, su agente sigue contestando, y cada respuesta
sigue cargando tokens a nuestra cuenta de Anthropic. Un cliente que dejó de pagar es el que más
nos cuesta.

### 2.5 Un trabajo encolado con plan alto corre con plan bajo

`apps/worker/src/index.ts` es un andamio limpio: `registerQueue()`, `pg-boss`, `batchSize: 1`.
No tiene —ni debe tener— nada de negocio.

Pero tampoco tiene punto de verificación. Un job encolado el martes con plan `pro`, que corre el
jueves después de una baja a `free`, **corre igual**. El único momento en que alguien mira el
plan es al encolar, si es que alguien lo mira.

Es el modo de fallo clásico de todo sistema con cola y con planes, y no aparece hasta que hay
suficiente volumen para que la cola tenga latencia. Se cierra ahora, cuando la cola está vacía.

---

## 3. Alcance

### Sí

1. **Eje de funciones booleanas** — `can(ctx, 'flows.publish')`, con catálogo en base de datos.
2. **Overrides por tenant** — la excepción con nota obligatoria, como ya hizo H3 con el presupuesto.
3. **402 contra 403** — no contratado no es lo mismo que sin permiso.
4. **Semántica de degradación** — pausar, nunca borrar.
5. **`assertEntitled()` en el punto de ejecución**, no sólo al encolar.
6. **La puerta del tenant no activo en el camino sin sesión** (webhooks, worker, cron).
7. Unificación de los dos catálogos de planes (2.3) y de los dos números de presupuesto.
8. Pantalla `/ajustes/plan`: qué incluye tu plan, qué estás usando, qué te falta.

### No

- **No** cobras. Stripe, checkout y webhooks de pago son H10. Tú lees el resultado.
- **No** cambias `TenancyPort` ni ningún port de `packages/db/ports.ts`. Es de H1 (§9).
- **No** cuentas contactos, flujos ni canales tú mismo. Expones `assertQuota` para que cada
  dueño cuente lo suyo y te lo pase. Contar tú significaría leer las tablas de otros carriles.
- **No** construyes el panel de agencia donde el staff cambia planes a mano. Es H14; tú le das
  la operación y él pinta el botón.
- **No** borras datos de nadie, nunca, por ninguna razón de plan. Ver §7.

---

## 4. Contrato de no colisión

| | |
|---|---|
| **Escribes sólo en** | `packages/tenancy/entitlements/**` · `packages/tenancy/src/entitlements/**` · `apps/web/app/(app)/ajustes/plan/**` |
| **Migraciones** | `130`–`139`, ni una fuera |
| **Rama** | `h16-entitlements` — igual que tu llave en `.ownership.json` |
| **Worktree** | `/Volumes/FRAGUA/CLAUDE CODE/PLATAFORMA-h16-entitlements` |
| **No toques** | el resto de `packages/tenancy/**` (es de H2) · `packages/db/**` · `apps/worker/src/index.ts` · el lockfile |

**Vives dentro del paquete de H2 pero en un subárbol que es tuyo.** `.ownership.json` le puso a
`h2-tenancy` las exclusiones `!packages/tenancy/entitlements/**` y
`!packages/tenancy/src/entitlements/**`, igual que H6 se las puso a H12 y H13 para
`drivers/meta` y `drivers/email`. El gate lo verifica en cada PR: si escribes un carácter en
`packages/tenancy/src/services/plans.ts`, tu PR muere nombrando el archivo.

**Consumes:** `TenancyPort` (H2) contra la interfaz · `usage_ledger` de H3 **sólo de lectura**.
**Te consumen:** H6 (la puerta del webhook) · H8 (publicar un flujo) · H10 (aplicar el resultado
de un cambio de suscripción) · H12 y H13 (¿este plan incluye este canal?) · H14 (overrides).

### Por qué esto no cabía dentro de H2

H2 mergeó el 2026-07-31 (PR #6) y su alcance escrito dice, textual: *"Planes y cuotas (el
modelo, no el cobro — eso es H10)"* — `H2-tenancy.md:36`. Cumplió: dejó el modelo. Lo que
falta no es una corrección de su trabajo, es la capa que nadie escribió porque no estaba
asignada a nadie: H2 dejó el modelo, H10 dejó el cobro, y **entre los dos quedó el hueco de qué
compra el dinero**.

Abrir el árbol de H2 completo para esto sería re-despertar un carril dormido y hacer que
cualquier cambio tuyo pueda romper el aislamiento entre clientes, que es lo único que ese
paquete de verdad protege. El subárbol es más estrecho a propósito.

---

## 5. Modelo de datos

```sql
-- 130_entitlements.sql

-- tenantless: catálogo de la plataforma. Qué funciones existen, no quién las tiene.
CREATE TABLE app.features (
  key         text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  label       text NOT NULL,
  -- Lo que se le enseña a quien topa el 402. Es copy de producto, no un mensaje de error.
  blurb       text NOT NULL,
  -- Qué le pasa a lo que ya existe cuando la función se apaga. Ver §7.
  on_downgrade text NOT NULL CHECK (on_downgrade IN ('pause', 'readonly', 'keep')),
  position    int  NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app.features ENABLE ROW LEVEL SECURITY;

-- tenantless: qué incluye cada plan. Igual para todos los clientes del mismo plan.
CREATE TABLE app.plan_features (
  plan_id     text NOT NULL REFERENCES app.plans(id) ON UPDATE CASCADE ON DELETE CASCADE,
  feature_key text NOT NULL REFERENCES app.features(key) ON UPDATE CASCADE ON DELETE CASCADE,
  PRIMARY KEY (plan_id, feature_key)
);
ALTER TABLE app.plan_features ENABLE ROW LEVEL SECURITY;

-- La excepción por cliente. Gana sobre el plan, en los dos sentidos.
CREATE TABLE app.tenant_entitlements (
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  feature_key text NOT NULL REFERENCES app.features(key) ON UPDATE CASCADE ON DELETE CASCADE,

  -- `true` concede algo que su plan no trae; `false` QUITA algo que su plan sí trae.
  -- Los dos sentidos importan: el segundo es cómo se apaga una función a un
  -- cliente que está abusando de ella sin bajarle el plan entero.
  granted     boolean NOT NULL,

  -- Obligatoria, con el mismo criterio de app.agent_budget_overrides.note
  -- (024_agent_budgets.sql:63-65): un permiso especial sin razón escrita es un
  -- misterio en seis meses.
  note        text NOT NULL CHECK (length(btrim(note)) >= 8),

  -- Concesión temporal: una prueba de 14 días es una fila con fecha, no un
  -- recordatorio en la cabeza de alguien.
  expires_at  timestamptz,
  updated_by  text REFERENCES app.users(email) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, feature_key)
);
ALTER TABLE app.tenant_entitlements ENABLE ROW LEVEL SECURITY;
```

```sql
-- 131_plan_lifecycle.sql

-- Bitácora de cambios de plan. No es auditoría decorativa: es lo que contesta
-- "¿por qué este cliente perdió su función?" sin adivinar.
CREATE TABLE app.plan_changes (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  from_plan   text,
  to_plan     text NOT NULL REFERENCES app.plans(id) ON UPDATE CASCADE,
  from_status text,
  to_status   text NOT NULL,
  reason      text NOT NULL,        -- checkout | payment_failed | cancel | staff | trial_end
  actor       text,                 -- correo, o null si lo hizo el sistema
  -- Qué se apagó de verdad, resuelto en el momento del cambio. Sin esto,
  -- reconstruir el efecto de una baja de hace tres meses exige saber cómo
  -- estaba el catálogo entonces.
  effects     jsonb NOT NULL DEFAULT '[]',
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app.plan_changes ENABLE ROW LEVEL SECURITY;
CREATE INDEX plan_changes_tenant_idx ON app.plan_changes (tenant_id, created_at DESC);
```

**Toda tabla lleva `ENABLE ROW LEVEL SECURITY` en la misma migración que la crea.** El gate lo
verifica (`revisarMigracion` en `scripts/ownership-gate.mjs`) y falla el PR con el nombre de la
tabla. `app.features` y `app.plan_features` son catálogo de la plataforma: llevan el comentario
`-- tenantless:` justo antes del `CREATE TABLE` o el gate las marca por no tener `tenant_id`.

> **"Justo antes" es literal.** `revisarMigracion` sólo mira las **tres líneas inmediatamente
> anteriores** al `CREATE TABLE`. Un `-- tenantless:` al inicio de un bloque de comentario más
> largo **no cuenta**, y el gate falla diciendo que a tu tabla le falta `tenant_id` — un mensaje
> que manda a buscar el problema al lugar equivocado. Ponlo pegado; la explicación, arriba.

### La migración 132 — cerrar el desfase de los dos catálogos

`132_plan_catalog.sql` arregla lo de §2.3, y es aditiva:

1. `INSERT … ON CONFLICT DO NOTHING` de `starter` y `agency` en `app.plans`, con sus `limits`
   completos. Hasta ese momento son planes que la FK prohíbe.
2. `monthlyAiUsd` de `app.plans.limits` pasa a ser **el número**, y `app.agent_plan_limits`
   deja de ser una segunda fuente: se le agrega un comentario que dice de dónde viene y se
   reconcilian los valores (`pro`: 50 contra 100 — decide uno y escribe por qué en el archivo).

> **No borres `app.agent_plan_limits`.** Es de H3, `packages/agents/src/ledger/budget.ts` la lee
> en cada corrida, y borrarla apaga el único tope de gasto que hoy funciona de verdad. La
> reconciliación es de datos, no de esquema.

### El catálogo inicial de funciones

Doce llaves, derivadas de lo que los otros carriles ya construyeron. Sembrarlas es parte de la 130:

| `key` | `on_downgrade` | Qué apaga |
|---|---|---|
| `inbox.whatsapp` | `pause` | El canal de H6 |
| `inbox.meta` | `pause` | Instagram y Messenger (H12) |
| `inbox.email` | `pause` | Email (H13) |
| `inbox.sms` | `pause` | SMS (H13) |
| `inbox.ai_reply` | `pause` | Que el agente conteste solo |
| `flows.publish` | `pause` | Activar automatizaciones (H8) |
| `flows.ai_assist` | `keep` | El asistente en español de H8 |
| `agents.custom` | `readonly` | Definiciones de agente propias (H3) |
| `vault.ingest` | `readonly` | Ingesta de documentos (H4) |
| `work.projects` | `readonly` | Proyectos (H9) |
| `crm.pipelines` | `readonly` | Más de un embudo (H15) |
| `team.invite` | `keep` | Invitar gente (ya lo limita `maxSeats`) |

---

## 6. `can()` — el eje que falta

```ts
// packages/tenancy/src/entitlements/can.ts
export async function can(ctx: TenantContext, feature: FeatureKey): Promise<boolean>;
export async function assertEntitled(ctx: TenantContext, feature: FeatureKey): Promise<void>;
export async function entitlementsFor(ctx: TenantContext): Promise<Record<FeatureKey, boolean>>;
```

Resolución en tres saltos, del más específico al más general — **el mismo patrón que H3 ya usó
para el presupuesto** (`migrations/024_agent_budgets.sql:11-18`), y se usa el mismo a propósito:
un sistema con dos formas de resolver una excepción tiene dos formas de equivocarse.

```
app.tenant_entitlements   ¿este cliente tiene un trato especial vigente?
        ↓ si no hay fila, o expiró
app.plan_features         ¿lo trae su plan?
        ↓ si no
false                     deny por defecto
```

**Tres reglas que no se negocian:**

1. **Deny por defecto.** Una función que no está en ninguna de las dos tablas está apagada. Un
   catálogo incompleto no regala funciones — al revés que los límites numéricos, donde un límite
   ausente es ilimitado (`packages/tenancy/src/services/plans.ts:10-14`). **La asimetría es
   deliberada y hay que documentarla en el código:** olvidar declarar un límite le da servicio
   de más a un cliente; olvidar declarar una función se lo quita y él levanta la mano en
   minutos. Se falla del lado que se descubre rápido.

2. **`expires_at` vencido es como si la fila no existiera.** Se evalúa contra `now()` en la
   consulta, no en JavaScript: una prueba de 14 días que sigue viva porque el proceso tenía el
   reloj corrido es un cliente que dejó de pagar y no se enteró nadie.

3. **Un tenant con `status != 'active'` no tiene ninguna función.** `can()` devuelve `false`
   para todo, sin mirar el catálogo. Ver §8.

**Caché:** sí, con TTL corto (60 s) y una función `invalidarEntitlements(tenantId)` que H10 llama
al aplicar un cambio de suscripción. Copia el patrón de `invalidarCachePresupuesto()` en
`packages/agents/src/ledger/budget.ts`, incluida la parte de que la prueba lo invalida entre
casos — un caché sin invalidación explícita en pruebas produce suites que pasan en verde y
mienten.

---

## 7. Degradación: pausar, nunca borrar

Es la regla que define el carril, y la que más fácil se rompe con buena intención.

Cuando un plan baja, o una suscripción se cancela, o un pago falla:

| `on_downgrade` | Qué pasa | Qué **no** pasa |
|---|---|---|
| `pause` | Lo que estaba corriendo se detiene y queda marcado como pausado por plan | No se borra, no se archiva, no se desactiva "para siempre" |
| `readonly` | Se puede leer y exportar; no se puede crear ni editar | No se oculta ni se vacía |
| `keep` | No pasa nada. La función se queda | — |

**Por qué importa tanto.** El emprendedor que se atrasó un mes en el pago vuelve. Si al volver
sus automatizaciones ya no existen, sus documentos desaparecieron y sus contactos se fueron, no
vuelve: se va, y con razón. El costo de guardar sus filas tres meses más es aproximadamente
cero; el costo de perderlo como cliente no.

Y hay un segundo motivo, menos sentimental: **borrar es irreversible y una baja puede ser un
error.** Un webhook de Stripe mal interpretado, una tarjeta que rebotó y se cobró al segundo
intento, un staff que le picó al plan equivocado en el panel de H14. Pausar se deshace en un
segundo. Borrar no se deshace nunca.

**Reactivar es exactamente lo inverso y tiene que ser una operación, no un procedimiento
manual:** `applyPlanChange()` sube el plan, despausa lo que ella misma pausó —lo sabe porque
está en `plan_changes.effects`— y **no toca** lo que el emprendedor había pausado él. Esa
distinción es el detalle que separa una reactivación que funciona de una que le vuelve a
encender al cliente el flujo que él había apagado a propósito.

```ts
// packages/tenancy/src/entitlements/lifecycle.ts
export async function applyPlanChange(i: {
  tenantId: string;
  toPlan: string;
  toStatus: 'active' | 'suspended' | 'archived';
  reason: 'checkout' | 'payment_failed' | 'cancel' | 'staff' | 'trial_end';
  actor?: string;
}): Promise<{ effects: Array<{ feature: FeatureKey; action: 'paused' | 'readonly' | 'restored' }> }>;
```

Todo o nada, en una transacción, e **idempotente**: H10 puede reintentar un webhook de Stripe y
aplicar el mismo cambio dos veces sin pausar dos veces ni escribir dos filas de bitácora.

---

## 8. La puerta que hoy no existe: el camino sin sesión

Ésta es tu entrega más importante, la de §2.4, y la que se puede medir en pesos.

```ts
// packages/tenancy/src/entitlements/gate.ts

/**
 * ¿Esta empresa puede consumir recursos ahora mismo?
 *
 * Es lo que `contextFor()` hace para una persona, pero para un camino sin
 * sesión: webhook, job del worker, cron. Devuelve el motivo para que quien
 * llama pueda registrar POR QUÉ no hizo nada.
 */
export async function tenantIsLive(tenantId: string): Promise<
  { live: true } | { live: false; reason: 'suspended' | 'archived' | 'unknown' }
>;
```

**Dónde se llama y qué pasa si no pasa:**

| Camino | Quién llama | Qué hace si `live: false` |
|---|---|---|
| Webhook entrante | H6, justo después de resolver el canal y **antes** de correr al agente | **Guarda el mensaje entrante** y no contesta. El mensaje del cliente final no se pierde: cuando la empresa vuelva, ahí está |
| Job del worker | H8 y quien encole | Marca el job como omitido con motivo. **No lo reintenta en bucle** |
| Envío saliente | H6 | Rechaza con `FORBIDDEN` y lo registra |

**El matiz que hay que respetar:** guardar el mensaje entrante es gratis y no pierde información
del cliente final; contestarlo cuesta tokens. Se corta en la línea del gasto, no antes. Un
sistema que tira los mensajes de una empresa suspendida le hace perder ventas a alguien que a lo
mejor paga mañana.

> **Tú no editas `packages/inbox/`.** Expones `tenantIsLive()` y `assertEntitled()`, escribes la
> prueba que demuestra que funcionan, y el enganche en el webhook de H6 va en el PR de H6 o en
> un handoff de una línea que el orquestador emite. Está anotado en §11.

### Y en el worker

`apps/worker/src/index.ts` es de H1 y **no se toca**. La verificación al ejecutar se hace donde
sí se puede: en el handler de cada cola. Tú entregas el envoltorio:

```ts
// packages/tenancy/src/entitlements/queue.ts
export function withEntitlement<T>(
  feature: FeatureKey,
  handler: (job: T, ctx: TenantContext) => Promise<void>,
): (job: T) => Promise<void>;
```

Quien registra una cola la envuelve y se acabó. La verificación ocurre **en el momento de
correr**, con el plan de ese momento, que es todo el punto de §2.5.

---

## 9. 402 contra 403 — no es cosmético

Hoy `packages/db/src/errors.ts:3-15` ya mapea `BUDGET_EXCEEDED` a **402** y `FORBIDDEN` a **403**.
La distinción que falta es de significado:

| Situación | Código | Qué le dice al usuario | Qué le dice a la UI |
|---|---|---|---|
| Tu plan no incluye esto | **402** | "Esto viene en el plan Pro" | Enseña la pantalla de mejora, con el `blurb` de la función |
| Tu plan lo incluye pero tú no tienes permiso | **403** | "Pídele acceso al dueño de la empresa" | Enseña quién puede dártelo |
| Tu plan lo incluye, tú tienes permiso, pero ya te pasaste del número | **409** | "Llegaste a 500 contactos" | Enseña el contador y la mejora |
| Te pasaste del gasto de IA | **402** con `details.reason='budget'` | "Se acabó el presupuesto del mes" | Enseña el gasto y la mejora |

**Confundir 402 con 403 le enseña al emprendedor la pantalla equivocada**, y la pantalla
equivocada es la que lo hace escribirle a soporte. Un 403 cuando lo que pasa es que no contrató
lo manda a buscar a un administrador que no existe: él *es* el dueño.

### Lo que no puedes hacer y cómo se resuelve mientras tanto

`PlatformErrorCode` es una unión cerrada en `packages/db/ports.ts:109-120`, y ese archivo es de
H1: el gate falla tu PR si lo tocas (regla 3 de `CONTRIBUTING.md`). El código que hace falta —
`FEATURE_NOT_IN_PLAN` — tiene que agregarlo H1.

**Mientras tanto**, y sin esperar a nadie: lanza `BUDGET_EXCEEDED` (que ya es 402) con
`details.reason = 'feature_not_in_plan'` y `details.feature = <key>`. El HTTP que ve el navegador
es el correcto desde el día uno. Cuando H1 agregue el código, cambia una constante en un archivo
tuyo y ningún llamador se entera.

Anótalo en tu PR con este texto, para que el orquestador lo pase a H1:

```ts
// packages/db/ports.ts — en PlatformErrorCode
| 'FEATURE_NOT_IN_PLAN'   // 402 — el plan no lo incluye (≠ FORBIDDEN, que es permiso)
// packages/db/src/errors.ts — en STATUS
FEATURE_NOT_IN_PLAN: 402,
```

---

## 10. La pantalla

`/ajustes/plan` — Server Component, con el mismo criterio de tres estados que usó H15
(`H15-crm.md §8`): `datos`, `error` y `sin-cablear`. Un cero silencioso parece un dato y manda a
alguien a depurar un sistema que está bien.

Tres bloques, y ninguno es una tabla de precios:

1. **Qué incluye tu plan** — la lista de funciones con palomita, y las que no con candado **y su
   `blurb` visible**. Es la misma decisión que H11 tomó para las áreas bloqueadas
   (`ports.ts:AreaState`): *"las bloqueadas se MUESTRAN con candado y su promesa: la curiosidad
   es el motor del producto"*. Esconder lo que no tiene no le ahorra nada a nadie.
2. **Qué estás usando** — asientos, contactos, canales, flujos, gasto de IA del mes. Los números
   los pide a cada dueño por su port; los que nadie contesta todavía se muestran como
   `sin-cablear`, no como cero.
3. **Si algo está pausado por plan, dilo aquí y dilo claro** — con el botón para reactivar. Un
   flujo apagado sin explicación visible es una llamada a soporte garantizada.

Usa el design system de H5. **No inventes tokens ni metas hex.**

---

## 11. Lo que este carril NO puede hacer solo — para el orquestador

Anótalo tal cual en tu PR. Ninguna es una corrección: son enganches en árboles ajenos.

| # | Qué | Dónde | Quién |
|---|---|---|---|
| 1 | `FEATURE_NOT_IN_PLAN` en `PlatformErrorCode` y en `STATUS` | `packages/db/ports.ts` · `packages/db/src/errors.ts` | H1 |
| 2 | Llamar a `tenantIsLive()` en el webhook antes de correr al agente | `packages/inbox/src/ingest.ts` (rama `h6-inbox`) | H6 |
| 3 | Envolver la cola de flujos con `withEntitlement('flows.publish', …)` | `packages/flows/**` | H8 |
| 4 | Llamar a `applyPlanChange()` desde el webhook de suscripción | `packages/billing/**` | H10 |
| 5 | Botón de override en el panel de agencia | `apps/web/app/(admin)/**` | H14 |
| 6 | Fila de H16 en las dos tablas que no son de H0 | `CONTRIBUTING.md` §1 · `migrations/README.md` | H1 |

**Ninguno de los seis te bloquea.** Programa contra tu propia interfaz, prueba con dobles, y
entrega. Los enganches son de una línea cada uno y se hacen en el merge — ésa es toda la idea de
la regla 5 del contrato.

---

## 12. Criterios observables de "listo"

Con evidencia, no con "lo probé".

| # | Criterio |
|---|---|
| 1 | `can()` devuelve `false` para una función que no está en el catálogo (deny por defecto), con prueba automatizada |
| 2 | Un override con `granted=true` concede una función que el plan no trae |
| 3 | Un override con `granted=false` **quita** una función que el plan sí trae |
| 4 | Un override con `expires_at` vencido **no** concede nada — evaluado en SQL, no en JS |
| 5 | Un tenant `suspended` da `false` en **todas** las funciones, sin mirar el catálogo |
| 6 | `tenantIsLive()` devuelve `{live:false, reason:'suspended'}` y el motivo llega a quien llama |
| 7 | **La prueba que vale dinero:** un job encolado con plan `pro` y ejecutado tras bajar a `free` **no corre**, y queda marcado con motivo. Automatizada, con el cambio de plan entre el encolado y la ejecución |
| 8 | Bajar de plan **pausa** y no borra: las filas siguen ahí y se cuentan en la prueba |
| 9 | Volver a subir de plan restaura **sólo** lo que la baja pausó, y no lo que el usuario había pausado él |
| 10 | `applyPlanChange()` aplicada dos veces con los mismos datos deja el mismo estado y **una** fila en `plan_changes` |
| 11 | Una función no contratada responde **402**, no 403; falta de permiso responde **403** |
| 12 | Un tenant **no** ve los entitlements de otro. Test automatizado con dos tenants |
| 13 | `starter` y `agency` ya se pueden asignar a un tenant sin violar `tenants_plan_fkey` |
| 14 | `monthlyAiUsd` y `agent_plan_limits.monthly_budget_usd` dicen el mismo número para el mismo plan, y hay una prueba que lo afirma |
| 15 | `node scripts/ownership-gate.mjs` y `--check-overlap` en verde |

---

## 13. Prompt de arranque

```
ANTES DE ESCRIBIR NADA — freno duro. Verifica ARCHIVOS, no directorios: un
directorio existe desde que H1 dejó el stub y no prueba nada.

  test -f packages/db/ports.ts \
    && test -f packages/tenancy/src/services/plans.ts \
    && test -f packages/tenancy/src/services/context.ts \
    && test -f packages/agents/src/ledger/budget.ts \
    && test -f migrations/010_tenancy.sql \
    && test -f migrations/024_agent_budgets.sql \
    && echo LISTO || echo "ESPERA — falta que mergee H1, H2 o H3"

Si falta alguno, NO crees estructura, NO instales dependencias y NO escribas migraciones.
Usa el tiempo para leer tu handoff completo y estudiar los dos archivos de los que sale
todo tu carril: packages/tenancy/src/services/plans.ts y packages/agents/src/ledger/budget.ts.

Trabaja SIEMPRE desde /Volumes/FRAGUA/CLAUDE CODE/PLATAFORMA-h16-entitlements. Si no existe:
  git worktree add "/Volumes/FRAGUA/CLAUDE CODE/PLATAFORMA-h16-entitlements" -b h16-entitlements origin/main
  cd "/Volumes/FRAGUA/CLAUDE CODE/PLATAFORMA-h16-entitlements" && npm ci
No hagas checkout ni switch en otro directorio: hay más de diez conversaciones sobre este repo.

Vas a construir H16 — entitlements y ciclo de vida del plan de ABRAXA Plataforma.

Lee primero, completo:
  docs/handoffs/H16-entitlements.md   (tu handoff)
  docs/handoffs/README.md             (el contrato de no colisión)
  packages/tenancy/src/services/plans.ts     (lo que existe hoy: sólo números)
  packages/agents/src/ledger/budget.ts       (el patrón de 3 saltos que vas a repetir)
  migrations/010_tenancy.sql  y  migrations/024_agent_budgets.sql

POR QUÉ EXISTES: el producto sabe CUÁNTO puede hacer una empresa y no sabe QUÉ, ni qué pasa
cuando deja de pagar. Cinco huecos verificados, todos con archivo y línea en tu §2:

  1. app.plans.limits sólo tiene llaves numéricas (010_tenancy.sql:107-114). No hay un solo
     eje booleano: no se puede decir "este plan incluye automatizaciones".
  2. De seis límites, uno se aplica. assertQuota() existe (plans.ts:83) y su ÚNICO llamador de
     producción es assertSeatAvailable desde invitations.ts:96. Las otras 4 apariciones están
     en su propio test.
  3. Hay DOS catálogos de planes y no coinciden: agent_plan_limits siembra free/starter/pro/
     agency (024:44-48) y app.plans siembra sólo free/pro (010:107-114). Como la 010 pone
     tenants_plan_fkey, NINGÚN tenant puede tener plan 'starter' ni 'agency'. Dos filas muertas
     que parecen vivas. Y monthlyAiUsd (pro=50) contra monthly_budget_usd (pro=100) son dos
     números que dicen lo mismo y no dicen lo mismo.
  4. LA QUE CUESTA DINERO: un tenant suspendido SIGUE contestando webhooks y gastando tokens.
     contextFor() sí verifica tenants.status (context.ts:63-79), pero el webhook no pasa por
     ahí: pasa por contextoDeCanal() (packages/inbox/src/context.ts), que arma el contexto con
     la fila del canal y no mira el status. Suspendes a alguien, se queda fuera del producto,
     y su agente sigue contestando con nuestra tarjeta.
  5. Un job encolado con plan alto que corre tras una baja se ejecuta igual. El worker
     (apps/worker/src/index.ts) no tiene punto de verificación, y el único momento en que
     alguien mira el plan es al encolar.

CUATRO COSAS QUE NO SE NEGOCIAN:

  1. DENY POR DEFECTO en funciones — al revés que en los límites numéricos, donde un límite
     ausente es ILIMITADO (plans.ts:10-14). La asimetría es deliberada: olvidar un límite da
     servicio de más; olvidar una función lo quita y el cliente levanta la mano en minutos. Se
     falla del lado que se descubre rápido. Documéntalo en el código.
  2. PAUSAR, NUNCA BORRAR. Ni una fila de nadie se borra por una razón de plan, jamás. Una
     baja puede ser un error de Stripe o un dedo del staff; pausar se deshace en un segundo,
     borrar no se deshace nunca. Y reactivar restaura SÓLO lo que la baja pausó, no lo que el
     emprendedor había pausado él.
  3. VERIFICAR AL EJECUTAR, no sólo al encolar. Entregas withEntitlement() y la prueba que
     cambia el plan ENTRE el encolado y la ejecución. Ése es el criterio #7 y es el que
     justifica el carril.
  4. 402 ≠ 403. No contratado no es lo mismo que sin permiso. Un 403 cuando en realidad no
     contrató manda al emprendedor a buscar un administrador que no existe: él ES el dueño.
     PlatformErrorCode es de H1 y no lo puedes tocar: usa BUDGET_EXCEEDED (que ya es 402) con
     details.reason='feature_not_in_plan' y pide el código nuevo en tu PR.

Trabajas SÓLO en packages/tenancy/entitlements/**, packages/tenancy/src/entitlements/** y
apps/web/app/(app)/ajustes/plan/**. Vives DENTRO del paquete de H2 pero en un subárbol que es
tuyo: .ownership.json le puso a h2-tenancy las exclusiones correspondientes, igual que H6 se
las puso a H12 y H13. Si escribes un carácter en packages/tenancy/src/services/, el gate mata
tu PR nombrando el archivo. Migraciones 130–139.

No edites packages/inbox/, packages/flows/, apps/worker/src/index.ts ni packages/db/ports.ts.
Expones las funciones, escribes las pruebas con dobles, y anotas los seis enganches de tu §11
en el PR. La regla 5 del contrato existe justo para esto.

Toda tabla nueva con RLS en la MISMA migración que la crea, y las de catálogo con el
comentario `-- tenantless: <razón>` antes del CREATE TABLE o el gate las rechaza.

Antes del PR: node scripts/ownership-gate.mjs && npm run typecheck && npm run lint && npm test
Nunca mergees a main. Termina con push a h16-entitlements y gh pr create.

Si algo del handoff está mal o incompleto, dilo y propón el arreglo antes de construir.
```
