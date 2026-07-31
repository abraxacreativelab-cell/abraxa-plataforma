# H15 — CRM: contactos, identidades por canal, embudo y línea de tiempo

> **Ola 2·bis.** Prerrequisito de media Ola 3. Requiere H1 mergeado; no requiere a nadie más.
> Rama: `h15-crm` · Migraciones: `120`–`129`
> Directorios: `packages/crm/**` y `apps/web/app/(app)/contactos/**`
> Worktree: `/Volumes/FRAGUA/CLAUDE CODE/PLATAFORMA-h15-crm`

> **Este documento se escribió DESPUÉS de construir el carril**, no antes. El prompt de arranque
> decía que si el handoff no existía al llegar, había que usar la especificación del prompt y
> crearlo al final. No existía. Lo que sigue es lo que se construyó, con las decisiones que se
> tomaron por el camino y las que quedaron para el orquestador — §9.

---

## 1. Contexto

**Hoy no hay tabla de contactos.** Es el hueco más grande que quedó abierto en la fundación, y
no por descuido: cuando se repartieron los 14 carriles, el CRM se dio por incluido dentro de H6
(bandeja) y de H8 (automatizaciones), y ninguno de los dos lo construye.

La evidencia está escrita en sus propios handoffs:

- **H6** declara `app.threads.contact_id uuid` **sin `REFERENCES`** — `H6-inbox.md:110`. No es un
  olvido: no había a qué apuntar.
- **H8** dice textualmente *"No construyas el CRM. Los pipelines y contactos son de otro carril"*
  — `H8-flows.md:38`. Ese otro carril no existía.

Y sin embargo H8 promete **tres nodos** y **cuatro disparadores** que sólo pueden escribir aquí:

| De H8 | Qué necesita del CRM |
|---|---|
| nodo `assign_owner` | `contacts.owner_email` |
| nodo `move_stage` | `contact_stages` + catálogo de etapas |
| nodo `add_tag` | `contact_tags` |
| disparador `contact_created` | quién lo emite |
| disparador `stage_changed` | quién lo emite |
| disparador `tag_added` | quién lo emite |
| disparador `form_submitted` | a qué contacto pertenece el formulario |

El ejemplo con el que abre el handoff de H8 —*"cuando entre un lead por mi página, mándale un
mensaje, métemelo en la etapa de Contactado, y que el agente de ventas lo contacte"*— no tiene
quién lo dispare ni dónde escribir la etapa. **Este carril es ese quién y ese dónde.**

---

## 2. La decisión de diseño

**Un contacto es una PERSONA. Sus direcciones son FILAS, no columnas.**

GARDEN guarda `email` y `phone` como dos columnas planas en `crm_contacts`
(`src/crm/types.ts:66-67`). Tres consecuencias medidas en ese repo:

1. **Una persona con dos teléfonos son dos contactos.** No hay dónde poner el segundo.
2. **Instagram y Messenger no caben en ninguna columna.** Viven en `external_ids jsonb`, que
   ningún índice único protege. Dos webhooks concurrentes del mismo usuario de IG crean dos
   contactos.
3. **La deduplicación es un `Set` en memoria** sobre TODAS las filas del tenant
   (`contacts/service.ts:243-254`) y sólo corre al importar un CSV. No es una restricción, es una
   esperanza.

Aquí:

```sql
CREATE TABLE app.contact_identities (
  tenant_id  uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES app.contacts(id) ON DELETE CASCADE,
  channel    text NOT NULL,      -- whatsapp | instagram | messenger | email | sms | web
  identifier text NOT NULL,      -- normalizado
  …
  UNIQUE (tenant_id, channel, identifier)
);
```

Dos webhooks simultáneos del mismo número chocan contra **Postgres** (`23505`), no contra la
suerte. Y es una prueba real, no una afirmación: `contacts/service.test.ts` corre las dos
llamadas con `Promise.all` contra un doble que sí reproduce el índice.

### Lo que se dejó fuera a propósito

