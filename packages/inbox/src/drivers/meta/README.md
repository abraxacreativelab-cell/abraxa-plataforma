# H12 · Driver de Instagram Direct y Messenger

Para muchos negocios mexicanos Instagram **es** el canal de ventas. El DM es donde preguntan
precio, donde se cierra y donde se pierde el cliente si nadie contesta a tiempo. Esto es lo que
hace que el agente conteste ahí igual que en WhatsApp.

Son dos canales y **un solo driver parametrizado**. Comparten la Graph API, la firma, el formato
del webhook y la ventana de 24 horas; se diferencian en tres cosas, y las tres están en
[`ajustes.ts`](ajustes.ts): el `object` del webhook, a qué id se le cuelga `/messages`, y el tope
de caracteres.

| Archivo | Qué resuelve |
|---|---|
| [`ajustes.ts`](ajustes.ts) | La config del canal. **Dónde viven los secretos y por qué ahí.** |
| [`firma.ts`](firma.ts) | `X-Hub-Signature-256` y el challenge del GET. |
| [`parse.ts`](parse.ts) | Webhook → mensajes. El guardia anti-cruce y la inversión del eco. |
| [`ventana.ts`](ventana.ts) | La ventana de 24 horas de Meta. |
| [`graph.ts`](graph.ts) | Lo único que habla con Meta. |
| [`ecos.ts`](ecos.ts) | Que el agente no se calle a sí mismo. |
| [`conexion.ts`](conexion.ts) | Vincular la cuenta desde Ajustes. |
| [`enrutado.ts`](enrutado.ts) | De un id de Meta al canal que le corresponde. |
| [`direccion.ts`](direccion.ts) | La dirección, y por qué no se fusionan contactos. |

---

## 1. Lo que necesito de H6 — tres cosas, ninguna opinable

Ninguna se puede escribir desde este carril: `packages/inbox/**` es de H6 **excepto** esta
carpeta, y el gate de propiedad falla el PR con el nombre del archivo. Están aquí, con el parche
exacto, para que sean tres parches y no tres diseños.

### 1.1 Importar esta carpeta · `packages/inbox/src/index.ts`

Sin esto los dos canales **no están registrados** y `crearCanal({type:'instagram'})` falla con
«No hay driver registrado». Es una línea:

```ts
// packages/inbox/src/index.ts, junto a la de WhatsApp
import './drivers/meta';
```

El driver se auto-registra al importarse, que es lo que promete
[`drivers/registry.ts:6-7`](../registry.ts). El registro es idempotente, así que si H6 prefiere
llamar a `registerDriver()` explícitamente las dos formas funcionan.

### 1.2 El GET del challenge · `packages/inbox/src/routes/webhooks.ts:35-37`

**Éste es el que bloquea de verdad: sin él, Meta no deja registrar la URL del webhook.**

Meta verifica el webhook con un **GET** que lleva `hub.mode`, `hub.verify_token` y
`hub.challenge`, y exige que se le devuelva el valor de `hub.challenge` **crudo, como texto
plano**. Hoy la ruta responde:

```ts
webhooksRouter.get('/webhooks/:channelId', (_req, res) => {
  res.json({ ok: true });          // ← con esto la verificación falla SIEMPRE
});
```

`{"ok":true}` no es el challenge, así que Meta rechaza la URL con un error del panel que no dice
por qué. El parche:

```ts
webhooksRouter.get('/webhooks/:channelId', (req: Request, res: Response) => {
  void (async () => {
    try {
      const canal = await resolverCanalDeWebhook(String(req.params.channelId ?? ''), tokenDe(req));
      const driver = driverFor(canal.type) as { verificarWebhook?: (i: {
        query: unknown; config: Record<string, unknown>;
      }) => string | null };

      // Los canales que no verifican por challenge (WhatsApp) siguen igual.
      if (!driver.verificarWebhook) { res.json({ ok: true }); return; }

      const challenge = driver.verificarWebhook({ query: req.query, config: canal.config });
      if (challenge === null) { res.status(403).type('text/plain').send(''); return; }

      // Crudo y en texto plano. Ni JSON, ni comillas, ni salto de línea.
      res.type('text/plain').send(challenge);
    } catch (err) {
      if (PlatformError.is(err)) { res.status(err.status).json(err.toResponse()); return; }
      res.status(500).json({ error: { code: 'INTERNAL', message: 'Error interno' } });
    }
  })();
});
```

