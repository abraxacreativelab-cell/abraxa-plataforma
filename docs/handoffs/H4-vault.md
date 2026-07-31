# H4 — Bóveda: valores canónicos, documentos y biblioteca

> **Ola 1.** Corre en paralelo con H2, H3 y H5. Requiere que H1 esté mergeado.
> Rama: `h4-vault` · Migraciones: `030`–`039`
> Directorios: `packages/vault/**` y `apps/web/app/(app)/direccion/**`

---

## 1. Contexto

La promesa del producto es un **ecosistema de datos siempre centralizados, conectados y
actualizados**. Tú lo construyes.

La idea: el emprendedor define **una sola vez** los números y hechos de su negocio —su precio,
su comisión, su horario, su política de devoluciones— y esos valores se propagan solos a los
contratos que genera, a los mensajes que manda y **a los prompts de sus agentes**. Cuando cambia
un precio, cambia en todos lados. Nadie inventa cifras.

Sin esto, los agentes alucinan números y el producto no sirve. Es el cimiento silencioso.

---

## 2. Alcance

### Sí

1. **Valores canónicos** con tipos, alcances jerárquicos y estado borrador→aprobado.
2. **Resolver** que entrega el mapa de valores ya formateado.
3. **Inyección a prompts de agentes** — el patrón que evita que inventen datos.
4. **Biblioteca de documentos** con buscador, lectura y edición.
5. **Ingesta**: el emprendedor pega un documento → se clasifica, se indexa y se extraen valores.
6. La UI del área **Dirección**.

### No

- **No** el motor de entrevista. Eso es H7 — él usa tu ingesta.
- **No** el desbloqueo de áreas. Eso es H11.
- **No** contratos ni plantillas de mensajes con marca. Van después.

---

## 3. Contrato de no colisión

| | |
|---|---|
| **Escribes sólo en** | `packages/vault/**` y `apps/web/app/(app)/direccion/**` |
| **Migraciones** | `030`–`039` |
| **Rama** | `h4-vault` |

**Implementas:** `VaultPort`.
**Consumes:** `TenancyPort` (H2) para el contexto — contra la interfaz.
**Te consumen:** H3 (agents) inyecta tu bóveda en cada prompt. H7 (ritual) usa tu ingesta.

---

## 4. Qué portar de GARDEN — aquí está lo más valioso

GARDEN está en `/Volumes/FRAGUA/CLAUDE CODE/GARDEN`. **Consulta, no edites.**

| Archivo | Líneas | Veredicto |
|---|---|---|
| `src/vault/resolver.ts` | 219 | **100% genérico. Cópialo casi tal cual.** Jerarquía de scopes, 7 tipos, namespaces, caché de 60s |
| `src/vault/agent-inject.ts` | 33 | **Patrón oro.** Anexa el bloque de datos vigentes al prompt con la instrucción de citarlos exactos |
| `src/vault/render.ts:13-35` | — | `interpolate()` y `renderDocument()`. Genérico. Los tokens desconocidos quedan vacíos, nunca `{…}` crudo |
| `src/vault/render.ts:38-66` | — | ⚠️ `loadEntityVars()` está atado a Inperio (socios, propiedades). **No lo portes** |
| `abraxa/extensions/abraxa-bookkeeper/ingest.ts` | 159 | El pipeline de ingesta completo. El prompt de clasificación se autodescribe como "property management" — **una línea a cambiar** |
| `garden-os/components/vault/tools/admin/valores.tsx` | 427 | La UI completa de valores canónicos |
| `src/vault/area-templates.ts` | 362 | ⚠️ La **estructura** sirve; el **contenido** es property management puro. Ver §6 |

---

## 5. Valores canónicos — el modelo

