# @abraxa/flows — Automatizaciones

> H8 · migraciones `060`–`069` · rutas bajo `/flows` · implementa `FlowPort`

El emprendedor describe en español lo que quiere que pase solo, el sistema lo
arma como pasos que puede ver y editar, y lo ve correr **paso por paso**.

```
"Cuando entre un lead por mi página, mándale un mensaje, métemelo en la etapa
 de Contactado, y que el agente de ventas lo contacte."
```

---

## Cómo está partido, y por qué

| Archivo | Qué es |
|---|---|
| `engine/decision.ts` | **El cerebro. Funciones puras.** Fence de idempotencia, tope anti-bucle, elección de rama, pausa, cierre. Ni base, ni cola, ni red. |
| `engine/nodes.ts` | Los diez nodos. Todo efecto sale por un *port*. |
| `engine/step.ts` | Carga → decide → ejecuta → guarda → encola. |
| `queue.ts` | Lo **único** que sabe de pg-boss. |
| `validate.ts` | zod + semántica contra el catálogo real del tenant. |
| `store.ts` | `tenantDb(ctx)`, siempre. |
| `ui/suscripcion.ts` | El transporte del panel en vivo, detrás de UNA función. |

Esa primera línea es la que hace que este paquete se pruebe **entero en CI**,
donde no hay `DATABASE_URL`, ni llaves de ningún proveedor, ni schema `pgboss`.
En GARDEN, `executeStep` decidía y accedía a datos en la misma función, así que
probar la idempotencia exigía una base viva — es decir, no se probaba.

---

## Los diez nodos

`send_message` · `wait` · `condition` · `assign_owner` · `move_stage` ·
`add_tag` · `create_task` · `webhook` · `ai_step` · `end`

**La UI no promete ningún nodo que el worker no corra.** `catalog.ts` es la
única lista, y la consumen los tres: la paleta del builder, el prompt del
asistente y el validador. `engine/nodes.test.ts` falla si alguno no se ejecuta.

`send_email` no existe como nodo: es `send_message` con `channel: 'email'`. En
GARDEN era un caso que devolvía `skipped` — un nodo que el builder ofrecía y el
motor no ejecutaba.

---

## Las tres garantías que hay que entender antes de tocarlo

### 1. Reintentar no manda dos mensajes

Tres capas, en orden de coste:

1. **El fence de `current_node`** — un job que apunta a otro nodo es un
   reintento de un paso ya superado y se aborta antes de ejecutar nada.
2. **El guard de doble envío** — si el nodo ya tiene un paso `ok`, no se gasta
   el mensaje.
3. **`flow_steps_hecho_idx`** — índice único parcial sobre `status = 'ok'`. Es
   el árbitro. En GARDEN esto era un `SELECT COUNT` previo, que pierde la
   carrera con dos intentos en vuelo: los dos cuentan cero, los dos envían.

### 2. Un canal caído pausa, no mata

`PlatformError.retryable` decide. Transitorio → la corrida se PAUSA, sin
escribir paso y sin mover el puntero, así que al reanudar se re-ejecuta ese
mismo nodo (y una espera de tres días no le gasta los 100 pasos). Permanente →
la corrida muere con su razón escrita.

### 3. Todo flujo nace en pausa

El `DEFAULT 'paused'` de la migración, más que `crearFlujo` nunca pasa
`status`, más que activar es una llamada aparte que **exige rol admin** y deja
`activated_by` y `activated_at`. Tres capas porque el fallo es caro.

---

## El panel en vivo: polling de 1 s, no SSE

`apps/api` y `apps/worker` son **dos procesos distintos**. Quien ejecuta los
pasos es el worker; quien tendría el SSE abierto es la API. Un `EventEmitter`
en proceso **pasa todas las pruebas y no emite un solo evento en producción**.
Y no hay `LISTEN`/`NOTIFY` ni Realtime cableados en el repo.

Un segundo se ve vivo para un humano y funciona de verdad. Todo el transporte
está detrás de `suscribirseACorrida()`: el día que exista `LISTEN`/`NOTIFY`,
cambia ese archivo y la pantalla no.

Se apaga sola cuando la corrida termina y cuando la pestaña se oculta. Las dos
cosas están probadas con reloj falso en `ui/suscripcion.test.ts`: un intervalo
de 1 s olvidado en una pestaña son ~170 000 peticiones en un fin de semana.

---

## Cómo se consume

```ts
// Cualquier paquete publica un evento; los flujos activos se enrolan solos.
await usePort('flows').emit(ctx, { type: 'contact_created', payload: { contactId } });
```

```ts
// El worker, con UNA línea (pendiente de H1/H0 — ver el PR):
import { descriptorDeCola } from '@abraxa/flows';
registerQueue(descriptorDeCola());
```

```ts
// El navegador, sin arrastrar Express al bundle:
import { suscribirseACorrida, CATALOGO } from '@abraxa/flows/ui';
```

---

## En tus pruebas

```ts
import { registrarTodo } from './testing/dobles';

const { bandeja, crm } = registrarTodo({ contactos: [{ id: 'c1', whatsapp: '+52…' }] });
bandeja.fallarSiguiente('transitorio');   // el canal se cae
bandeja.cuantosA('+52…');                 // cuántos mensajes le llegaron de verdad
```

El doble de la bandeja **cuenta envíos** y **falla a voluntad**, distinguiendo
transitorio de permanente. Sin esas dos capacidades, «no se manda dos veces» no
se puede afirmar: se puede suponer.

---

Contratos cruzados: `packages/db/ports.ts` · Las cinco reglas: `CONTRIBUTING.md`
· El encargo: `docs/handoffs/H8-flows.md`.