Y para que el método sea parte del contrato en vez de un `as`, en
[`drivers/types.ts`](../types.ts), dentro de `ExtrasDriver`:

```ts
  /** El challenge del GET de verificación del proveedor, o null. Texto PLANO. */
  verificarWebhook?(i: { query: unknown; config: Record<string, unknown> }): string | null;
```

`403` y no `200` cuando devuelve `null`: contestar 200 a un challenge que no se pudo verificar le
diría a Meta que la URL es buena sin que nadie haya probado que el secreto coincide.

### 1.3 El cuerpo crudo en el sobre · `packages/inbox/src/routes/webhooks.ts:58-62`

La firma de Meta es el HMAC-SHA256 del **cuerpo crudo**. `apps/api` ya lo guarda —
[`app.ts:14-16`](../../../../../apps/api/src/app.ts) deja el `Buffer` en `req.rawBody`
justamente para esto — pero el sobre no lo lleva hasta el driver:

```ts
      const r = await ingerirWebhook(canal, {
        channelId: canal.id,
        payload: req.body,
        headers: req.headers as Record<string, string | undefined>,
        rawBody: (req as Request & { rawBody?: Buffer }).rawBody,   // ← esto
      });
```

Y el campo en `SobreWebhook` ([`drivers/types.ts:93-99`](../types.ts)):

```ts
  /** El cuerpo tal como llegó por el socket. H12 lo necesita para el HMAC. */
  rawBody?: Buffer;
```

**Mientras tanto este driver rechaza los webhooks firmados**, y lo dice en el log. Es
deliberado: la alternativa —comprobar el HMAC contra `JSON.stringify(payload)`— lo calcula sobre
bytes distintos y rechaza **todos** los eventos legítimos, con un síntoma que parece un App
Secret equivocado. Está medido en
[`firma.test.ts`](firma.test.ts) → *«el cuerpo RE-SERIALIZADO no valida»*.

Para desarrollo hay un escape explícito y por canal: `config.meta_firma_opcional = true` deja
pasar un webhook **sin** firma (nunca uno con firma inválida) y avisa en el log cada vez.

### 1.4 Nadie está escribiendo `contact_identities` — y no es de este carril

El criterio #7 del handoff pide que «el mismo humano en dos canales quede con **dos identidades
ligadas al contacto**, sin fusión automática». Hoy eso **no lo hace nadie**, y conviene que se
sepa antes de darlo por hecho:

```
$ grep -rn "useContacts\|resolveByIdentity\|@abraxa/crm" packages/inbox/src/
(sin resultados)

$ grep -n dependencies -A 6 packages/inbox/package.json
    "@abraxa/config": "*", "@abraxa/db": "*", "express", "nanoid", "zod"
```

H15 construyó el contrato y lo dejó documentado para este uso exacto
(`packages/crm/src/port.ts:32-35`), pero H15 mergeó **después** que H6 y el inbox nunca llegó a
llamarlo. `threads.contact_id` se queda en `null` para todos los canales, no sólo los míos.

**Por qué no lo escribo yo**, aunque sería una tentación de veinte líneas:

- `packages/inbox/**` fuera de esta carpeta es de H6.
- Añadir `@abraxa/crm` a `packages/inbox/package.json` toca el lockfile, y el gate rechaza el PR
  de cualquier rama que no sea la de H1 (CONTRIBUTING §4).
- Y aunque se pudiera: dar de alta contactos desde un **driver** sería la segunda ruta de alta
  del CRM. La normalización de identidades existe en un solo sitio a propósito
  (`packages/crm/src/identity.ts`), y una segunda que normalizara distinto rompería el índice
  `(tenant_id, channel, identifier)` sin que nadie lo notara hasta ver dos fichas del mismo
  cliente.

