# H2 — Tenancy

> **Ola 1.** Corre en paralelo con H3, H4 y H5. Requiere que H1 esté mergeado.
> Rama: `h2-tenancy` · Migraciones: `010`–`019` · Directorio: `packages/tenancy/**`

---

## 1. Contexto

ABRAXA Plataforma es un sistema operativo empresarial para emprendedores. Cada emprendedor
tiene **una sola empresa** (un *tenant*) y va desbloqueando áreas conforme crece.

Tú construyes el cimiento de identidad: **quién es cada quien, a qué tenant pertenece, y qué
puede tocar dentro de él.** Todo lo demás en el producto depende de que esto esté bien.

**El hueco que cierras:** en GARDEN no existe forma de crear un tenant. `POST /api/crm/tenants`
no existe; el alta es un script con 9 empresas escritas a mano
(`GARDEN/scripts/crm/seed-crm.ts:21-31`). Sin tu trabajo no hay producto multi-cliente.

---

## 2. Alcance

### Sí

1. **`POST /tenants` transaccional** — el alta completa de un cliente en una sola operación.
2. Membresías e invitaciones.
3. **RBAC por área**, deny por defecto.
4. Resolución del `TenantContext` desde una sesión verificada.
5. Planes y cuotas (el modelo, no el cobro — eso es H10).

### No

- **No** landing ni Stripe. Eso es H10; tú expones `provision()` y él lo llama.
- **No** UI. El panel de agencia es H14.
- **No** siembres áreas de negocio con su contenido — eso es H11. Tú creas las filas base.

---

## 3. Contrato de no colisión

| | |
|---|---|
| **Escribes sólo en** | `packages/tenancy/**` |
| **Migraciones** | `010`–`019`, ni una fuera |
| **Rama** | `h2-tenancy` |
| **No toques** | `apps/api/src/index.ts` (H1 ya te importó) · `package-lock.json` · nada de otros paquetes |

**Implementas:** `TenancyPort` de `packages/db/ports.ts`.
**Consumes:** nada. Eres la base — no dependes de ningún otro handoff.

---

## 4. Qué portar de GARDEN

GARDEN vive en `/Volumes/FRAGUA/CLAUDE CODE/GARDEN`. **Consulta, no edites.**

| Archivo | Qué llevarte |
|---|---|
| `src/api/middleware/tenant.ts` | **El RBAC por área completo.** `loadAreaGrants`, `hasArea`, `requireArea`, `requireAnyArea`, `requireAreaOperation`, `ACCESS_RANK`. Está bien hecho: deny por defecto, y lanza si un grant viene malformado en DB |
| `src/api/middleware/tenant.ts:22-35` | `proxyVerified()` con `timingSafeEqual` y **fail-closed en producción**. Cópialo tal cual |
| `src/api/routes/crm/memberships.ts:43-60` | El upsert de invitación (crea el usuario primero, luego la membresía) |
| `scripts/crm/seed-crm.ts` | La **secuencia** del alta (usuario → tenant → membresía → pipeline → tags → áreas). El contenido está hardcodeado a las 9 empresas de ABRAXA; **la secuencia sirve, el contenido no** |

**Cambio transversal obligatorio:** GARDEN tiene dos ejes conviviendo — `company_id` (string
tipo `'inperio'`) y `tenant_id` (uuid). **Aquí hay un solo eje: `tenant_id` uuid.** Si algo que
portas menciona `company_id`, se traduce.

---

## 5. Modelo de datos

H1 ya creó `app.tenants`, `app.memberships` y `app.area_grants` en la migración 001. Tú agregas:

```sql
-- 010_tenancy.sql
CREATE TABLE app.users (
  email       text PRIMARY KEY,
  name        text,
  avatar_url  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.plans (
  id             text PRIMARY KEY,          -- 'free' | 'pro' | ...
  name           text NOT NULL,
  limits         jsonb NOT NULL DEFAULT '{}',  -- { maxSeats, maxContacts, monthlyAiUsd, ... }
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.invitations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  email       text NOT NULL,
  role        text NOT NULL,
  areas       jsonb NOT NULL DEFAULT '{}',
  token       text UNIQUE NOT NULL,
  accepted_at timestamptz,
  expires_at  timestamptz NOT NULL,
  UNIQUE (tenant_id, email)
);
```

**Toda tabla nueva lleva `ENABLE ROW LEVEL SECURITY` en la misma migración que la crea.** Sin
excepción. Es la regla que GARDEN rompió 145 veces.

