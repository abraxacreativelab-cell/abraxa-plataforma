# H17 — Integraciones por tenant: las credenciales dejan de ser del proceso

> **Ola 4.** Corre en paralelo con H16 y H18. Requiere H1 y H2 mergeados.
> **Prerrequisito duro de H12 y H13.** Sin esto, dos clientes comparten el mismo WhatsApp.
> Rama: `h17-integraciones` · Migraciones: `140`–`149`
> Directorios: `packages/integrations/**` y `apps/web/app/(app)/ajustes/integraciones/**`
> Worktree: `/Volumes/FRAGUA/CLAUDE CODE/PLATAFORMA-h17-integraciones`

---

## 1. Contexto

Hoy las credenciales de todos los canales son **variables del proceso**. Una llave de Evolution,
un secreto de app de Meta, un número de Twilio, una llave de Resend: una de cada cosa, para
todos los clientes a la vez.

Eso funciona con un cliente. Con dos, es un incidente.

Tú conviertes esas variables en **filas por empresa**, cifradas, con su estado, su fecha de
verificación y su dueño. Es la pieza que hace que ABRAXA Plataforma sea multi-cliente de verdad
y no un sistema de un solo inquilino con una tabla `tenants`.

---

## 2. El hueco, con archivo y línea

### 2.1 Un solo juego de credenciales para todos

`.env.example:44-51` — el bloque de canales completo:

```
EVOLUTION_API_URL       EVOLUTION_API_KEY
META_APP_SECRET         META_VERIFY_TOKEN
RESEND_API_KEY
TWILIO_ACCOUNT_SID      TWILIO_AUTH_TOKEN       TWILIO_FROM_NUMBER
```

Ocho variables, **una de cada una por proceso**. No hay dimensión de tenant en ninguna.

### 2.2 El driver de WhatsApp ya las lee así

`packages/inbox/src/drivers/whatsapp/evolution.ts:225-226`, en la rama `h6-inbox`:

```ts
baseUrl ??= e.EVOLUTION_API_URL ?? 'http://127.0.0.1:8080';
apiKey  ??= e.EVOLUTION_API_KEY ?? '';
```

El `??=` es lo importante: **el driver acepta que se las pasen**, y sólo cae al entorno si nadie
lo hace. H6 dejó el enchufe puesto sin saber quién lo iba a usar. Eres tú. Este carril no pelea
contra el diseño de H6: lo completa, y por eso no necesita tocar un solo archivo suyo.

### 2.3 Los dos carriles que dependen de ti lo dicen en su propio handoff

**H12 (`H12-meta.md:59-64`)** necesita de Santiago, textual:

> App de Meta tipo Business creada y vinculada a **su** Business Suite · … · App ID, App Secret
> y **token de acceso de página**

Un token de acceso de página es, por definición, de **una** página de **un** negocio. No cabe en
una variable de entorno del proceso. Y `H12-meta.md §2.4` promete: *"el emprendedor vincula su
cuenta desde Ajustes"* — la pantalla que vincula es tuya; el driver que la usa es suyo.

**H13 (`H13-email-sms.md §4-5`)** necesita un dominio con SPF, DKIM y DMARC **verificados** y un
número de Twilio con registro A2P. Los dos son por empresa. Un `RESEND_API_KEY` global significa
que el correo de un cliente sale con la reputación de dominio de todos los demás — y
`H13-email-sms.md §4` ya lo advierte: *"ignorar esto quema la reputación del dominio para todos
los tenants a la vez"*.

### 2.4 Lo que pasa si no existes

No es hipotético, es aritmética: dos empresas dadas de alta hoy comparten `EVOLUTION_API_KEY`.
Comparten instancia de Evolution. Comparten, en el peor caso, **el mismo número de WhatsApp**.

El cliente de la panadería recibe los mensajes de la clientela de la inmobiliaria. Es el peor
fallo posible de un producto multi-cliente: no es una fuga de datos abstracta, es que a alguien
le llegan las conversaciones de otro a su teléfono.

---

## 3. Alcance

### Sí

1. **`app.tenant_integrations`** — credenciales por empresa, **cifradas en reposo**.
2. **`IntegrationsPort`** — resolver, guardar, verificar, revocar.
3. **Cifrado y rotación de llave** con versión, sin downtime.
4. **Resolución con precedencia** — la del tenant gana; el respaldo de plataforma es explícito,
   apagado por defecto y prohibido para los proveedores donde compartir es inaceptable.
