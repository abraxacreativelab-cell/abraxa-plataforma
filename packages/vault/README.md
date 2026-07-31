# @abraxa/vault — La Bóveda

> El emprendedor define **una vez** los números de su negocio y se propagan solos a
> sus contratos, sus mensajes y **los prompts de sus agentes**. Cuando cambia un
> precio, cambia en todos lados. Nadie inventa cifras.

| | |
|---|---|
| **Handoff** | H4 |
| **Migraciones** | `030`–`033` |
| **Montado en** | `apps/api` → `/vault` · `apps/web` → `/direccion` |
| **Implementa** | `VaultPort` |
| **Consume** | `TenancyPort` (contexto) · `AgentPort` (opcional, para clasificar) |

---

## Las tres reglas de diseño

Heredadas de GARDEN y conservadas enteras. Si alguna se rompe, el producto deja de servir.

### 1. El documento es la fuente de verdad. Los valores son una proyección.

`app.documents` guarda lo que el emprendedor escribió. `app.canonical_values` guarda los
números que se extrajeron de ahí, con `source_doc_id` apuntando de vuelta con una llave
foránea de verdad.

Si no puedes rastrear de qué documento salió un número, la proyección deja de ser una
proyección y se vuelve un dato inventado con mejor reputación.

### 2. Nada se activa solo.

`active` nace en `false`. Todo valor que sale de un documento queda **propuesto** y lo
aprueba una persona con un clic. Sin excepción, sin bandera para saltárselo, sin «si la
confianza es alta».

Un número que ningún humano aprobó no puede llegar a un contrato.

**Y su corolario: lo aprobado tampoco se pisa solo.** Si el emprendedor aprobó
`consulta_inicial = $850` y meses después pega un documento que dice $900, la ingesta **no
decide**. Deja el $850 vigente —el agente lo sigue citando—, guarda el $900 en las
columnas `conflict_*` de la 031 y lo devuelve en `IngestResult.conflictos` para que la UI
lo enseñe. Lo resuelve una persona con `resolverConflicto(ctx, id, 'aceptar' | 'descartar')`.

Un `upsert` a secas haría lo contrario: cambiaría el precio **y** apagaría la aprobación,
en silencio. El emprendedor se enteraría cuando un contrato saliera con un número que
nunca autorizó.

Reglas de la contradicción, por si hace falta cambiarlas algún día:

| Estado previo del valor | Qué hace una reingesta que dice otra cosa |
|---|---|
| No existe | Lo crea en borrador (`active = false`) |
| Borrador | Lo sobrescribe: nadie ha respondido por él todavía |
| Aprobado, dice lo mismo | Nada. Si venía en conflicto, lo apaga: ya no hay contradicción |
| Aprobado, dice otra cosa | **No lo toca.** Marca `conflict_*` y lo reporta |
| No se pudo leer el estado previo | **No escribe ningún valor** y lo avisa. Escribir a ciegas podría pisar algo aprobado |

### 3. La inyección al prompt es best effort.

`injectIntoPrompt()` **nunca lanza**. Si la bóveda falla, devuelve el prompt intacto.

Un agente sin bóveda contesta peor. Un agente caído deja al emprendedor sin atender a su
cliente. Degradar la calidad es aceptable; tirar la conversación no.

---

## Cómo se usa

```ts
import { usePort } from '@abraxa/db';

const vault = usePort('vault');

// Lo que hace H3 en cada mensaje: el prompt + las cifras reales del negocio.
const prompt = await vault.injectIntoPrompt(ctx, definicion.systemPrompt);

// Lo que hace una plantilla de contrato o de WhatsApp.
const texto = await vault.render(ctx, 'El anticipo es de {valor.anticipo_pct}.');

// Lo que hace H7 durante la entrevista.
const { documentId, valueIds } = await vault.ingestDocument(ctx, { content });
const huecos = await vault.detectGaps(ctx);
```

Desde `apps/web` (Server Components) se importa `@abraxa/vault/api`, que expone los
mismos servicios sin arrastrar Express ni disparar el `registerPort()` del barril.

### Los cuatro namespaces

```
{valor.<clave>}    cualquier tipo, ya formateado
{precio.<clave>}   sólo los de tipo money con monto
{empresa.<k>}      de tenants.settings.empresa / .constants
{marca.<k>}        de tenants.settings.marca
```

Un token desconocido queda **vacío**, nunca `{algo}` crudo. Un contrato que le llega al
cliente final con `{precio_base}` a la vista se lee como un producto roto; un hueco se lee
como un error de captura.

### Alcances

Sólo dos: `tenant` y `area`. Gana el más específico.

GARDEN tenía además `socio` y `propiedad` — vocabulario de una inmobiliaria (Inperio
Rooms). Si algún día un giro necesita un tercer nivel, se agrega; lo que no se hace es
heredar el vocabulario de otro negocio.

---

## Qué se portó de GARDEN

