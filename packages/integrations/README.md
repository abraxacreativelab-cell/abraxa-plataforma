# @abraxa/integrations — H17

Las credenciales de canal dejan de ser variables del proceso y pasan a ser
**filas por empresa, cifradas en reposo**.

## Por qué existe, en una frase

Hoy `.env.example:44-51` tiene ocho variables de canal y ninguna tiene dimensión
de tenant. Dos empresas dadas de alta comparten `EVOLUTION_API_KEY`, comparten
instancia y, en el peor caso, **el mismo número de WhatsApp**: al cliente de la
panadería le llegan las conversaciones de la clientela de la inmobiliaria.

## Cómo se usa

```ts
import { useIntegrations } from '@abraxa/integrations';

// La credencial de ESTA empresa. La del tenant siempre gana.
const cred = await useIntegrations().resolveFor(ctx, 'evolution');
crearDriverEvolution({ baseUrl: String(cred.config.baseUrl), apiKey: cred.secret });

// Un webhook de Meta, que llega con el id de página adentro y no dice de quién es.
const dueño = await useIntegrations().resolveTenantByExternalAccount({
  provider: 'meta',
  externalAccountId: entrada.entry[0].id,
});
if (!dueño) return; // ignora y registra. NUNCA "el primero que encuentres".
```

En tus pruebas no esperes a este paquete: `registerIntegrationsPort(doble)`.

## Las cinco reglas que no se negocian

| # | Regla | Dónde vive |
|---|---|---|
| 1 | El secreto **no sale**: ni por HTTP, ni a un log, ni a `last_error`, ni a la bitácora. La API devuelve una **huella** | `src/no-filtra.test.ts` |
| 2 | AES-256-GCM con `node:crypto`. **No `pgcrypto`**: `pgp_sym_encrypt` mete la llave en el texto del statement, y ése acaba en `pg_stat_statements` y en los logs de Supabase | `src/crypto/secret-box.ts` |
| 3 | `key_version` desde el día uno. Se rota agregando `INTEGRATIONS_KEY_2` y corriendo `rotar()`, sin downtime | `src/bin/rotate.ts` |
| 4 | **Fail-closed sin llave**: sin `INTEGRATIONS_KEY`, guardar *lanza*. Nunca guarda en claro "por ahora" | `src/crypto/secret-box.ts` |
| 5 | El respaldo de plataforma está **apagado por defecto** y es **imposible** para `evolution`, `twilio` y `meta` | `src/providers/catalogo.ts` |

Y una que no estaba en el handoff y sale gratis: el sobre se ata a su empresa
con el dato asociado de GCM (`"<tenantId>:<provider>"`), así que **una fila
copiada de una empresa a otra ya no descifra**.

## `verify()` — capturado no es conectado

| Proveedor | Qué se comprueba |
|---|---|
| `evolution` | `GET /instance/connectionState` — que la instancia exista y esté abierta |
| `meta` | `GET /me` — que el token viva **y sea de la página que dice** |
| `twilio` | `GET /Accounts/{sid}.json` — que el SID y el token casen |
| `resend` | `GET /domains/{id}` — que el dominio exista y **esté verificado** |

Se corre al conectar, bajo demanda desde la pantalla, y en un repaso periódico
(`COLA_DE_REPASO`). Cuando falla, el estado pasa a `error` con su motivo y **la
fila no se borra**: revocar es del emprendedor.

## Variables de entorno

| Variable | Para qué |
|---|---|
| `INTEGRATIONS_KEY` | 32 bytes en base64 (`openssl rand -base64 32`). **Obligatoria**: sin ella no se guarda ninguna credencial |
| `INTEGRATIONS_KEY_2` | La llave nueva durante una rotación. Se agrega, se rota por lotes, se retira la vieja |
| `INTEGRATIONS_PLATFORM_FALLBACK` | `true` enciende el respaldo de plataforma **sólo** donde el catálogo lo permite (hoy: `resend`) |
| `RESEND_API_KEY`, `RESEND_FROM_DOMAIN` | El respaldo de correo de la plataforma |

Las cuatro van en `.env.example`, que es de H1 — anotadas en el PR.

## Estructura

```
src/
  port.ts                  el contrato (sólo tipos)
  port-registration.ts     se registra en el registro central de H1
  service.ts               resolver, guardar, verificar, revocar — todo por tenantDb(ctx)
  routing.ts               del webhook al dueño (la única consulta sin contexto, con su razón)
  sweep.ts                 el repaso periódico + el descriptor de la cola
  store.ts                 acceso a datos y la forma de las filas
  events.ts                la bitácora y el filtro que la mantiene limpia
  routes.ts                HTTP, montado en /integrations
  crypto/secret-box.ts     AES-256-GCM, versiones de llave, huella
  crypto/bytea.ts          bytea de Postgres ↔ Buffer, vía PostgREST
  providers/catalogo.ts    los cuatro proveedores, su verify() y su política de respaldo
  providers/sanear.ts      lo que se puede guardar del error de un proveedor, y lo que no
  bin/rotate.ts            rotación por lotes
```

Migraciones `140` (credenciales) y `141` (bitácora). Las dos tablas nacen con
`tenant_id` y RLS en la misma migración que las crea.
