# Cómo se construye aquí

ABRAXA Plataforma se está construyendo con **14 conversaciones en paralelo**
sobre un mismo repositorio. Este documento es lo que hace que eso funcione en
vez de terminar en un montón de conflictos.

Léelo completo antes de escribir tu primer archivo. Son cinco reglas.

---

## Las cinco reglas

### 1. Escribe sólo en tu árbol

`.ownership.json` es la ley, y `ownership-gate` la aplica en cada PR. Un
archivo fuera de tu carril falla el PR con el nombre del archivo y el handoff
al que pertenece.

| # | Directorios exclusivos | Migraciones | Rama |
|---|---|---|---|
| **H0** | *ninguno* — sólo `docs/` y `deploy/` | *aplica*, no crea | — |
| **H1** | raíz, `packages/config`, `packages/db`, `.github/`, `scripts/`, stubs | `001`–`009` | `h1-fundacion` |
| **H2** | `packages/tenancy/**` | `010`–`019` | `h2-tenancy` |
| **H3** | `packages/agents/**` | `020`–`029` | `h3-agents` |
| **H4** | `packages/vault/**`, `app/(app)/direccion/**` | `030`–`039` | `h4-vault` |
| **H5** | `packages/ui/**`, `app/layout.tsx`, `app/globals.css`, `app/(app)/layout.tsx`, `tailwind.config.ts` | — | `h5-design-system` |
| **H6** | `packages/inbox/**` **excepto** `src/drivers/{meta,email,sms}`, `app/(app)/bandeja/**` | `040`–`049` | `h6-inbox` |
| **H7** | `packages/onboarding/**`, `app/(onboarding)/**` | `050`–`059` | `h7-ritual` |
| **H8** | `packages/flows/**`, `app/(app)/automatizaciones/**` | `060`–`069` | `h8-flows` |
| **H9** | `packages/work/**`, `app/(app)/tareas/**` | `070`–`079` | `h9-work` |
| **H10** | `packages/billing/**`, `app/(public)/**` | `080`–`089` | `h10-billing` |
| **H11** | `packages/areas/**`, `app/(app)/mapa/**` | `090`–`099` | `h11-areas` |
| **H12** | `packages/inbox/src/drivers/meta/**` | `100`–`104` | `h12-meta` |
| **H13** | `packages/inbox/src/drivers/{email,sms}/**` | `105`–`109` | `h13-email-sms` |
| **H14** | `apps/web/app/(admin)/**` | `110`–`119` | `h14-admin` |

> **La rama tiene que llamarse exactamente igual que la clave de
> `.ownership.json`.** El gate deriva de ahí quién eres.

### 2. Numera migraciones sólo en tu rango

Jamás salgas de tu bloque de diez. Ver [`migrations/README.md`](migrations/README.md).

### 3. No toques el cableado central

`apps/api/src/packages.ts`, `packages/db/**`, `package.json` raíz, los
`tsconfig`, el `eslint.config.mjs`. **H1 los dejó terminados.**

Este archivo era el punto de colisión número uno del repo: cuatro
conversaciones iban a crear cada una su propio `packages/db/ports.ts`. Por eso
ya está hecho antes de que empiece nadie.

Si crees que necesitas editar el cableado, casi seguro no lo necesitas:
cuelga tus rutas del `router` que tu paquete ya exporta y aparecen solas.

### 4. No **agregues** dependencias

H1 instaló **todas**. Si falta una, **anótala en tu PR y no la instales**: el
gate falla si `package-lock.json` cambia desde cualquier rama que no sea la de
H1. Dos ramas tocando el lockfile es un conflicto garantizado.

> **`npm ci` sí, y es obligatorio.** Tu worktree es un directorio aparte y llega
> sin `node_modules`. `npm ci` instala exactamente lo que dice el lockfile y
> **no lo modifica**, así que no rompe nada. Lo prohibido es `npm install <algo>`
> y `npm update`, que sí lo reescriben.

### 5. Programa contra interfaces, nunca contra implementaciones

Ésta es la que desbloquea todo lo demás.

Los contratos cruzados están en [`packages/db/ports.ts`](packages/db/ports.ts).
Si necesitas algo de otro handoff, usa su *port* — **no esperes su código y no
lo escribas tú**.