5. **`verify()` por proveedor** — que "conectado" signifique algo comprobado, no algo capturado.
6. **Ruteo inverso**: de la cuenta externa que trae un webhook al tenant dueño.
7. Pantalla `/ajustes/integraciones` — conectar, ver estado, reconectar, revocar.

### No

- **No** implementas ningún canal. Los drivers son de H6, H12 y H13. Tú les das las credenciales.
- **No** tocas `packages/inbox/**`. Ni un archivo. El driver de WhatsApp ya acepta que se las
  pasen (§2.2).
- **No** construyes el flujo de OAuth de Meta *dentro* del driver — tú das la vuelta completa
  (autorizar → callback → guardar → verificar) y él sólo pide la credencial resuelta.
- **No** guardas secretos de Stripe. El cobro es de la plataforma, no del cliente: `H10` los
  tiene en el entorno y ahí se quedan.
- **No** haces la sesión ni el login. Es H18.

---

## 4. Contrato de no colisión

| | |
|---|---|
| **Escribes sólo en** | `packages/integrations/**` · `apps/web/app/(app)/ajustes/integraciones/**` |
| **Migraciones** | `140`–`149`, ni una fuera |
| **Rama** | `h17-integraciones` — igual que tu llave en `.ownership.json` |
| **Worktree** | `/Volumes/FRAGUA/CLAUDE CODE/PLATAFORMA-h17-integraciones` |
| **No toques** | `packages/inbox/**` (H6, H12, H13) · `packages/db/**` (H1) · el lockfile |

**Implementas:** `IntegrationsPort`, declarado en `packages/integrations/src/port.ts` — **no** en
`packages/db/ports.ts`, que es de H1 y el gate lo defiende. Es exactamente lo que hizo H15 con
`ContactsPort` (`H15-crm.md §9.4`) y por la misma razón: `PortName = keyof PortRegistry` y
`port-registry.ts:6` declara `OWNER` con las ocho llaves a mano, así que ampliar el registro
desde aquí rompería `npm run typecheck` **en un archivo de otro carril**.

**Consumes:** `TenancyPort` (H2) para el contexto de las rutas HTTP.
**Te consumen:** H6 (WhatsApp) · H12 (Meta) · H13 (email y SMS) · H16 (¿el plan incluye este
canal?) · H14 (ver el estado de las integraciones de un cliente en el panel de agencia).

### Tu paquete es nuevo y eso tiene un costo

`packages/integrations` no existe. Como le pasó a H15 con `packages/crm`, `npm ci` exige que el
lockfile conozca el workspace nuevo o **falla antes del typecheck**: `Missing:
@abraxa/integrations@0.1.0 from lock file`.

**Tienes permiso para ese nodo, y sólo para ése.** Tu entrada de `.ownership.json` trae
`"lockfile": true` justamente por esto (se le dio el 2026-07-31, al fusionar `main`: sin él tu
CI no tenía ninguna salida — `npm ci` reventaba, y si tocabas el lockfile el gate te rechazaba
el PR).

Las condiciones:

- **Aíslalo en un solo commit**, sólo el nodo del workspace. Cambio aditivo; no mueve ninguna
  versión de terceros.
- **Sigues sin poder instalar dependencias nuevas** (regla 4). Si te falta una, anótala en el PR
  y no la instales.
- **Rebasa sobre `main` justo antes de abrir el PR.** H15 y H18 también tienen la llave del
  lockfile ahora mismo; dos ramas que lo tocan en paralelo dan un conflicto garantizado.
- El orquestador **quita** ese `"lockfile": true` en cuanto tu carril mergee.

Lo mismo con el montaje del router (`apps/api/src/packages.ts`) y con `transpilePackages` de
`apps/web/next.config.mjs`. Los tres van en §10.

---

## 5. Modelo de datos

