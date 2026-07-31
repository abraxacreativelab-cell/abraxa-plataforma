# H11 — Áreas, mapa de negocio y gamificación

> **Ola 3.** Corre en paralelo con H12, H13 y H14. Requiere H1, H5 y H7 mergeados.
> **Ruta crítica** — es la que hace que el producto se sienta como un juego y no como un ERP.
> Rama: `h11-areas` · Migraciones: `090`–`099`
> Directorios: `packages/areas/**` y `apps/web/app/(app)/mapa/**`

---

## 1. Contexto

El emprendedor no llega con su empresa lista. Llega con una idea a medias, tres clientes y
demasiadas cosas en la cabeza. **Su sistema tiene que crecer con él.**

Empieza quizá con una sola área encendida. Conforme avanza, desbloquea las demás — y cada una
le explica antes **qué gana su negocio** con tenerla, no qué botones trae. Puede parar en
cualquier hito y volver después.

Tu trabajo es que eso se sienta como avanzar en un juego, no como llenar un formulario largo.

---

## 2. Alcance

### Sí

1. Estado y ciclo de vida de cada área por tenant.
2. **Reglas de desbloqueo** — qué hace falta para abrir cada una.
3. **Mini-onboarding por área** con tutorial empresarial.
4. El **Mapa de Negocio**: la pantalla donde ve todo su sistema y qué sigue.
5. Roadmap de hitos, generado por el agente maestro y editable.
6. Siembra de un tenant nuevo desde su plantilla de giro.

### No

- **No** el Ritual de Fundación. Es H7 — él genera los datos iniciales, tú los operas después.
- **No** el contenido funcional de cada área. Cada handoff hace lo suyo.
- **No** el shell ni la navegación. Es H5 — él consume tu endpoint `GET /areas`.

---

## 3. Contrato de no colisión

| | |
|---|---|
| **Escribes sólo en** | `packages/areas/**` y `apps/web/app/(app)/mapa/**` |
| **Migraciones** | `090`–`099` |
| **Rama** | `h11-areas` · worktree `PLATAFORMA-h11-areas` |

**Consumes:** `TenancyPort` (H2) · `AgentPort` (H3) · `VaultPort` (H4) para `detectGaps()`.
**Te consumen:** H5 pinta la navegación con tus datos. H7 crea el estado inicial.

---

## 4. Modelo

```sql
-- 090_areas.sql
CREATE TABLE app.tenant_areas (
  tenant_id    uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  area_slug    text NOT NULL,
  state        text NOT NULL DEFAULT 'bloqueada'
               CHECK (state IN ('bloqueada','disponible','en_progreso','activa')),
  requirements jsonb NOT NULL DEFAULT '[]',   -- qué falta para abrirla
  progress     jsonb NOT NULL DEFAULT '{}',   -- qué ya cumplió
  unlocked_at  timestamptz,
  position     int NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, area_slug)
);

CREATE TABLE app.tenant_milestones (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  area_slug    text,
  title        text NOT NULL,
  description  text,
  position     int NOT NULL DEFAULT 0,
  done_at      timestamptz,
  generated_by text NOT NULL DEFAULT 'master_agent',
  created_at   timestamptz NOT NULL DEFAULT now()
);
```

Ambas con `ENABLE ROW LEVEL SECURITY` en la misma migración.

---

## 5. Desbloqueo

```
 ÁREA          SE ABRE CUANDO                       EL TUTORIAL PROMETE
 ────────────────────────────────────────────────────────────────────────────
 Ventas/MKT    conecta 1 canal + define pipeline    "un equipo de ventas que
                                                     nunca duerme"
 Dirección     carga 1 documento o define 3 valores "tus números en un solo lugar,
                                                     para que nada más mienta"
 Onboarding    cierra su primera venta en sistema   "cómo se siente entrar a tu
                                                     negocio siendo cliente"
 Servicio      tiene 5 contactos activos            "dejar de perder clientes por
                                                     no contestar"
 RH            declara que va a contratar           "graduarte de solopreneur"
 Finanzas      3 meses de operación registrada      "saber si de verdad ganas"
```

**Las reglas viven en datos, no en código.** Un `requirements` es una lista de condiciones
evaluables (`{ type: 'has_channel' }`, `{ type: 'value_count', min: 3 }`). Así se ajustan por
giro sin desplegar, y el agente maestro puede proponer sus propias condiciones.

