# H18 — Identidad: NextAuth, sesión y el puente BFF→API

> **Ola 4.** Corre en paralelo con H16 y H17. Requiere H1, H2 y H5 mergeados.
> **Sin ti no hay producto: hoy nadie puede iniciar sesión.**
> Rama: `h18-identidad` · Migraciones: `150`–`159`
> Directorios: `packages/auth/**`, `apps/web/app/api/**` y `apps/web/app/(app)/ajustes/**`
> (excepto `ajustes/plan` y `ajustes/integraciones`)
> Worktree: `/Volumes/FRAGUA/CLAUDE CODE/PLATAFORMA-h18-identidad`

---

## 1. Contexto

Todo el producto está construido sobre un `TenantContext` que sale de una **sesión verificada**.
Los 15 carriles anteriores programaron contra esa premisa, con cuidado y bien.

Esa sesión no existe. Ni una línea.

Tú la construyes: entrar con Google o con un link por correo, que el servidor sepa quién eres, y
que ese "quién eres" llegue a la API por un puente que nadie pueda falsificar.

**No eres un carril de identidad completo** —no hay SSO, ni SAML, ni 2FA, ni gestión de
dispositivos— y no debe serlo. Es **un** proveedor social y **un** link por correo. El alcance
acotado es parte del encargo.

---

## 2. El hueco, con archivo y línea

### 2.1 La función que devuelve `null`

`apps/web/app/(app)/direccion/_lib/session.ts`, al final del archivo:

```ts
async function correoDeLaSesion(): Promise<string | null> {
  return null;
}
```

Con su comentario, que es de las cosas más honestas del repo:

> *Cuando H5 monte next-auth, esto pasa a ser `(await getServerSession())?.user?.email`. Hoy
> devuelve null y la pantalla lo dice. Lo que NO hace es leer un header del navegador: eso
> convertiría el aislamiento entre clientes en una sugerencia.*

H4 hizo lo correcto: no se inventó una sesión. Y el mismo archivo dice quién falta:

> *Tampoco existe todavía la sesión de next-auth (es del shell de H5) ni una ruta BFF en
> `apps/web/app/api/**`, **que no está asignada a ningún handoff** en `.ownership.json`.*