```sql
-- 140_tenant_integrations.sql

CREATE TABLE app.tenant_integrations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,

  -- evolution | meta | twilio | resend | smtp | …
  provider    text NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_]{1,30}$'),

  -- Cómo se llama esta conexión para el emprendedor: "WhatsApp de la tienda".
  label       text NOT NULL,

  -- El identificador de la cuenta DEL LADO DEL PROVEEDOR: id de página de Meta,
  -- Account SID de Twilio, nombre de instancia de Evolution, dominio de Resend.
  -- Es la llave del ruteo inverso de §8 y por eso es única globalmente, no por
  -- tenant: una misma página de Facebook no puede pertenecer a dos empresas.
  external_account_id text,

  -- Lo que NO es secreto y sí hace falta consultar y filtrar: número de
  -- teléfono, dominio, base URL, scopes concedidos. Va en claro a propósito:
  -- cifrar lo que no lo necesita sólo hace imposible depurar.
  config      jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(config) = 'object'),

  -- El secreto, cifrado. Ver §6.
  secret_ct   bytea,
  secret_iv   bytea,
  secret_tag  bytea,
  key_version int NOT NULL DEFAULT 1,

  status      text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','connected','error','revoked')),
  last_error  text,
  -- Cuándo se comprobó por última vez que la credencial SIRVE, no cuándo se
  -- capturó. Ver §7: son dos cosas distintas y confundirlas es la causa número
  -- uno de "el sistema dice conectado y no manda".
  verified_at timestamptz,
  expires_at  timestamptz,          -- tokens de Meta que caducan

  connected_by text REFERENCES app.users(email) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  -- Una conexión viva por proveedor y cuenta, por empresa. Reconectar
  -- REEMPLAZA la fila, que además invalida la credencial anterior — que es lo
  -- que uno quiere al reconectar.
  UNIQUE (tenant_id, provider, external_account_id)
);

ALTER TABLE app.tenant_integrations ENABLE ROW LEVEL SECURITY;

-- El ruteo inverso de §8. Parcial porque una fila revocada ya no rutea nada, y
-- porque `external_account_id` es null mientras el OAuth no termina.
CREATE UNIQUE INDEX tenant_integrations_cuenta_externa_idx
  ON app.tenant_integrations (provider, external_account_id)
  WHERE external_account_id IS NOT NULL AND status <> 'revoked';

CREATE INDEX tenant_integrations_por_tenant_idx
  ON app.tenant_integrations (tenant_id, provider) WHERE status = 'connected';

COMMENT ON COLUMN app.tenant_integrations.secret_ct IS
  'Secreto cifrado con AES-256-GCM. La llave NUNCA está en la base: vive en '
  'INTEGRATIONS_KEY y sólo el proceso la tiene. Ver docs/handoffs/H17-integraciones.md §6.';
```

```sql
-- 141_integration_events.sql

-- Bitácora. Cuando alguien reclame que "conectó su WhatsApp y no funcionó",
-- esto es lo único que contesta qué pasó.
CREATE TABLE app.integration_events (
  id             bigserial PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  integration_id uuid REFERENCES app.tenant_integrations(id) ON DELETE SET NULL,
  provider       text NOT NULL,
  type           text NOT NULL,   -- connect | verify_ok | verify_fail | rotate | revoke | refresh
  detail         jsonb NOT NULL DEFAULT '{}',
  actor          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app.integration_events ENABLE ROW LEVEL SECURITY;
CREATE INDEX integration_events_tenant_idx ON app.integration_events (tenant_id, created_at DESC);
```

**Las dos tablas llevan `tenant_id` y `ENABLE ROW LEVEL SECURITY` en la misma migración que las
crea.** No hay ninguna global aquí: una credencial siempre es de alguien.

### Lo que nunca entra en `detail` ni en `last_error`

El cuerpo crudo de la respuesta del proveedor. Meta y Twilio **devuelven el token en el eco de
error** con más frecuencia de la que uno esperaría, y una bitácora que guarda el error completo
acaba siendo un almacén de secretos en claro con RLS pero sin cifrado. Guarda código, mensaje
corto y `request_id`. Nada más.

---

## 6. Cifrado — y por qué no `pgcrypto`

**AES-256-GCM con `node:crypto`.** Sin dependencias nuevas (regla 4), y GCM porque autentica:
un ciphertext alterado falla al descifrar en vez de producir basura silenciosa.

```ts
// packages/integrations/src/crypto/secret-box.ts
export function seal(plain: string): { ct: Buffer; iv: Buffer; tag: Buffer; version: number };
export function open(b: { ct: Buffer; iv: Buffer; tag: Buffer; version: number }): string;
```