```sql
-- 030_vault.sql
CREATE TABLE app.values (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  key         text NOT NULL,          -- snake_case, único por tenant+scope
  label       text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('money','percent','number','text','date','bool','list')),
  value       numeric,
  value_text  text,
  value_json  jsonb,
  currency    text NOT NULL DEFAULT 'MXN',
  unit        text,
  note        text,
  area_slug   text,
  scope_type  text NOT NULL DEFAULT 'tenant' CHECK (scope_type IN ('tenant','area')),
  scope_id    text NOT NULL DEFAULT '',
  active      boolean NOT NULL DEFAULT false,   -- ← borrador por defecto
  source_doc_id uuid,
  position    int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app.values ENABLE ROW LEVEL SECURITY;
```

**Cambio respecto a GARDEN:** sus 4 alcances eran `tenant | area | socio | propiedad`. Los dos
últimos son de Inperio Rooms. **Aquí quedan dos:** `tenant` y `area`. Si más adelante un giro
necesita un tercer nivel, se agrega — pero no se hereda el vocabulario inmobiliario.

**Resolución jerárquica:** gana el scope más específico que aplique al contexto. `area` > `tenant`.

**`active: false` por defecto** es deliberado: cuando la ingesta extrae un valor de un documento,
queda **propuesto**, y el emprendedor lo aprueba con un clic. Nada se activa solo. El toast al
aprobar dice qué se propagó.

**Namespaces de salida** — así los consumen mensajes, contratos y prompts:

```
{valor.<key>}     cualquier tipo
{precio.<key>}    sólo los de tipo money
{empresa.<k>}     de tenant.settings
{marca.<k>}       colores, logo, tono
```

---

## 6. Taxonomías por giro — sácalas del código

`GARDEN/src/vault/area-templates.ts` tiene el `COMPANY_TYPE` **hardcodeado con las 8 empresas de
Santiago** (`inperio: 'property'`, `carineeto: 'franchise'`…). Eso no escala a clientes.

**Muévelo a base de datos:**

```sql
CREATE TABLE app.industry_templates (
  id          text PRIMARY KEY,        -- 'servicios' | 'ecommerce' | 'restaurante' | 'agencia' | 'general'
  name        text NOT NULL,
  areas       jsonb NOT NULL,          -- [{ slug, label, icon, position, blurb }]
  expected_docs   jsonb NOT NULL DEFAULT '[]',
  expected_values jsonb NOT NULL DEFAULT '[]'
);
```

Siembra 4 o 5 giros genéricos de PyME mexicana. **Nada de property management.** El
`industry_type` del tenant apunta aquí, y H7 lo asigna cuando la entrevista descubre el giro.

`detectGaps(tenantId)` compara lo esperado contra lo que hay y devuelve los huecos por área. Es
lo que le permite al agente maestro decir *"todavía no me has dicho cuánto cobras"*.
Referencia: `area-templates.ts:343-362` — la lógica es genérica, el contenido no.

---

## 7. Documentos y biblioteca

```sql
CREATE TABLE app.documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  area_slug   text,
  title       text NOT NULL,
  content     text NOT NULL,           -- markdown
  doc_type    text NOT NULL,           -- sop|contrato|precios|guion|politica|manual|faq|plantilla|otro
  status      text NOT NULL DEFAULT 'draft',
  version     int NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.knowledge_chunks (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  document_id uuid REFERENCES app.documents(id) ON DELETE CASCADE,
  content     text NOT NULL,
  embedding   vector(1536),
  chunk_index int NOT NULL
);
```

**Embeddings:** OpenAI `text-embedding-3-small`, 1536 dims. Copia el diseño de
`GARDEN/src/services/embeddings.ts:8-21` — tiene un cortacircuito de 10 min tras 401/403/429, y
**rechaza a propósito un proveedor de respaldo** porque un embedding de otro modelo vive en otro
espacio vectorial y envenenaría la búsqueda en silencio. Es una decisión correcta, consérvala.

`embedding NULL` es un resultado legítimo — se rellena después con un backfill, no se falla.

**La UI de biblioteca es UNA vista**, no cinco. GARDEN tenía carpetas, constelación 3D, flujo y
biblioteca por separado; aquí se fusiona en un árbol con buscador y lector/editor de markdown.
Referencia: `garden-os/components/cerebro/biblioteca-view.tsx` (342 líneas).

---

## 8. Ingesta — documento → valores