Lo que este driver sí garantiza es la mitad que le toca: la `address` que produce ya converge con
`normalizarHandle()` de H15 (probado en `direccion.test.ts`), así que el día que el núcleo llame
al port, las identidades de Instagram y Messenger caen donde deben **sin tocar este código**. Y
no se fusiona nada: un PSID es un id de la *relación* entre una persona y una página, no de la
persona — ver [`direccion.ts`](direccion.ts).

---

## 2. El webhook de Meta es por APP, no por canal

Esto no es un detalle de implementación: es una diferencia de modelo con WhatsApp y hay que
decidirla arriba, no aquí.

En el panel de Meta se configura **una sola URL de callback para toda la app**. Por ahí entran
las páginas de **todos** los clientes. El modelo de H6 es el contrario: la URL lleva el
`channelId` y el tenant sale de la fila de ese canal (`routes/webhooks.ts` → `contextoDeCanal`).

Si llega una `entry` de la página del cliente B por la URL del canal del cliente A, el núcleo la
escribiría **con el contexto de A**: los DMs de B en la bandeja de A.

**Lo que hace este driver:** [`guardiaDeEntrada()`](parse.ts) compara `entry[].id` contra el
`page_id`/`ig_user_id` del canal y **descarta lo que no es suyo**, dejándolo en el log. Se pierde
un mensaje; no se filtra a nadie. Probado en `parse.test.ts` e `index.test.ts`.

**Lo que hace falta**, y es de H6 o de H0: una ruta de nivel de app que resuelva el canal por
`entry[].id` **antes** de construir el `TenantContext`.
[`resolverCanalPorEntrada()`](enrutado.ts) es esa pieza, ya construida:

```ts
// una ruta nueva, sin :channelId — p. ej. POST /inbox/webhooks/meta
for (const entrada of req.body?.entry ?? []) {
  const canal = await resolverCanalPorEntrada(String(entrada.id ?? ''));
  if (!canal) continue;                       // no es de nadie: se ignora
  await ingerirWebhook(canal, {               // ← contexto del tenant CORRECTO
    channelId: canal.id,
    payload: { object: req.body.object, entry: [entrada] },
    headers: req.headers as Record<string, string | undefined>,
    rawBody: (req as Request & { rawBody?: Buffer }).rawBody,
  });
}
```

Mientras eso no exista, **cada tenant necesita su propia app de Meta** para tener su propia URL.
Funciona, y es exactamente lo que se hace en modo desarrollo.

---

## 2 bis. Para H17 — vincular la cuenta, en dos llamadas

H0 decidió y registró el `redirect_uri` (2026-07-31):

```
https://mi.abraxa.club/ajustes/integraciones/meta/callback
```

**La pantalla y esa ruta son de H17.** Aquí sólo está el lado servidor. Las credenciales salen
de `META_APP_ID` / `META_APP_SECRET` sin que haya que pasarlas, y se pueden pasar por parámetro el
día que sean por tenant — que es exactamente lo que H17 va a hacer.

```ts
import { urlDeAutorizacion, cuentasVinculables, conectarCuenta, createClienteMeta }
  from '@abraxa/inbox';   // vía el barril, ya exportado

// 1 · El botón «Conectar Instagram». `state` lo genera y lo guarda H17.
const url = urlDeAutorizacion({ canal: 'instagram', state });

// 2 · En el callback, con el `code` de la query (y tras comprobar el `state`):
const cliente = createClienteMeta();
const cuentas = await cuentasVinculables(cliente, { canal: 'instagram', code });
//   → [{ pageId, pageName, igUserId, igUsername, pageAccessToken,
//        utilizable, motivo? }]
//   Vienen TODAS, también las que no sirven, con `motivo` en español para
//   enseñarlo: «esta página no tiene una cuenta de Instagram profesional
//   vinculada» es el caso más común y el que más soporte genera.

// 3 · El emprendedor elige una, y se conecta:
const { config, externalId, status } = await conectarCuenta(cliente, {
  canal: 'instagram',
  cuenta: cuentas.find((c) => c.pageId === elegida)!,
  ...credencialesDeApp(),
});
// `config` es lo que va a `crearCanal()` / `ajustarCanal()` de H6. No se escribe
// la fila aquí: eso ya lo sabe hacer H6 y ya valida lo suyo.
```