La llave viene de `INTEGRATIONS_KEY` (32 bytes en base64). Anótala en tu PR para que H1 la
agregue a `.env.example` — **ese archivo es suyo** (`.ownership.json`, `h1-fundacion`).

**Por qué no `pgcrypto`**, aunque esté disponible: `pgp_sym_encrypt(secreto, llave)` mete la
llave **en el texto del statement**. Ese texto acaba en `pg_stat_statements`, en el log de
consultas lentas y en el explorador de logs de Supabase. Se termina auditando una base donde el
secreto está cifrado y la llave está en el log de al lado. El cifrado en la aplicación mantiene
la llave en un solo lugar: la memoria del proceso.

**Cuatro reglas que no se negocian:**

1. **El secreto no sale nunca por HTTP.** Ni al dueño de la empresa, ni al staff, ni en el panel
   de H14. La API devuelve una **huella**: `••••4821` más los 8 primeros hex del sha256. Con eso
   se distingue una credencial de otra sin poder usar ninguna.
2. **El secreto no sale nunca en un log**, ni en un error, ni en un `console.warn` de
   depuración. Escribe la prueba que lo afirma: serializa el objeto de integración completo y
   verifica que el texto claro no aparece.
3. **`key_version` desde el día uno.** Rotar sin versión obliga a un downtime o a un big-bang.
   Con versión: se agrega `INTEGRATIONS_KEY_2`, lo nuevo se cifra con la 2, lo viejo se sigue
   leyendo con la 1, y un comando (`packages/integrations/src/bin/rotate.ts`) re-cifra por
   lotes. Sin prisa y sin apagar nada.
4. **Fail-closed sin llave.** Si `INTEGRATIONS_KEY` no está, `seal()` y `open()` **lanzan**. No
   guardan en claro "por ahora". Es el mismo criterio de `proxyVerified()`
   (`packages/tenancy/src/middleware/proxy.ts:42`): un deploy que pierde una variable no
   degrada a inseguro, se cae.

---

## 7. `verify()` — la diferencia entre capturado y conectado

Una credencial capturada no es una credencial que sirve. El emprendedor pega un token, ve una
palomita verde, se va tranquilo, y tres días después nadie le contestó a nadie.

**Cada proveedor implementa una comprobación real, barata y de sólo lectura:**

| Proveedor | Qué se comprueba |
|---|---|
| `evolution` | `GET /instance/connectionState` — que la instancia exista y esté conectada |
| `meta` | `GET /me` con el token de página — que el token viva y sea de la página que dice |
| `twilio` | `GET /Accounts/{sid}.json` — que el SID y el token casen |
| `resend` | `GET /domains/{id}` — que el dominio exista y **esté verificado** |

`verify()` se corre en tres momentos: **al conectar**, **bajo demanda** desde la pantalla, y en
un **repaso periódico**. El repaso es el que importa: los tokens de página de Meta caducan, un
cliente puede revocar el acceso desde su Business Suite, y un número de Twilio se puede liberar.

**Cuando la verificación falla, el estado pasa a `error` con su motivo y la pantalla lo enseña
arriba, no escondido.** Y por ninguna razón se borra la fila: revocar es del emprendedor.

> El repaso periódico es una cola de `pg-boss`. Regístrala desde tu propio `src/index.ts` con
> `registerQueue()` — **no edites `apps/worker/src/index.ts`**, su comentario de cabecera lo dice
> textual: *"llama a registerQueue() desde el index de tu paquete y no toques este archivo"*.

---

## 8. Ruteo inverso: del webhook al dueño

Es el problema que aparece el día que hay dos clientes, y es tuyo porque nace de tener
credenciales por empresa.

Hoy H6 resuelve el tenant por la **URL** del webhook: `POST /inbox/webhooks/:channelId?token=…`
(`packages/inbox/src/routes/webhooks.ts:39`, rama `h6-inbox`). Funciona porque cada canal tiene
su URL propia y su token.

**Meta no funciona así.** Una app de Meta tiene **un** webhook para todas las páginas que la
autorizaron, y el mensaje llega con el id de la página adentro. Hay que ir de ese id al tenant.

