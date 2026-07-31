# @abraxa/crm — H15

Contactos, identidades por canal, embudo y línea de tiempo.

---

## Por qué existe

Hasta este carril, la plataforma **no tenía una tabla de contactos**.

- H6 declaró `app.threads.contact_id uuid` **sin `REFERENCES`** porque no había a qué apuntar
  (`docs/handoffs/H6-inbox.md:110`).
- Tres nodos de H8 —`assign_owner`, `move_stage`, `add_tag`— y cuatro de sus ocho disparadores
  —`contact_created`, `stage_changed`, `tag_added`, `form_submitted`— no tenían dónde escribir.

Media Ola 3 dependía de esto.

---

## La decisión que lo separa de GARDEN

**Un contacto es una persona. Sus direcciones son filas.**

GARDEN guarda `email` y `phone` como dos columnas planas en `crm_contacts`
(`src/crm/types.ts:66-67`). De ahí salen tres problemas medidos en ese repo:

| Problema | Consecuencia |
|---|---|
| Una persona con dos teléfonos | Son dos contactos. No hay dónde poner el segundo |
| Instagram y Messenger | No caben; viven en `external_ids jsonb`, que ningún índice protege |
| Deduplicación | Un `Set` en memoria sobre todas las filas, y sólo al importar CSV |

Aquí:

```sql
app.contact_identities (tenant_id, contact_id, channel, identifier, …)
UNIQUE (tenant_id, channel, identifier)
```

Dos webhooks simultáneos del mismo número chocan contra **Postgres**, no contra la suerte.

---

## Cómo se consume

```ts
import { useContacts } from '@abraxa/crm';

// H6 · el puente, al llegar un webhook
const { contactId } = await useContacts().resolveByIdentity(ctx, {
  channel: msg.channelType,
  identifier: msg.address,       // sin normalizar; el port lo normaliza
  name: msg.contactName,
});

// H8 · los tres nodos
await useContacts().moveStage(ctx, { contactId, stage: 'contactado' });
await useContacts().assignOwner(ctx, { contactId, ownerEmail: 'ana@abraxa.club' });
await useContacts().addTag(ctx, { contactId, tag: 'vip' });
```

`useContacts()` y no `usePort('contacts')` — el porqué está en
[`src/port-registration.ts`](src/port-registration.ts) y el parche de seis líneas que lo colapsa,
en `docs/handoffs/H15-crm.md` §9. El port **sí** vive en el registro central de H1; sólo la llave
viaja sin tipo.

En tus pruebas no esperes a nadie:

```ts
import { registerContactsPort } from '@abraxa/crm';
registerContactsPort(miDoble);
```

---

## Las cuatro garantías

1. **`resolveByIdentity` es segura ante concurrencia.** El árbitro es el índice único, no un
   `SELECT` previo: el segundo INSERT recibe `23505`, borra su contacto huérfano y relee al
   ganador. Probado con dos llamadas en `Promise.all`.

2. **Fusionar no borra.** El perdedor queda con `merged_into` apuntando al ganador, y
   `resolveByIdentity` sigue la cadena. Un hilo de WhatsApp de hace tres meses nunca abre una
   tarjeta que el emprendedor ya no ve. Borrar rompería `threads.contact_id` y los enrolamientos
   de H8.

3. **Mover a la etapa en la que ya está no emite `stage_changed`.** Sin esa regla, "cuando entre
   un lead, muévelo a Contactado" + un flujo que escucha `stage_changed` es un bucle: el anti-loop
   del motor lo corta a los 100 pasos, pero después de 100 mensajes al cliente.

4. **Registrar un evento nunca tumba lo que lo generó.** `recordEvent` devuelve
   `{ eventId: null }` y avisa por consola. Un WhatsApp sin contestar porque no se pudo escribir
   una línea de bitácora es peor que una bitácora incompleta.

---

## Normalización

Vive en [`src/identity.ts`](src/identity.ts), en un solo lugar, con sus propias pruebas. Un
índice único vale lo que valga la función que produce su llave.

| Entra | Sale |
|---|---|
| `+52 81 4681 1675` | `+528146811675` |
| `5218146811675@s.whatsapp.net` | `+528146811675` — se cae el `1` mexicano de antes de 2019 |
| `00528146811675` | `+528146811675` |
| `Santiago <S@Abraxa.Club>` | `santiago@abraxa.club` |
| `https://instagram.com/abraxa/` | `abraxa` |
| `8146811675` | `8146811675` — **no se inventa el país** |

Ese último caso es a propósito: `findDuplicates()` lo propone después por los últimos 10 dígitos.
Proponer es honesto; adivinar no.

---

## Tablas

| Tabla | Migración | Qué guarda |
|---|---|---|
| `app.contacts` | 120 | La persona |
| `app.contact_identities` | 120 | Sus direcciones por canal · **`UNIQUE (tenant, channel, identifier)`** |
| `app.contact_tags` | 120 | Etiquetas (texto, no catálogo con FK) |
| `app.contact_merges` | 120 | Bitácora de fusiones, con el perdedor completo |
| `app.pipelines` | 121 | Embudos |
| `app.pipeline_stages` | 121 | Etapas, con `slug` estable |
| `app.contact_stages` | 121 | Dónde va cada contacto · PK `(tenant, contact, pipeline)` |
| `app.contact_events` | 122 | Línea de tiempo · `external_id` único parcial |
| — | 129 | FK `threads.contact_id → contacts.id`, guardada e idempotente |

Las ocho llevan `tenant_id NOT NULL REFERENCES app.tenants(id)` y `ENABLE ROW LEVEL SECURITY` en
la misma migración que las crea. Ninguna es global: **`adminDb()` no aparece en este paquete ni
una vez.**

---

## Pruebas

```bash
npm test -- packages/crm
```

Corren sin base viva contra [`src/testing/fake-db.ts`](src/testing/fake-db.ts), que **no**
reimplementa el aislamiento por tenant (ése lo pone `tenantDb` de H1) pero **sí** reimplementa
los índices únicos de 120–122. Sin eso, la prueba de concurrencia sería teatro: pasaría igual con
el código roto.