**El `redirect_uri` no se pasa a mano en ninguna de las dos**, y es a propósito: Meta compara el
del diálogo con el del canje **carácter por carácter** y, cuando no coinciden, el error dice
«Invalid verification code format» sin mencionarlo. Sale de una sola constante
(`REDIRECT_URI`), y `conexion.test.ts` mide que las dos llamadas emiten el mismo valor.
`META_REDIRECT_URI` lo pisa para desarrollo.

`conectarCuenta` además **suscribe la página** (`POST /{page-id}/subscribed_apps`). Es el paso
que todo el mundo olvida: la URL del webhook se configura a nivel de app, pero cada página se
suscribe por separado, y sin eso no llega ni un mensaje.

Y se niega —con `CONFLICT`— si esa página o esa cuenta de Instagram ya está conectada en otra
empresa, **sin decir en cuál**: los mensajes de una acabarían en la bandeja de la otra, y decir
de quién es le filtraría a un cliente el nombre de otro.

> **Variables que faltan en `.env.example`** (es de H1, no se edita desde aquí): `META_APP_ID` y
> `META_REDIRECT_URI`. `META_APP_SECRET` y `META_VERIFY_TOKEN` ya están. Quedan anotadas, no
> añadidas.

---

## 3. Esto no puede salir a producción sin H17

Mientras las credenciales de canal sean variables del proceso (`.env.example:46-47`), **dos
clientes comparten la misma cuenta de Instagram**. Es una fuga entre clientes.

El driver ya está listo para H17 y no hará falta tocarlo: `leerConfigMeta()` lee **primero la
`config` del canal** —que es por tenant— y sólo cae al entorno si ahí no hay nada. Es el mismo
orden que el driver de WhatsApp (`whatsapp/evolution.ts:221-227`). Medido en
`ajustes.test.ts` → *«el canal manda sobre el entorno»*.

---

## 4. Los secretos, y por qué van anidados

`sanearCanal()` ([`channels/service.ts:36-45`](../../channels/service.ts)) es lo único que impide
que la `config` de un canal salga cruda al navegador, y filtra por **lista de nombres exactos**:

```ts
const SECRETOS = ['webhook_token','api_key','apikey','token','secret','password'];
```

`page_access_token` no está en esa lista. `app_secret` tampoco. Guardarlos en la raíz los
publicaría en `GET /inbox/channels`.

Por eso **todos los secretos de Meta viven bajo `config.secret`**, que sí está en la lista y se
elimina entero. `ajustes.test.ts` lo comprueba contra el `sanearCanal` de verdad: si alguien
cambia ese filtro, la prueba se cae aquí y no en producción.

```jsonc
{
  "page_id": "102938475600000",        // público: la pantalla lo enseña
  "ig_user_id": "17841400000000000",
  "ig_username": "minegocio",
  "webhook_token": "…",                // secreto (lo filtra H6 por nombre)
  "secret": {                          // secreto entero
    "page_access_token": "…",
    "app_secret": "…",
    "app_id": "…",
    "verify_token": "…"
  },
  "meta_etiqueta_fuera_de_ventana": "HUMAN_AGENT",  // opcional, ver §5
  "meta_firma_opcional": false,        // sólo desarrollo
  "meta_perfil": true                  // buscar el nombre del contacto
}
```

---

## 5. La ventana de 24 horas

Sólo se puede escribir libremente dentro de las 24 h posteriores al **último mensaje del
cliente**. Fuera de ahí Meta exige una etiqueta aprobada.

Un driver que la ignora **pasa todas las pruebas**: en desarrollo uno contesta a los diez
segundos. El fallo aparece con clientes reales al día siguiente, como un error del proveedor
(código 10, subcódigo 2018278) que parece un problema de permisos.