De las 34 columnas de `crm_contacts` de GARDEN:

- **9 son de Meta Ads** — `fbclid`, `fbc`, `fbp`, `attribution`, `first_landing_event_id`.
- **4 son del proceso de cuarentena de leads falsos de Inperio** — `quarantined_at`,
  `quarantine_reason`, `quarantine_rule`, `quarantined_by`.

No son de un CRM: son de una inmobiliaria que pauta en Facebook. Se quedan en GARDEN.

También se dejó fuera **`crm_opportunities` como entidad aparte**. Es correcto para una
inmobiliaria donde una persona compra tres departamentos que avanzan a distinto ritmo; no lo es
para el negocio de una persona, donde "el lead" y "el trato" son la misma cosa y separarlos
obliga a crear una oportunidad vacía por contacto sólo para poder arrastrarlo en el tablero.
Aquí el contacto tiene una etapa por embudo: `app.contact_stages`, PK
`(tenant_id, contact_id, pipeline_id)`.

---

## 3. Contrato de no colisión

| | |
|---|---|
| **Escribes sólo en** | `packages/crm/**` · `apps/web/app/(app)/contactos/**` |
| **Migraciones** | `120`–`129` |
| **Rama** | `h15-crm` |
| **Worktree** | `/Volumes/FRAGUA/CLAUDE CODE/PLATAFORMA-h15-crm` |

**Implementa:** `ContactsPort` (en `packages/crm/src/port.ts` — ver §9 sobre por qué no está en
`packages/db/ports.ts`).
**Consume:** `FlowPort` (H8) con `tryPort`, best effort · `TenancyPort` (H2) para el contexto de
las rutas HTTP.
**Le consumen:** H6 (resuelve el contacto de cada webhook) · H8 (tres nodos, cuatro
disparadores) · H7 (siembra el embudo al terminar el Ritual) · H10 (`form_submitted`).

### El alta del carril es un acto de H0 — y ya está hecha, en `main`

Este carril nació después del mapa, así que durante la construcción tuvo que darse de alta solo:
la entrada de `h15-crm` se listaba a sí misma en sus `paths` (`.ownership.json` y
`scripts/ownership-gate.test.mjs`) para que el gate aceptara el primer commit. Contra la base de
la rama eso era inocuo —el único otro dueño era `h1-fundacion`, que `--check-overlap` excluye a
propósito—. **El 2026-07-31 dejó de serlo:** el PR #15 le dio a `h0-integracion` los paths
`scripts/**` y `.ownership.json`, y el mapa fusionado quedaba con dos archivos con dos dueños
concurrentes:

```
$ node scripts/ownership-gate.mjs --check-overlap     # con los dos paths en h15-crm
✖ Archivos con dos dueños concurrentes:
  · .ownership.json                  →  h0-integracion, h15-crm
  · scripts/ownership-gate.test.mjs  →  h0-integracion, h15-crm
```

…y con él fallaba el test `H0 no se solapa con ningún carril de construcción`, **que corre en el
PR de los otros quince carriles**. El daño no era de H15: era de todos. La verificación del §10
decía «✔» porque se había corrido contra la base vieja de la rama — verde ≠ correcto.

**El arbitraje lo hizo H0 desde `main`, que es donde tenía que hacerse** (PR #16 / commit
`e404024`): la entrada de `h15-crm` y la cuenta `15 → 16` del test ya están en `main`, escritas
por su dueño. Consecuencia práctica:

> **Este PR ya NO toca `.ownership.json` ni `scripts/ownership-gate.test.mjs`.** Después de
> mergear `main`, los dos archivos son idénticos a los de `main` y el gate del PR sale limpio:
> `✔ Dentro del carril` y `✔ Mapa de propiedad consistente`. Corrido contra el árbol fusionado,
> no contra la base.