```ts
/** Del identificador de la cuenta externa al tenant dueño. Sin él, un webhook
 *  de Meta no sabe de quién es. */
resolveTenantByExternalAccount(i: { provider: string; externalAccountId: string }):
  Promise<{ tenantId: string; integrationId: string } | null>;
```

Lo garantiza el índice único parcial de §5: una misma página no puede estar conectada a dos
empresas. **Y devolver `null` es una respuesta válida y frecuente** — Meta manda eventos de
páginas que ya se desconectaron. `null` significa "ignora y registra", nunca "usa el primero
que encuentres".

---

## 9. Resolución y respaldo de plataforma

```ts
// packages/integrations/src/port.ts
export interface ResolvedIntegration {
  provider: string;
  config: Record<string, unknown>;
  /** El secreto en claro. Sólo existe dentro del proceso y nunca se serializa. */
  secret: string;
  /** De dónde salió. Se registra en cada uso. */
  source: 'tenant' | 'platform';
  integrationId: string | null;
}

resolveFor(ctx: TenantContext, provider: string): Promise<ResolvedIntegration>;
```

Precedencia:

```
app.tenant_integrations con status='connected'      ← siempre gana
        ↓ si no hay
respaldo de plataforma (las variables de .env)      ← sólo si está permitido
        ↓ si no
lanza  CHANNEL_ERROR  diciendo QUÉ falta conectar y DÓNDE
```

**El respaldo de plataforma está apagado por defecto y no es negociable para todos los
proveedores.** Se declara en una tabla del código, no en una variable suelta:

| Proveedor | ¿Respaldo permitido? | Por qué |
|---|---|---|
| `resend` | sí, con `INTEGRATIONS_PLATFORM_FALLBACK=true` | Se puede mandar desde `mail.abraxa.club` con el nombre del negocio mientras verifica su dominio |
| `evolution` | **no** | Compartir instancia es compartir el número. Es el fallo de §2.4 |
| `twilio` | **no** | Un número de Twilio es de un negocio, y el A2P está a nombre de alguien |
| `meta` | **no** | Un token de página es de una página |

Una tabla en el código con esos cuatro renglones y su razón escrita vale más que cualquier
comentario, porque el día que alguien quiera "destrabar rápido" a un cliente va a leer esto
antes de encender el respaldo del proveedor equivocado.

**El piloto.** Mientras haya un solo cliente, `source: 'platform'` es aceptable para `resend` y
suficiente para trabajar. Lo que no se negocia es que sea **visible**: la pantalla dice "estás
usando el correo de la plataforma" y la bitácora lo registra. Un respaldo silencioso es cómo se
llega a producción con dos clientes en el mismo número sin que nadie lo haya decidido.

---

## 10. Lo que este carril NO puede hacer solo — para el orquestador

| # | Qué | Dónde | Quién |
|---|---|---|---|
| 1 | Nodo de `packages/integrations` en el lockfile | `package-lock.json` | H1 |
| 2 | Montar el router: `['/integrations', integrationsRouter]` y su `meta` | `apps/api/src/packages.ts` | H1 |
| 3 | `'@abraxa/integrations'` en `transpilePackages` y en las dependencias del web | `apps/web/next.config.mjs` · `apps/web/package.json` | H1 |
| 4 | `INTEGRATIONS_KEY=` (y `INTEGRATIONS_PLATFORM_FALLBACK=`) en la plantilla de entorno | `.env.example` | H1 |
| 5 | Pasarle al driver la credencial resuelta en vez de leer el entorno | `packages/inbox/src/drivers/whatsapp/evolution.ts:225` | H6 |
| 6 | Que el driver de Meta pida su token por `resolveFor()` y rutee por `resolveTenantByExternalAccount()` | `packages/inbox/src/drivers/meta/**` | H12 |
| 7 | Lo mismo para Resend y Twilio | `packages/inbox/src/drivers/{email,sms}/**` | H13 |
| 8 | Fila de H17 en las dos tablas que no son de H0 | `CONTRIBUTING.md` §1 · `migrations/README.md` | H1 |

El #5 es de una línea y H6 ya lo dejó preparado con el `??=`. Los #6 y #7 son parte del trabajo
normal de H12 y H13 — por eso este carril tiene que mergear **antes** que ellos.

---

## 11. Criterios observables de "listo"