**Las áreas bloqueadas se ven, con candado y su promesa.** No las escondas: la curiosidad es el
motor. Ver "RH · graduarte de solopreneur" con candado le planta una idea que va a querer.

---

## 6. Mini-onboarding por área

Cuando desbloquea un área, no aterriza en una tabla vacía. El agente maestro le da un
**tutorial empresarial** — corto, sobre su negocio, no sobre la herramienta:

1. **Qué es esta área en tu empresa.** Con sus propias palabras, tomadas de la entrevista.
2. **Qué cambia cuando la tienes.** Concreto: *"tus leads dejan de perderse el fin de semana"*.
3. **Tres preguntas** para configurarla — no veinte.
4. **Un primer resultado visible** antes de terminar.

Es el mismo motor de entrevista de H7 con otro guion. **Guiones en base de datos**, uno por
área × giro, no en el código.

---

## 7. El Mapa de Negocio

La pantalla de `(app)/mapa`. Su sistema completo de un vistazo: áreas activas, en progreso,
disponibles y bloqueadas, con el roadmap de hitos al lado.

Que se sienta un mapa, no una lista de pendientes. **Lo que ya construyó tiene que verse
construido** — es el pago de todo el esfuerzo que ha metido.

Usa el design system de H5. Cada área con su acento. Cero hex.

---

## 8. Criterios observables de "listo"

1. Un tenant nuevo nace con sus áreas sembradas según su giro, en el estado correcto.
2. Cumplir un requisito **desbloquea sola** el área — sin que nadie apriete nada.
3. El área bloqueada se ve con candado y su promesa, y no es clickeable.
4. Desbloquear dispara el mini-onboarding, y al terminar hay **un resultado visible**.
5. Cambiar `requirements` en datos **cambia el comportamiento sin desplegar**.
6. Dos giros distintos siembran mapas distintos.
7. El roadmap del agente maestro aparece y se puede marcar, reordenar y editar.
8. `GET /areas` devuelve lo que H5 necesita para pintar la navegación.

---

## 9. Prompt de arranque

```
ANTES DE ESCRIBIR NADA: verifica que H1, H5 y H7 hayan mergeado.
  test -f packages/db/ports.ts && test -d packages/ui/src && test -d packages/onboarding/src \
    && echo LISTO || echo "ESPERA"
Si falta alguno, NO crees estructura. Lee tu handoff, prepara tu plan.

Trabaja SIEMPRE desde /Volumes/FRAGUA/CLAUDE CODE/PLATAFORMA-h11-areas (tu worktree, rama
h11-areas ya activa). No hagas checkout ni switch.

Vas a construir H11 — las áreas, el mapa de negocio y la gamificación de ABRAXA Plataforma.
Estás en la ruta crítica: eres lo que hace que el producto se sienta como un juego y no como
un ERP.

Lee primero, completo:
  docs/handoffs/H11-areas.md         (tu handoff)
  docs/handoffs/README.md            (el contrato de no colisión)
  packages/db/ports.ts               (consumes TenancyPort, AgentPort, VaultPort)

Contexto: el emprendedor no llega con su empresa lista. Llega con una idea a medias, tres
clientes y demasiadas cosas en la cabeza. Su sistema tiene que crecer con él: empieza quizá con
una sola área encendida y va desbloqueando las demás, y cada una le explica ANTES qué gana su
negocio con tenerla — no qué botones trae.

Dos decisiones de diseño que no se negocian:
  1. Las reglas de desbloqueo viven en DATOS, no en código. Así se ajustan por giro sin
     desplegar, y el agente maestro puede proponer sus propias condiciones.
  2. Las áreas bloqueadas SE VEN, con candado y su promesa. No las escondas: la curiosidad es
     el motor. Ver "RH · graduarte de solopreneur" con candado le planta una idea que va a querer.

El mini-onboarding por área usa el mismo motor de entrevista de H7 con otro guion, y los
guiones van en base de datos, uno por área × giro.

Trabajas SÓLO en packages/areas/** y apps/web/app/(app)/mapa/**. Migraciones 090–099.
Otras 3 conversaciones trabajan en paralelo. Usa el design system de H5 — cero hex.

Si algo del handoff está mal o incompleto, dilo y propón el arreglo antes de construir.
```
