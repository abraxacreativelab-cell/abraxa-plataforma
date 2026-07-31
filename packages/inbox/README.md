# @abraxa/inbox

Bandeja multicanal, driver de WhatsApp y **el puente agente↔inbox**.

| | |
|---|---|
| **Handoff** | H6 |
| **Rama** | `h6-inbox` |
| **Migraciones** | `040_inbox.sql` |
| **Montado en** | `apps/api` → `/inbox` |
| **Pantalla** | `apps/web/app/(app)/bandeja/` → `/bandeja` |

---

## Qué hace

La promesa que vende el producto es una frase: **"tu agente contesta a tus
clientes mientras duermes."** Este paquete es lo que la vuelve verdad.

```
POST /inbox/webhooks/:channelId?token=…        routes/webhooks.ts
  → resolverCanalDeWebhook()                   channels/lookup.ts   ← única lectura sin sesión
  → contextoDeCanal()                          context.ts           ← TenantContext sintético
  → driver.parseWebhook()                      drivers/whatsapp/
  → asegurarHilo() + INSERT idempotente        ingest.ts            ← criterio #4
  → decidirSiContesta()                        bridge/decide.ts     ← el campo que GARDEN nunca leyó
  → AgentPort.run({ …, threadId })             bridge/responder.ts  ← el puente
  → driver.send()                              inbox/service.ts     ← anti-duplicado
```

En GARDEN, `crm_threads.ai_enabled` está declarado en el tipo y **no se lee en
ningún lado**: su única aparición en todo el repo es `src/crm/types.ts:281`. Los
bots viven en un mundo y la bandeja en otro. Nunca se cableó el puente. Aquí se
lee en cada mensaje que entra.

---

## Para los demás handoffs

**H8 (flows) — mandar un mensaje**

```ts
await usePort('inbox').send(ctx, { threadId, body: 'Te esperamos mañana' });
```

**H12 y H13 — enchufar un canal nuevo**

```ts
// packages/inbox/src/drivers/meta/index.ts   ← carpeta de H12
import { registerDriver } from '@abraxa/inbox';

registerDriver({
  type: 'instagram',
  async send({ channelId, address, body, media }) { … },
  async parseWebhook(raw) {
    const sobre = leerSobre(raw);          // { channelId, payload, headers }
    return […];                            // InboundMessage[]
  },
  // Opcionales, con default sensato si no se implementan:
  normalizeAddress: (raw) => raw.trim().toLowerCase(),
  parseEvents: async (raw) => […],         // acuses y estado de la línea
  provisionChannel: async ({ tenantId, name, config }) => { … },
  channelStatus: async ({ config }) => { … },
  teardownChannel: async ({ config }) => { … },
});
```

Y el import desde `packages/inbox/src/index.ts` — esa línea sí la agrega H6 o el
orquestador, porque el archivo es de H6.

### Dos convenciones que hay que conocer

**El sobre del webhook.** `ChannelDriver.parseWebhook(raw)` no recibe el id del
canal y el driver no lo puede deducir del cuerpo del proveedor. `raw` es siempre
un `SobreWebhook`: `{ channelId, payload, headers }`.

**`provisionChannel` escribe en `config`.** El port no permite devolver la
config, así que el driver **muta** el objeto que recibe (ahí guarda su instancia
y su `webhook_token`) y el servicio persiste el resultado. `config.channelId`
viene lleno: es lo que hace falta para armar la URL del webhook.

---

## El modelo

`app.channels` · `app.threads` · `app.messages` (migración `040`).

Tres cosas que no son obvias:

- **`threads.external_address` es genérico.** Un teléfono E.164, un correo, un
  id de Instagram. GARDEN guardaba un JID de WhatsApp y ese supuesto se filtró a
  dos subsistemas (`phoneToJid()` en el inbox y en el motor de workflows). Aquí
  el JID sólo lo conoce `drivers/whatsapp/phone.ts`.
- **El índice único parcial `(tenant_id, external_id)` sobre `messages`** es lo
  que hace idempotente la recepción. Sin él, dos entregas concurrentes del mismo
  webhook pasan las dos y el cliente recibe dos respuestas del agente.
- **La política de la IA vive en el canal**: qué agente contesta
  (`agent_role`), si contesta (`ai_enabled`) y en qué horario
  (`business_hours`, `ai_outside_hours`). Un canal de soporte y uno de ventas no
  deberían hablar igual, y eso se resuelve con una fila, no con un `if`.

---

## Las reglas que no se negocian