| # | Criterio |
|---|---|
| 1 | **La prueba que justifica el carril:** dos tenants conectan el mismo proveedor con credenciales distintas, y cada uno resuelve la suya. Automatizada |
| 2 | Un tenant **no** puede leer ni resolver la integración de otro. Automatizada, con dos tenants reales |
| 3 | El secreto **nunca** sale por HTTP: la respuesta de la API trae huella, no valor. Prueba que serializa el objeto completo y busca el texto claro |
| 4 | El secreto **nunca** aparece en un log ni en `last_error` ni en `integration_events.detail` |
| 5 | Sin `INTEGRATIONS_KEY`, guardar **lanza**. No guarda en claro |
| 6 | Un ciphertext alterado en un byte **falla al descifrar** (GCM), no devuelve basura |
| 7 | Rotar la llave: se cifra con la v2, se sigue leyendo lo de la v1, y el comando re-cifra por lotes sin downtime |
| 8 | `verify()` de un proveedor con credencial mala deja `status='error'` con motivo, y la pantalla lo enseña arriba |
| 9 | El repaso periódico detecta un token caducado y cambia el estado **sin borrar la fila** |
| 10 | `resolveTenantByExternalAccount()` con una cuenta desconocida devuelve `null`, y quien llama ignora y registra — **nunca** toma el primero |
| 11 | La misma cuenta externa **no** se puede conectar a dos empresas: el índice único lo impide y hay prueba del `23505` |
| 12 | Sin integración y con respaldo apagado, el error dice **qué** conectar y **dónde**, no "algo falló" |
| 13 | El respaldo de plataforma está **apagado por defecto** y es imposible de encender para `evolution`, `twilio` y `meta` |
| 14 | Cuando se usa respaldo de plataforma, la pantalla lo dice y la bitácora lo registra |
| 15 | Revocar deja la fila en `revoked` y deja de rutear webhooks de inmediato |
| 16 | `node scripts/ownership-gate.mjs` y `--check-overlap` en verde |

---

## 12. Prompt de arranque

