# H1 — Fundación del monorepo

> **Ola 0. Va SOLO.** Ninguna otra conversación arranca hasta que este PR esté mergeado.
> Rama: `h1-fundacion` · Migraciones: `001`–`009`

---

## 1. Contexto

Se está construyendo **ABRAXA Plataforma**: un sistema operativo empresarial para
emprendedores. Un emprendedor de cualquier giro conecta su empresa y va desbloqueando áreas
(Ventas, Dirección, Onboarding, Servicio…) conforme su negocio crece, guiado por un **agente
maestro** al que él mismo le pone nombre.

Es un producto **nuevo y separado** de GARDEN, que es el sistema operativo interno de ABRAXA.
GARDEN vive en `/Volumes/FRAGUA/CLAUDE CODE/GARDEN` y **no se toca**: es fuente de consulta y
de código a portar, nada más.

Tu trabajo **no es código de producto**. Es el andamiaje que permite que **4 o 5
conversaciones construyan en paralelo sin destruirse entre sí**. Todo lo que hagas mal aquí se
multiplica por 14 después.

---

## 2. Por qué existe este handoff

Cinco conversaciones simultáneas sobre un mismo repo chocan por cinco razones. Tu entregable
las elimina de raíz:

| Colisión | Lo que tú dejas hecho |
|---|---|
| Dos conversaciones editan el mismo archivo | Propiedad exclusiva de directorios + gate de CI que la aplica |
| Dos migraciones con el mismo número | Rango asignado por handoff, verificado en CI |
| Todos editan el cableado central | **Tú lo escribes UNA vez.** Los 12 paquetes ya importados por `apps/api` |
| Conflictos de `package-lock.json` | **Tú instalas todas las dependencias.** Nadie más instala nada |
| Un handoff necesita código de otro que no existe | **Tú declaras los contratos cruzados** en `packages/db/ports.ts` |

---

## 3. Alcance

### Sí

1. Monorepo con npm workspaces, TypeScript strict, ESM.
2. **Los 12 paquetes creados y vacíos pero válidos**, ya importados por `apps/api`.
3. **`packages/db/ports.ts`** con los contratos cruzados — sólo tipos.
4. **`tenantDb(ctx)`** y la regla de lint que prohíbe el cliente crudo.
5. **Migración 001**: `REVOKE` + RLS **antes** de la primera tabla de dominio.
6. Todas las dependencias instaladas, lockfile congelado.
7. Route groups de `apps/web` como carpetas vacías con `layout.tsx` mínimo.
8. CI en **Node 22** con typecheck, lint, test, build.
9. **`.ownership.json`** + job `ownership-gate`.
10. `CONTRIBUTING.md` con la tabla de propiedad.

### No

- Cero lógica de negocio. Cero UI real. Cero endpoints de dominio.
- No portes código de GARDEN. Eso lo hace cada handoff en su carril.
- No crees tablas de dominio más allá de las de tenancy base.

---

## 4. Estructura a crear

```
abraxa-plataforma/
  apps/
    api/          Express + TS · gateway
    web/          Next.js 14 App Router
    worker/       pg-boss
  packages/
    config/       zod, env, constantes        ← tuyo
    db/           cliente, tipos, ports       ← tuyo
    tenancy/  agents/  vault/  ui/  inbox/
    onboarding/  flows/  work/  billing/  areas/    ← stubs vacíos
  migrations/
  docs/
  .ownership.json
  CONTRIBUTING.md
```

Cada paquete stub necesita `package.json`, `tsconfig.json` y un `src/index.ts` que exporte algo
válido (aunque sea `export const ready = false`), **y estar importado por `apps/api`** para que
nadie tenga que editar el cableado después.

### Route groups de `apps/web/app` (carpetas vacías con `layout.tsx` mínimo)

```
(public)/       landing y pago          → H10
(onboarding)/   el Ritual de Fundación  → H7
(app)/          el producto             → shell de H5
  direccion/    → H4      bandeja/      → H6
  automatizaciones/ → H8  tareas/       → H9
  mapa/         → H11
(admin)/        panel de agencia        → H14
```

---

## 5. `packages/db/ports.ts` — los contratos cruzados

**Esto es lo más importante que entregas.** Sólo tipos, cero implementación. Permite que H8
programe contra el inbox sin esperar a H6.

Define al menos:

```ts
export interface TenantContext { tenantId: string; userEmail: string | null; areas: Record<string, 'view'|'edit'|'admin'>; }

export interface InboxPort {
  send(ctx: TenantContext, i: { threadId: string; body: string; media?: string[] }): Promise<{ messageId: string }>;
  startThread(ctx: TenantContext, i: { contactId: string; channelType: ChannelType }): Promise<{ threadId: string }>;
}

export interface AgentPort {
  run(ctx: TenantContext, i: { role: AgentRole; input: string; threadId?: string }): Promise<{ text: string; usage: Usage }>;
}

export interface VaultPort {
  resolve(ctx: TenantContext, scope?: VaultScope): Promise<Record<string, string>>;
  injectIntoPrompt(ctx: TenantContext, prompt: string): Promise<string>;
}

export interface TenancyPort {
  provision(i: { slug: string; name: string; ownerEmail: string; industryType?: string }): Promise<{ tenantId: string }>;
  contextFor(i: { userEmail: string; tenantSlug: string }): Promise<TenantContext>;
}

export interface FlowPort { emit(ctx: TenantContext, e: { type: TriggerType; payload: unknown }): Promise<void>; }
export interface BillingPort { onCheckoutCompleted(i: { sessionId: string }): Promise<{ tenantId: string }>; }

export interface ChannelDriver {
  readonly type: ChannelType;
  send(i: { channelId: string; address: string; body: string; media?: string[] }): Promise<{ externalId: string }>;
  parseWebhook(raw: unknown): Promise<InboundMessage[]>;
}

export type ChannelType = 'whatsapp' | 'instagram' | 'messenger' | 'email' | 'sms';
export type AgentRole = 'master' | 'sales' | 'service' | 'social' | 'analyst';
export type TriggerType = 'contact_created' | 'stage_changed' | 'form_submitted'
  | 'appointment_created' | 'appointment_cancelled' | 'tag_added' | 'message_in' | 'manual';
export interface Usage { inputTokens: number; outputTokens: number; cachedReadTokens: number; costUsd: number; }
```

Ajusta y amplía si algo falta, pero **no implementes nada**.

---

## 6. `tenantDb(ctx)` — el aislamiento como tipo, no como convención

GARDEN dejó **145 de 170 tablas sin RLS** y el aislamiento entre clientes depende de 447
llamadas a `.eq('tenant_id', …)` escritas a mano. **Ese error no se repite aquí.**

```ts
// packages/db/src/tenant-db.ts — única vía de acceso a datos de dominio
export function tenantDb(ctx: TenantContext) {
  return {
    from<T extends DomainTable>(table: T) {
      return serviceClient().from(table).eq('tenant_id', ctx.tenantId);
    },
  };
}
```

Más una **regla de ESLint** que falle si alguien importa el cliente crudo de Supabase dentro de
`packages/*/src/routes/**` o `packages/*/src/services/**`. Usa `no-restricted-imports` con un
mensaje que explique qué hacer en su lugar.

---

## 7. Migración 001 — el orden importa

```sql
-- 001_foundation.sql
CREATE SCHEMA IF NOT EXISTS app;

-- PRIMERO cerrar. Antes de crear una sola tabla de dominio.
REVOKE ALL ON SCHEMA app FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- Después las tablas base de tenancy
CREATE TABLE app.tenants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text UNIQUE NOT NULL,
  name          text NOT NULL,
  industry_type text,
  stage         text,
  settings      jsonb NOT NULL DEFAULT '{}',
  plan          text NOT NULL DEFAULT 'free',
  status        text NOT NULL DEFAULT 'active',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.memberships (
  tenant_id  uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  user_email text NOT NULL,
  role       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_email)
);

CREATE TABLE app.area_grants (
  tenant_id  uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  user_email text NOT NULL,
  area_slug  text NOT NULL,
  access     text NOT NULL CHECK (access IN ('view','edit','admin')),
  PRIMARY KEY (tenant_id, user_email, area_slug)
);

-- RLS en todas, desde el primer día. service_role hace bypass.
ALTER TABLE app.tenants     ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.area_grants ENABLE ROW LEVEL SECURITY;
```

**Deja escrito en `migrations/README.md`** que toda tabla de dominio nueva lleva `tenant_id`,
`ENABLE ROW LEVEL SECURITY` y su política, en la misma migración que la crea. Sin excepción.

---

## 8. `.ownership.json` y el gate de CI

El contrato de no colisión en forma ejecutable. Una entrada por handoff:

```json
{
  "h6-inbox": {
    "paths": [
      "packages/inbox/**",
      "!packages/inbox/drivers/meta/**",
      "!packages/inbox/drivers/email/**",
      "!packages/inbox/drivers/sms/**",
      "apps/web/app/(app)/bandeja/**"
    ],
    "migrations": [40, 49]
  }
}
```

