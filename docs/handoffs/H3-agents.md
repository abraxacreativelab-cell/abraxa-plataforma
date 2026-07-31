# H3 — Agents

> **Ola 1.** Corre en paralelo con H2, H4 y H5. Requiere que H1 esté mergeado.
> **Está en la ruta crítica** — H6 y H7 te esperan.
> Rama: `h3-agents` · Migraciones: `020`–`029` · Directorio: `packages/agents/**`

---

## 1. Contexto

Cada emprendedor tiene un **agente maestro** al que él mismo le pone nombre en su primer
minuto en el producto. Ese agente lo entrevista, entiende su negocio, arma su roadmap y lo
acompaña. Debajo hay sub-agentes por área (ventas, servicio, redes) que contestan mensajes de
sus clientes finales.

Tú construyes el motor que corre a todos: **cómo se definen, con qué modelo hablan, cómo se les
cobra el consumo y cómo se les pone un tope.**

**Los dos huecos que cierras:**
- En GARDEN las definiciones de agentes viven en **archivos YAML del filesystem**, cargados con
  `readdirSync` al arrancar (`src/bots/bot-factory.ts:44`). Cliente nuevo = commit + deploy.
  **Aquí van en base de datos.**
- El registro de costos es **estimado con tablas hardcodeadas** (`src/services/openrouter.ts:83-93`)
  y estuvo roto meses sin que nadie lo notara. **Aquí se lee el costo real de la respuesta.**

---

## 2. Alcance

### Sí

1. **Router de proveedores** — `anthropic` | `openrouter` | `local`, elegido por fila de DB.
2. **`agent_definitions` en base de datos**, no en YAML.
3. Loop de agente con tool use.
4. Registro de tools con aislamiento por tenant.
5. **`usage_ledger`** con costo **real**.
6. Presupuesto y rate limit **por tenant**.

### No

- **No** conectes agentes al inbox. Eso es H6 — él te llama a ti.
- **No** construyas el Ritual de Fundación. Eso es H7 — él usa tu `AgentPort`.
- **No** implementes tools de otros dominios (bóveda, flows). Ellos registran las suyas.

---

## 3. Contrato de no colisión

| | |
|---|---|
| **Escribes sólo en** | `packages/agents/**` |
| **Migraciones** | `020`–`029` |
| **Rama** | `h3-agents` |

**Implementas:** `AgentPort`.
**Consumes:** `VaultPort` (H4) para inyectar los datos del negocio al prompt — **contra la
interfaz, no esperes su código.** Si no está implementado aún, tu fallback es prompt sin bóveda.

---

## 4. El router de proveedores — la pieza que define el futuro

```
  agent_definitions (fila en DB, por tenant)
        │  { role, provider, model, key_ref, system_prompt, tools[] }
        ▼
  ┌───────────────────────────────────────────────┐
  │  anthropic   → Messages API                    │
  │  openrouter  → modelos baratos / fallback      │
  │  local       → modelos propios     ← v2        │
  └───────────────────────────────────────────────┘
```

**Por qué importa:** Santiago quiere eventualmente correr modelos locales para no pagar tokens.
Si el proveedor es una columna de DB detrás de una interfaz, migrar un agente a un modelo local
es **una fila**, no un refactor. Diseña `ProviderAdapter` con eso en mente aunque hoy sólo
implementes `anthropic` y `openrouter`.

**Autenticación:** API key de Anthropic (`ANTHROPIC_API_KEY`), **no** el Agent SDK con
suscripción. Son productos distintos. Cada tenant puede tener su propia key referenciada por
`key_ref` → `tenant_integrations` (tabla de H2/H4); si no tiene, usa la key de la plataforma.

**Modelos por defecto:**

| Rol | Modelo | Por qué |
|---|---|---|
| `master` | `claude-sonnet-5` | Entrevista y síntesis. Volumen bajo, calidad alta |
| `sales` `service` `social` | `claude-haiku-4-5` | Volumen alto, latencia baja |
| `analyst` | `claude-sonnet-5` + Batch API | No es tiempo real → −50% de costo |

---

## 5. Costo — hazlo bien esta vez

**Lee el costo real de la respuesta**, no lo estimes. La API devuelve `usage` con
`input_tokens`, `output_tokens`, `cache_creation_input_tokens` y `cache_read_input_tokens`.

```sql
-- 020_agents.sql
CREATE TABLE app.usage_ledger (
  id                 bigserial PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  agent_role         text NOT NULL,
  provider           text NOT NULL,
  model              text NOT NULL,
  input_tokens       int NOT NULL,
  output_tokens      int NOT NULL,
  cache_read_tokens  int NOT NULL DEFAULT 0,
  cache_write_tokens int NOT NULL DEFAULT 0,
  cost_usd           numeric(12,6) NOT NULL,
  thread_id          text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON app.usage_ledger (tenant_id, created_at DESC);
ALTER TABLE app.usage_ledger ENABLE ROW LEVEL SECURITY;
```