```
ANTES DE ESCRIBIR NADA — freno duro. Verifica ARCHIVOS, no directorios: los directorios de
packages/ existen desde el stub de H1 y no prueban nada.

  test -f packages/db/ports.ts \
    && test -f packages/db/src/tenant-db.ts \
    && test -f packages/tenancy/src/services/context.ts \
    && test -f packages/tenancy/src/middleware/tenant.ts \
    && test -f migrations/010_tenancy.sql \
    && echo LISTO || echo "ESPERA — falta que mergee H1 o H2"

Si falta alguno, NO crees estructura, NO instales dependencias y NO escribas migraciones.
Usa el tiempo para leer tu handoff y los handoffs de H12 y H13, que son tus clientes.

Trabaja SIEMPRE desde /Volumes/FRAGUA/CLAUDE CODE/PLATAFORMA-h17-integraciones. Si no existe:
  git worktree add "/Volumes/FRAGUA/CLAUDE CODE/PLATAFORMA-h17-integraciones" -b h17-integraciones origin/main
  cd "/Volumes/FRAGUA/CLAUDE CODE/PLATAFORMA-h17-integraciones" && npm ci
No hagas checkout ni switch en otro directorio.

Vas a construir H17 — las integraciones por tenant de ABRAXA Plataforma: las credenciales de
canal dejan de ser variables del proceso y pasan a ser filas cifradas por empresa.

Lee primero, completo:
  docs/handoffs/H17-integraciones.md   (tu handoff)
  docs/handoffs/README.md              (el contrato de no colisión)
  docs/handoffs/H12-meta.md §4         (lo que Meta exige POR NEGOCIO)
  docs/handoffs/H13-email-sms.md §4-5  (dominio verificado y A2P, POR NEGOCIO)
  .env.example  líneas 44-52           (las ocho variables globales que reemplazas)
  packages/db/ports.ts                 (el estilo del contrato que vas a escribir)

POR QUÉ EXISTES, en una frase: hoy dos clientes comparten el mismo WhatsApp.

.env.example:44-51 tiene ocho variables de canal y ninguna tiene dimensión de tenant. El
driver de WhatsApp ya las lee así — packages/inbox/src/drivers/whatsapp/evolution.ts:225-226
en la rama h6-inbox:
    baseUrl ??= e.EVOLUTION_API_URL ?? 'http://127.0.0.1:8080';
    apiKey  ??= e.EVOLUTION_API_KEY ?? '';
Fíjate en el `??=`: el driver ACEPTA que se las pasen y sólo cae al entorno si nadie lo hace.
H6 dejó el enchufe puesto. Eres tú. Por eso no necesitas tocar un solo archivo de packages/inbox.

Y no es abstracto: si dos empresas se dan de alta hoy, comparten instancia de Evolution y en el
peor caso el mismo número. Al cliente de la panadería le llegan las conversaciones de la
clientela de la inmobiliaria. Es el peor fallo posible de un producto multi-cliente.

CINCO COSAS QUE NO SE NEGOCIAN:

  1. EL SECRETO NO SALE. Ni por HTTP, ni al staff, ni al panel de agencia, ni a un log, ni a
     last_error, ni a integration_events.detail. La API devuelve huella (••••4821 + 8 hex del
     sha256). Escribe la prueba que serializa el objeto completo y busca el texto claro.
     Ojo: Meta y Twilio devuelven el token en el eco de error más seguido de lo que uno espera;
     guarda código, mensaje corto y request_id, nunca el cuerpo crudo.
  2. AES-256-GCM con node:crypto — sin dependencias nuevas (regla 4) y con autenticación, para
     que un ciphertext alterado falle en vez de dar basura. NO uses pgcrypto: pgp_sym_encrypt
     mete la llave en el texto del statement y ésa acaba en pg_stat_statements y en el
     explorador de logs de Supabase. Cifrado en la base con la llave en el log de al lado no es
     cifrado.
  3. key_version DESDE EL DÍA UNO. Rotar sin versión obliga a un big-bang. Con versión: llave 2
     para lo nuevo, llave 1 para leer lo viejo, y un comando que re-cifra por lotes.
  4. FAIL-CLOSED SIN LLAVE. Sin INTEGRATIONS_KEY, seal() y open() LANZAN. Nunca guardan en
     claro "por ahora". Es el criterio de proxyVerified() en
     packages/tenancy/src/middleware/proxy.ts:42.
  5. EL RESPALDO DE PLATAFORMA ESTÁ APAGADO POR DEFECTO y es IMPOSIBLE de encender para
     evolution, twilio y meta — compartir instancia es compartir el número. Sólo resend lo
     permite, y cuando se usa, la pantalla lo dice y la bitácora lo registra. Un respaldo
     silencioso es exactamente cómo se llega a producción con dos clientes en el mismo número
     sin que nadie lo haya decidido.

Y dos que se olvidan siempre:
  · verify() de verdad, con una llamada barata de sólo lectura al proveedor, al conectar y en un
    repaso periódico. "Capturado" no es "conectado": el emprendedor pega un token, ve palomita
    verde, y tres días después nadie le contestó a nadie. Registra la cola con registerQueue()
    desde TU index — apps/worker/src/index.ts dice textual que no se toca.
  · Ruteo inverso: Meta manda TODAS las páginas al mismo webhook. Necesitas ir del id de página
    al tenant, y devolver null cuando no lo conoces significa "ignora y registra", nunca "usa el
    primero que encuentres".

Trabajas SÓLO en packages/integrations/** y apps/web/app/(app)/ajustes/integraciones/**.
Migraciones 140–149. NO edites packages/inbox/ ni packages/db/ports.ts: tu IntegrationsPort vive
en packages/integrations/src/port.ts, por la misma razón que ContactsPort de H15 (ver
H15-crm.md §9.4). Los ocho enganches que no puedes hacer van anotados en tu PR — tu §10.

packages/integrations es un workspace NUEVO: npm ci exige su nodo en el lockfile o falla antes
del typecheck. Tu entrada trae "lockfile": true SÓLO para eso — aísla ese nodo en un commit
propio, rebasa sobre main antes de abrir el PR, y NO instales ninguna dependencia nueva.

Toda tabla nueva con tenant_id y RLS en la MISMA migración que la crea.

Antes del PR: node scripts/ownership-gate.mjs && npm run typecheck && npm run lint && npm test
Nunca mergees a main. Termina con push a h17-integraciones y gh pr create.

Si algo del handoff está mal o incompleto, dilo y propón el arreglo antes de construir.
```
