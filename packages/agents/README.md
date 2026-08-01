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
| **Migraciones** | `020`–`027` |
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
`cost_source='unpriced'` y se registra con costo 0.

### 3. …y ese 0 honesto apagaba el tope *(hallazgo del 2026-07-31)*

El `0` de `unpriced` era correcto para la contabilidad y catastrófico para el
presupuesto: `gastoDesde()` sumaba ceros, el tope comparaba `0 >= 5.00` y
**siempre dejaba pasar**. Un tenant de plan free podía quemar cientos de dólares
reales con `GET /agents/budget` reportando `gastadoUsd: 0`. La única señal era un
`log.warn` por corrida.

No se arregla inventando un precio —ése es el pecado de GARDEN—. Se arregla
separando las dos preguntas, que nunca fueron la misma:

| Columna | Pregunta | Cuando no hay precio |
|---|---|---|
| `cost_usd` | ¿cuánto costó? | `0`, marcado, y **recalculable** |
| `budgeted_usd` | ¿cuánto cuenta al tope? | el **piso** conservador |

El piso es el modelo más caro del catálogo (`PRECIO_DE_PISO`, Fable 5). Falla
hacia caro a propósito: cortar el servicio de más se atiende con una llamada;
una factura de $500 en un plan de $5, no.

Y por delante hay una puerta más: si el modelo **está en el catálogo** de
`capabilities.ts` y no tiene precio vigente, la corrida se rechaza con
`VALIDATION` **antes** de llamar al proveedor. Un modelo que decimos conocer sin
precio es un error de operación, no una condición normal. Un modelo
*desconocido* sí corre —estrenar modelo sin deploy es la promesa entera de H3—
y de ése se encarga el piso.

Dos guardianes impiden que el hueco vuelva:

- **`src/pricing/seeds.test.ts`** cruza el catálogo del código contra las
  semillas de `migrations/` y **rompe el build**. Corre en `npm test`, o sea en
  CI, sin base.
- **`npm run check:pricing`** corre contra la base real y ve lo que la prueba no
  puede ver: los modelos que los **clientes** pusieron en sus filas. Va en el
  despliegue, después de `npm run migrate`.

> **La migración 021 decía tener esa prueba desde el primer día.** No existía —
> y por eso `claude-sonnet-4-6` vivió meses en el catálogo sin precio. La frase
> sigue escrita en `migrations/021_model_pricing.sql` y en el `COMMENT ON` de
> `cost_source` de la `023`, y **no se puede borrar**: las dos ya están
> aplicadas, y `scripts/migrate.mjs:88-98` aborta el despliegue entero si el
> checksum de una migración aplicada cambia. Los `COMMENT ON` de la `025` y la
> `026` pisan ese texto en la base viva; el encabezado de la `025` deja la nota.
> Un comentario que promete un guardián inexistente es peor que no tener
> guardián: hace que nadie lo busque.

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
3. precio        ← lanza ANTES de gastar si el modelo es conocido y no tiene precio
4. llave         ← del tenant, o de la plataforma
5. prompt        ← fila + bóveda + contexto del tenant
6. caché         ← ¿el prefijo llega al mínimo del modelo?
7. loop          ← proveedor + tools, hasta 10 vueltas
8. costo         ← tokens reales × precio vigente
9. ledger        ← se escribe SIEMPRE, éxito o error
```

Los pasos 2 y 3 van antes que el 7 porque un tope que se revisa después de
llamar al modelo no es un tope, y un precio que se busca después tampoco sirve
para aplicarlo. El 9 corre aunque el 7 haya reventado, porque los tokens de una
respuesta que falló a media generación ya se van a facturar.

Y **se registran los de verdad**, no cero. El acumulado del loop se empuja hacia
afuera vuelta por vuelta (`agentLoop({ onUsage })`): si el proveedor devuelve
529 en la quinta iteración, las cuatro anteriores ya se contabilizaron. Antes
vivían en una variable local que se iba con la excepción, así que el ledger
escribía `input_tokens=0` y ~$0.32 ya facturables desaparecían del tope — y como
un 529 es reintentable, cada reintento repetía la fuga.

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
ANTHROPIC_API_KEY=sk-... npm run measure:cache --workspace packages/agents
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
| `025` | precio de `claude-sonnet-4-6`, el que faltaba + recálculo hacia atrás |
| `026` | `usage_ledger.budgeted_usd` — lo que cuenta contra el tope |
| `027` | CHECK cruzado `(provider, model)` en `agent_definitions` |

---

## El par `(provider, model)` *(hallazgo del 2026-07-31)*

Cada proveedor nombra al **mismo** modelo distinto, y mandarle el id del otro es
un 400 garantizado:

| Proveedor | Dialecto | Ejemplo |
|---|---|---|
| `anthropic` | sin prefijo de vendor | `claude-haiku-4-5` |
| `openrouter` | `vendor/modelo` | `anthropic/claude-haiku-4.5` |
| `local` | lo que el runtime propio use | *no lo conocemos; no opinamos* |

La 020 le puso `CHECK` a `provider` y dejó `model` como texto libre, así que la
**combinación** nunca se validó. Peor: `upsertDefinition` la fabricaba sola —
cambiar sólo `provider` heredaba el `model` anterior y dejaba la fila en el par
roto, sin una queja. El costo aparecía en el siguiente mensaje del cliente
final: `400 not a valid model ID` en cada intento, hasta que alguien leyera el
log.

Cerrado en dos capas, porque ninguna basta sola:

- **Código** — cambiar de proveedor **exige `model` explícito**, y el par se
  valida antes del upsert (`dialectoValido`). Es la capa que da un mensaje
  entendible y evoluciona sin migración.
- **Base** — el `CHECK` de la `027`. Es la que sobrevive a un `psql` a mano y al
  próximo camino de escritura que alguien agregue sin acordarse de validar.

La validación mira el **dialecto**, no el catálogo: `deepseek/deepseek-chat` no
está tabulado en `capabilities.ts` y es un id perfectamente legítimo con precio
desde la `021`. Exigir catálogo devolvería a H3 al YAML de disco de GARDEN.

Y `esConocido()` ya considera el proveedor: antes hacía *hit* directo en el
catálogo ignorándolo, así que el par roto respondía `true` y ninguna señal se
encendía.

---

## Guiones

```bash
# ¿Algún modelo en uso sin precio capturado? (necesita base)
#   → correr en cada despliegue, después de `npm run migrate`
npm run check:pricing --workspace packages/agents

# ¿Cachea de verdad? (necesita ANTHROPIC_API_KEY)
npm run measure:cache --workspace packages/agents
```

Los dos se compilan con `esbuild --bundle` y corren con `node`; no dependen de
`tsx`.

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