```ts
import { usePort, tryPort } from '@abraxa/db';

// H8 manda WhatsApp sin que H6 exista todavía.
await usePort('inbox').send(ctx, { threadId, body: 'Hola' });

// Camino best-effort: H3 sigue funcionando sin bóveda si H4 aún no aterriza.
const prompt = (await tryPort('vault')?.injectIntoPrompt(ctx, base)) ?? base;
```

Si el port no está registrado, `usePort` lanza diciendo **qué handoff falta**.
En tus pruebas, registra un doble:

```ts
registerPort('inbox', { async send() { return { messageId: 'fake' }; }, /* … */ });
```

Y registra el tuyo desde el `index.ts` de **tu** paquete:

```ts
// packages/inbox/src/index.ts
registerPort('inbox', inboxService);
```

---

## Quién pide: `contextoDePeticion()`

> **Ningún router de dominio escribe su propio `contextoDe`. Se importa el
> canónico.**

Es la única regla de este documento que se ganó a golpes. Entre el 2026-07-30 y
el 07-31, **cuatro carriles** escribieron cada uno su propio resolvedor de
contexto a partir de las cabeceras, y **tres salieron mal de la misma manera**:
leían `x-user-email` sin comprobar antes el secreto compartido del BFF, que es
lo único que hace que esa cabecera signifique algo. Uno de los cuatro llegó a
`main` y estuvo sirviendo la bóveda —precios, márgenes, documentos— a cualquiera
con `curl`.

Un carril que se equivoca es un error. Cuatro es un defecto de diseño: el patrón
correcto no existía como pieza importable, así que cada carril lo reconstruía de
memoria. Ahora existe.

```ts
import { contextoDePeticion, responderError } from '@abraxa/db';

router.get('/cosas', (req, res) => {
  void (async () => {
    try {
      const ctx = await contextoDePeticion(req); // ← lo único correcto
      res.json(await listarCosas(ctx));
    } catch (err) {
      responderError(res, err);
    }
  })();
});
```

`contextoDePeticion(req)` hace tres puertas, **en este orden**:

1. **`proxyVerified(req)`**, antes de mirar una sola cabecera de identidad. Sin
   `PROXY_SECRET` en producción está **cerrada** (fail-closed): si un deploy
   pierde la variable, el sistema no reabre la suplantación por header.
2. **Identidad presente.** Sin correo no hay quién; sin slug no hay cuál.
3. **La membresía**, que valida H2 vía `TenancyPort.contextFor()`. El
   `x-tenant-slug` lo manda el navegador y **no se cree**: ese 403 es lo único
   que impide que el cliente A lea los datos del cliente B.

Todo lo que lanza es `PlatformError` del catálogo de `ports.ts`.

Para lo que ocurre **antes** de pertenecer a una empresa —crear la tuya, aceptar
una invitación, arrancar el ritual— hay identidad sin empresa:

```ts
import { correoVerificadoDe } from '@abraxa/db';
const email = correoVerificadoDe(req); // mismo candado, sin resolver tenant
```

**ESLint marca la lectura directa** de `x-user-email`, `x-tenant-slug` y
`x-proxy-secret` fuera de la pieza canónica. No es un recordatorio: falla tu PR.
La implementación vive en `packages/db/src/http/` y es de `h0-integracion`; si
crees que le falta un caso, **anótalo en tu PR** — no la copies a tu árbol.

---

## Antes de empezar

**1. Verifica que tu ola esté habilitada.** Desde tu worktree:

```bash
test -f packages/db/ports.ts && echo "H1 listo, puedes construir" || echo "ESPERA: H1 no ha mergeado"
```

Si no existe, **no crees estructura, no agregues dependencias, no escribas
migraciones**. Usa el tiempo para leer tu handoff y estudiar el código de
GARDEN que vas a portar.

**2. Instala.** Tu worktree llega sin `node_modules`:

```bash
nvm use && npm ci
```

Tarda unos minutos la primera vez. `npm ci` no toca el lockfile — ver regla 4.

---

## El aislamiento entre clientes

