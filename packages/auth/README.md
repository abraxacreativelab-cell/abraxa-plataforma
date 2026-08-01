# @abraxa/auth — H18 · Identidad

Quién entra a ABRAXA, con qué empresa, y por qué el navegador no puede mentir sobre
ninguna de las dos cosas.

## Lo que resuelve

Diez invitados entran con diez cuentas de Google en el mismo minuto. Cada uno queda con
**su propia empresa** y **nunca ve la de otro**. Eso es todo el carril; lo demás es
comodidad.

## Dónde vive cada cosa

| Pieza                  | Archivo                                        | Runtime     |
| ---------------------- | ---------------------------------------------- | ----------- |
| Handler de NextAuth    | `apps/web/app/api/auth/[...nextauth]/route.ts` | Node        |
| `authOptions`          | `apps/web/app/api/auth/opciones.ts`            | Node        |
| Transporte BFF→API     | `apps/web/app/api/_auth/transporte.ts`         | Node        |
| Sellado de cabeceras   | `apps/web/app/api/_auth/cabeceras.ts`          | Edge + Node |
| **El middleware**      | `apps/web/middleware.ts`                       | Edge        |
| Pantalla de cuenta     | `apps/web/app/(app)/ajustes/page.tsx`          | Node        |
| Lógica pura            | `packages/auth/src/**`                         | cualquiera  |
| Pruebas puras          | `packages/auth/src/*.test.ts`                  | —           |
| Pruebas que tocan Next | `apps/web/src/*.test.ts`                       | —           |

## `packages/**` no puede alcanzar los tipos de `next`

Es la regla del repo que nadie había escrito, y este carril la descubrió a golpes.

`node_modules/next/index.d.ts` empieza con `/// <reference types="./types/global" />`, y
`next/types/global.d.ts:22` declara **globalmente**:

```ts
declare namespace NodeJS {
  interface ProcessEnv {
    readonly NODE_ENV: 'development' | 'production' | 'test';
  }
}
```

En cuanto **un** archivo del proyecto de TypeScript de Node —`tsconfig.json`, que incluye
`packages/*/src/**/*.ts`— resuelve el módulo `next`, directamente o a través de
`next-auth`, `process.env.NODE_ENV` queda de **sólo lectura para todo el programa**. Y
nueve carriles le escriben en sus pruebas, en quince archivos:

```
packages/agents/src/http/proxy-verified.test.ts   packages/agents/src/routes.test.ts
packages/billing/src/{checkout,gateway,store,webhook}.test.ts
packages/crm/src/http/proxy-verified.test.ts      packages/crm/src/routes.test.ts
packages/db/src/http/{proxy-verified,tenant-context}.test.ts
packages/inbox/src/routes/index.test.ts           packages/onboarding/src/routes.test.ts
packages/tenancy/src/middleware/proxy.test.ts     packages/vault/src/http/context.test.ts
packages/work/src/routes.test.ts
```

Medido, con `scripts` reproducible en el PR: con las tres pruebas de este carril dentro de
`packages/auth/src/`, `npm run typecheck` daba **67 errores** en esos quince archivos
**ajenos** — 57 `TS2540: Cannot assign to 'NODE_ENV'` y 10 `TS2704: The operand of a
'delete' operator cannot be a read-only property` (el `delete process.env.NODE_ENV` de sus
`afterEach`). Con ellas en `apps/web/src/`: **0**.

Una prueba de este carril rompía la compilación de otros nueve sin tocarles una línea.

El arreglo es de sitio, no de código: las tres viven en `apps/web/src/`.

| Prueba                             | Por qué toca Next                                   |
| ---------------------------------- | --------------------------------------------------- |
| `apps/web/src/aislamiento.test.ts` | `next/server`, `next-auth/jwt` y el middleware real |
| `apps/web/src/sesion.test.ts`      | `authOptions`, que importa `next-auth`              |
| `apps/web/src/matcher.test.ts`     | `config` del middleware                             |

Funciona sin configurar nada porque las dos piezas ya estaban puestas:

- **vitest ya las recoge.** `vitest.config.ts` incluye `apps/*/src/**/*.test.ts`.
- **`tsc` las revisa con los tipos correctos.** `apps/web/tsconfig.json` incluye `**/*.ts`
  y es una app de Next, así que ahí los tipos de Next son bienvenidos. El proyecto de Node
  no incluye `apps/web`.

`packages/auth/src/*.test.ts` se queda con lo puro, que se prueba en milisegundos y sin un
solo `.d.ts` de por medio.

**Si escribes una prueba nueva de este carril**: si importa algo de `next`, `next-auth` o
`apps/web/`, va en `apps/web/src/`. Si no, en `packages/auth/src/`.

## Por qué este paquete no tiene `package.json`

No es un workspace de npm y es a propósito, aprobado por el orquestador:

- **vitest ya lo recoge.** El patrón de `vitest.config.ts` es
  `packages/*/src/**/*.test.ts`, que no mira si hay `package.json`.