| Origen | Aquí | Cambio |
|---|---|---|
| `src/vault/resolver.ts` | `resolver.ts` | 4 alcances → 2 · `tenantDb` en vez de `.eq()` a mano · sin puente `company_id` |
| `src/vault/agent-inject.ts` | `agent-inject.ts` | Íntegro. El `try/catch` se conserva exacto |
| `src/vault/render.ts:13-35` | `render.ts` | Genérico. `loadEntityVars()` **no** se portó (leía `crm_socios`) |
| `abraxa-bookkeeper/ingest.ts` | `ingest/pipeline.ts` | El prompt ya no dice «Karen de Inperio»: se describe por el giro del tenant |
| **`src/crm/pricing/service.ts:23-55`** | `ingest/money.ts` | La joya que el handoff no menciona: extracción determinista |
| `src/services/embeddings.ts` | `documents/embeddings.ts` | Cortacircuito íntegro, sin proveedor de respaldo (a propósito) |
| `src/vault/area-templates.ts` | `industry/` + migración 033 | La estructura sirve; las 8 empresas de Santiago se fueron a una tabla |

### La moneda se detecta, no se asume

`money.ts` lee la moneda de cada cifra y la lleva hasta `canonical_values.currency`.
Se detecta en dos niveles y en este orden:

1. **En el valor**: `- deposito: $1,200 USD`, `US$499`, `€99`, `499 dólares`, `dlls`.
2. **En una declaración explícita del documento**: una línea `Moneda: USD` o
   «Todos los precios están en dólares».

El segundo nivel es a propósito **estrecho**: bastaría con buscar «USD» en cualquier parte
para que un «el proveedor nos cobra en USD» perdido en un párrafo convirtiera toda la lista
de precios a dólares. La nota de un valor tampoco se mira, por lo mismo — «ya no cobramos
en dólares» marcaría la cifra como USD.

Un falso positivo aquí envenena la bóveda entera; un falso negativo sólo deja el valor en
MXN, que es lo correcto casi siempre. Probado en `money.test.ts` y `pipeline.test.ts`.

### Dos cosas que aquí se arreglaron

**El rango convertido en precio.** El regex de GARDEN cortaba el valor en el primer `-`,
así que `- paquete: $1,500 - $2,000` capturaba sólo `$1,500`, la detección de rango no se
disparaba y 1500 quedaba registrado como el precio. Aquí la nota se separa sólo con raya
(— –) y el guion se queda dentro del valor. Probado en `money.test.ts`.

**El redondeo silencioso.** `formatMoney` de GARDEN usaba `maximumFractionDigits: 0`, así
que $1,500.50 salía como $1,501 en el contrato del cliente. Redondear un número que va a
un contrato no es una decisión de presentación.

### Y una que se dice en vez de fingirse

`notifyVaultChanged()` de GARDEN llamaba a `rpc('pg_notify')` — una RPC que no existe; el
`catch` vacío se la tragaba. Aquí el mecanismo entre procesos **es el TTL de 60 s** y está
escrito así en `cache.ts`. Hay un `setVaultCacheBroadcaster()` para quien quiera enchufar
un bus de verdad. Un invalidador que miente es peor que ninguno.

---

## Verificación

### Sin base de datos — corre en cada PR

```bash
npm test
```

CI no tiene Postgres, así que las pruebas usan un doble en memoria que habla como
PostgREST (`src/testing/fake-db.ts`, enchufado con el `__setClientForTests()` que dejó
H1). Cubre toda la lógica que vive en TypeScript, que es donde están los errores que se
cometen a diario.

**No cubre**: los `CHECK`, las llaves foráneas, el RLS ni el índice HNSW. Para eso:

### Contra una base real

```bash
npm run migrate                       # aplica 030–033
node packages/vault/verify-db.mjs     # verifica esquema, restricciones y funciones SQL
```

`verify-db.mjs` comprueba lo que sólo Postgres puede decir: que el índice único existe,
que los `CHECK` rechazan lo que deben, que borrar un documento deja el valor con
`source_doc_id NULL` en vez de colgando, y que `match_knowledge_chunks` y
`search_documents` responden.

La prueba de que RLS está activo se hace con la llave anónima, desde fuera:

```bash
curl -s "$SUPABASE_URL/rest/v1/canonical_values?select=id" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Accept-Profile: app"
# → {"code":"42501","message":"permission denied for schema app"}
```

---

## Ingesta sin credenciales de IA

El pipeline funciona **sin** `ANTHROPIC_API_KEY` ni `OPENAI_API_KEY`:

| Paso | Depende de un proveedor | Qué pasa si falla |
|---|---|---|
| Clasificar área × tipo | sí | Cae en Dirección y lo dice |
| Guardar el documento | **no** | — |
| Partir en fragmentos | **no** | — |
| Generar embeddings | sí | `embedding NULL`, listo para backfill |
| **Extraer cifras** | **no** | — |
| Crear los valores en borrador | **no** | — |

Los números —lo único que de verdad no se puede alucinar— salen de un regex.

---

## Anotado para H0

- `TenantContext` no trae `settings`, y los namespaces `{empresa.*}` y `{marca.*}` salen
  de ahí. Se lee `app.tenants` desde `global-tables.ts` mientras tanto.
- `AgentPort.run()` no tiene un rol utilitario para clasificar documentos. Hay un
  adaptador listo en `ingest/classifier.ts` para el día que exista.
- `apps/web/app/api/**` (el BFF) no está asignado a nadie en `.ownership.json`. Estas
  pantallas lo esquivan leyendo desde Server Components.
- `sonner` no está instalado y la regla 4 prohíbe agregarlo: hay un toaster mínimo en
  `direccion/_components/ui.tsx`.