H5 mergeó (PR #5) y no la montó — no estaba en su alcance escrito. **Nadie la tenía.** Ahora sí:
la tienes tú, y `apps/web/app/api/**` ya es tuyo en el mapa de propiedad.

### 2.2 El puente existe, verificado y probado — del lado que recibe

`packages/tenancy/src/middleware/tenant.ts` espera tres cosas:

| Header | De dónde debe venir |
|---|---|
| `x-proxy-secret` | del BFF, comparado con `timingSafeEqual`, **fail-closed en producción** |
| `x-user-email` | de la sesión verificada server-side, **nunca** de un header del cliente |
| `x-tenant-slug` | del navegador, y **no se confía**: `contextFor()` lo valida contra `app.memberships` |

`proxyVerified()` está portado de GARDEN, probado, y es correcto. **Le falta el otro extremo.**
Hoy nadie manda esos headers, porque el BFF que los debía poner no está escrito. La mitad que
recibe está terminada; la mitad que emite es tuya.

> **Dónde vive, desde el 2026-07-31 (PR #16).** La pieza canónica está en `@abraxa/db`, no en
> `@abraxa/tenancy`:
>
> ```ts
> import { contextoDePeticion, correoVerificadoDe, responderError } from '@abraxa/db';
> ```
>
> `contextoDePeticion(req)` corre `proxyVerified()` **antes** de mirar una sola cabecera de
> identidad y resuelve la membresía por `usePort('tenancy')`. Para tus rutas de identidad **sin**
> empresa —alta, invitación, ritual— usa `correoVerificadoDe(req)`.
> `packages/tenancy/src/middleware/proxy.ts` sigue re-exportando `proxyVerified` por
> compatibilidad, pero **no escribas tu propia copia**: cuatro carriles lo hicieron y tres
> salieron mal igual. **ESLint marca la lectura directa** de `x-user-email`, `x-tenant-slug` y
> `x-proxy-secret` fuera de la pieza canónica, y falla tu PR. Ver
> [CONTRIBUTING.md](../../CONTRIBUTING.md) y `docs/handoffs/README.md`.

### 2.3 El incidente que define tu carril

`H0-orquestador.md §6`, entrada del 2026-07-31:

> `packages/agents/src/routes.ts:34-48` armaba el `TenantContext` con `x-user-email` **crudo**.
> Inofensivo sólo porque `usePort('tenancy')` devuelve 501; el merge del PR #6 lo convertía en
> **escalada de privilegios entre clientes**.

Se cerró antes de que se activara. **Tú eres quien enciende esa vía.** El día que tu BFF empiece
a mandar `x-user-email`, cualquier lugar que lo lea sin `proxyVerified()` se vuelve explotable de
inmediato. Léelo entero antes de escribir tu primera línea: es tu carril el que arma el detonador
que ya alguien tuvo que desactivar una vez.

### 2.4 Lo que ya está resuelto y no vas a reescribir

| Pieza | Dónde | Qué hace |
|---|---|---|
| `canSignIn(email)` | `packages/tenancy/src/services/context.ts:176-196` | Doble puerta, **fail-closed**: allowlist del equipo o membresía activa. Un error de red devuelve `false`, jamás `true`. Ya tiene inyección de dependencias para probarse sin red |
| `primaryTenantSlugFor(email)` | mismo archivo, `:212-215` | A dónde mandar después de entrar. `null` si no tiene empresa (va al Ritual de H7) **y también si tiene varias** (va al selector). Elegir por él sería adivinar |
| `contextFor()` | `:50-91` | El 403 que aísla a los clientes |
| Normalización de correo | `migrations/010_tenancy.sql:35-46` | `app.es_correo()`: minúsculas, sin espacios, con forma de correo. Es un `CHECK` de la base |

Tu trabajo es **llamarlas**, no reimplementarlas.

---

## 3. Alcance

### Sí

1. **NextAuth v4** con **Google** y **magic link** por correo.
2. Sesión **JWT**, resuelta server-side.
3. **El BFF**: la ruta de Next que habla con la API poniendo los tres headers.
4. **Cookie de empresa activa**, escrita sólo tras validar membresía.
5. Pantallas de entrar, salir, "revisa tu correo" y errores de acceso.
6. `/ajustes` — la sección: tu cuenta, tus empresas, cerrar sesión.
7. Aceptar una invitación entrando por primera vez (H2 dejó `app.accept_invitation()`).

### No

- **No** SSO, SAML, 2FA, passkeys, gestión de dispositivos ni sesiones activas. Fuera de alcance
  **a propósito**.
- **No** más de un proveedor social. Uno: Google.
- **No** el alta de la empresa. Es H7 (Ritual) y H10 (checkout). Tú entregas ahí y te quitas.
- **No** el RBAC. Es de H2 y ya está hecho.
- **No** `/ajustes/plan` (H16) ni `/ajustes/integraciones` (H17). Tú haces el `layout` y el índice
  de la sección; esas dos subrutas son de ellos.

---

## 4. Contrato de no colisión

| | |
|---|---|
| **Escribes sólo en** | `packages/auth/**` · `apps/web/app/api/**` · `apps/web/app/(app)/ajustes/**` **excepto** `ajustes/plan` y `ajustes/integraciones` |
| **Migraciones** | `150`–`159`, ni una fuera |
| **Rama** | `h18-identidad` — igual que tu llave en `.ownership.json` |
| **Worktree** | `/Volumes/FRAGUA/CLAUDE CODE/PLATAFORMA-h18-identidad` |
| **No toques** | `apps/web/app/layout.tsx` ni `app/(app)/layout.tsx` (H5) · `packages/tenancy/**` (H2) · `packages/db/**` (H1) · el lockfile |

**Consumes:** `TenancyPort` (H2) — `canSignIn`, `primaryTenantSlugFor`, `contextFor` — contra la
interfaz de `packages/db/ports.ts`.
**Te consumen:** todos. Cada pantalla del producto depende de que `correoDeLaSesion()` deje de
devolver `null`.

### Por qué esto salió de H10

`H10-billing.md §2.4` lo tenía en su lista: *"Login con Google y entrada al Ritual de Fundación"*.
Se saca por una razón mecánica, no de gusto: **`apps/web/app/api/auth/**` es la raíz de las rutas
de API del front.** Un carril de cobro tocándola pone a H10 en el camino de cualquier otro carril
que necesite una ruta de servidor, y el gate de propiedad convierte eso en PRs rojos para gente
que no hizo nada mal.

Separado, H10 se queda con lo suyo —landing, Stripe, webhook— y el punto de contacto entre los
dos es una sola cosa: **después de pagar, el correo lleva a `/entrar` y de ahí al Ritual.**

---

## 5. Modelo de datos

```sql
-- 150_auth.sql

-- El token va HASHEADO, con el mismo criterio que app.invitations.token_hash
-- (012_invitations.sql): un magic link pendiente es una llave que abre una
-- cuenta. Si la tabla se filtra en claro, se filtran todas las llaves vivas.
--
-- tenantless: la identidad existe antes de pertenecer a una empresa. Es la
-- misma razón por la que app.users no lleva tenant_id (010_tenancy.sql:73-75).
CREATE TABLE app.auth_verification_tokens (
  identifier text NOT NULL CHECK (app.es_correo(identifier)),
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  expires    timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app.auth_verification_tokens ENABLE ROW LEVEL SECURITY;

CREATE INDEX auth_verification_tokens_identifier_idx
  ON app.auth_verification_tokens (identifier, created_at DESC);

-- tenantless: vincula una cuenta de proveedor a una persona.
CREATE TABLE app.auth_accounts (
  provider            text NOT NULL,
  provider_account_id text NOT NULL,
  user_email          text NOT NULL REFERENCES app.users(email) ON DELETE CASCADE
                      CHECK (app.es_correo(user_email)),
  -- Si el proveedor afirmó que el correo está verificado. Ver §7.2: sin esto,
  -- vincular por correo es apropiación de cuenta.
  email_verified      boolean NOT NULL DEFAULT false,
  linked_at           timestamptz NOT NULL DEFAULT now(),
  last_login_at       timestamptz,
  PRIMARY KEY (provider, provider_account_id)
);
ALTER TABLE app.auth_accounts ENABLE ROW LEVEL SECURITY;

CREATE INDEX auth_accounts_user_idx ON app.auth_accounts (user_email);

-- tenantless: bitácora de intentos. Los DENEGADOS son los que importan.
CREATE TABLE app.auth_events (
  id         bigserial PRIMARY KEY,
  email      text,
  provider   text,
  outcome    text NOT NULL CHECK (outcome IN ('ok','denied','expired','error')),
  reason     text,
  ip_hash    text,          -- sha256 con sal. La IP en claro es dato personal.
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app.auth_events ENABLE ROW LEVEL SECURITY;
CREATE INDEX auth_events_email_idx ON app.auth_events (email, created_at DESC);
```

**Las tres llevan `-- tenantless:` antes del `CREATE TABLE` y `ENABLE ROW LEVEL SECURITY` en la
misma migración.** El gate (`revisarMigracion`) lo verifica y falla el PR con el nombre de la
tabla.

> **Trampa medida, no teórica:** `revisarMigracion` sólo busca el `-- tenantless:` en las **tres
> líneas inmediatamente anteriores** al `CREATE TABLE` (`scripts/ownership-gate.mjs`, el bucle
> `for (let j = Math.max(0, i - 3); j < i; j++)`). Si lo pones al inicio de un bloque de
> comentario más largo, el gate no lo ve y falla el PR diciendo que a tu tabla le falta
> `tenant_id`. Ponlo **pegado** al `CREATE TABLE` y el resto de la explicación arriba — así está
> escrito el ejemplo de arriba, y por eso.

**No hay tabla de sesiones**, y es una decisión: la estrategia es **JWT**. Una tabla de sesiones
sólo vale la pena cuando hace falta revocar una sesión concreta desde el servidor, y eso está
fuera de alcance (§3). Escríbelo en el encabezado de la migración para que quien lo necesite
mañana sepa que fue una decisión y no un olvido.

---

## 6. El adaptador, y por qué no instalas nada

`apps/web/package.json` ya trae **`next-auth ^4.24.11`** — H1 la instaló. Y ahí se acaban las
facilidades:

| Lo que normalmente se usaría | ¿Instalado? | Qué haces en su lugar |
|---|---|---|
| `nodemailer` (para `EmailProvider`) | **no** | `sendVerificationRequest` propio con **`resend`**, que **sí** está instalado |
| `@next-auth/pg-adapter` | **no** | Un adaptador mínimo tuyo sobre `app.auth_*` |

**No instales ninguna de las dos.** Regla 4 del contrato: dos ramas moviendo versiones de
terceros es un conflicto garantizado.

> **Matiz que sí te toca.** Tu entrada de `.ownership.json` trae `"lockfile": true`, pero **no
> es una licencia para instalar**: es que `packages/auth` es un workspace **nuevo** y `npm ci`
> falla sin su nodo (`Missing: @abraxa/auth@0.1.0 from lock file`) **antes** del typecheck.
> Aíslalo en un commit propio, que sea aditivo, y rebasa sobre `main` justo antes de abrir el PR
> — H15 y H17 también tienen la llave ahora mismo. El orquestador la retira al mergear tu carril.

Y no es un sacrificio: el adaptador que necesitas es corto porque la sesión es JWT. NextAuth v4
exige adaptador **para el proveedor de correo** (tiene que persistir el token de verificación),
no para la sesión.

```ts
// packages/auth/src/adapter.ts — sólo lo que el flujo de verdad llama
createVerificationToken · useVerificationToken
getUserByEmail · getUserByAccount · createUser · linkAccount · getUser · updateUser
```

**Los métodos que no implementas lanzan con un mensaje que dice por qué.** No devuelven `null`
silenciosamente: un adaptador que contesta `null` a `getSessionAndUser` produce un fallo de
autenticación que parece un token vencido y no lo es, y eso son dos horas de depuración de
alguien.

---

## 7. Las siete reglas que no se negocian

### 7.1 El correo es la identidad, y va normalizado antes de comparar

`app.users.email` es la llave primaria y tiene el `CHECK app.es_correo()`: minúsculas, sin
espacios alrededor. El comentario de `migrations/010_tenancy.sql:14-21` explica por qué, y aplica
palabra por palabra a tu carril:

> *Si la base acepta `'Ana@x.com'` y `'ana@x.com'` como dos filas distintas, existe un usuario
> sombra: alguien con membresía que el código no encuentra, o peor, alguien que el código
> encuentra y no debería.*

Google devuelve el correo con la capitalización que el usuario escribió al registrarse.
**Normaliza en el `signIn`, antes de cualquier consulta**, o vas a crear un usuario sombra el
primer día.

### 7.2 Google sin `email_verified` no entra

El perfil de Google trae `email_verified`. Si no es `true`, **se rechaza**.

Sin esa comprobación, cualquiera que registre una cuenta de Google Workspace en un dominio que
controle puede afirmar ser `santiago@abraxa.club` y —como la identidad es el correo— entrar a esa
empresa. Es la vulnerabilidad clásica de "iniciar sesión con", y no la trae NextAuth activada.

Lo mismo aplica al vincular: un proveedor que no verifica el correo **no vincula** a un usuario
que ya existe. Crea una cuenta nueva o rechaza; nunca hereda.

### 7.3 `canSignIn()` decide, y decide fail-closed

En el callback `signIn`, después de normalizar y de verificar `email_verified`:

```ts
if (!(await tenancy.canSignIn(email))) return false;
```

**No la reimplementes ni la "mejores".** Ya es doble puerta y ya es fail-closed
(`context.ts:176-196`): un error de red, un timeout o una respuesta rara devuelven `false`, nunca
`true`. Registra el `denied` en `auth_events` con su motivo — es lo único que contesta "¿por qué
no me deja entrar?" sin adivinar.

### 7.4 El magic link es una credencial al portador

Cuatro candados, y ninguno es opcional:

1. **15 minutos de vida.** El valor por defecto de NextAuth es 24 horas: un link que sigue vivo
   un día entero en la bandeja de alguien es una llave abandonada.
2. **Un solo uso.** `useVerificationToken` **borra la fila y devuelve lo borrado en la misma
   sentencia** (`DELETE … RETURNING`). Leer y luego borrar deja una ventana en la que dos
   peticiones simultáneas consumen el mismo token.
3. **Hasheado en reposo** (§5). La base guarda el sha256; el claro sólo viaja en el correo.
4. **Con límite de intentos** por correo y por IP. Sin él, pedir mil links a la misma dirección
   es gratis, y quien recibe los mil es el usuario.

Y uno de producto: el correo del link se manda con **Resend**, con `APP_BASE_URL` como origen del
enlace. Si el envío falla, **la pantalla lo dice**. Un "revisa tu correo" cuando el correo nunca
salió es la peor pantalla posible: el usuario espera, revisa spam, se rinde, y nadie se entera.

### 7.5 El BFF pone los headers — y **borra** los que trae el navegador

Es la regla más importante de tu carril entero.

```
navegador → ruta de Next (server) → API Express
                    ↓
   1. lee la sesión con getServerSession()  ← la ÚNICA fuente de x-user-email
   2. lee la empresa activa de SU PROPIA cookie ← nunca de un header del cliente
   3. BORRA del request entrante x-user-email, x-tenant-slug y x-proxy-secret
   4. pone los tres, suyos, con el secreto
```

**El paso 3 es el que se olvida.** Un proxy que reenvía las cabeceras del cliente y luego añade
las suyas puede terminar mandando dos `x-user-email`; qué gana depende de la librería HTTP, y esa
lotería es exactamente el agujero de §2.3, reabierto con más pasos. Construye el objeto de
headers **desde cero** — nunca `{...req.headers, ...mios}` — y escribe la prueba que manda un
`x-user-email` falso desde el navegador y verifica que el que llega a la API es el de la sesión.

Los nombres están en `HEADER` de `@abraxa/config` (`packages/config/src/constants.ts:24-29`).
**Úsalos desde ahí**, no los escribas a mano: el día que uno cambie, cambia en un solo lugar.

### 7.6 Sin `PROXY_SECRET` en producción no hay puente

`proxyVerified()` ya es fail-closed del lado que recibe. Sé simétrico: si tu BFF no tiene
`PROXY_SECRET` y `NODE_ENV === 'production'`, **falla al arrancar con un mensaje claro**, no en la
primera petición de un usuario.

Igual con `NEXTAUTH_SECRET`. NextAuth v4 en desarrollo genera uno solo; en producción, sin él, las
sesiones se invalidan en cada reinicio y el síntoma —"me saca cada rato"— no apunta a la causa ni
de lejos.

### 7.7 La empresa activa vive en una cookie del servidor, validada

El `x-tenant-slug` viaja al final, sí, y `contextFor()` lo valida contra `app.memberships` — ése es
el 403 que aísla a los clientes y ya está hecho.

Aun así, tu BFF **no lo toma de un header ni de un query param del navegador**: lo toma de una
cookie `httpOnly`, `sameSite=lax`, `secure` en producción, que **sólo se escribe después de haber
llamado a `contextFor()` con éxito**. Dos capas que no dependen la una de la otra. Y al cerrar
sesión, la cookie se borra: dejar la empresa activa después de salir es cómo la siguiente persona
que abra ese navegador ve el nombre de un negocio que no es suyo.

---

## 8. Las pantallas

Todas con el design system de H5. **No inventes tokens ni metas hex.**

| Ruta | Qué |
|---|---|
| `/entrar` | Google + campo de correo. **Un solo botón primario**: quien llega aquí quiere entrar, no elegir arquitectura |
| `/entrar/revisa-tu-correo` | Confirmación honesta, con el correo al que se mandó y un reenviar con cuenta regresiva |
| `/entrar/error` | Traduce los códigos de NextAuth a español y a algo accionable. `AccessDenied` ≠ `Verification` ≠ `OAuthAccountNotLinked`, y los tres se arreglan distinto |
| `/ajustes` | Tu cuenta, tus empresas, cerrar sesión. El `layout` de la sección es tuyo; `plan` e `integraciones` son de H16 y H17 |
| `/invitacion/[token]` | Aceptar una invitación. Llama a `app.accept_invitation()`, que H2 ya dejó |

**Después de entrar**, `primaryTenantSlugFor()` decide y no lo decides tú:

```
null y sin invitaciones  → /ritual        (H7 lo recibe)
null y con varias        → selector de empresa
un slug                  → escribe la cookie y va al producto
```

### Lo que no puedes tocar y hay que anotar

`<SessionProvider>` va en `apps/web/app/layout.tsx`, que es de **H5**. **No lo edites.**

No te bloquea: con `getServerSession()` en Server Components no hace falta el provider. Sólo lo
necesita un componente de cliente que llame a `useSession()`. **Escribe todo lo tuyo del lado del
servidor** —que además es lo correcto, por lo que dice `session.ts`: si el dato nunca sale del
servidor, no hay header que falsificar— y anota el `SessionProvider` en tu PR para H5, por si
algún día hace falta.

---

## 9. Lo que este carril NO puede hacer solo — para el orquestador

| # | Qué | Dónde | Quién |
|---|---|---|---|
| 1 | Nodo de `packages/auth` en el lockfile (workspace nuevo) | `package-lock.json` | H1 |
| 2 | `'@abraxa/auth'` en `transpilePackages` y en las dependencias del web | `apps/web/next.config.mjs` · `apps/web/package.json` | H1 |
| 3 | **Cambiar `correoDeLaSesion()` para que devuelva la sesión real** | `apps/web/app/(app)/direccion/_lib/session.ts` | H4 — es una línea, y es la que enciende el producto |
| 4 | `<SessionProvider>` en el layout raíz, si algún día hace falta | `apps/web/app/layout.tsx` | H5 |
| 5 | Enlace de "cerrar sesión" y correo del usuario en el shell | `packages/ui/**` | H5 |
| 6 | `AUTH_MAGIC_LINK_TTL_MIN=` y `AUTH_IP_HASH_SALT=` en la plantilla | `.env.example` | H1 |
| 7 | Fila de H18 en las dos tablas que no son de H0 | `CONTRIBUTING.md` §1 · `migrations/README.md` | H1 |

El **#3 es el más importante de los siete**: mientras no entre, tu sesión funciona y las pantallas
de H4 siguen diciendo que no hay sesión. Escríbelo en el PR con el diff exacto para que sea de
copiar y pegar.

---

## 10. Criterios observables de "listo"

| # | Criterio |
|---|---|
| 1 | **De punta a punta:** entrar con Google y ver el producto con datos reales de tu empresa |
| 2 | **De punta a punta:** pedir un magic link, recibirlo, abrirlo y entrar |
| 3 | El mismo correo por Google y por magic link es **la misma cuenta**, no dos |
| 4 | Un perfil de Google con `email_verified: false` **no entra**, y queda en `auth_events` |
| 5 | `Ana@Ejemplo.MX` y `ana@ejemplo.mx` son **la misma persona**: una sola fila en `app.users` |
| 6 | Un correo fuera de la allowlist y sin membresía **no entra** — `canSignIn` decide, no tu código |
| 7 | Un fallo de red consultando la membresía **deniega**, nunca concede |
| 8 | Un magic link usado dos veces falla la segunda. Prueba con dos peticiones **en paralelo**, no en serie |
| 9 | Un magic link de hace 20 minutos falla |
| 10 | En la base **no hay** ningún token de verificación en claro |
| 11 | **La prueba que define el carril:** el navegador manda `x-user-email: victima@otra.com` y lo que llega a la API es el correo de la sesión. Automatizada |
| 12 | Lo mismo con `x-proxy-secret` y con `x-tenant-slug` inyectados desde el cliente |
| 13 | Sin `PROXY_SECRET` en producción, el BFF **no arranca** (no falla en la primera petición) |
| 14 | Sin `NEXTAUTH_SECRET` en producción, **no arranca** |
| 15 | La cookie de empresa se escribe **sólo** tras un `contextFor()` exitoso |
| 16 | Cerrar sesión borra la cookie de empresa **y** la de sesión |
| 17 | Alguien sin empresa acaba en `/ritual`; con varias, en el selector; con una, dentro |
| 18 | Aceptar una invitación desde cero: entra, queda con membresía y con sus grants |
| 19 | Si Resend falla al mandar el link, la pantalla lo **dice** — no muestra "revisa tu correo" |
| 20 | `node scripts/ownership-gate.mjs` y `--check-overlap` en verde |

---

## 11. Prompt de arranque

```
ANTES DE ESCRIBIR NADA — freno duro. Verifica ARCHIVOS, no directorios: apps/web/app existe
desde H1 y no prueba nada.

  test -f packages/db/ports.ts \
    && test -f packages/tenancy/src/services/context.ts \
    && test -f packages/tenancy/src/middleware/proxy.ts \
    && test -f packages/config/src/constants.ts \
    && test -f apps/web/app/layout.tsx \
    && test -f apps/web/app/'(app)'/direccion/_lib/session.ts \
    && echo LISTO || echo "ESPERA — falta que mergee H1, H2, H4 o H5"

Si falta alguno, NO crees estructura, NO instales dependencias y NO escribas migraciones. Usa el
tiempo para leer tu handoff y los tres archivos de los que sale todo tu carril:
packages/tenancy/src/middleware/tenant.ts, .../middleware/proxy.ts y
apps/web/app/(app)/direccion/_lib/session.ts.

Trabaja SIEMPRE desde /Volumes/FRAGUA/CLAUDE CODE/PLATAFORMA-h18-identidad. Si no existe:
  git worktree add "/Volumes/FRAGUA/CLAUDE CODE/PLATAFORMA-h18-identidad" -b h18-identidad origin/main
  cd "/Volumes/FRAGUA/CLAUDE CODE/PLATAFORMA-h18-identidad" && npm ci
No hagas checkout ni switch en otro directorio.

Vas a construir H18 — la identidad de ABRAXA Plataforma: NextAuth con Google y magic link, la
sesión, y el puente BFF→API.

Lee primero, completo:
  docs/handoffs/H18-identidad.md    (tu handoff)
  docs/handoffs/README.md           (el contrato de no colisión)
  docs/handoffs/H0-orquestador.md §6 (el incidente del 2026-07-31 — es TU detonador)
  packages/tenancy/src/middleware/tenant.ts   (los tres headers que tienes que emitir)
  packages/tenancy/src/middleware/proxy.ts    (la mitad que recibe, ya hecha y probada)
  packages/tenancy/src/services/context.ts    (canSignIn y primaryTenantSlugFor — LLÁMALAS)
  apps/web/app/(app)/direccion/_lib/session.ts (la función que devuelve null)

POR QUÉ EXISTES: todo el producto está construido sobre un TenantContext que sale de una sesión
verificada, y esa sesión no existe. En session.ts, `correoDeLaSesion()` es literalmente
`return null;`. Ese mismo archivo dice que la ruta BFF en apps/web/app/api/** "no está asignada
a ningún handoff". Ya lo está: es tuya.

LEE PRIMERO EL INCIDENTE. H0 §6, 2026-07-31: packages/agents/src/routes.ts:34-48 armaba el
TenantContext con x-user-email CRUDO. Era inofensivo sólo porque usePort('tenancy') devolvía
501, y el merge del PR #6 lo convertía en escalada de privilegios entre clientes. Se desactivó a
tiempo. TÚ ERES QUIEN ENCIENDE ESA VÍA: el día que tu BFF empiece a mandar x-user-email,
cualquier lugar que lo lea sin proxyVerified() se vuelve explotable de inmediato.

NO INSTALES NADA. next-auth ^4.24.11 ya está en apps/web/package.json. nodemailer NO está y
@next-auth/pg-adapter tampoco. En su lugar: sendVerificationRequest propio con `resend` (que sí
está instalado) y un adaptador mínimo tuyo. El adaptador es corto porque la sesión es JWT:
NextAuth v4 exige adaptador para el proveedor de CORREO (persistir el token), no para la sesión.
Regla 4: si crees que falta una dependencia, anótala en el PR y NO la instales. Tu entrada trae
"lockfile": true sólo para el nodo del workspace nuevo packages/auth, sin el cual npm ci falla
antes del typecheck: aíslalo en un commit propio y rebasa sobre main antes de abrir el PR.

SIETE COSAS QUE NO SE NEGOCIAN (tu §7, léelas completas):
  1. Normaliza el correo ANTES de cualquier consulta. Google devuelve la capitalización que el
     usuario escribió; app.users.email tiene CHECK de minúsculas. Sin normalizar creas un
     usuario sombra el primer día (010_tenancy.sql:14-21 lo explica).
  2. Google sin email_verified === true NO ENTRA. Sin eso, cualquiera con un dominio propio
     afirma ser santiago@abraxa.club y —como la identidad ES el correo— entra a esa empresa.
     NextAuth no lo trae activado.
  3. canSignIn() decide. Ya es doble puerta y ya es fail-closed (context.ts:176-196). No la
     reimplementes ni la "mejores". Registra los denied con su motivo.
  4. El magic link es credencial al portador: 15 min (el default de NextAuth es 24 HORAS), un
     solo uso con DELETE … RETURNING en UNA sentencia, hasheado en reposo, y con límite de
     intentos. Leer-y-luego-borrar deja una ventana en la que dos peticiones consumen el mismo
     token.
  5. EL BFF BORRA los headers del navegador antes de poner los suyos. Nunca
     {...req.headers, ...mios}: construye el objeto desde cero. Un proxy que reenvía y luego
     añade puede mandar DOS x-user-email, y cuál gana depende de la librería HTTP. Es el agujero
     de arriba, reabierto con más pasos. Usa HEADER de @abraxa/config, no strings a mano.
  6. Sin PROXY_SECRET o sin NEXTAUTH_SECRET en producción, el BFF NO ARRANCA. Fallar en la
     primera petición de un usuario en vez de al arrancar es hacer que un error de deploy
     parezca un error del usuario.
  7. La empresa activa vive en una cookie httpOnly que sólo se escribe DESPUÉS de un contextFor()
     exitoso, y se borra al cerrar sesión.

El criterio #11 es el que define el carril: el navegador manda x-user-email: victima@otra.com y
lo que llega a la API es el correo de la sesión. Automatizado, no verificado a mano.

Trabajas SÓLO en packages/auth/**, apps/web/app/api/** y apps/web/app/(app)/ajustes/** EXCEPTO
ajustes/plan (H16) y ajustes/integraciones (H17). Migraciones 150–159.
NO edites apps/web/app/layout.tsx ni app/(app)/layout.tsx: son de H5. No te bloquea —
getServerSession() en Server Components no necesita SessionProvider, y escribir del lado del
servidor es además lo correcto: si el dato nunca sale del servidor, no hay header que falsificar.
Los siete enganches que no puedes hacer van en tu PR — tu §9. El #3 (que correoDeLaSesion()
devuelva la sesión real) es de una línea y es el que enciende el producto: escribe el diff exacto.

Toda tabla nueva con RLS en la MISMA migración, y las cuatro tuyas son tenantless: ponles el
comentario `-- tenantless: <razón>` antes del CREATE TABLE o el gate las rechaza.

Antes del PR: node scripts/ownership-gate.mjs && npm run typecheck && npm run lint && npm test
Nunca mergees a main. Termina con push a h18-identidad y gh pr create.

Si algo del handoff está mal o incompleto, dilo y propón el arreglo antes de construir.
```