- **`tsc` ya lo revisa.** `tsconfig.json` incluye `packages/*/src/**/*.ts`.
- **`apps/web` lo consume por ruta relativa** (`../../packages/auth/src/…`). Next lo
  compila porque `next.config.mjs` declara `transpilePackages`, y eso enciende
  `shouldIncludeExternalDirs` en su configuración de webpack —
  `node_modules/next/dist/build/webpack-config.js:654` — que es lo que hace que los
  archivos de fuera de `apps/web` pasen por el loader de TypeScript.
- **Añadirlo movería `package-lock.json`.** Tres carriles tenían la llave del lockfile
  el mismo día. Mover el lockfile hoy da un conflicto garantizado y bloquea a los otros
  dos por una línea que no cambia el comportamiento de nada.

**Pendiente post-demo:** promoverlo a workspace (`packages/auth/package.json` con
`"name": "@abraxa/auth"`), añadirlo a `transpilePackages` y sustituir las rutas relativas
por `@abraxa/auth`. Es mecánico y toca `package-lock.json`, `apps/web/package.json` y
`apps/web/next.config.mjs`, ninguno de este carril.

## Por qué el sellado de cabeceras NO está aquí

`eslint.config.mjs` prohíbe escribir a mano `x-user-email`, `x-tenant-slug` y
`x-proxy-secret` en todo `packages/*` — es la regla que impide que un quinto carril
reescriba `contextoDe` — y exime `apps/web/**` con esta razón textual: «el BFF es quien
PONE la cabecera; es el único lugar del sistema donde eso es correcto». Meter el sellado
en un paquete y esquivar la regla concatenando cadenas habría sido saltarse una
protección del repo para quedar más ordenado.

## El contrato con los demás carriles

```ts
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/opciones';

const s = await getServerSession(authOptions);
s?.user?.email; // el correo que verificó Google
s?.user?.tenantSlug; // el slug de la empresa, o null si todavía no tiene
s?.user?.tenantName; // el nombre de esa empresa
s?.user?.motivoSinEmpresa; // por qué no la tiene, cuando no la tiene
```

`getServerSession()` **sin** `authOptions` devuelve una sesión sin `tenantSlug`: los
callbacks viven en `authOptions` y sin ellas NextAuth usa los suyos, que sólo saben de
`name`, `email` e `image`.

Quien no quiera acoplarse al módulo puede pedirlo por HTTP con la cookie de la petición
—es el camino de H7—:

```
GET /api/auth/session      →  { "user": { "email": …, "tenantSlug": … }, "expires": … }
```

Las dos formas pasan por el mismo `callbacks.session`. `apps/web/src/sesion.test.ts` fija esa forma.

## Variables de entorno

| Variable               | Obligatoria      | Para qué                                                                                                                  |
| ---------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`     | sí               | el cliente OAuth Web                                                                                                      |
| `GOOGLE_CLIENT_SECRET` | sí               | su secreto                                                                                                                |
| `NEXTAUTH_URL`         | sí               | `https://mi.abraxa.club`. De aquí sale la URI de redirección y el prefijo `__Secure-` de la cookie                        |
| `NEXTAUTH_SECRET`      | sí               | firma la cookie de sesión                                                                                                 |
| `PROXY_SECRET`         | sí en producción | acredita al BFF ante la API. Sin él, el invitado entra y no ve un solo dato                                               |
| `API_BASE_URL`         | no               | dónde vive `apps/api`. Por defecto `http://localhost:3100`                                                                |
| `AUTH_ALLOWED_EMAILS`  | **no**           | allowlist. **Vacía = cualquier cuenta de Google**, que es lo que un evento necesita. Puesta, cierra la puerta a esa lista |

`AUTH_ALLOWED_EMAILS` es la única que no está en `.env.example` (que es de H1). Es
opcional y hoy tiene que estar VACÍA.

La URI de redirección que hay que tener registrada en Google Cloud Console es exactamente:

```
https://mi.abraxa.club/api/auth/callback/google
```

`diagnosticoDeIdentidad()` de `entorno.ts` dice, en español, qué falta y por qué.

## La ruta `/api/auth/*` no se mueve

nginx en producción tiene `location ^~ /api/auth/ → 3041 (Next)` **antes** de
`location /api/ → 3040 (Express)`. Montar NextAuth en otra ruta manda el callback de
Google a Express, que contesta 404 — después de que el invitado ya aceptó el permiso.

## Cómo se prueba el aislamiento sin base de datos

`empresaDe()` recibe un `Transporte` inyectado y `api-falsa.ts` implementa una `apps/api`
de mentira con las reglas de verdad: el alta idempotente por slug **para el mismo dueño**
y CONFLICT si es de otro. `apps/web/src/aislamiento.test.ts` levanta dos invitados y comprueba las dos
formas de romperlo — acabar en la misma empresa, y leer la de otro con una cabecera
forjada. La segunda corre contra `apps/web/middleware.ts` de verdad, con una cookie
cifrada por `next-auth/jwt` y aplicando las cabeceras como las aplica Next por dentro.