Aquí es un requisito con estado propio:

1. Cada mensaje del cliente la abre → `app.meta_message_windows` (migración 100).
2. Cada envío la consulta **antes de salir**. Cerrada y sin etiqueta → se rechaza aquí, **sin
   gastar la llamada a Meta**, con un texto que dice la fecha exacta en la que se cerró.
3. `estadoDeVentana()` la expone para que la bandeja la enseñe antes de que falle.

`last_inbound_at` **sólo avanza**, y eso lo garantiza un trigger de la migración
(`meta_ventana_solo_avanza`), no un `if`: Meta reintenta sin orden garantizado y un reintento
viejo cerraría una ventana viva.

### Lo que falta para el criterio #6 completo

La parte de driver está hecha y probada. **Enseñarlo en la bandeja es de H6**
(`app/(app)/bandeja/**`). Lo que hace falta consumir:

```ts
import { estadoDeVentana } from '@abraxa/inbox';   // vía el barril, ya exportado

const v = await estadoDeVentana(ctx, { channelId, address });
// { abierta, ultimoEntrante, cierraEn, minutosRestantes, porCerrar }
```

`porCerrar` es la bandera que la UI necesita: `true` cuando quedan menos de dos horas. Con eso
el emprendedor lo ve **antes** de que el envío falle, que es lo que pide el criterio.

---

## 6. Probado en modo desarrollo · qué queda pendiente

La app `"Abraxa platform"` (`942016735581534`) está en `dev_mode`, con la verificación de negocio
**aprobada** y los permisos `instagram_manage_messages`, `pages_messaging` y
`pages_manage_metadata` **en trámite**. Meta permite construir y probar con cuentas de
desarrollador y roles de prueba, y eso es lo que se hizo.

**Verificado en CI, sin red ni cuenta conectada** (`npm test`):

- Firma válida entra; firma inválida se rechaza y no deja rastro (criterio #8).
- El cuerpo re-serializado **no** valida — con bytes, no con un argumento.
- El challenge se devuelve crudo; con el token equivocado, `null`.
- Dentro de la ventana sale como `RESPONSE`; **fuera se rechaza sin una sola llamada a Meta**;
  con etiqueta configurada sale como `MESSAGE_TAG`.
- Instagram cuelga `/messages` de la cuenta de IG y Messenger de la página.
- Un eco propio no vuelve a entrar; el eco del teléfono del dueño sí (criterio #5).
- Una `entry` de otra cuenta se descarta.
- Un webhook reenviado no duplica: sin `mid` no entra, y el `mid` es la llave de idempotencia
  del índice único de H6 (criterio #4).
- Los secretos no cruzan `sanearCanal`.

**Pendiente de validar cuando Meta apruebe** — no se puede medir antes, y no depende del código:

1. Criterios #1 y #2 con un DM real: mandar un DM y que el agente conteste. Necesita los
   permisos aprobados y la línea 1.1 y 1.2 de H6.
2. El nombre del contacto (`GET /{psid}?fields=name`): los permisos de perfil son de los últimos
   en aprobarse. Hasta entonces devuelve `null` y la bandeja enseña `id:…`. Está previsto y es
   best-effort.
3. Que Meta acepte de verdad la etiqueta `HUMAN_AGENT` del negocio: se aprueba por separado.
4. El filtro `config->>page_id` de [`enrutado.ts`](enrutado.ts) contra Postgres de verdad: el
   doble en memoria de H6 no entiende los operadores JSON de PostgREST.
5. Que la URL de adjuntos de Meta caduque. Hoy se guarda la URL, igual que hace el driver de
   WhatsApp. Archivar los binarios es una decisión de producto, no de un driver.
6. Los acuses por **marca de agua**: `parsearEventos` sólo traduce los que traen `mids`. Aplicar
   un `watermark` pide un UPDATE por rango sobre `messages`, y eso es del núcleo —
   `aplicarEvento()` filtra por `external_id` exacto (`ingest.ts:341`).