**Deuda para H0 (carril `h0-integracion`, no se toca desde aquí):** el patrón funciona pero exige
que el orquestador vaya por delante. Mientras el gate exija que cada carril posea todo lo que su
diff toca, **ningún carril nuevo puede darse de alta solo con el gate en verde**. El arreglo
permanente vive en `scripts/ownership-gate.mjs` y es de H0: que `verificarSolapamiento` y
`verificarPR` traten `.ownership.json` como el registro compartido que es —la misma excepción que
ya se le concede a `h1-fundacion`— en vez de como un archivo de producto.

**Y al mergear:** quitar `"lockfile": true` de `h15-crm` (sólo hacía falta para dar de alta el
workspace `packages/crm`) y dejar la prueba del lockfile en `['h1-fundacion']` en la misma
edición, no en dos pasadas. Las dos líneas son de `h0-integracion`.

---

## 4. Modelo de datos

| Tabla | Migración | Qué guarda |
|---|---|---|
| `app.contacts` | 120 | La persona. `merged_into` apunta al superviviente de una fusión |
| `app.contact_identities` | 120 | Dirección por canal · **`UNIQUE (tenant, channel, identifier)`** |
| `app.contact_tags` | 120 | Etiquetas como texto, no catálogo con FK |
| `app.contact_merges` | 120 | Bitácora de fusiones, con la fila del perdedor completa |
| `app.pipelines` | 121 | Embudos · `UNIQUE (tenant, slug)` · uno solo por defecto |
| `app.pipeline_stages` | 121 | Etapas con `slug` estable · `is_won`/`is_lost` excluyentes |
| `app.contact_stages` | 121 | Dónde va cada contacto · PK `(tenant, contact, pipeline)` |
| `app.contact_events` | 122 | Línea de tiempo · `external_id` con índice único parcial |
| — | 129 | FK `threads.contact_id → contacts.id`, guardada e idempotente |

Las ocho llevan `tenant_id NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE` y
`ENABLE ROW LEVEL SECURITY` **en la misma migración que las crea**. Ninguna es global:
`adminDb()` no aparece en este paquete ni una vez, y `serviceClient()` tampoco.

### El orden de las migraciones importa y por eso 129 existe

`scripts/migrate.mjs` aplica **por nombre de archivo**. `app.contacts` nace en 120, así que la FK
de `app.threads.contact_id` sólo puede escribirse en un archivo con número **mayor** que 120 — y
el bloque de H6 es 040–049. Escribirla allá fallaría en cualquier ambiente nuevo: 040 correría
antes de que existiera la tabla a la que apunta. Es el modo de fallo que sólo aparece el día del
primer despliegue limpio, cuando ya nadie se acuerda.

Por eso `129_crm_link_inbox.sql` vive en este bloque, va dentro de un `DO` guardado (H15 y H6 son
paralelos y no hay garantía de cuál mergea primero), y usa `NOT VALID` para no abortar un
despliegue por `contact_id` históricos que no apuntan a nada. La consulta de limpieza y el
`VALIDATE CONSTRAINT` están escritos en el encabezado del archivo.

**Pendiente para el orquestador:** si al aplicar 129 `app.threads` aún no existía, el runner no
la reaplica sola. Hay que volver a ejecutar el bloque después de mergear H6. El aviso sale en el
log de `npm run migrate` (`RAISE NOTICE 'H15/129: …'`).

---

## 5. `ContactsPort`

18 operaciones. Las que importan:

```ts
/** Identidad de canal → contacto. Lo CREA si no existe. La puerta de H6. */
resolveByIdentity(ctx, { channel, identifier, name?, source? })
  : Promise<{ contactId: string; created: boolean }>

/** Los tres nodos de H8. */
moveStage(ctx, { contactId, stage, pipeline?, amount? })
assignOwner(ctx, { contactId, ownerEmail })
addTag(ctx, { contactId, tag })

/** Fusión. No borra: apunta. */
merge(ctx, { winnerId, loserId })
findDuplicates(ctx, { limit? })   // PROPONE, nunca fusiona

/** Línea de tiempo. `externalId` la hace idempotente. */
recordEvent(ctx, { contactId, type, summary, externalId? })
timeline(ctx, { contactId, limit?, before? })
```