1. **Un humano escribe en el hilo → la IA se calla.** Nada peor que el agente
   contestando encima de su dueño. Por las **dos** vías, que no son la misma:
   - desde la bandeja → `enviarEnHilo` llena `assigned_to` y el hilo queda
     tomado hasta que alguien lo suelte;
   - desde **el teléfono del dueño**, que es el camino más común — el
     emprendedor casi nunca tiene la pantalla abierta. Ese mensaje vuelve por el
     webhook como un eco `fromMe`; `ingest.ts` lo reconoce (si hubiera salido de
     aquí, ya estaría en la base y el eco chocaría con el índice único) y **pausa
     la IA una hora** (`MINUTOS_PAUSA_POR_ECO_HUMANO`). Se pausa y no se asigna
     porque el eco no trae identidad y porque una pausa vence sola.
2. **La IA nunca contesta dos veces al mismo mensaje.** La unicidad vive en la
   base, no en un `SELECT` previo.
3. **Si el agente falla, silencio.** El mensaje queda marcado
   (`ai_outcome = 'failed'`) con su motivo. No sale un texto de disculpa: un
   silencio es mejor que un robot roto.
4. **`threadId` SIEMPRE a `AgentPort.run`.** Es lo que ata el costo al hilo en
   `usage_ledger` y lo que le da memoria al agente.
5. **Toda ruta con sesión pasa primero por `proxyVerified`.** El secreto
   compartido del BFF se comprueba **antes** de leer `x-user-email`. La
   membresía no es la identidad: `contextFor()` valida que ese correo pertenezca
   a esa empresa, no que el correo sea de quien llama. Y este carril es el que
   obliga a que `apps/api` sea alcanzable desde fuera (Evolution tiene que poder
   hacer POST al webhook), así que aquí no hay red privada que valga.
6. **Desconectar una línea no borra el historial.** Ver abajo.

---

## Reconectar una línea caída (sin perder nada)

La línea se cae —se quedó sin batería el teléfono, venció la sesión de
Baileys— y el canal queda en `disconnected`. **No hace falta borrar el canal:**

```
GET /inbox/channels/:id/status     → devuelve un QR nuevo cuando la instancia
                                     no está `open`. Se escanea y ya.
```

Y si de verdad se quiere dar de baja la línea:

```
DELETE /inbox/channels/:id             → baja lógica: la línea deja de
                                         funcionar, `config` se vacía y el
                                         canal queda `disconnected`.
                                         Los hilos y mensajes SE CONSERVAN.
                                         (Si el canal no tiene ni un hilo, la
                                         fila sí se borra: no hay nada que
                                         proteger.)

DELETE /inbox/channels/:id?purge=true  → destructivo e irreversible. Borra los
                                         hilos y los mensajes, y devuelve —y
                                         registra en el log— cuántos destruyó.
```

`threads.channel_id` **no** lleva `ON DELETE CASCADE` (migración `040`): sin esa
red, «reconectar mi WhatsApp» borraba seis meses de conversaciones con clientes
y la API contestaba `{ ok: true }`.

---

## Las dos URL que NO son la misma

`API_BASE_URL` significaba dos cosas incompatibles a la vez, y con el valor que
trae `.env.example` la línea se conecta, el QR se escanea y **no entra ni un
mensaje**: Evolution está haciendo POST a su propio `localhost`.

| Variable | Qué es | Quién la usa | Ejemplo |
|---|---|---|---|
| `PUBLIC_WEBHOOK_BASE_URL` | La URL **pública** por la que los servidores de Evolution alcanzan `/inbox/webhooks/:id`. Tiene que salir a internet. | `drivers/whatsapp/index.ts` | `https://api.abraxa.club` |
| `API_BASE_URL` | La base **interna** con la que el BFF de Next llama a `apps/api`. Nunca la ve el navegador. | `apps/web/app/(app)/bandeja/api/bff.ts` | `http://localhost:3100` |

Si `PUBLIC_WEBHOOK_BASE_URL` no está puesta se sigue usando `API_BASE_URL` —para
no romper un despliegue que hoy funcione porque le pusieron el valor público—,
pero si de ahí sale una dirección de loopback o de un rango privado, el driver lo
**avisa en el log** en vez de callarse. Ese aviso es lo único que separa «no
llega ningún WhatsApp» de una tarde revisando Evolution.

> **Pendiente de H1** (dueño de `.env.example` y de `packages/config/**`):
> declarar `PUBLIC_WEBHOOK_BASE_URL` en la plantilla de entorno y en el esquema
> de `env.ts`. H6 no puede tocar esos archivos.

---

## Probar sin nada conectado

```bash
npm test -- packages/inbox          # los criterios observables, con dobles
ABRAXA_INBOX_DEMO=1 npm run dev:web # ver /bandeja con datos en memoria
```

Las pruebas corren la cadena completa con un driver que **no es WhatsApp**
(`testing/fake-driver.ts`): si algo del núcleo asumiera JIDs o instancias de
Evolution, se caerían.
