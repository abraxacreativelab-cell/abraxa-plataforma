# H8 — Automatizaciones: motor, builder visual y ejecución en vivo

> **Ola 2.** Corre en paralelo con H6, H7, H9 y H10. Requiere H1 y H3 mergeados.
> Rama: `h8-flows` · Migraciones: `060`–`069`
> Directorios: `packages/flows/**` y `apps/web/app/(app)/automatizaciones/**`

---

## 1. Contexto

El emprendedor describe en español lo que quiere que pase solo:

> *"Cuando entre un lead por mi página, mándale un mensaje, métemelo en la etapa de Contactado,
> y que el agente de ventas lo contacte por WhatsApp."*

…y el sistema lo arma como un flujo de nodos que él puede ver, editar a mano, probar y ver
correr **paso por paso en vivo**.

Es la función que convierte el producto de "un CRM bonito" a "mi negocio trabaja solo".

---

## 2. Alcance

### Sí

1. Motor de ejecución con cola, idempotencia y reanudación.
2. **Builder visual tipo n8n** con nodos, ramas y configuración por nodo.
3. **Asistente en español** que arma la propuesta desde una descripción.
4. **Ejecución en vivo por SSE** — ver cada paso ocurrir, no polling.
5. Historial de corridas.
6. Activación segura: siempre se guarda en pausa.

### No

- **No** implementes canales. Mandas mensajes por `InboxPort` (H6).
- **No** construyas el CRM. Los pipelines y contactos son de otro carril.
- **No** des ejecución de código arbitrario al cliente. El catálogo de nodos es cerrado.

---

## 3. Contrato de no colisión

| | |
|---|---|
| **Escribes sólo en** | `packages/flows/**` y `apps/web/app/(app)/automatizaciones/**` |
| **Migraciones** | `060`–`069` |
| **Rama** | `h8-flows` · worktree `PLATAFORMA-h8-flows` |

**Implementas:** `FlowPort`.
**Consumes:** `InboxPort` (H6) · `AgentPort` (H3) · `VaultPort` (H4) — **contra las interfaces.**
No esperes a H6: si su implementación no existe, tus tests usan un doble.

---

## 4. Qué portar de GARDEN — está casi todo hecho

| Archivo | Líneas | Veredicto |
|---|---|---|
| `src/crm/workflows/engine.ts` | — | **El motor completo. Cero Inperio.** Idempotencia por `current_node`, guard de doble envío, pausa y reanudación cuando el canal cae, anti-loop de 100 pasos, clasificación de errores transitorios vs permanentes |
| `src/crm/workflows/events.ts` | — | Matching de trigger + filtros, creación de enrollment |
| `src/crm/queue.ts` + `workflows/worker.ts` | — | pg-boss con `batchSize:1` **deliberado** para no re-ejecutar vecinos al fallar |
| `src/crm/workflows/assist.ts` | 370 | El asistente IA. Carga el catálogo real del tenant e inyecta IDs reales; valida con zod **y** semánticamente (1 trigger, sin ciclos, ramas conectadas, IDs existentes); 2 intentos con re-prompt |
| `garden-os/components/crm/flow/*` | 1,037 | Builder React Flow completo: paleta, config por nodo, panel de asistente, panel de runs |

**Sólo hay que cambiar una línea del prompt del asistente:** se autodescribe como *"CRM
inmobiliario/ventas"* (`assist.ts:217`).

---

## 5. Nodos y disparadores

**10 nodos**, todos ejecutables. El comentario original de GARDEN vale como ley:
*"la UI no promete nada que el worker no corra."*

`send_message` · `wait` · `condition` · `assign_owner` · `move_stage` · `add_tag` ·
`create_task` · `webhook` · `ai_step` · `end`

**8 disparadores:** contacto nuevo · cambio de etapa · formulario enviado · cita agendada ·
cita cancelada · etiqueta añadida · **mensaje entrante** · manual.

**Variables de plantilla**, incluidos los valores canónicos de H4:
`{nombre} {fecha} {hora} {vendedor} {link}` + `{valor.*}` y `{precio.*}`.

**Cambio respecto a GARDEN:** su `send_whatsapp` era específico. Aquí es **`send_message` con
canal como parámetro**, despachado por `InboxPort`. Así los canales de H12 y H13 funcionan sin
tocarte.

---

## 6. Lo que hay que agregar sobre GARDEN

Tres huecos reales del original:

1. **Ejecución en vivo por SSE.** GARDEN hace polling de 10 segundos
   (`builder.tsx:829-834`). Aquí el emprendedor ve cada paso ocurrir. Es la diferencia entre
   "confío en que sirve" y "lo vi funcionar".
