# Entitlements y ciclo de vida del plan — H16

Este subárbol vive **dentro** de `packages/tenancy` pero **no es de H2**.
`.ownership.json` se lo excluyó explícitamente a `h2-tenancy`, igual que
`h6-inbox` le cedió `drivers/{meta,email,sms}` a H12 y H13.

Si estás editando H2, esta carpeta no es tuya. Si estás editando H16, el resto
del paquete no es tuyo.

---

## Qué resuelve

H2 dejó **cuánto** puede hacer una empresa: `app.plans.limits`, seis llaves y
las seis numéricas. H10 dejó **el cobro**. Entre los dos quedó el hueco de **qué
compra el dinero** — y de qué pasa cuando deja de pagarse.

```
can(ctx, 'flows.publish')      ¿su plan incluye esto?          → 402 si no
tenantIsLive(tenantId)         ¿puede gastar AHORA?            → sin sesión
withEntitlement(f, handler)    verifica al EJECUTAR            → no al encolar
applyPlanChange({...})         baja y sube de plan             → pausa, no borra
setOverride(ctx, {...})        el trato especial, con razón    → los dos sentidos
usageFor(ctx)                  qué llevas usado                → hueco honesto
```

---

## Las cuatro reglas que no se negocian

**1 · Deny por defecto.** Una función que no está en el catálogo está apagada.
Es **al revés** que los límites numéricos, donde un límite ausente es ilimitado
(`services/plans.ts:10-14`). La asimetría es deliberada: olvidar un límite
regala servicio y nadie se entera hasta la factura; olvidar una función se la
quita al cliente y él levanta la mano en minutos. Se falla del lado que se
descubre rápido.

**2 · Pausar, nunca borrar.** Ni una fila de nadie se borra por una razón de
plan. Una baja puede ser un webhook de Stripe mal interpretado o un dedo del
staff: pausar se deshace en un segundo, borrar no se deshace nunca. Por eso
`app.features.on_downgrade` no tiene el valor `'delete'` y `lifecycle.ts` no
tiene un solo `DELETE` de datos de cliente.

**3 · Verificar al ejecutar.** Un job encolado el martes con `pro` que corre el
jueves en `free` **no corre**. La verificación ocurre en el handler, con el plan
de ese momento.

**4 · 402 ≠ 403.** No contratado no es lo mismo que sin permiso. Un 403 cuando
en realidad no contrató manda al emprendedor a buscar un administrador que no
existe: él *es* el dueño.

---

## Dónde está cada cosa

| Archivo | Qué |
|---|---|
| `catalogo.ts` | el vocabulario: las 12 llaves, los tipos |
| `can.ts` | `can` / `assertEntitled` / `entitlementsFor` + caché de 60 s |
| `gate.ts` | `tenantIsLive` y el contexto del camino sin sesión |
| `queue.ts` | `withEntitlement` — las tres puertas del worker |
| `lifecycle.ts` | `applyPlanChange` y las pausas |
| `overrides.ts` | el trato especial por cliente |
| `uso.ts` | el consumo contra el plan, con `sin-cablear` donde no hay dato |
| `errores.ts` | el 402 y la constante que cambia cuando H1 agregue el código |
| `routes.ts` | `GET /entitlements/plan` · `POST /entitlements/pausas` |

Migraciones: **130** (modelo + vista + catálogo) · **131** (ciclo de vida) ·
**132** (unificación de los dos catálogos de planes).

---

## La resolución vive en SQL

`app.tenant_entitlements_effective` (migración 130) hace los tres saltos:

```
app.tenant_entitlements   ¿trato especial VIGENTE?
        ↓ si no hay fila, o expiró
app.plan_features         ¿lo trae su plan?
        ↓ si no
false                     deny por defecto
```

Está en una vista y no en tres consultas de TypeScript por el vencimiento: se
compara contra `now()` **de la base**. En JavaScript, un contenedor con la hora
corrida mantendría viva una prueba de 14 días que ya terminó y nadie se
enteraría. El reloj de la base es uno solo.

---

## Cómo se prueba

Las pruebas en memoria **no reimplementan la vista** — `testing/siembra.ts`
siembra el resultado ya resuelto. Si lo calculara en JS estaría verificando esa
reimplementación y no el SQL de producción; es la misma línea que trazó H2 en
`testing/fake-postgrest.ts:24-31`.

```bash
npm test -- packages/tenancy/src/entitlements     # lo que vive en JavaScript

# Y contra Postgres de verdad — la vista, el ciclo de impago, la idempotencia:
docker run -d --name pg -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=abraxa_test -p 55432:5432 postgres:16-alpine

TENANCY_TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/abraxa_test \
  npm test -- packages/tenancy/src/entitlements/pg.test.ts
```

Misma variable que la suite de H2, a propósito: dos suites pidiendo dos bases
distintas serían dos bases que nadie levanta.

---

## Lo que este subárbol NO hace

- **No cobra.** Stripe y el checkout son H10. Aquí se lee el resultado.
- **No cuenta contactos, flujos ni canales.** Cada dueño cuenta lo suyo y lo
  pasa; lo que nadie contesta se muestra `sin-cablear`, no como cero.
- **No apaga nada en las tablas de otro carril.** Deja el hecho en
  `app.feature_pauses` y el dueño lo respeta preguntando.
- **No borra `app.agent_plan_limits`.** `packages/agents/src/ledger/budget.ts`
  la lee en cada corrida: borrarla apagaría el único tope de gasto que hoy
  funciona de verdad.
