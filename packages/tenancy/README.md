# @abraxa/tenancy

Quién es cada quien, a qué empresa pertenece y qué puede tocar.

| | |
|---|---|
| **Handoff** | H2 |
| **Rama** | `h2-tenancy` |
| **Migraciones** | `010`–`012` |
| **Montado en** | `apps/api` → `/tenants` |
| **Port** | `TenancyPort` de `packages/db/ports.ts` |

---

## Lo único que hay que entender

```
navegador → NextAuth (Google) → BFF verificado server-side → API
                                     ↓
   inyecta x-user-email VERIFICADO (de la sesión, NUNCA de un header
   del cliente) + x-proxy-secret (timingSafeEqual, fail-closed en prod)
                                     ↓
   el x-tenant-slug del navegador NO se confía: se valida contra
   app.memberships
```

`contextFor()` devuelve el contexto o lanza **403**. Ese 403 es lo único que
impide que el cliente A lea los datos del cliente B: `tenantDb(ctx)` filtra por
el `tenantId` que sale de ahí, así que si esta comprobación se equivoca, todo lo
de abajo filtra impecablemente hacia la empresa equivocada.

Está probado en `src/isolation.test.ts`.

---

## Uso desde otro paquete

```ts
import { usePort } from '@abraxa/db';

const tenancy = usePort('tenancy');
const ctx = await tenancy.contextFor({ userEmail, tenantSlug });   // o lanza 403
```

Proteger una ruta por área:

```ts
import { tenantMiddleware, requireArea, requireAreaOperation } from '@abraxa/tenancy';

router.use(tenantMiddleware);
router.get('/reportes', requireArea('finanzas', 'view'), handler);
router.use('/contactos', requireAreaOperation('ventas'));  // GET→view, resto→edit
```

Escuchar el alta de una empresa (**H11**):

```ts
import { onTenantProvisioned, drainTenantEvents } from '@abraxa/tenancy';

onTenantProvisioned(async (e) => {
  await sembrarAreasDelGiro(e.payload.tenantId, e.payload.industryType);
});
// el worker lo llama periódicamente
await drainTenantEvents();
```

---

## Decisiones que no son obvias

**`provision()` es una función de plpgsql, no cinco `insert` de TypeScript.**
PostgREST no expone transacciones. El criterio #1 pide todo-o-nada sobre cinco
escrituras, y eso no se puede cumplir desde supabase-js. En una función de
Postgres la atomicidad se hereda: no hay rollback que escribir mal. Ver
`migrations/011_provision.sql`.

**Idempotente por slug sólo si el dueño coincide.** Si el slug existe y
pertenece a otra persona, `provision()` lanza `CONFLICT` en vez de devolver el
tenant ajeno. H10 confía en esa respuesta para dar acceso a quien acaba de
pagar; devolverle una empresa que no es suya sería el mismo agujero que cierra
el criterio #3, entrando por atrás.

**No hay bypass de super-admin.** GARDEN dejaba entrar a cualquier sub-cuenta a
quien estuviera en `CRM_SUPER_ADMINS`. Portado tal cual, el aislamiento entre
clientes dependería de una variable de entorno. Aquí la ruta normal no tiene ese
camino ni para el staff: quien necesite acceso transversal (H14) llama a
`staffContextFor()`, que está apagada por defecto y marca el contexto.

**El token de invitación se guarda hasheado.** Una invitación pendiente es una
llave que abre una empresa. En claro, una fuga de base de datos entrega todas
las llaves vivas a la vez. Es el mismo patrón que GARDEN ya usaba para sus API
keys.

**Los eventos son filas, no un bus en memoria.** `tenant_provisioned` se escribe
dentro de la misma transacción que crea la empresa. Un bus en memoria se pierde
si el proceso muere entre el COMMIT y el emit, y entonces existe una empresa que
nunca recibió sus áreas.

**No existe `GET /tenants/:slug`.** Sería una superficie de lectura transversal:
un endpoint al que se le pide una empresa por nombre. Lo que no se puede pedir
no se puede filtrar.

---

## Modelo de datos

| Tabla | Migración | |
|---|---|---|
| `app.tenants` · `app.memberships` · `app.area_grants` | 001 (H1) | H2 les agrega FKs y CHECKs |
| `app.users` | 010 | global — la llave es el correo |
| `app.plans` | 010 | global — el modelo de límites, no el cobro |
| `app.invitations` | 010 | token hasheado, una viva por persona y empresa |
| `app.tenant_events` | 010 | outbox transaccional |

Roles: `owner` · `admin` · `member` · `viewer`.
Accesos por área: `view` < `edit` < `admin`. El comodín `'*'` cubre todas.

---

## Rutas

| | |
|---|---|
| `POST /tenants` | alta; el dueño es siempre el de la sesión |
| `GET /tenants/mine` | las empresas del usuario |
| `GET /tenants/current` | la empresa activa, su rol y sus áreas |
| `GET /tenants/quotas` | plan, límites y asientos |
| `GET·PUT·PATCH·DELETE /tenants/members[/…]` | miembros, roles y áreas |
| `GET·POST·DELETE /tenants/invitations[/…]` | invitaciones |
| `POST /tenants/invitations/accept` | aceptar (sin contexto de empresa) |
| `GET /tenants/plans` | catálogo |
| `GET /tenants/internal/has-access` | servidor-a-servidor, para el `signIn` del BFF |

---

## Pruebas

```bash
npm test -- packages/tenancy          # todo lo que no necesita base de datos
```

`pg.test.ts` verifica lo que ninguna prueba en memoria puede: atomicidad,
idempotencia, restricciones y RLS. Necesita un Postgres:

```bash
docker run -d --name pg -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=abraxa_test -p 55432:5432 postgres:16-alpine

TENANCY_TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/abraxa_test \
  npm test -- packages/tenancy/src/pg.test.ts
```

Sin esa variable se salta con un aviso, en vez de fallar.

El doble de `src/testing/fake-postgrest.ts` es **permisivo a propósito**: guarda
las filas de todas las empresas juntas y sólo aplica los filtros que el código
pide. Si una consulta olvidara su `tenant_id`, recibiría las filas del vecino y
la prueba fallaría — que es justo lo que se quiere.

---

## Variables de entorno

| | |
|---|---|
| `PROXY_SECRET` | Secreto compartido BFF↔API. **Sin él, en producción la vía de headers se rechaza.** |
| `AUTH_ALLOWED_EMAILS` | Allowlist del equipo para `canSignIn()`. Vacía en producción = nadie entra sin membresía. |
| `PLATFORM_STAFF_EMAILS` | Acceso transversal de staff. **Vacía por defecto**; no afecta a `contextFor()`. |
| `APP_BASE_URL` | Base de los enlaces de invitación. |