El pipeline, portado de `abraxa-bookkeeper/ingest.ts`:

```
el emprendedor pega un documento
  → el modelo clasifica: área × tipo × título × confianza
  → se guarda como documento (draft)
  → se parte en chunks y se embebe
  → se extraen montos de forma DETERMINISTA (regex + tablas markdown, no el modelo)
  → se crean valores con active=false
  → detectGaps() → lista de huecos
```

El comentario de diseño de GARDEN vale la pena conservar: *"el documento madre ES la fuente de
verdad; los valores son una proyección. Nada se activa solo."*

---

## 9. Criterios observables de "listo"

1. Crear un valor de tipo `money`, referenciarlo como `{valor.mi_precio}` en un texto, y ver que
   se renderiza formateado en pesos mexicanos.
2. Un valor con scope `area` **gana** sobre uno con el mismo `key` y scope `tenant`.
3. `injectIntoPrompt()` devuelve el prompt con el bloque de datos vigentes anexado; si la bóveda
   falla, devuelve el prompt **intacto** (best-effort, nunca rompe al agente).
4. Pegar un documento con precios crea el documento, sus chunks embebidos, y valores en
   `active=false`. **Ninguno se activa solo.**
5. Aprobar un valor lo pone `active=true` y aparece en la siguiente resolución del tenant.
6. `detectGaps()` de un tenant nuevo lista los valores esperados de su giro que faltan.
7. La búsqueda semántica encuentra un documento por significado, no por palabra exacta.
8. Un tenant **no** puede leer documentos ni valores de otro. Test automatizado.

---

## 10. Prompt de arranque

```
ANTES DE ESCRIBIR NADA: verifica que H1 haya mergeado.
  test -f packages/db/ports.ts && echo LISTO || echo "ESPERA — H1 no ha terminado"
Si no existe, NO crees estructura ni instales dependencias. Lee tu handoff, estudia el
código de GARDEN que vas a portar, prepara tu plan, y espera la señal del orquestador.

Vas a construir H4 — la Bóveda de ABRAXA Plataforma: valores canónicos, documentos y biblioteca.

Lee primero, completo:
  docs/handoffs/H4-vault.md          (tu handoff)
  docs/handoffs/README.md            (el contrato de no colisión)
  packages/db/ports.ts               (implementas VaultPort, consumes TenancyPort)

Contexto: la promesa del producto es "tus datos siempre centralizados, conectados y
actualizados". El emprendedor define UNA vez los números de su negocio y se propagan solos a
sus contratos, sus mensajes y los prompts de sus agentes. Sin esto, los agentes inventan
cifras y el producto no sirve.

GARDEN está en "/Volumes/FRAGUA/CLAUDE CODE/GARDEN" — consúltalo, NO lo edites. Aquí está lo
más valioso que vas a portar:
  src/vault/resolver.ts        (219 líneas, 100% genérico, cópialo casi tal cual)
  src/vault/agent-inject.ts    (33 líneas, patrón oro)
  abraxa/extensions/abraxa-bookkeeper/ingest.ts   (el pipeline de ingesta)
  garden-os/components/vault/tools/admin/valores.tsx  (la UI, 427 líneas)

Dos cosas que hay que DES-inperiar al portar:
  1. Los scopes 'socio' y 'propiedad' son de una inmobiliaria. Aquí sólo quedan 'tenant' y 'area'.
  2. Las taxonomías por giro están hardcodeadas con las 8 empresas de Santiago. Van a una tabla
     industry_templates, sembrada con giros genéricos de PyME mexicana.

Trabajas SÓLO en packages/vault/** y apps/web/app/(app)/direccion/**. Migraciones 030–039.
Rama h4-vault. Otras 3 conversaciones trabajan en paralelo.

Conserva la regla de diseño de GARDEN: el documento es la fuente de verdad, los valores son
una proyección, y NADA se activa solo — todo valor extraído nace en borrador y lo aprueba el
emprendedor.

Si algo del handoff está mal o incompleto, dilo y propón el arreglo antes de construir.
```
