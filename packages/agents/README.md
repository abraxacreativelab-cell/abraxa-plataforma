# @abraxa/agents — H3

El motor que corre los agentes de cada emprendedor: un **agente maestro** al que
él mismo le pone nombre, y debajo sub-agentes por área que contestan a **sus**
clientes.

Este paquete define, corre, cobra y limita. No conecta agentes al inbox (eso es
H6, que llama a `AgentPort`) ni construye el Ritual de Fundación (H7, que usa
`upsertDefinition`).

| | |
|---|---|
| **Handoff** | `docs/handoffs/H3-agents.md` |
| **Montado en** | `apps/api` → `/agents` (H1 ya lo cableó) |
| **Migraciones** | `020`–`024` |
| **Contratos** | `packages/db/ports.ts` |

---

## Los dos huecos de GARDEN que aquí no se repiten

### 1. Las definiciones vivían en YAML del disco

GARDEN carga cada agente con `readdirSync` al arrancar
(`src/bots/bot-factory.ts:39-55`). Cliente nuevo = commit + deploy + reinicio.

Aquí viven en `app.agent_definitions`. **Cliente nuevo = INSERT.** No hay caché
de proceso: la fila se lee en cada corrida, así que un cambio aplica en la
siguiente respuesta. Cuesta una consulta indexada por mensaje, y es barato al
lado de la alternativa — un caché en memoria significa dos instancias de la API
contestando con definiciones distintas después de un cambio, y ese bug no se
reproduce en desarrollo.

### 2. El costo se estimaba con una tabla escrita a mano

`src/services/openrouter.ts:83-100` de GARDEN tiene ocho modelos y un **fallback
silencioso** de `{input: 1.0, output: 3.0}` para todo lo demás. Y las entradas
que sí están, están mal: `claude-opus-4.6` figura a $15/$75 cuando cuesta $5/$25.

El reparto aquí:

| | Qué es | Dónde vive |
|---|---|---|
| **Tokens** | medición | leídos de `usage` en la respuesta, jamás estimados |
| **Precio** | dato | `app.model_pricing`, versionado por `effective_from` |
| **Costo** | proyección | calculado, y **recalculable** |

Lo tercero es lo que GARDEN no tiene. Su fila guarda un número ya cocinado;
cuando está mal, no queda nada con qué rehacerlo y se ve idéntico a uno bueno.
Aquí la fila guarda los tokens: un precio equivocado es un `UPDATE`, no un dato
perdido.

Un modelo sin precio **no se cobra a un número inventado**: se marca
`cost_source='unpriced'`, se registra con costo 0, y
`src/bin/check-pricing.ts` lo saca a la luz.

---

## Cómo se usa

```ts
import { usePort } from '@abraxa/db';

// Correr un agente — H6 al llegar un mensaje, H7 durante la entrevista
const { text, usage, agentName } = await usePort('agents').run(ctx, {
  role: 'sales',
  input: 'hola, ¿a qué hora abren?',
  threadId,
});

// Registrar una tool desde TU paquete — H4 la de bóveda, H6 la de mensajería
usePort('agents').registerTool({ name, description, inputSchema, handler });

// Bautizar al agente maestro — H7
await usePort('agents').upsertDefinition(ctx, {
  role: 'master', name: 'Chelo', systemPrompt: '…',
});
```

