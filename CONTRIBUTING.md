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

### 4. No instales dependencias

H1 instaló **todas**. Si falta una, **anótala en tu PR y no la instales**: el
gate falla si `package-lock.json` cambia desde cualquier rama que no sea la de
H1. Dos ramas tocando el lockfile es un conflicto garantizado.

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

## Antes de empezar: verifica que tu ola esté habilitada

```bash
test -f packages/db/ports.ts && echo "H1 listo, puedes construir" || echo "ESPERA: H1 no ha mergeado"
```

Si no existe, **no crees estructura, no instales nada, no escribas
migraciones**. Usa el tiempo para leer tu handoff y estudiar el código de
GARDEN que vas a portar.

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
