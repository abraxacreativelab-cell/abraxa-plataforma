# H10 — Landing, cobro y alta self-service

> **Ola 2.** Corre en paralelo con H6, H7, H8 y H9. Requiere H1, H2 y H5 mergeados.
> Rama: `h10-billing` · Migraciones: `080`–`089`
> Directorios: `packages/billing/**` y `apps/web/app/(public)/**`

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
4. Login con Google y entrada al Ritual de Fundación.
5. Modelo de suscripciones y planes.

### No

- **No** el panel de agencia. Es H14.
- **No** el provisioning en sí. Es `TenancyPort.provision()` de H2 — tú lo llamas.
- **No** el onboarding conversacional. Es H7 — tú lo entregas ahí y te quitas.

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
correo al emprendedor con su link
   ↓
login con Google → /(onboarding) → su agente lo saluda   ← H7
```

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

`billing_events` **no lleva `tenant_id`** — llegan antes de que el tenant exista. Es la única
tabla del schema sin él; documéntalo para que el gate no la marque como error.

---

## 7. La landing

Público: un emprendedor mexicano, probablemente solo, que trabaja demasiado y sospecha que
podría automatizar algo pero no sabe qué.

**Habla de su vida, no de tu tecnología.** No "plataforma multi-agente con RAG". Sí "tu negocio
contesta mientras duermes".

Lo mínimo: qué es en una frase · qué cambia en su día · cómo se ve (capturas reales, no mockups)
· cuánto cuesta (lo que quiera dar) · empezar.

Usa el design system de H5. **No inventes tokens ni metas hex.**

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

---

## 9. Prompt de arranque

```
ANTES DE ESCRIBIR NADA: verifica que H1, H2 y H5 hayan mergeado.
  test -f packages/db/ports.ts && test -d packages/tenancy/src && test -d packages/ui/src \
    && echo LISTO || echo "ESPERA"
Si falta alguno, NO crees estructura. Lee tu handoff, prepara tu plan.

Trabaja SIEMPRE desde /Volumes/FRAGUA/CLAUDE CODE/PLATAFORMA-h10-billing (tu worktree, rama
h10-billing ya activa). No hagas checkout ni switch.

Vas a construir H10 — la landing, el cobro y el alta self-service de ABRAXA Plataforma.

Lee primero, completo:
  docs/handoffs/H10-billing.md       (tu handoff)
  docs/handoffs/README.md            (el contrato de no colisión)
  packages/db/ports.ts               (implementas BillingPort, consumes TenancyPort)

Contexto: eres la puerta de entrada. Un emprendedor llega a mi.abraxa.club, entiende en 30
segundos qué es esto, paga lo que quiera (donación de monto libre por ahora) y en el siguiente
clic ya está conversando con su agente maestro. SIN INTERVENCIÓN HUMANA — ese es el criterio.

El flujo: landing → Stripe Checkout monto libre → webhook → TenancyPort.provision() → correo
con su link → login Google → el Ritual de Fundación (H7) lo recibe.

Sobre la landing: el público es un emprendedor mexicano que trabaja demasiado y sospecha que
podría automatizar algo pero no sabe qué. Habla de su vida, no de nuestra tecnología. No
"plataforma multi-agente con RAG"; sí "tu negocio contesta mientras duermes". Usa el design
system de H5 — no inventes tokens ni metas hex.

Trabajas SÓLO en packages/billing/** y apps/web/app/(public)/**. Migraciones 080–089.
Otras 4 conversaciones trabajan en paralelo.

Las cinco reglas del webhook de la sección 5 son donde se rompen todas las integraciones de
pago. La #4 sobre todo: si provision() falla, NO devuelvas 200 — deja que Stripe reintente. Un
pago cobrado sin cuenta creada es el peor estado posible del sistema.

Si algo del handoff está mal o incompleto, dilo y propón el arreglo antes de construir.
```