El aislamiento por tenant se aplica **dentro** de cada handler con
`tenantDb(ctx)`. Una tool corrida con el contexto de A no puede leer datos de B,
y eso está probado (`service.test.ts`, criterio #7).

---

## El orden en que corre

```
1. definición    ← fila de app.agent_definitions   (no un YAML del disco)
2. presupuesto   ← lanza ANTES de gastar           (no degrada en silencio)
3. llave         ← del tenant, o de la plataforma
4. prompt        ← fila + bóveda + contexto del tenant
5. caché         ← ¿el prefijo llega al mínimo del modelo?
6. loop          ← proveedor + tools, hasta 10 vueltas
7. costo         ← tokens reales × precio vigente
8. ledger        ← se escribe SIEMPRE, éxito o error
```

El paso 2 va antes que el 6 porque un tope que se revisa después de llamar al
modelo no es un tope. El 8 corre aunque el 6 haya reventado, porque los tokens
de una respuesta que falló a media generación ya se van a facturar.

---

## Dos trampas de modelo que este paquete evita

### `output_config.effort` mata a Haiku 4.5

Los tres sub-agentes de cara al cliente (`sales`, `service`, `social`) corren en
Haiku 4.5, que devuelve **400** ante `output_config.effort`. Un adaptador que
arme el cuerpo igual para todos los modelos los tumba a los tres en la primera
llamada.

### Sonnet 5 piensa por omisión

Si no se apaga explícitamente, cada mensaje de un cliente final paga tokens de
razonamiento que nadie pidió, y `max_tokens` cubre pensamiento + texto, así que
la respuesta además sale truncada. Sin error: sólo respuestas peores y más caras.

Las dos viven en `src/capabilities.ts`, tabuladas **por modelo** — no por
proveedor y no inferidas del nombre.

---

## El caché de prompt (criterio #4)

Debajo del mínimo, el caché no se crea. Sin error y sin aviso.

| Modelo | Mínimo cacheable |
|---|---:|
| Opus 5 / Fable 5 | 512 |
| Sonnet 5, Opus 4.8, Sonnet 4.6 | 1,024 |
| Opus 4.7 | 2,048 |
| **Haiku 4.5**, Opus 4.6, Opus 4.5 | **4,096** |

Tres cosas que conviene saber antes de alargar prompts:

1. **El mínimo cubre el prefijo completo.** El orden de render es
   `tools → system → messages`, así que las definiciones de tools cuentan. Un
   sub-agente con seis tools puede cruzar el mínimo sin tocar el prompt.
2. **Fallar el caché no "triplica" el costo.** Sin caché se paga 1.0× de input
   en cada llamada; con caché, 1.25× una vez y 0.1× las siguientes. Lo que se
   pierde es el ahorro de ~90%: la llamada repetida cuesta ~10× lo que costaría
   cacheada.
3. **El mínimo no crece con la generación.** El modelo más nuevo tiene el más
   bajo y el de más volumen el más alto. Hay que tabularlo.

**Estimar no es medir.** `src/prompt/cache.ts` estima para decidir si vale la
pena *pedir* el caché. La verificación es `cache_read_input_tokens > 0` contra
la API real:

```bash
ANTHROPIC_API_KEY=sk-... npx tsx packages/agents/src/bin/measure-cache.ts
```

---

## Migraciones

| # | Qué |
|---|---|
| `020` | `agent_definitions` — las definiciones, en DB |
| `021` | `model_pricing` — precios versionados por fecha *(tenantless)* |
| `022` | `agent_messages` — historial del agente |
| `023` | `usage_ledger` — consumo real, con tokens crudos |
| `024` | `agent_plan_limits` *(tenantless)* + `agent_budget_overrides` |

---

## Guiones

```bash
# ¿Cachea de verdad? (necesita ANTHROPIC_API_KEY)
npx tsx packages/agents/src/bin/measure-cache.ts

# ¿Algún modelo en uso sin precio capturado? (necesita base)
npx tsx packages/agents/src/bin/check-pricing.ts
```

---

## Lo que este paquete consume de otros

| Port | De quién | Si no está |
|---|---|---|
| `VaultPort` | H4 | `tryPort('vault')` → el agente corre **sin bóveda**, no revienta |
| `TenancyPort` | H2 | sólo lo usan las rutas HTTP; devuelven 501 nombrando a H2 |

`app.tenant_integrations` (credenciales por cliente, para `key_ref`) **no tiene
dueño asignado** en ningún handoff. Mientras tanto `providers/keys.ts` cae a la
llave de la plataforma y deja rastro en el log.

---

## Nota sobre `@anthropic-ai/sdk`

El adaptador de Anthropic habla HTTP en vez de usar el SDK. Razón: H1 instaló
`@anthropic-ai/sdk@^0.33.1` (diciembre 2024), que no conoce `output_config` ni
`thinking` — los dos parámetros que este motor necesita para no romper Haiku 4.5
y para apagar el pensamiento por omisión de Sonnet 5. Subir la versión mueve
`package-lock.json`, que es de H1 y el gate lo rebota con razón.

**Anotado en el PR:** subir el SDK a una versión actual. Cuando pase, el
adaptador se puede reescribir sin tocar nada más — para eso existe
`ProviderAdapter`.
