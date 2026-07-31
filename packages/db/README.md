# @abraxa/db

Cliente, aislamiento por tenant y **los contratos cruzados**. Handoff **H1**.

Es el paquete que nadie más edita. Si te falta un tipo en `ports.ts`, anótalo
en tu PR: H1 lo agrega en una pasada. Un tipo que cambia debajo de cuatro
conversaciones vivas cuesta más que esperar.

## Qué exporta

| | |
|---|---|
| `tenantDb(ctx)` | **la única vía** de acceso a datos de dominio |
| `adminDb()` | sin filtro: alta de tenants y tablas globales, con su razón escrita |
| `PlatformError` | el error que cruza la frontera entre paquetes |
| `usePort` / `tryPort` / `registerPort` | el registro de implementaciones |
| `@abraxa/db/ports` | los contratos, **sólo tipos** |
| `@abraxa/db/tables` | el registro de tablas con `tenant_id` (se aumenta desde tu paquete) |

Ver [`CONTRIBUTING.md`](../../CONTRIBUTING.md) — secciones "El aislamiento entre
clientes" y regla 5.