Roles: `owner` · `admin` · `member` · `viewer`. Accesos por área: `view` < `edit` < `admin`.

---

## 6. `provision()` — la pieza central

Una sola operación, transaccional, idempotente por `slug`:

```ts
provision({ slug, name, ownerEmail, industryType? }): Promise<{ tenantId: string }>
```

Hace, en orden, y **todo o nada**:

1. upsert de `app.users` con `ownerEmail`
2. insert de `app.tenants`
3. membresía `owner` para ese correo
4. `area_grants` totales para el owner
5. plan `free` asignado

**No siembra áreas de negocio ni pipelines.** Eso lo dispara H11 después, escuchando el evento
`tenant.provisioned` que tú emites.

Si el `slug` ya existe, devuelve el tenant existente sin duplicar nada — H10 puede reintentar un
webhook de Stripe y no debe crear dos empresas.

---

## 7. Autenticación y contexto

El patrón que GARDEN resolvió bien y hay que conservar íntegro:

```
navegador → NextAuth (Google) → BFF verificado server-side → API
                                     ↓
   inyecta x-user-email VERIFICADO (de la sesión, NUNCA de un header del cliente)
   + x-proxy-secret (timingSafeEqual, fail-closed en producción)
                                     ↓
   el x-tenant-slug del navegador NO se confía: se valida contra app.memberships
```

`contextFor({ userEmail, tenantSlug })` devuelve el `TenantContext` o lanza `403` si no hay
membresía. **Ese 403 es lo único que impide que el cliente A lea los datos del cliente B.**

`canSignIn(email)` con doble puerta y **fail-closed**: entra si está en la allowlist del equipo,
o si tiene membresía activa. Cualquier error de red o timeout devuelve `false`, nunca `true`.
Referencia: `GARDEN/garden-os/lib/auth.ts:42-56`.

---

## 8. Criterios observables de "listo"

1. `provision()` crea tenant + usuario + membresía + grants + plan en **una** transacción; si
   falla un paso, no queda nada a medias.
2. Llamarlo dos veces con el mismo `slug` devuelve el mismo `tenantId` y **no duplica**.
3. **La prueba de aislamiento:** crea dos tenants; con la sesión del A, pide `x-tenant-slug` del
   B y confirma `403`. Escríbela como test automatizado, no como verificación manual.
4. Sin el proxy secret en producción, la vía de headers se **rechaza** (no se abre).
5. `requireArea('ventas','edit')` deja pasar a quien tiene `edit` o `admin`, y bloquea a quien
   tiene `view` o nada.
6. Un grant malformado en DB hace **lanzar**, no otorgar acceso silenciosamente.
7. Una invitación aceptada crea usuario + membresía + grants; una expirada se rechaza.

---

## 9. Prompt de arranque

```
ANTES DE ESCRIBIR NADA: verifica que H1 haya mergeado.
  test -f packages/db/ports.ts && echo LISTO || echo "ESPERA — H1 no ha terminado"
Si no existe, NO crees estructura ni instales dependencias. Lee tu handoff, estudia el
código de GARDEN que vas a portar, prepara tu plan, y espera la señal del orquestador.

Vas a construir H2 — Tenancy de ABRAXA Plataforma.

Lee primero, completo:
  docs/handoffs/H2-tenancy.md        (tu handoff)
  docs/handoffs/README.md            (el contrato de no colisión)
  packages/db/ports.ts               (los contratos — implementas TenancyPort)

Contexto: ABRAXA Plataforma es un sistema operativo para emprendedores. Cada uno tiene UNA
empresa (un tenant). Tú construyes quién es cada quien, a qué tenant pertenece y qué puede
tocar. Todo lo demás depende de esto.

Portas código de GARDEN, que está en "/Volumes/FRAGUA/CLAUDE CODE/GARDEN" — consúltalo, NO lo
edites. Lo más valioso ahí es src/api/middleware/tenant.ts: el RBAC por área está bien hecho
y se lleva casi tal cual.

Trabajas SÓLO en packages/tenancy/**. Migraciones 010–019. Rama h2-tenancy.
Otras 3 conversaciones están trabajando en paralelo en otros paquetes — si escribes fuera de
tu carril, el gate de CI falla el PR.

El criterio que más importa es el #3 de tu handoff: la prueba automatizada de que el tenant A
no puede leer datos del tenant B. Ese test es la única garantía real de aislamiento entre
clientes que paga.

Si algo del handoff está mal o incompleto, dilo y propón el arreglo antes de construir.
```