La tabla completa está en `docs/handoffs/README.md`. Cópiala entera.

**Job `ownership-gate`** en cada PR. Deriva el handoff del nombre de la rama y falla con el
archivo exacto que se salió:

| Verifica | Falla si |
|---|---|
| Propiedad | `git diff --name-only origin/main...HEAD` toca algo fuera de sus globs |
| Migraciones | un archivo de `migrations/` cae fuera de su bloque de 10 |
| Lockfile | `package-lock.json` cambió |
| Secretos | el diff trae `sk-`, `sbp_`, `whsec_`, `gh[pousr]_` o `PRIVATE KEY` |

El mensaje de error tiene que decir **qué archivo** y **a qué handoff pertenece**, para que la
conversación se corrija sola sin preguntarle a nadie.

---

## 9. Dependencias — instálalas todas ahora

Nadie más va a instalar nada. Como mínimo:

**Backend:** `express`, `zod`, `@supabase/supabase-js`, `pg-boss`, `pino`, `@anthropic-ai/sdk`,
`stripe`, `resend`, `twilio`, `openai` (embeddings), `js-yaml`, `nanoid`, `date-fns`.

**Frontend:** `next@14`, `react`, `next-auth`, `@xyflow/react`, `react-markdown`, `cmdk`,
`lucide-react`, `tailwindcss`, `tailwindcss-animate`, `class-variance-authority`, `clsx`,
`tailwind-merge`, `@radix-ui/react-{dialog,popover,select,tabs,tooltip,scroll-area,slot,separator}`,
`recharts`.

**Dev:** `typescript`, `tsx`, `vitest`, `eslint`, `@typescript-eslint/*`, `prettier`,
`@playwright/test`.

Si alguna sobra, es un costo trivial. Si falta, un handoff se bloquea o rompe el lockfile.

---

## 10. Criterios observables de "listo"

No basta con que digas que quedó. Se verifica así:

1. `npm ci && npm run build` verde desde cero en Node 22.
2. `npm run typecheck` y `npm run lint` verdes.
3. `apps/api` arranca e importa los 12 paquetes sin error.
4. `apps/web` arranca y las 8 route groups renderizan (aunque estén vacías).
5. **La migración 001 aplicada**, y desde el dashboard de Supabase con la anon key una consulta
   a `app.tenants` devuelve `permission denied`.
6. **El gate funciona**: crea una rama `h6-inbox` de prueba, toca `packages/vault/algo.ts`, abre
   PR y **confirma que CI falla nombrando ese archivo**. Borra la rama después.
7. `.ownership.json` tiene las 14 entradas.
8. `CONTRIBUTING.md` explica las 5 reglas y la tabla.

---

## 11. Qué NO hacer

- **No portes código de GARDEN.** Tentador y equivocado: cada handoff porta lo suyo.
- **No implementes ningún port.** Sólo tipos.
- **No crees tablas de dominio** fuera de tenancy base.
- **No dejes el cableado a medias.** Si `apps/api` no importa los 12 paquetes, el primer handoff
  de la ola 1 va a tener que editarlo y arrancan las colisiones.

---

## 12. Prompt de arranque

```
Vas a construir H1 — la Fundación del monorepo de ABRAXA Plataforma.

Lee primero, completo:
  docs/handoffs/H1-fundacion.md      (tu handoff)
  docs/handoffs/README.md            (el contrato de no colisión)

Contexto en una línea: ABRAXA Plataforma es un sistema operativo empresarial para
emprendedores, producto nuevo y separado de GARDEN (que vive en
"/Volumes/FRAGUA/CLAUDE CODE/GARDEN" y NO se toca — sólo se consulta).

Tu entregable NO es código de producto. Es el andamiaje que permite que 4 o 5 conversaciones
construyan en paralelo sin pisarse: los 12 paquetes ya cableados, los contratos cruzados
declarados como tipos, todas las dependencias instaladas, la migración 001 con RLS activo
ANTES de la primera tabla de dominio, y el gate de CI que aplica el contrato de propiedad.

Trabajas en la rama h1-fundacion. Migraciones 001–009.

Antes de dar por terminado, verifica los 8 criterios de la sección 10 de tu handoff — uno por
uno, con evidencia real. El #6 (probar que el gate de CI efectivamente falla) es el que más
importa: si ese gate no funciona, todo el paralelismo posterior se cae.

Si algo del handoff está mal o incompleto, dilo y propón el arreglo antes de construir.
```