**La trampa del caché que hay que medir, no asumir:** el mínimo cacheable de **Haiku 4.5 son
4,096 tokens**; el de Sonnet 5 son 1,024. Si el prompt de sistema de un sub-agente no llega a
4,096, **no cachea y el costo se triplica en silencio**. Verifica con
`cache_read_input_tokens > 0` en peticiones repetidas y deja ese chequeo en un test.

**Presupuesto por tenant:** antes de cada llamada, suma el gasto del mes. Si rebasa el límite de
su plan, lanza `BudgetExceeded` — no degrades a un modelo peor en silencio. En GARDEN
`MONTHLY_BUDGET_USD` está declarado y **nunca se aplica** (`src/config.ts:122`, única aparición).
Eso no se repite.

---

## 6. Definiciones en DB

```sql
CREATE TABLE app.agent_definitions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  role          text NOT NULL,        -- master | sales | service | social | analyst
  name          text NOT NULL,        -- el nombre que le puso el emprendedor
  provider      text NOT NULL DEFAULT 'anthropic',
  model         text NOT NULL,
  key_ref       text,                 -- null = key de la plataforma
  system_prompt text NOT NULL,
  tools         text[] NOT NULL DEFAULT '{}',
  enabled       boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, role)
);
```

**El prompt efectivo se compone en cada mensaje**, en este orden — patrón portado de
`GARDEN/src/bots/base-bot.ts:143-235`:

```
system_prompt (de la fila)
  + inyección de la BÓVEDA           ← VaultPort.injectIntoPrompt()
  + contexto del tenant (giro, etapa)
```

El bloque de bóveda le mete al agente **los números reales del negocio** con la instrucción de
citarlos exactos y no inventarlos. Es 33 líneas en GARDEN
(`src/vault/agent-inject.ts`) y es patrón oro — cópialo.

---

## 7. Tools

Registro con `ExecutionContext` que lleva `{ tenantId, userEmail, role }`. **El aislamiento por
tenant se aplica dentro de cada handler**, usando `tenantDb(ctx)` de H1 — nunca el cliente crudo.

Tú registras sólo las tools genéricas del motor. Los demás handoffs registran las suyas: H4 la
de bóveda, H6 la de mensajería, H8 la de flows.

Referencia: `GARDEN/src/core/tool-registry.ts` y `src/core/agent-loop.ts` (167 líneas, simple y
sólido — máx 10 iteraciones, rate limiter, eventos, timeout por tool).

---

## 8. Criterios observables de "listo"

1. Crear un `agent_definition` en DB y que el agente responda **sin redeploy**.
2. Cambiar `provider` de `anthropic` a `openrouter` en la fila y que siga funcionando.
3. Cada llamada escribe una fila en `usage_ledger` con **costo real**, y la suma cuadra con lo
   que reporta la consola de Anthropic (±5%).
4. **`cache_read_input_tokens > 0`** en la segunda llamada con el mismo prompt de sistema. Si es
   cero en Haiku, el prompt no llega a 4,096 tokens — documéntalo o alárgalo.
5. Al rebasar el presupuesto del plan, lanza `BudgetExceeded`; no degrada en silencio.
6. Dos tenants con el mismo rol tienen agentes independientes: prompt, modelo y consumo separados.
7. Una tool ejecutada con el contexto del tenant A **no puede** leer datos del B.

---

## 9. Prompt de arranque

```
Vas a construir H3 — la capa de Agents de ABRAXA Plataforma. Estás en la ruta crítica:
H6 (inbox) y H7 (el onboarding conversacional) te esperan.

Lee primero, completo:
  docs/handoffs/H3-agents.md         (tu handoff)
  docs/handoffs/README.md            (el contrato de no colisión)
  packages/db/ports.ts               (implementas AgentPort, consumes VaultPort)

Contexto: cada emprendedor tiene un agente maestro al que él le pone nombre, más sub-agentes
por área que contestan a sus clientes. Tú construyes el motor que los corre.

Dos cosas que GARDEN hizo mal y aquí no se repiten:
  1. Las definiciones de agentes viven en YAML del filesystem → cliente nuevo = deploy.
     Aquí van en base de datos.
  2. El costo se estima con tablas hardcodeadas y estuvo roto meses sin que nadie lo notara.
     Aquí se lee el costo REAL de la respuesta de la API.

GARDEN está en "/Volumes/FRAGUA/CLAUDE CODE/GARDEN" — consúltalo, NO lo edites. Llévate
src/core/agent-loop.ts y el patrón de src/vault/agent-inject.ts.

Trabajas SÓLO en packages/agents/**. Migraciones 020–029. Rama h3-agents.
Otras 3 conversaciones trabajan en paralelo. Consumes VaultPort CONTRA LA INTERFAZ — no
esperes a que H4 termine; si no está implementado, tu fallback es prompt sin bóveda.

Ojo con el criterio #4: el mínimo cacheable de Haiku 4.5 son 4,096 tokens. Si el prompt de
sistema no llega, no cachea y el costo se triplica en silencio. Mídelo, no lo asumas.

Si algo del handoff está mal o incompleto, dilo y propón el arreglo antes de construir.
```
