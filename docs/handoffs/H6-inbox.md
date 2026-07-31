# H6 — Bandeja, WhatsApp y la conexión agente↔inbox

> **Ola 2.** Corre en paralelo con H7, H9 y H10 — **H8 se bajó a la Ola 3**, ver `H8-flows.md` §0.
> Requiere H1 y H3 mergeados: **ya lo están, y también H2, H4 y H5.** Lee la §0 antes que nada.
> **ERES LA RUTA CRÍTICA.** Si algo se atrasa, que no sea esto.
> Rama: `h6-inbox` · Migraciones: `040`–`049`
> Directorios: `packages/inbox/**` (excepto `drivers/{meta,email,sms}`) y `apps/web/app/(app)/bandeja/**`

---

## 0. ESTADO REAL AL 2026-07-31 — léelo antes que nada

Este handoff se escribió cuando el repo no tenía una sola línea de producto. Lo de abajo está
**verificado contra `origin/main` y contra la base real**, no recordado. Donde el resto del
documento y esta sección se contradigan, **manda esta sección**.

### Lo que SÍ está en main

**`origin/main` = `f6affc1e80049396087a1ff507aeeb96770ce326`.**

| Carril | Lo que te dejó — archivos que puedes abrir hoy |
|---|---|
| **H1 · fundación** | `packages/db/ports.ts` (los 8 ports), `packages/db/src/port-registry.ts` (`registerPort` / `usePort` / `tryPort`), `apps/api`, `apps/worker`, el CI y el gate |
| **H3 · agentes** | `packages/agents/src/service.ts`, `loop/agent-loop.ts`, `ledger/usage-ledger.ts`, `pricing/compute.ts`, `providers/{anthropic,openrouter,local}.ts`. `AgentPort` **registrado** |
| **H5 · design system** | `packages/ui/src/components/primitives/*`, `shell/app-shell.tsx`, `lib/accent.ts` |
| **H2 · tenancy** (PR #6) | `packages/tenancy/src/services/{provision,memberships,plans,invitations}.ts`, `middleware/{tenant,rbac,proxy}.ts`. `TenancyPort` **registrado** |
| **H4 · bóveda** (PR #7) | `packages/vault/src/{values/service,documents/search,ingest/pipeline,resolver}.ts`. `VaultPort` **registrado** |
| **H0 · seguridad** (PR #12) | `packages/agents/src/routes.ts` ya no arma el `TenantContext` con el header `x-user-email` crudo |

**La base real ya está migrada** (proyecto Supabase `ievnkmodselrlkazkzoy`):

- **13 migraciones aplicadas** — `001, 010, 011, 012, 020, 021, 022, 023, 024, 030, 031, 032, 033`.
  `app.schema_migrations` trae las 13 filas con el checksum que espera el runner: `npm run migrate`
  responde **0 pendientes** y no truena.
- **19 tablas y `tablas_sin_rls = 0`.** Tu `040` se suma a esa cuenta: el gate rechaza toda tabla
  nueva sin `tenant_id` y sin `ENABLE ROW LEVEL SECURITY` **en el mismo archivo**.
- Catálogos sembrados: `app.plans` (2), `app.model_pricing` (10), `app.industry_templates` (5).
- **`app.tenants` está VACÍA.** No hay datos de prueba de nadie. Si necesitas un tenant real,
  créalo tú: `SELECT app.provision_tenant(...)` (migración `011`).
- `pgvector` instalado. **El schema `pgboss` NO existe**: el worker nunca ha corrido contra esta base.

### Lo que NO existe todavía, aunque el documento lo dé por hecho

- `packages/inbox/src/` tiene **exactamente dos archivos**: `index.ts` y `meta.ts`, los stubs de H1.
  Igual `onboarding`, `flows`, `work`, `billing` y `areas`. **Por eso el freno de arranque de este
  handoff mentía**: probaba `test -d packages/agents/src`, y ese directorio existe siempre. El
  freno corregido está en §12.
- **No hay CRM.** No existe `app.contacts` ni ninguna tabla de contactos: `grep -rn contacts
  migrations/` no devuelve nada. Tu `app.threads.contact_id` (§6) se queda **`uuid` sin
  `REFERENCES`**, tal como está escrito. No inventes la tabla: se abrió un carril nuevo, **H15 ·
  CRM** (`packages/crm`, migraciones `120`–`129`), y su `129_crm_link_inbox.sql` existe justamente
  para colgar esa FK después. No es tuya.
- **No hay `.env` en el repo** (sólo `.env.example`) y el repositorio de GitHub **no tiene
  secretos**. `EVOLUTION_API_URL` y `EVOLUTION_API_KEY` no están puestos en ningún lado. CI no
  puede hablar con Evolution, ni con Anthropic, ni con la base. Todo test que corra en CI tiene
  que pasar con dobles. Ver §11.
- **`GET /agents` contra la base real ya no da 42P01.** Ese error era de antes de aplicar las
  migraciones; si alguien te lo dice, está citando un informe viejo.
- No hay protección de rama (repo privado sin GitHub Pro): **el gate de CI es la única ley**, y
  nadie te va a impedir mergear en rojo. No lo hagas.

### Carriles en vuelo mientras lees esto

Al 2026-07-31 hay PRs abiertos y en verde de `h6-inbox` (#10), `h7-ritual` (#8), `h9-work` (#13),
`h10-billing` (#11) y `h15-crm` (#9). **H8 se bajó a la Ola 3** (ver `H8-flows.md` §0): su
`send_message` te va a consumir por `InboxPort`, pero ya no en paralelo contigo.

---

## 1. Contexto

La promesa que vende el producto es una sola frase: **"tu agente contesta a tus clientes
mientras duermes."** Tú la conviertes en realidad.

Un mensaje entra por WhatsApp. Si el hilo tiene la IA activa y no lo está atendiendo un humano,
el agente del área responde con los datos reales del negocio, y el consumo queda registrado.
Si el emprendedor toma el hilo, la IA se calla.

**Sin ti, el producto es una demo bonita.**

---

## 2. El hueco que cierras — es literal

En GARDEN, `crm_threads.ai_enabled` **está declarado en el tipo y no se usa en ningún lado**.
Verificado: la única aparición en todo el repo es `src/crm/types.ts:281`.

Los bots viven en un mundo (`garden.conversations`, `garden.bots`) y la bandeja del CRM en otro
(`crm_threads`, `crm_messages`). **Están desconectados.** Nunca se cableó el puente.

Ese puente es tu entregable principal. Todo lo demás de este handoff es infraestructura para
que ese puente exista.

---

## 3. Alcance

### Sí

1. Modelo de canales, hilos y mensajes — **genérico multicanal desde el diseño**.
2. **Driver de WhatsApp** (Evolution API) — envío, recepción, acuses.
3. **La conexión agente↔inbox.** El puente.
4. Handoff a humano, pausa de IA, horario de atención.
5. La UI de la bandeja con compositor.
6. **`ChannelDriver` como interfaz**, para que H12 y H13 enchufen sus canales sin tocarte.

### No

- **No** implementes Instagram, Messenger, email ni SMS. Son H12 y H13. Tú dejas la interfaz.
- **No** construyas el motor de workflows. Es H8 — él te llama por `InboxPort`.
- **No** toques `packages/inbox/drivers/meta/`, `/email/` ni `/sms/`. **No son tuyos.**

---

## 4. Contrato de no colisión

| | |
|---|---|
| **Escribes sólo en** | `packages/inbox/**` **excepto** `drivers/meta`, `drivers/email`, `drivers/sms` · `apps/web/app/(app)/bandeja/**` |
| **Migraciones** | `040`–`049` |
| **Rama** | `h6-inbox` |
| **Worktree** | `/Volumes/FRAGUA/CLAUDE CODE/PLATAFORMA-h6-inbox` |

**Implementas:** `InboxPort` y `ChannelDriver` (sólo el de WhatsApp).
**Consumes:** `AgentPort` (H3) para que el agente responda · `TenancyPort` (H2) · `VaultPort` (H4).
**Te consumen:** H8 (flows) manda mensajes por ti. H12 y H13 implementan `ChannelDriver`.

---

## 5. Qué portar de GARDEN

GARDEN está en `/Volumes/FRAGUA/CLAUDE CODE/GARDEN`. **Consulta, no edites.**

| Archivo | Veredicto |
|---|---|
| `src/crm/types.ts:258-305` | **El modelo de channels/threads/messages ya es genérico multicanal.** Cópialo |
| `src/crm/inbox/service.ts:82-215` | Bandeja nativa con **anti-duplicado sofisticado**: registra `queued` antes de enviar y maneja el eco `fromMe` del webhook con un 23505 idempotente. Cópialo con cuidado |
| `src/crm/channels/evolution.ts` | El driver de WhatsApp completo: instancia, QR, estado, envío, webhook |
| `src/crm/channels/service.ts:37-56` | `createWhatsAppChannel()` — genera instancia y token de webhook. Ya está automatizado |
| `src/crm/channels/webhook.ts` | Recepción y acuses |

**Dos cambios transversales obligatorios al portar:**

1. **`external_contact` genérico.** GARDEN asume JID de WhatsApp en todos los caminos
   (`phoneToJid()` en `inbox/service.ts:201` y `engine.ts:472`). Pasa a `{ channelType, address }`.
2. **`sendViaChannel` no debe lanzar si el driver no es Evolution** (`channels/service.ts:181`).
   Debe despachar por el registro de drivers.

---

## 6. Modelo de datos

```sql
-- 040_inbox.sql
CREATE TABLE app.channels (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  type        text NOT NULL,   -- whatsapp | instagram | messenger | email | sms
  driver      text NOT NULL,
  name        text NOT NULL,
  config      jsonb NOT NULL DEFAULT '{}',
  external_id text,
  status      text NOT NULL DEFAULT 'pending',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.threads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  contact_id      uuid,                  -- ← SIN REFERENCES a propósito: no hay CRM. Es de H15
  channel_id      uuid NOT NULL REFERENCES app.channels(id),
  channel_type    text NOT NULL,
  external_address text NOT NULL,        -- ← genérico, no JID
  status          text NOT NULL DEFAULT 'open',
  assigned_to     text,                  -- correo del humano que lo tomó
  ai_enabled      boolean NOT NULL DEFAULT true,   -- ← ESTE campo es tu trabajo
  ai_paused_until timestamptz,
  unread          int NOT NULL DEFAULT 0,
  last_message_at timestamptz,
  UNIQUE (tenant_id, channel_id, external_address)
);

CREATE TABLE app.messages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  thread_id    uuid NOT NULL REFERENCES app.threads(id) ON DELETE CASCADE,
  direction    text NOT NULL CHECK (direction IN ('in','out')),
  body         text,
  media        jsonb NOT NULL DEFAULT '[]',
  ai_generated boolean NOT NULL DEFAULT false,
  author       text,
  external_id  text,
  status       text NOT NULL DEFAULT 'queued',
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ON app.messages (tenant_id, external_id) WHERE external_id IS NOT NULL;
```

**Toda tabla con `ENABLE ROW LEVEL SECURITY` en la misma migración.** No es un consejo: el gate
lee tu SQL y falla el PR con el `ALTER TABLE` exacto que te falta
(`scripts/ownership-gate.mjs`, `revisarMigracion`). Y si de verdad necesitas una tabla global sin
`tenant_id`, la escotilla es un comentario en las 3 líneas anteriores al `CREATE TABLE`:
`-- tenantless: <razón>`. Ninguna de tus tres tablas lo necesita.

Ese índice único parcial sobre `external_id` es lo que hace idempotente la recepción del
webhook. Sin él, un reintento de Evolution duplica mensajes.

**`contact_id` se queda sin FK.** Cuando se escribió este handoff se daba por hecho que el CRM
salía de tu carril o del de H8; ninguno de los dos lo construye —H8 dice literal *"no construyas
el CRM"*—. Por eso existe ahora **H15 · CRM** (`packages/crm`, migraciones `120`–`129`), y su
`129_crm_link_inbox.sql` es el que colgará la FK. Tú declara la columna y sigue: **no crees
`app.contacts`**, el gate te lo tumba y con razón.

---

## 7. El puente — tu entregable principal

```
mensaje entra por webhook
   ↓
driver.parseWebhook() → normaliza a InboundMessage
   ↓
resuelve o crea el contacto y el hilo
   ↓
guarda el mensaje entrante
   ↓
┌─ ¿debe contestar la IA? ────────────────────────┐
│  thread.ai_enabled                              │
│  Y thread.assigned_to IS NULL                   │
│  Y (ai_paused_until IS NULL O ya pasó)          │
│  Y estamos dentro del horario de atención       │
└─────────────────────────────────────────────────┘
   ↓ sí
AgentPort.run({ role: agenteDelÁrea, input, threadId })
   ↓
guarda la respuesta con ai_generated=true
   ↓
driver.send() → sale al canal
   ↓
usage_ledger ya lo registró H3
```

**Reglas que no se negocian:**

- **Un humano escribe en el hilo → `assigned_to` se llena y la IA se calla.** Sin excepción.
  Nada peor que el agente contestando encima de su dueño.
- **La IA nunca contesta dos veces al mismo mensaje.** Guard de idempotencia por `external_id`.
- **Si el agente falla, el mensaje queda sin responder y se marca**, no se manda un texto
  genérico de disculpa. Un silencio es mejor que un robot roto.
- **Horario de atención configurable por canal.** Fuera de horario, la IA puede contestar o no
  según el ajuste del emprendedor.

---

## 8. `ChannelDriver` — la interfaz que hace posibles H12 y H13

Está declarada en `packages/db/ports.ts` por H1. Tú **implementas sólo WhatsApp** y montas el
registro por el que H12 y H13 enchufan los suyos:

```ts
// packages/inbox/src/drivers/registry.ts  ← tuyo
export function registerDriver(d: ChannelDriver): void;
export function driverFor(type: ChannelType): ChannelDriver;
```

Cada driver vive en su carpeta y se auto-registra. H12 crea `drivers/meta/`, H13 crea
`drivers/email/` y `drivers/sms/`. **Tú no los tocas** — solo dejas el enchufe y verificas que
tu registro no asuma nada de WhatsApp.

Prueba concreta de que la interfaz está bien: escribe un driver falso en tus tests que no sea
WhatsApp y confirma que todo el flujo funciona con él.

---

## 9. La UI de la bandeja

Lista de hilos con último mensaje, no leídos y canal. Panel de conversación con burbujas.
Compositor con **envío optimista** (el mensaje aparece en `queued` y se confirma después).

Un control visible y obvio: **"IA activa / IA en pausa"** por hilo. El emprendedor tiene que
poder callar a su agente en un clic cuando quiera meterse él.

Referencia: `garden-os/components/vault/tools/sales/inbox.tsx` (320 líneas).

---

## 10. Criterios observables de "listo"

Estos son los que definen la fecha real de la v1:

1. **Manda un WhatsApp real** a un número conectado y **el agente contesta**. De punta a punta,
   con datos reales del negocio en la respuesta.
2. La respuesta queda en `usage_ledger` con costo real.
3. **Un humano escribe en el hilo y la IA se calla.** Verificado.
4. Un webhook reenviado dos veces **no duplica** el mensaje ni dispara dos respuestas.
5. Si el agente falla, el mensaje queda marcado sin responder — **no** sale un texto de disculpa.
6. Un driver falso no-WhatsApp funciona en toda la cadena sin tocar tu código.
7. Un tenant **no** ve hilos ni mensajes de otro. Test automatizado.
8. Fuera del horario configurado, la IA respeta el ajuste.

---

## 11. LO QUE NO PUEDES CERRAR DORMIDO

Santiago está dormido y no hay credenciales de Evolution, ni de Anthropic, ni un `.env`. Tres de
los ocho criterios de §10 **no se pueden cerrar hoy**. No los tomes como cerrados ni los tapes
con un mock que se llame "prueba de integración": márcalos, y entrega en su lugar el sustituto
verificable de la derecha.

| Criterio de §10 | Por qué no se puede | Sustituto que SÍ entregas |
|---|---|---|
| **#1 · WhatsApp real punta a punta** | Exige `EVOLUTION_API_URL` + `EVOLUTION_API_KEY`, una instancia levantada y un teléfono escaneando un QR. Nada de eso existe | **Doble de Evolution en proceso**: un `http.createServer` local que habla el mismo protocolo, con los **payloads de webhook reales copiados de GARDEN** como fixtures. Cubre envío, acuse, eco `fromMe` y reintento. Más un `packages/inbox/README.md` con el runbook exacto de 10 minutos para correr el criterio #1 cuando haya credenciales |
| **#2 · costo real en `usage_ledger`** | Exige `ANTHROPIC_API_KEY` u `OPENROUTER_API_KEY` | H3 ya te dejó `packages/agents/src/providers/local.ts` y `src/testing/fakes.ts`. Corre el puente con el proveedor local y **verifica que la fila aterrice en `usage_ledger`** con el modelo, los tokens y el costo calculado por `pricing/compute.ts`. Lo que queda sin probar es el precio de un proveedor real, no tu cableado |
| **#8 · horario de atención** | La zona horaria y el horario por defecto son una decisión de producto de Santiago | **Decisión conservadora tomada**: por defecto `America/Mexico_City`, ventana `09:00–19:00`, y **fuera de horario la IA SÍ contesta** (es la promesa que vende el producto: *"contesta mientras duermes"*). Guárdalo como config por canal, con default en código y un solo lugar donde cambiarlo. Anótalo en el PR para que él lo confirme o lo mueva |

**Los otros cinco criterios (#3 humano toma el hilo, #4 idempotencia, #5 silencio ante fallo,
#6 driver falso, #7 aislamiento) se cierran hoy, completos y automatizados.** Son la mayoría, y
son los que de verdad se rompen en producción. Ciérralos.

**Regla que no se negocia mientras él duerme:** un test que necesita red **no** entra a CI. CI no
tiene ni un secreto, y el job `verify` corre `npm run build` justamente para probar que el repo
compila sin ninguno. Si tu módulo valida `process.env.EVOLUTION_API_KEY` al importarse, rompes
el build **de los 15 carriles**. Valida en la llamada, nunca en el import.

---

## 12. Prompt de arranque

```
ANTES DE ESCRIBIR NADA — freno duro. Pégalo tal cual; si imprime ESPERA, no escribas una línea.

(
  set -u
  W="/Volumes/FRAGUA/CLAUDE CODE/PLATAFORMA-h6-inbox"
  cd "$W" || { echo "ESPERA · no existe el worktree $W"; exit 1; }
  ok=1; mal() { echo "  ✖ $1"; ok=0; }
  echo "freno de arranque · H6 · $(git rev-parse --abbrev-ref HEAD)"
  for f in \
    packages/db/ports.ts \
    packages/agents/src/service.ts \
    packages/agents/src/loop/agent-loop.ts \
    packages/tenancy/src/services/plans.ts \
    packages/tenancy/src/middleware/rbac.ts \
    packages/vault/src/values/service.ts \
    packages/ui/src/components/primitives/button.tsx \
    migrations/010_tenancy.sql \
    migrations/020_agent_definitions.sql \
    migrations/030_vault_documents.sql
  do [ -f "$f" ] || mal "falta $f"; done
  echo "  … actualizando origin/main (es red: en un disco externo puede tardar un minuto)"
  GIT_TERMINAL_PROMPT=0 git fetch --no-tags -q origin main \
    || mal "no pude 'git fetch origin main' — sin eso, el cotejo de abajo usa una referencia vieja"
  [ "$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 99)" = 0 ] \
    || mal "tu árbol NO trae origin/main ($(git rev-parse --short origin/main)) → git merge --no-edit origin/main"
  [ -d node_modules ] || mal "no hay node_modules → npm ci"
  case "$(node -v)" in v22.*) ;; *) mal "Node $(node -v); el repo exige Node 22 → nvm use 22";; esac
  [ "$ok" = 1 ] \
    && echo "LISTO · H1·H2·H3·H4·H5 en el árbol, en $(git rev-parse --short HEAD), con node_modules. Construye." \
    || echo "ESPERA · no escribas una línea hasta que lo de arriba esté resuelto."
)

Prueba ARCHIVOS DE IMPLEMENTACIÓN, no directorios: los 12 paquetes traen stubs de H1, así que
packages/inbox/src existe desde el día uno y `test -d` siempre dijo LISTO aunque no hubiera nada.
Y verifica dos cosas más que el freno viejo no miraba: que tu worktree traiga origin/main (los
worktrees se quedaron clavados dos commits atrás) y que exista node_modules (ninguno lo tenía).

Trabaja SIEMPRE desde /Volumes/FRAGUA/CLAUDE CODE/PLATAFORMA-h6-inbox (tu worktree, rama
h6-inbox ya activa). No hagas checkout ni switch.

Vas a construir H6 — la bandeja, el driver de WhatsApp y la conexión agente↔inbox de
ABRAXA Plataforma. ERES LA RUTA CRÍTICA: sin ti el producto es una demo bonita.

Lee primero, completo:
  docs/handoffs/H6-inbox.md          (tu handoff — la §0 ESTADO REAL manda sobre el resto)
  docs/handoffs/README.md            (el contrato de no colisión)
  packages/db/ports.ts               (implementas InboxPort y ChannelDriver)

Contexto: la promesa que vende el producto es "tu agente contesta a tus clientes mientras
duermes". Tú la conviertes en realidad.

El hueco que cierras es literal: en GARDEN el campo crm_threads.ai_enabled está declarado en
el tipo y NO SE USA EN NINGÚN LADO — la única aparición en todo el repo es src/crm/types.ts:281.
Los bots viven en un mundo y la bandeja en otro, desconectados. Nunca se cableó el puente.
Ese puente es tu entregable principal.

GARDEN está en "/Volumes/FRAGUA/CLAUDE CODE/GARDEN" — consúltalo, NO lo edites. Llévate el
modelo de channels/threads/messages (ya es genérico multicanal), el driver de Evolution y el
anti-duplicado de src/crm/inbox/service.ts:82-215, que está muy bien resuelto.

Dos cambios obligatorios al portar: external_contact deja de asumir JID de WhatsApp y pasa a
{channelType, address}; y sendViaChannel despacha por registro de drivers en vez de lanzar si
no es Evolution.

Trabajas SÓLO en packages/inbox/** (EXCEPTO drivers/meta, drivers/email y drivers/sms, que son
de H12 y H13) y apps/web/app/(app)/bandeja/**. Migraciones 040–049.
Otras conversaciones trabajan en paralelo (H7, H9, H10 y el carril nuevo H15 · CRM).

NO hay contactos: app.contacts no existe y no la creas tú. threads.contact_id se queda uuid SIN
REFERENCES; H15 cuelga la FK después en su 129_crm_link_inbox.sql.

El criterio #1 sigue siendo el que define la fecha real de la v1 — mandar un WhatsApp real y que
el agente conteste, de punta a punta — pero HOY NO SE PUEDE CERRAR: no hay EVOLUTION_API_URL ni
EVOLUTION_API_KEY en ningún lado y Santiago está dormido. Lee la §11: entregas el doble de
Evolution con los payloads reales de GARDEN y el runbook de 10 minutos, y lo dejas marcado como
pendiente en el PR. No lo declares cerrado.
El #3 sí se cierra hoy y no se negocia: si un humano escribe en el hilo, la IA se calla — nada
peor que el agente contestando encima de su dueño.

Si algo del handoff está mal o incompleto, dilo y propón el arreglo antes de construir.
```