El contrato completo, con el porqué de cada firma, está en
[`packages/crm/src/port.ts`](../../packages/crm/src/port.ts), escrito con las mismas tres reglas
que `packages/db/ports.ts`: sólo tipos, se programa contra él, y no se edita desde otra rama.

---

## 6. Las cuatro garantías

### 1 · `resolveByIdentity` es segura ante concurrencia

El camino obvio —"busca, y si no está créalo"— tiene una carrera: dos webhooks que llegan con
3 ms de diferencia hacen los dos su `SELECT` (nada) y los dos su `INSERT`.

Aquí se busca primero igual, porque el 99 % de los mensajes son de contactos que ya existen y esa
lectura es barata. Pero **el árbitro real es el índice único**: si el `INSERT` choca con `23505`,
se borra el contacto huérfano recién creado y se relee al ganador. Ese `catch` **es** la
corrección, no una red de seguridad.

### 2 · Fusionar NO borra

El perdedor queda con `merged_into` apuntando al ganador. Borrarlo rompería
`app.threads.contact_id` (H6), los enrolamientos de H8 que lo mencionan y cualquier reporte
histórico. Y sobre todo: haría la fusión **irreversible**.

`resolveByIdentity` sigue la cadena `merged_into` hasta el vivo, con tope de saltos y detección de
ciclos — `merged_into` es una FK a la misma tabla y nada en Postgres impide un `A→B→A` si alguien
escribe mal dos veces; sin tope, esa función cuelga el proceso.

El orden de las seis operaciones de `merge()` está elegido para que una interrupción a media
fusión deje un estado **recuperable**: marcar `merged_into` va **al final**, porque es lo que
saca al perdedor de la lista. Marcarlo primero sería el error clásico — la tarjeta desaparece y
si algo falla después, sus datos quedan donde nadie puede verlos.

### 3 · Mover a la etapa en la que ya está no emite `stage_changed`

*"Cuando entre un lead, muévelo a Contactado"* + un flujo que escucha `stage_changed` = bucle. El
anti-loop de 100 pasos del motor de H8 lo corta… después de 100 mensajes al cliente. Se corta
aquí, en el origen. Igual `addTag`: etiquetar dos veces no emite dos veces.

### 4 · Registrar un evento nunca tumba lo que lo generó

`recordEvent` devuelve `{ eventId: null }` y avisa por consola. Un WhatsApp sin contestar porque
no se pudo escribir una línea de bitácora es mucho peor que una bitácora incompleta.

Y al revés: cuando `FlowPort` no responde, el CRM **anota en la línea de tiempo del contacto** que
el disparador no salió. Es la diferencia entre *"mi flujo no corrió y no sé por qué"* y *"el motor
de flujos estaba caído a las 3:14"*.

---

## 7. Normalización de identidades

Vive en un solo archivo con sus propias pruebas —
[`packages/crm/src/identity.ts`](../../packages/crm/src/identity.ts). Un índice único vale lo que
valga la función que produce su llave: si el webhook escribe `5218146811675@s.whatsapp.net` y la
UI escribe `+52 81 4681 1675`, el índice ve dos filas distintas y el emprendedor ve su
conversación partida en dos.

| Entra | Sale |
|---|---|
| `+52 81 4681 1675` | `+528146811675` |
| `5218146811675@s.whatsapp.net` | `+528146811675` |
| `528146811675:12@s.whatsapp.net` | `+528146811675` |
| `00528146811675` | `+528146811675` |
| `Santiago <S@Abraxa.Club>` | `santiago@abraxa.club` |
| `https://instagram.com/abraxa/` | `abraxa` |
| `8146811675` | `8146811675` |

**La trampa mexicana.** México eliminó el `1` de los celulares en agosto de 2019, pero los JID de
WhatsApp de números registrados antes lo siguen trayendo. La misma persona llega como
`+5218146811675` (13 dígitos) por un canal y `+528146811675` (12) por otro. Sin el ajuste son dos
contactos, y es el duplicado más común del mercado en el que opera este producto. Se recorta sólo
en el largo exacto: hay países cuyo código nacional legítimamente empieza con `1` después del
`52`, y recortar a ciegas rompería sus números.