2. **Rollback de versión.** `crm_workflow_versions` existe en GARDEN y **nadie la lee** — es un
   log de auditoría, no versionado usable. Aquí se puede volver a una versión anterior.
3. **`send_email` deja de ser un stub.** En GARDEN devuelve `skipped`. Aquí despacha por
   `InboxPort` y funciona en cuanto H13 conecte el driver.

---

## 7. Seguridad — el cliente edita flujos, no código

- **Todo flujo se guarda en pausa.** Activarlo es un clic humano aparte, con modal que advierte
  que va a ejecutarse con contactos **reales**.
- **Sin ciclos.** El validador los rechaza (DFS tricolor, ya está en `assist.ts`).
- **Anti-loop de 100 pasos** en tiempo de ejecución, además.
- **Guard anti-SSRF** en el nodo `webhook` (`isBlockedSsrfHost` de GARDEN).
- **Probar** = enrolar un contacto real en ese flujo y sólo ese.
- Activar y probar exigen rol admin, y el botón se **deshabilita con explicación** en vez de dar
  un 403 sorpresa.

---

## 8. Criterios observables de "listo"

1. Describir un flujo en español y obtener una propuesta **válida y ejecutable**, con los IDs
   reales del tenant.
2. Editar un nodo a mano, guardar, y que el motor corra la versión editada.
3. **Ver la ejecución en vivo**: disparar el flujo y ver cada nodo cambiar de estado por SSE,
   sin recargar.
4. Un flujo nuevo **nace en pausa**. Activarlo exige confirmación explícita.
5. Reintentar un paso fallido **no** duplica el mensaje ya enviado.
6. Si el canal se cae a media corrida, el flujo **pausa y reanuda** cuando vuelve.
7. Volver a una versión anterior y que el motor use esa.
8. Un flujo del tenant A **no** puede tocar datos del B. Test automatizado.

---

## 9. Prompt de arranque

```
ANTES DE ESCRIBIR NADA: verifica que H1 y H3 hayan mergeado.
  test -f packages/db/ports.ts && test -d packages/agents/src && echo LISTO || echo "ESPERA"
Si falta alguno, NO crees estructura. Lee tu handoff, estudia GARDEN, prepara tu plan.

Trabaja SIEMPRE desde /Volumes/FRAGUA/CLAUDE CODE/PLATAFORMA-h8-flows (tu worktree, rama
h8-flows ya activa). No hagas checkout ni switch.

Vas a construir H8 — las Automatizaciones de ABRAXA Plataforma: motor, builder visual tipo n8n
y ejecución en vivo.

Lee primero, completo:
  docs/handoffs/H8-flows.md          (tu handoff)
  docs/handoffs/README.md            (el contrato de no colisión)
  packages/db/ports.ts               (implementas FlowPort; consumes InboxPort y AgentPort)

Contexto: el emprendedor describe en español lo que quiere que pase solo, y el sistema lo arma
como un flujo de nodos que puede ver, editar, probar y ver correr paso por paso. Es la función
que convierte el producto de "un CRM bonito" a "mi negocio trabaja solo".

Buena noticia: en GARDEN esto está casi todo hecho y es bueno. El motor no tiene ni una
referencia a Inperio: idempotencia, pausa y reanudación cuando el canal cae, anti-loop,
clasificación de errores transitorios vs permanentes. Y el asistente IA valida con zod Y
semánticamente contra el catálogo real del tenant. GARDEN está en
"/Volumes/FRAGUA/CLAUDE CODE/GARDEN" — consúltalo, NO lo edites.

Tres cosas que hay que AGREGAR sobre el original:
  1. Ejecución en vivo por SSE. GARDEN hace polling de 10s. Ver cada paso ocurrir es la
     diferencia entre "confío en que sirve" y "lo vi funcionar".
  2. Rollback de versión. La tabla existe en GARDEN y nadie la lee.
  3. send_email deja de ser un stub que devuelve 'skipped'.

Y un cambio: send_whatsapp se vuelve send_message con el canal como parámetro, despachado por
InboxPort — así los canales de H12 y H13 funcionan sin tocarte. Consumes InboxPort CONTRA LA
INTERFAZ: no esperes a H6, usa un doble en tus tests.

Trabajas SÓLO en packages/flows/** y apps/web/app/(app)/automatizaciones/**.
Migraciones 060–069. Otras 4 conversaciones trabajan en paralelo.

Conserva la ley de GARDEN: la UI no promete ningún nodo que el worker no corra de verdad. Y
todo flujo nace en pausa — activarlo es un clic humano aparte, con advertencia de que va a
ejecutarse con contactos REALES.

Si algo del handoff está mal o incompleto, dilo y propón el arreglo antes de construir.
```
