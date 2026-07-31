# Migraciones

```bash
npm run migrate:status   # qué hay aplicado y qué falta
npm run migrate          # aplica lo pendiente, cada una en su transacción
```

El libro vive en `app.schema_migrations`. El runner verifica el **checksum** de
lo ya aplicado: si editas una migración que ya corrió, falla. Una migración
aplicada es historia, no borrador — para cambiar algo, escribe una nueva.

---

## La regla, sin excepciones

> **Toda tabla de dominio nueva lleva `tenant_id`, `ENABLE ROW LEVEL SECURITY` y
> su política, en la MISMA migración que la crea.**

No es una recomendación. `ownership-gate` la verifica en cada PR y falla con el
nombre de la tabla.

GARDEN dejó **145 de 170 tablas sin RLS**. No fue descuido de nadie en
particular: fue que las tablas se crearon primero y la seguridad se iba a poner
"después". Con 170 tablas, después ya no llega. Por eso la migración `001`
cierra el schema `app` **antes** de que exista la primera tabla de dominio, y
por eso el gate no deja crear una tabla sin su RLS.

### Tablas globales

Unas pocas tablas legítimamente no llevan `tenant_id`:

| Tabla | Por qué |
|---|---|
| `app.tenants` | *es* el tenant; su llave de aislamiento es `id` |
| `app.users` | una persona puede existir antes de pertenecer a una empresa |
| `app.plans` | catálogo de la plataforma |
| `app.industry_templates` | catálogo de la plataforma |
| `app.billing_events` | los eventos de Stripe llegan **antes** de que el tenant exista |
| `app.schema_migrations` | infraestructura |

Se declaran poniendo un comentario justo antes del `CREATE TABLE`:

```sql
-- tenantless: los eventos de Stripe llegan antes de que el tenant exista.
CREATE TABLE app.billing_events ( … );
ALTER TABLE app.billing_events ENABLE ROW LEVEL SECURITY;
```

RLS sigue siendo obligatorio incluso en ésas: sin políticas, RLS activo es
**negado para todos** menos `service_role`, que hace bypass. Fail-closed.

---

## Bloques por handoff

Nunca salgas de tu bloque de diez. El gate lo verifica y te dice de quién es el
número que tomaste.

| Bloque | Handoff | | Bloque | Handoff |
|---|---|---|---|---|
| `001`–`009` | H1 fundación | | `060`–`069` | H8 flows |
| `010`–`019` | H2 tenancy | | `070`–`079` | H9 work |
| `020`–`029` | H3 agents | | `080`–`089` | H10 billing |
| `030`–`039` | H4 vault | | `090`–`099` | H11 areas |
| `040`–`049` | H6 inbox | | `100`–`104` | H12 meta |
| `050`–`059` | H7 ritual | | `105`–`109` | H13 email + SMS |
| | | | `110`–`119` | H14 admin |

H5 (design system) no crea migraciones.

---

## Convenciones

- Nombre: `NNN_tema.sql`, en minúsculas y con guiones bajos.
- Una migración = un tema. No mezcles tenancy con inbox.
- Idempotente donde se pueda (`IF NOT EXISTS`), pero **no** a costa de
  claridad: es más importante que se lea qué hace.
- No hace falta conceder privilegios a `service_role`: la `001` dejó puestas
  las `ALTER DEFAULT PRIVILEGES` del schema `app`.
- `gen_random_uuid()` está en el core de Postgres 17. Para vectores,
  `extensions.vector` ya está habilitado (H4).