**Lo que a propósito NO se hace:** adivinar el país de un número de 10 dígitos. `8146811675`
puede ser mexicano o estadounidense. Se guarda tal cual y `findDuplicates()` lo propone después
por coincidencia de los últimos 10 dígitos. **Proponer es honesto; adivinar no.**

**Los grupos no son personas.** `esGrupo()` detecta `@g.us`, `@broadcast` y los JID viejos
`<creador>-<epoch>`, y `resolveByIdentity` los rechaza con `VALIDATION`. Crear una ficha por cada
grupo al que agreguen el número del negocio llena la lista de basura en una semana. **H6 tiene que
preguntar esto antes de resolver** — por eso `esGrupo` se exporta.

---

## 8. La pantalla

`/contactos` — lista con filtro en vivo, tablero de embudo y ficha 360 en `/contactos/[id]` con
identidades, posición en el embudo y línea de tiempo.

Es un componente de **servidor** con un solo trozo de cliente (el filtro), igual que el shell de
H5. Y tiene **tres** estados, no dos:

| Estado | Qué significa | Cómo se ve |
|---|---|---|
| `datos` | La API contestó. Vacío es un dato legítimo | Lista, o `EmptyState` |
| `error` | La API contestó mal o no contestó | `LoadError`, con la causa |
| `sin-cablear` | Falta un merge, no está roto | Componente propio, tono neutro |

El tercero existe porque un rojo de "algo falló" cuando lo que pasa es que falta una línea manda
a alguien a depurar un sistema que está bien, y un cero silencioso es peor todavía porque parece
un dato. Es el mismo criterio del aviso *"navegación de prueba"* que H5 pinta en la barra
superior.

---

## 9. Lo que este carril NO pudo hacer — para el orquestador

Cinco archivos del cableado central son de H1 y el gate falla cualquier PR que los toque. El
carril está completo y probado; estas líneas lo encienden. **Ninguna es una corrección: son
altas de un paquete número trece en un cableado escrito para doce.**

### 9.1 `package-lock.json` — el workspace nuevo

`packages/crm` es un workspace nuevo y `npm ci` exige que el lockfile lo conozca. Sin esta
entrada, **CI no instala**. Es la única razón por la que el lockfile aparece en el diff de este
PR; el cambio es aditivo (el nodo `packages/crm` y su enlace en `node_modules`) y no mueve
ninguna versión de ningún paquete de terceros.

> Si el orquestador prefiere que ninguna rama que no sea H1 toque el lockfile —que es la regla
> escrita—, la alternativa es que H1 haga ese commit y este PR se rebase encima. El diff está
> aislado en un solo commit para que se pueda mover.

### 9.2 `apps/api/src/packages.ts` — montar el router

```ts
import { meta as crmMeta } from '@abraxa/crm/meta';
import { router as crmRouter } from '@abraxa/crm';
// …en PACKAGE_META:  crmMeta,
// …en MOUNTS:        ['/crm', crmRouter],
```

Importar el router también dispara su `registerContactsPort()`, que es lo que hace que
`useContacts()` funcione en el proceso de la API.

### 9.3 `apps/web/next.config.mjs` y `apps/web/package.json` — la pantalla

```js
transpilePackages: [ …, '@abraxa/crm' ],
```
```json
"dependencies": { …, "@abraxa/crm": "*" }
```

Mientras tanto, `apps/web/app/(app)/contactos/tipos.ts` es un **espejo declarado** de
`port.ts` y la pantalla habla con la API por HTTP. En cuanto entren esas dos líneas, ese archivo
se borra y las importaciones apuntan al port.

### 9.4 `packages/db/ports.ts` + `port-registry.ts` — el port en el registro tipado