GARDEN dejó **145 de 170 tablas sin RLS**, y el aislamiento colgaba de **447
llamadas a `.eq('tenant_id', …)` escritas a mano**. Basta que una falte para
que un cliente vea los datos de otro. Ese error no se repite aquí, y no por
disciplina: por diseño.

**Todo dato de dominio pasa por `tenantDb(ctx)`.** El filtro no se escribe, así
que no se puede olvidar.

```ts
import { tenantDb } from '@abraxa/db';

const { data } = await tenantDb(ctx).from('threads').select('*').eq('status', 'open');
```

- `insert` / `upsert` **estampan** `tenant_id`, pisando lo que venga en el
  payload. Un cuerpo de la red con el `tenant_id` de otra empresa muere ahí.
- `update` **quita** `tenant_id` del patch: una fila no se muda de empresa.
- El cliente crudo de Supabase está **prohibido por ESLint** fuera de
  `packages/db`.

Para registrar tus tablas, declara el módulo dentro de **tu** paquete:

```ts
// packages/inbox/src/tables.d.ts
declare module '@abraxa/db/tables' {
  interface DomainTableRegistry {
    threads: true;
    messages: true;
    channels: true;
  }
}
```

Sin ese paso el compilador te frena, y es a propósito.

`adminDb()` existe para lo que legítimamente no puede estar aislado: dar de
alta un tenant, y las tablas globales (`app.users`, `app.plans`,
`app.industry_templates`, `app.billing_events`). ESLint lo prohíbe dentro de
`routes/` y `services/`. Si lo usas en otro lado, deja escrito por qué.

**Y el `ctx` que le pasas tiene que venir de `contextoDePeticion(req)`.**
`tenantDb(ctx)` filtra impecablemente por el `tenantId` que le den: si el
contexto se armó con una cabecera que nadie verificó, la red de abajo aísla a la
empresa equivocada. Ver la sección *Quién pide* más arriba.

---

## Errores

Un solo tipo cruza la frontera entre paquetes:

```ts
import { PlatformError } from '@abraxa/db';

throw new PlatformError('BUDGET_EXCEEDED', 'El tenant se pasó de su límite mensual');
```

`apps/api` lo traduce a HTTP con su status. `retryable` distingue lo transitorio
(429, 5xx del proveedor) de lo permanente — el motor de H8 lo usa para decidir
si pausa la corrida o la mata.

---

## Cómo está armado el repo

```
apps/
  api/      Express · gateway. Bundleado con esbuild a un solo .mjs
  web/      Next.js 14 App Router
  worker/   pg-boss
packages/
  config/  db/                            ← H1
  tenancy/ agents/ vault/ ui/ inbox/
  onboarding/ flows/ work/ billing/ areas/ ← un handoff cada uno
migrations/
scripts/    ownership-gate · migrate
```

**Los paquetes no se compilan.** Se consumen como fuente TypeScript
(`exports` apunta a `./src/index.ts`); `esbuild` los mete al bundle de la API y
Next los transpila con `transpilePackages`. Nadie mantiene un `dist/` por
paquete, ni pelea con extensiones `.js` en los imports, ni con orden de
compilación entre doce paquetes. Multiplicado por 14 carriles, eso valía días.

Consecuencia práctica: los imports relativos van **sin extensión**
(`./tenant-db`, no `./tenant-db.js`).

---

## Comandos

```bash
npm run dev:api          # tsx watch
npm run dev:web          # next dev
npm run dev:worker

npm run typecheck        # node + ui + web
npm run lint
npm test
npm run build            # api (esbuild) + worker + web (next)

npm run migrate:status
npm run migrate

node scripts/ownership-gate.mjs                  # lo mismo que CI, en 2 segundos
node scripts/ownership-gate.mjs --check-overlap  # el mapa completo
```

Node **22** (`.nvmrc`). CI corre en 22 y `npm ci` desde cero.

---

## Antes de abrir el PR

1. `node scripts/ownership-gate.mjs` — te dice exactamente lo que dirá CI.
2. `npm run typecheck && npm run lint && npm test && npm run build`.
3. Los criterios observables de tu handoff, **uno por uno con evidencia real**.
   Salida de comando, id de fila, captura. "Lo probé" no es evidencia.
4. Las dependencias que te faltaron, anotadas — no instaladas.
