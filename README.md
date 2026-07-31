# ABRAXA Plataforma

Un **sistema operativo empresarial para emprendedores**. Cualquiera conecta su
empresa y va desbloqueando áreas —Ventas, Dirección, Onboarding, Servicio…—
conforme su negocio crece, guiado por un **agente maestro** al que él mismo le
pone nombre.

La promesa, en una frase: *tu agente contesta a tus clientes mientras duermes.*

> Producto **nuevo y separado de GARDEN**, que es el sistema operativo interno
> de ABRAXA. GARDEN vive en `/Volumes/FRAGUA/CLAUDE CODE/GARDEN` y **no se
> toca**: es fuente de consulta y de código a portar, nada más.

---

## Arrancar

```bash
nvm use            # Node 22
npm ci
cp .env.example .env    # y llénalo
npm run migrate         # aplica lo pendiente

npm run dev:api    # :3100
npm run dev:web    # :3000
```

---

## Cómo está armado

```
apps/
  api/      Express + TS · gateway         (bundle esbuild → dist/index.mjs)
  web/      Next.js 14 App Router
  worker/   pg-boss
packages/
  config/   entorno validado con zod, constantes
  db/       cliente, tenantDb(ctx), errores y LOS CONTRATOS CRUZADOS
  tenancy/  agents/  vault/  ui/  inbox/
  onboarding/  flows/  work/  billing/  areas/
migrations/
scripts/    ownership-gate · migrate
docs/handoffs/   los 14 documentos de construcción
```

Rutas del producto: `/` · `/ritual` · `/direccion` · `/bandeja` ·
`/automatizaciones` · `/tareas` · `/mapa` · `/admin`.

---

## Se construye con 14 conversaciones en paralelo

Cada handoff escribe **sólo en su carril**, numera migraciones **sólo en su
bloque de diez**, y habla con los demás **a través de los ports** de
[`packages/db/ports.ts`](packages/db/ports.ts) — nunca contra su código.

El job de CI `ownership-gate` lo aplica: si una rama toca un archivo ajeno,
falla el PR nombrando el archivo y a quién pertenece.

👉 **Lee [`CONTRIBUTING.md`](CONTRIBUTING.md) antes de escribir nada.**

---

## Dos decisiones que valen por todo lo demás

**El aislamiento entre clientes es un tipo, no una convención.** Todo dato de
dominio pasa por `tenantDb(ctx)`; el filtro por `tenant_id` no se escribe, así
que no se puede olvidar. GARDEN dejó 145 de 170 tablas sin RLS y el aislamiento
colgando de 447 `.eq()` escritos a mano.

**El schema se cierra antes de tener tablas.** La migración `001` hace `REVOKE`
sobre `app` y deja las *default privileges* puestas **antes** de crear la
primera tabla de dominio. Toda tabla nueva nace dentro de un schema ya negado
por defecto, y el gate verifica que traiga `tenant_id` y RLS en la misma
migración que la crea.

---

## Infraestructura

| | |
|---|---|
| Supabase | proyecto `abraxa-plataforma` · ref `ievnkmodselrlkazkzoy` · us-east-1 |
| Dominio | `mi.abraxa.club` → `187.77.9.8` |
| Repo | `abraxacreativelab-cell/abraxa-plataforma` (privado) |
| Node | 22 |