```ts
// ports.ts — al final, junto a los demás
export type { ContactsPort, Contact, ContactIdentity, … } from '@abraxa/crm/port';
export interface PortRegistry { …, contacts: ContactsPort }

// port-registry.ts — una línea en OWNER
contacts: 'H15 · packages/crm',
```

**Por qué no se pudo desde aquí:** `PortName` es `keyof PortRegistry` y `port-registry.ts:8`
declara `const OWNER: Record<PortName, string>` con las ocho llaves escritas a mano. Ampliar
`PortRegistry` por aumentación de interfaz —que TypeScript sí permite— haría que ESE objeto
dejara de ser exhaustivo y `npm run typecheck` fallaría **en un archivo de otro carril**. Un
carril nuevo no puede romper la compilación de H1 para entrar.

La solución intermedia registra en el **mismo** registro central con la llave como string, y el
cast está aislado en `port-registration.ts`, tres veces, con nombre. Con este parche, ese archivo
se colapsa a tres reexports y **ningún llamador cambia una línea**.

Consecuencia conocida mientras tanto: `listPorts()` —y por tanto `GET /_health/packages`— itera
`OWNER` y no muestra `contacts`. Hay una prueba que lo afirma explícitamente
(`port-registration.test.ts`) para que nadie lo descubra como sorpresa.

### 9.5 Sidebar — la herramienta apunta a una ruta que no existe

`packages/ui/src/components/nav/mock-areas.ts:96` registra el respaldo
`ventas:contactos → /ventas/contactos`, y `ventas:pipeline → /ventas/pipeline`. Las rutas reales
son `/contactos` y `/contactos` (el embudo va en la misma pantalla). Ese archivo es de H5, y
cuando H11 sirva las herramientas de verdad desde `AreasPort` el respaldo deja de usarse — así
que probablemente no valga la pena tocarlo. **Anotado por si el orquestador quiere el enlace vivo
antes de H11.**

### 9.6 ~~Deuda declarada: `proxy-verified.ts` duplicado~~ — SALDADA (2026-07-31)

La copia existía por la misma razón que la de H3: encadenar el cierre de un agujero de
autenticación al merge de otro carril es exactamente cómo un agujero llega a producción "porque
estábamos esperando". Y en un CRM esa puerta es **leer la cartera de clientes de otra empresa**.

Con el PR #16 de H0 el destino cambió y la deuda se pagó aquí mismo:

- La pieza canónica **no** quedó en `@abraxa/tenancy` sino en **`@abraxa/db`** —el único paquete
  del que dependen los quince carriles—, así que adoptarla no toca ningún `package.json` ni el
  lockfile.
- `packages/crm/src/http/proxy-verified.ts` es hoy `export { proxyVerified } from '@abraxa/db';`
  y su prueba es de **contrato**: la primera aserción es `expect(proxyVerified).toBe(canonico)`,
  que se pone roja en cuanto alguien vuelva a pegar el cuerpo.
- `packages/crm/src/routes.ts` ya **no tiene** su propio `contextoDe`. Usa
  `contextoDePeticion(req)` y `responderError(res, err)` de `@abraxa/db`.

Era la **quinta** copia del mismo resolvedor. **La de aquí no tenía agujero** —comprobaba
`proxyVerified()` antes de mirar un header, que es justo lo que a H4, H6 y H7 se les escapó— y
eso se dice tal cual para no inflar el hallazgo. Lo que sí había era **deriva**: la copia
entregaba el correo sin normalizar a `TenancyPort.contextFor()` (`'Ana@Panaderia.MX'`) mientras
la pieza canónica lo recorta y lo pasa a minúsculas antes. Hoy da igual porque `contextFor`
vuelve a normalizar; con otra implementación del port, o con el doble de otro carril, no. Fijado
en `routes.test.ts` («el correo llega normalizado»).

