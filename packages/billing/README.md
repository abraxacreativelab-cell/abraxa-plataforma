# @abraxa/billing

Stripe, alta self-service y suscripciones. **La puerta de entrada del producto.**

| | |
|---|---|
| **Handoff** | H10 |
| **Rama** | `h10-billing` |
| **Montado en** | `apps/api` → `/billing` (H1 ya lo cableó) |
| **Migraciones** | `080_billing.sql` |
| **Landing** | `apps/web/app/(public)/**` |

---

## El flujo

```
mi.abraxa.club                        landing · (public)/page.tsx
   ↓ "Empezar" (sólo pide el nombre del negocio)
POST /billing/checkout                crea la sesión de monto libre
   ↓
Stripe Checkout                       el comprador decide cuánto paga
   ↓ pago aprobado
POST /billing/webhook                 firma → idempotencia → alta
   ↓
TenancyPort.provision()               H2 · transaccional, idempotente por slug
   ↓
app.subscriptions                     el cobro queda registrado
   ↓ (después del 200)
correo de bienvenida                  → /bienvenida?empresa=<slug>
   ↓
login (H18) → Ritual de Fundación (H7)
```

El `success_url` de Stripe manda a `/gracias`, que **no** promete que la cuenta
ya existe: cuando el navegador vuelve, el webhook puede no haber llegado. El
acuse real es el correo.

---

## Las cinco reglas del webhook

Están implementadas en `src/http.ts`, en este orden y con este nombre en los
comentarios:

1. **Verificar la firma. Siempre.** Sobre el cuerpo CRUDO (`req.rawBody`, que
   guarda el `express.json({ verify })` de `apps/api`). Verificar contra el
   cuerpo ya parseado calcula el HMAC sobre otros bytes y tumba **todos** los
   eventos legítimos.
2. **Idempotencia** por `UNIQUE (stripe_event_id)`. Se inserta primero y se
   pregunta después: un `SELECT` y luego `INSERT` tiene una ventana por la que
   caben dos reintentos simultáneos.
3. **Responder 200 rápido, lo pesado después.** El alta condiciona el 200; el
   correo no.
4. **Si el alta falla, NO 200.** Se anota el motivo y se relanza para que
   Stripe reintente. Un pago cobrado sin cuenta creada es el peor estado
   posible del sistema.
5. **Registrar todo evento**, incluidos los que se ignoran. La excepción son
   los de firma inválida: su `event.id` no es un dato confiable y escribirlo
   dejaría que cualquiera llene la tabla desde fuera. Ésos van a los logs.

---

## La regla 6, que costó una auditoría descubrir

**Reprocesar un pago tiene que caer en la MISMA empresa. El árbitro de si un
slug está ocupado es el DUEÑO, no la existencia de la fila.**

La regla 2 abre a propósito el camino del reproceso: un evento que quedó a
medias (`processed_at` nulo) se vuelve a procesar en lugar de darse por bueno.
Ese camino tiene que ser idempotente de verdad, y la primera versión no lo era:

```
Lupita paga $25 · Stripe manda evt_1
  1er intento → ¿'panaderia-lupita' ocupado? NO → se CREA el tenant
              → falla el upsert de la suscripción (blip de red) → 500  ✅ correcto
  reintento   → ¿'panaderia-lupita' ocupado? SÍ ← lo ocupó ÉL MISMO
              → 'panaderia-lupita-2' → SEGUNDA EMPRESA con un solo pago  ❌
```

Con N fallos, N empresas: la suscripción colgada de la última, las anteriores
huérfanas pero funcionales, y el correo de bienvenida mandando a la persona a
una URL distinta de la que la landing le enseñó en la vista previa.

El arreglo es que `slug.ts` ya no pregunta nada — sólo genera candidatos
(`candidatosDeSlug`) — y `provisionarEmpresa()` (`service.ts`) los prueba en
orden contra `app.provision_tenant`, que es el único que sabe de quién es cada
slug y lo decide **dentro de su transacción**:

| respuesta de `provision()` | qué hace el alta |
|---|---|
| slug libre → `created: true` | listo, es una empresa nueva |
| slug del MISMO dueño → `created: false` | listo, es el mismo tenant: reproceso correcto |
| slug de OTRO dueño → `CONFLICT` (ABX01) | avanza al siguiente sufijo |
| cualquier otro error | se relanza tal cual — un fallo de red **no** se disfraza de colisión |

De paso desaparece la ventana entre el «¿está libre?» y el INSERT.
`POST /billing/alta-gratis` usa la misma función y por la misma razón: un doble
clic en el formulario ya no crea dos empresas.

