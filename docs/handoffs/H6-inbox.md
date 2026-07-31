# H6 — Bandeja, WhatsApp y la conexión agente↔inbox

> **Ola 2.** Corre en paralelo con H7, H8, H9 y H10. Requiere H1 y H3 mergeados.
> **ERES LA RUTA CRÍTICA.** Si algo se atrasa, que no sea esto.
> Rama: `h6-inbox` · Migraciones: `040`–`049`
> Directorios: `packages/inbox/**` (excepto `drivers/{meta,email,sms}`) y `apps/web/app/(app)/bandeja/**`

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
  contact_id      uuid,
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

**Toda tabla con `ENABLE ROW LEVEL SECURITY` en la misma migración.**

Ese índice único parcial sobre `external_id` es lo que hace idempotente la recepción del
webhook. Sin él, un reintento de Evolution duplica mensajes.

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

## 11. Prompt de arranque

```
ANTES DE ESCRIBIR NADA: verifica que H1 y H3 hayan mergeado.
  test -f packages/db/ports.ts && test -d packages/agents/src && echo LISTO || echo "ESPERA"
Si falta alguno, NO crees estructura. Lee tu handoff, estudia GARDEN, prepara tu plan.

Trabaja SIEMPRE desde /Volumes/FRAGUA/CLAUDE CODE/PLATAFORMA-h6-inbox (tu worktree, rama
h6-inbox ya activa). No hagas checkout ni switch.

Vas a construir H6 — la bandeja, el driver de WhatsApp y la conexión agente↔inbox de
ABRAXA Plataforma. ERES LA RUTA CRÍTICA: sin ti el producto es una demo bonita.

Lee primero, completo:
  docs/handoffs/H6-inbox.md          (tu handoff)
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
Otras 4 conversaciones trabajan en paralelo.

El criterio #1 es el que define la fecha real de la v1: mandar un WhatsApp real y que el agente
conteste, de punta a punta. Y el #3 no se negocia: si un humano escribe en el hilo, la IA se
calla — nada peor que el agente contestando encima de su dueño.

Si algo del handoff está mal o incompleto, dilo y propón el arreglo antes de construir.
```