La evidencia dura del cierre no es una prueba de vitest: es **`npm run lint`**. Con el `main` del
PR #16, `eslint.config.mjs` marca como error leer `x-user-email`, `x-tenant-slug` o
`x-proxy-secret` fuera de la pieza canónica. Las versiones anteriores de estos dos archivos daban
**6 errores** (`routes.ts` 44:22, 49:32, 50:33, 54:31, 54:53 · `http/proxy-verified.ts` 52:39):
el merge de `main` dejaba el carril en rojo. No hay forma de escribir una sexta copia sin que CI
lo diga.

---

## 10. Criterios observables de "listo"

Con evidencia, no con "lo probé":

| # | Criterio | Cómo se verifica |
|---|---|---|
| 1 | Dos webhooks concurrentes del mismo número dan **un** contacto | `contacts/service.test.ts` · dos `resolveByIdentity` en `Promise.all` contra un doble que reproduce el índice único |
| 2 | El mismo número por WhatsApp, con y sin el `1` mexicano, es la misma identidad | `identity.test.ts` |
| 3 | Un tenant **no** ve contactos, identidades ni línea de tiempo de otro | `contacts/service.test.ts`, `timeline/service.test.ts` |
| 4 | Fusionar **no borra**: el hilo viejo sigue resolviendo al ganador | `contacts/merge.test.ts` |
| 5 | Fusionar **no retrocede** al ganador en el embudo | `contacts/merge.test.ts` |
| 6 | Mover a la etapa actual **no** emite `stage_changed` | `pipeline/service.test.ts` |
| 7 | Etiquetar dos veces **no** emite dos veces | `contacts/service.test.ts` |
| 8 | Un `external_id` repetido **no** duplica la línea de tiempo | `timeline/service.test.ts` |
| 9 | Si la base falla al registrar un evento, **no** se lanza | `timeline/service.test.ts` |
| 10 | El CRM funciona sin `FlowPort` registrado | `pipeline/service.test.ts` |
| 11 | H6 y H8 pueden meter un doble y construir sin esperar a H15 | `port-registration.test.ts` |
| 12 | En producción sin `PROXY_SECRET`, la vía de headers queda **cerrada** | `http/proxy-verified.test.ts` |
| 13 | `findDuplicates` **nunca** fusiona nada solo | `contacts/merge.test.ts` |
| 14 | El mapa de propiedad sigue consistente **contra el árbol fusionado** | `node scripts/ownership-gate.mjs --check-overlap` — ver la nota de abajo |
| 15 | Una identidad marcada principal que choca **no** se descarta ni miente | `contacts/service.test.ts` · «dos teléfonos marcados AMBOS como principal» |
| 16 | Una operación sobre un `contactId` inexistente o ajeno es **404**, no `{ok:true}` | `contacts/service.test.ts`, `pipeline/service.test.ts` |
| 17 | Fusionar **no evapora** el monto de la posición descartada | `contacts/merge.test.ts` |
| 18 | Un grupo de WhatsApp no entra por **ninguna** de las tres puertas | `contacts/service.test.ts`, `identity.test.ts` |
| 19 | Un trato en dólares se guarda y se pinta en dólares; el tablero **no** suma monedas | `pipeline/service.test.ts` |
| 20 | Un filtro por etiqueta muy grande se acota y **avisa** que la lista es parcial | `contacts/service.test.ts` |
| 21 | Un `curl` con `x-user-email` inventado **no** llega a la capa de membresías | `routes.test.ts` · la aserción es `llamadas.length === 0`, no el código HTTP |
| 22 | El CRM **no** tiene su propio `contextoDe` ni su propia copia del guardia | `routes.test.ts`, `http/proxy-verified.test.ts` · `expect(proxyVerified).toBe(canonico)` |

> **El criterio 14 estuvo mal verificado y por eso se anota aquí.** La primera vez se corrió
> contra la BASE de la rama, donde el único otro dueño de `.ownership.json` era `h1-fundacion`.
> Contra el `main` del 2026-07-31 —que por el PR #15 le dio `scripts/**` y `.ownership.json` a
> `h0-integracion`— salía en rojo, y con él el gate de los otros catorce carriles. Ver §3.
> **Un `--check-overlap` sólo vale corrido DESPUÉS del merge.**