**Y la lección de pruebas, que es la mitad del hallazgo:** esto pasó typecheck,
lint, test y el gate de propiedad porque el `provision()` falso nunca escribía
en la tabla `tenants` del doble, así que «¿ocupado?» contestaba `false` en
todas las pruebas y la aserción «sigue habiendo una sola empresa» era cierta
del doble y falsa de Postgres. El doble vive ahora en
`src/pruebas/tenancy-doble.ts` e implementa las tres respuestas de la migración
011. Un doble que no puede fallar no prueba nada.

---

## Sin llaves de Stripe

Si no hay `STRIPE_SECRET_KEY`, el gateway arranca en **modo doble** y lo avisa
por consola. El doble finge la RED —crear y recuperar sesiones— y nada más:

**La verificación de firma nunca se finge.** La hace el `stripe` de verdad con
su criptografía de verdad, porque construir el cliente no toca la red. Un doble
que dijera "firma válida ✔" convertiría la prueba de seguridad más importante
del webhook en una prueba de que el doble devuelve `true`.

`firmarComoStripe()` firma payloads como lo haría Stripe, para ejercitar el
webhook de punta a punta sin cuenta. Es lo que usan las pruebas.

Igual con el correo: sin `RESEND_API_KEY` no sale nada, pero el enlace exacto
que habría llevado queda escrito en consola.

---

## Propiedad del catálogo de planes

`app.plans` la **crea H2** (migración 010) y la siembra para poder probarse
sola. **H10 decide su contenido.** El catálogo vive en `src/catalog.ts`; la
migración 080 lo reconcilia con `ON CONFLICT DO UPDATE` y `syncPlanCatalog()`
hace lo mismo en runtime.

> ⚠️ Los límites están espejeados en `catalog.ts` y en `080_billing.sql`. Si
> cambias uno, cambia el otro **en el mismo commit**. `limits` es una sola
> columna `jsonb`, no un merge: un objeto más pobre no actualiza los límites,
> los **borra** — y `assertQuota()` de H2 compara contra `maxChannels`,
> `maxFlows` y `maxAgents`. `catalog.test.ts` lee el SQL y falla si divergen.

v1 vende **sólo `free` y `pro`**. Los planes intermedios (starter, agency) y
las banderas booleanas de features son de **H16**.

---

## Rutas

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/billing/plans` | catálogo y topes del monto libre; lo pinta la landing |
| `POST` | `/billing/checkout` | `{ businessName }` → `{ url }` de Stripe |
| `POST` | `/billing/webhook` | Stripe nos habla de vuelta |
| `POST` | `/billing/alta-gratis` | plan `free`, **contra sesión verificada** |

`alta-gratis` no pasa por Stripe, así que no hay pago que pruebe quién es la
persona. Exige el contrato BFF→API de H2 (`x-user-email` + `x-proxy-secret`,
comparado en tiempo constante) y en producción sin `PROXY_SECRET` **rechaza
todo**. El login con Google es de H18: hasta que aterrice, la ruta está
cableada y probada pero nadie la puede llamar desde el navegador.

---

## Variables de entorno

| Variable | Sin ella |
|---|---|
| `STRIPE_SECRET_KEY` | gateway en modo doble, no se cobra nada |
| `STRIPE_WEBHOOK_SECRET` | **el webhook rechaza todo** (fail-closed) |
| `RESEND_API_KEY` | el correo no sale; el enlace queda en los logs |
| `PROXY_SECRET` | `alta-gratis` rechaza todo en producción |
| `APP_BASE_URL` | de aquí salen `success_url` y el enlace del correo |

En el navegador, `NEXT_PUBLIC_API_BASE_URL` vacía = relativa al mismo origen
(lo correcto en producción, con nginx mandando `/billing` a la API). En
desarrollo, con el web en `:3000` y la API en `:3100`, hay que ponerla en
`http://localhost:3100`.

---

## Mapa del código

| Archivo | Qué es |
|---|---|
| `catalog.ts` | qué planes existen y qué incluyen — **la decisión** |
| `slug.ts` | candidatos de slug, cumpliendo los CHECK de H2 — **no decide nada** |
| `gateway.ts` | la única frontera con Stripe · doble sin llaves |
| `store.ts` | el único lugar con acceso a datos, y por qué ahí sí va `adminDb()` |
| `service.ts` | el `BillingPort`: sesión pagada → tenant · `provisionarEmpresa()` |
| `correo.ts` | la bienvenida, que nunca puede tumbar el webhook |
| `http.ts` | las rutas |
| `pruebas/fake-db.ts` | doble en memoria de PostgREST, con violación de unicidad real |
| `pruebas/tenancy-doble.ts` | doble de `provision()` con la regla del dueño de la migración 011 |

---

Documento de trabajo: `docs/handoffs/H10-billing.md`.
Contratos cruzados: `packages/db/ports.ts`.
Las cinco reglas del repo: `CONTRIBUTING.md`.