Lo que **no** se pudo verificar sin base viva y queda para el orquestador al aplicar migraciones:

- Que `129` cree de verdad la FK cuando `app.threads` existe (hoy H6 no ha mergeado, así que el
  bloque sale por el `RAISE NOTICE`).
- Que RLS esté activo en las ocho tablas — se afirma en el SQL y lo verifica el gate
  (`revisarMigracion`), pero la comprobación real es
  `select relname, relrowsecurity from pg_class where relnamespace = 'app'::regnamespace`.
- Que `123` deje las FK compuestas `(tenant_id, contact_id)` en las cinco tablas hijas. El doble
  en memoria no reproduce claves foráneas, así que la defensa que sí se prueba es la del servicio
  (`exigirContacto`). La comprobación real es
  `select conname, confrelid::regclass from pg_constraint where conrelid = 'app.contact_identities'::regclass`.

---

## 11. Prompt de arranque

```
Trabaja SIEMPRE desde /Volumes/FRAGUA/CLAUDE CODE/PLATAFORMA-h15-crm (worktree, rama h15-crm
ya activa). No hagas checkout ni switch: hay 14 conversaciones más sobre el mismo repo.

Vas a construir H15 — el CRM de ABRAXA Plataforma: contactos, identidades por canal, embudo y
línea de tiempo.

Lee primero, completo:
  docs/handoffs/H15-crm.md    (tu handoff)
  docs/handoffs/README.md     (el contrato de no colisión)
  packages/db/ports.ts        (el estilo del contrato que vas a escribir)
  migrations/001_foundation.sql   (el patrón de RLS: ninguna tabla sin él)

POR QUÉ EXISTES: hoy no hay tabla de contactos. H6 declara contact_id SIN REFERENCES porque no
hay a qué apuntar (H6-inbox.md:110). Tres nodos y cuatro disparadores de H8 no tienen dónde
escribir. Eres prerrequisito de media Ola 3.

La decisión que lo separa de GARDEN: un contacto es una PERSONA y sus direcciones son FILAS.
GARDEN tiene `email` y `phone` como columnas planas (src/crm/types.ts:66) y por eso una persona
con dos teléfonos son dos contactos, Instagram no cabe en ninguna columna, y la deduplicación es
un Set en memoria que sólo corre al importar CSV. Aquí: app.contact_identities con
UNIQUE (tenant_id, channel, identifier). GARDEN está en "/Volumes/FRAGUA/CLAUDE CODE/GARDEN" —
consúltalo, NO lo edites.

Cuatro cosas que no se negocian:
  1. resolveByIdentity segura ante concurrencia: el árbitro es el índice único y el catch de
     23505, no un SELECT previo que pierde la carrera.
  2. Fusionar NO borra: merged_into apunta al superviviente y resolveByIdentity sigue la cadena.
     Borrar rompería threads.contact_id de H6.
  3. Mover a la etapa en la que ya está NO emite stage_changed. Sin eso, "cuando entre un lead
     muévelo a Contactado" se dispara a sí mismo 100 veces.
  4. Registrar un evento NUNCA tumba la operación que lo generó.

Toda escritura por tenantDb(ctx). Nunca serviceClient ni adminDb: las ocho tablas tienen
tenant_id y ninguna es global. RLS en la MISMA migración que crea cada tabla.

Ojo con el orden: scripts/migrate.mjs aplica por NOMBRE de archivo, así que una tabla
referenciada por FK debe tener número MENOR que quien la referencia. Por eso la FK de
threads.contact_id vive en 129 y no en el bloque de H6.

Trabajas SÓLO en packages/crm/** y apps/web/app/(app)/contactos/**. Migraciones 120–129. Agrega
tu entrada a .ownership.json en tu primer commit o el gate te frena.

Antes del PR: node scripts/ownership-gate.mjs && npm run typecheck && npm run lint && npm test
Nunca mergees a main. Termina con push a h15-crm y gh pr create.
```
