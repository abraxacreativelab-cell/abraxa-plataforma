# @abraxa/onboarding — El Ritual de Fundación

Lo primero que vive un emprendedor en el producto. Un agente aparece, **le pide que le ponga
nombre**, lo entrevista sobre su negocio y le entrega su **Mapa de Negocio**. Puede parar cuando
quiera y volver mañana.

| | |
|---|---|
| **Handoff** | H7 · `docs/handoffs/H7-ritual.md` |
| **Rama** | `h7-ritual` |
| **Migraciones** | `050_onboarding.sql`, `051_business_blueprint.sql` |
| **Montado en** | `apps/api` → `/onboarding` · pantalla en `apps/web/app/(onboarding)/ritual` |

---

## Cómo está armado

```
src/
  interview/         la entrevista — todo funciones puras, sin base ni red
    fases.ts           las 7 fases y el progreso
    cierre.ts          qué exige cada fase para poder avanzar   ← criterio #6
    marcadores.ts      el canal lateral modelo → máquina        ← criterio #5
    maquina.ts         aplicarTurno(): la transición, pura      ← criterios #6 y #8
    guion.ts           lo que se le antepone al agente cada turno
    regreso.ts         el "esto es lo que ya sé de ti", sin modelo
  session/
    repositorio.ts     la sesión en la base. Nada en memoria.
    ritual.ts          el orquestador de un turno
  synthesis/          el Mapa de Negocio — también puro
    catalogo.ts        las 6 áreas genéricas y su regla de arranque
    mapa.ts            construirMapa(): áreas + hitos + documento madre ← criterio #4
    blueprint.ts       persistir la decisión, y proyectarla si hay quién
    entrega.ts         giro, bóveda y bautizo del agente
  ports/
    blueprint-sink.ts  EL CONTRATO QUE LE FALTA A AreasPort — leer abajo
```

**La mitad del paquete son funciones puras a propósito.** La máquina de estados y la síntesis no
tocan base, red ni reloj, y por eso los criterios #4, #5, #6 y #8 se verifican en CI, en cada PR,
sin una Supabase viva y sin gastar un token.

---

## El hueco estructural: `tenant_areas` y `tenant_milestones`

El §7 del handoff manda persistir `tenant_areas[]` y `tenant_milestones[]` al cerrar la fase 6.
Al construir H7:

- las dos tablas las crea **H11** en su migración `090` — ola 3, no existen;
- `AreasPort` (`packages/db/ports.ts:412`) declara **sólo lectura**: `listAreas()` y
  `unlockArea()`. No hay método de escritura;
- `ports.ts` es de H1 y el gate de propiedad falla el PR de quien lo edite.

**Decisión:** se aplicó la regla #5 del plan al caso en que la interfaz todavía no existe — si el
contrato que necesitas no está declarado, **decláralo en tu carril y programa contra él**.

El Ritual produce un **blueprint** y lo persiste en `app.onboarding_blueprints` (migración 051),
que es suya. Ése es el registro de lo que se decidió y no depende de nadie. Proyectarlo a las
tablas de H11 es un paso aparte, detrás de `BlueprintSink`.

Mientras H11 no aterrice no hay sink registrado: el blueprint queda guardado con `applied_at` en
`NULL`. **Eso no es un fallo** — es el estado correcto de un sistema en el que la ola 3 aún no
empieza, y queda visible en la base en vez de perderse en un log.

### Qué tiene que hacer H11 (tres pasos, ningún archivo de H7 cambia)

```ts
import { registrarBlueprintSink, aplicarBlueprintsPendientes } from '@abraxa/onboarding';

registrarBlueprintSink({
  nombre: 'H11 · packages/areas',
  async aplicar(ctx, b) {
    // b.areas:  [{ slug, label, estado, blurb, position, razon, requisitos[] }]
    //           `estado` ya usa AreaState de ports.ts
    //           `requisitos` ya son condiciones evaluables: {type:'has_channel', min:1}
    // b.hitos:  [{ areaSlug, titulo, detalle, origen }]
    //           origen==='abogado_del_diablo' = lo que el emprendedor NO pidió
    await upsertAreas(ctx, b.areas);       // idempotente: se puede reintentar
    await upsertHitos(ctx, b.hitos);
  },
});

await aplicarBlueprintsPendientes(ctx);   // barrido de una pasada, o
                                          // POST /onboarding/ritual/proyectar-pendientes
```

Los rituales que ya se completaron se proyectan solos. Nadie vuelve a entrevistar a nadie.

### Lo que se propone para `ports.ts`

Cuando H1 haga una pasada de mantenimiento, esto debería subir a `AreasPort` y
`ports/blueprint-sink.ts` se vuelve un adaptador de tres líneas:

```ts
applyBlueprint(ctx, b: { industryType, areas, milestones }): Promise<void>;
```

No se hizo en esta rama porque cambiar `ports.ts` con cuatro carriles vivos cuesta más que
esperar — que es exactamente lo que dice el encabezado de ese archivo.

---

## Lo que se portó de GARDEN, y lo que se arregló

`GARDEN/abraxa/extensions/abraxa-bookkeeper/` son 2,188 líneas de motor de entrevista
funcionando. **No se reescribió: se parametrizó.**

| Lo que se portó | De dónde |
|---|---|
| Máquina de 7 fases con condiciones de cierre explícitas | `state-machine.ts:19-65` |
| Marcadores: el modelo emite, el código parsea **y borra antes de mostrar** | `state-machine.ts:113-160` |
| Condiciones que exigen datos concretos, no "sensación de que ya" | `state-machine.ts:19-44` |
| Constructor del documento madre | `document-builder.ts` |

### Los tres arreglos

1. **El historial vivía en memoria.** GARDEN guarda fase y datos en Postgres, pero la
   conversación en un `Map` del proceso (`handler.ts:36`). Un deploy y el entrevistado vuelve a un
   agente que conserva sus datos y perdió el hilo. Aquí el transcript es una columna y se pasa
   como `history` explícito a `AgentPort.run()` en cada corrida.
2. **La lista de marcadores estaba escrita dos veces**, una en el parser y otra en el limpiador.
   Agregar uno y olvidar la segunda lista significa un corchete en la cara del cliente. Aquí las
   dos derivan de `MARCADORES`, y además hay un barrido de marcadores inventados.
3. **Karen estaba clavada a una inmobiliaria** — ocho áreas de property management
   (`karen/src/types.ts:86-95`) y un prompt que se autodescribe como "bookkeeper de Inperio"
   (`ingest.ts:59`). Aquí el catálogo es genérico y **Karen no existe**: el emprendedor conoce un
   solo agente, el suyo, con el nombre que él le puso.

---

## Los criterios del handoff, y dónde se verifica cada uno

| # | Criterio | Dónde |
|---|---|---|
| 1 | Completa las 7 fases y termina con áreas, hitos y valores | `session/ritual.test.ts` · «llega al Mapa de Negocio» |
| 2 | **Reanudación real** — 3 fases, cierra el navegador, vuelve al día siguiente | `session/ritual.test.ts` · «retoma al día siguiente» |
| 3 | El agente responde con el nombre que le puso | `synthesis/entrega.ts` → `agent_definitions.name` |
| 4 | Dos giros distintos, mapas distintos | `synthesis/mapa.test.ts` |
| 5 | Los marcadores nunca se ven en pantalla | `interview/maquina.test.ts` + guardia en `routes.ts` |
| 6 | Una fase no avanza si faltan sus datos | `interview/cierre.ts` · `maquina.test.ts` |
| 7 | Al terminar puede usar al menos un área | `synthesis/catalogo.ts` — Ventas nunca nace bloqueada |
| 8 | La fase 4 genera un hito que él no pidió | condición de cierre de `dolor` + `maquina.test.ts` |

El #2 no se simula con una bandera: la prueba **serializa la base a JSON, tira el cliente, el port
del agente y la instancia entera**, y reconstruye el mundo desde cero — que es lo que le pasa a un
proceso que se reinició en la madrugada. Si el Ritual guardara una sola cosa importante en una
variable de módulo, esa prueba se cae.

---

## Rutas

| | |
|---|---|
| `GET /onboarding/_status` | qué fases hay y si el `BlueprintSink` está registrado |
| `GET /onboarding/ritual` | el estado completo **sin gastar un token** |
| `POST /onboarding/ritual/iniciar` | arranca, o produce el saludo de regreso |
| `POST /onboarding/ritual/turno` | `{ texto }` |
| `POST /onboarding/ritual/pausa` | "guardar y seguir después" |
| `GET /onboarding/ritual/mapa` | el Mapa de Negocio vigente |
| `POST /onboarding/ritual/proyectar-pendientes` | el barrido de H11 |

Todas arman el `TenantContext` con `TenancyPort.contextFor()` desde una sesión verificada. Hasta
que H2 aterrice responden **501 nombrando a quién se espera**, y no leen el tenant de un header:
ese 403 es lo único que impide que el cliente A lea los datos del B.

---

## La pantalla

`apps/web/app/(onboarding)/ritual/` — conversación a pantalla completa, sin el shell del producto.

- **Progreso por fases cerradas**, no por mensajes: una barra que se mueve cada vez que escribes
  miente.
- **"Guardar y seguir después" siempre a la vista.** No guarda nada — ya está todo guardado desde
  el turno anterior; sólo deja escrito que se fue por su voluntad.
- **El bautizo es un momento**, no un campo: una sola pregunta a pantalla completa.
- **El Mapa de Negocio como cierre con peso**, con las áreas bloqueadas a la vista, con candado y
  con su promesa.

`/ritual/vista-previa` es un storyboard con datos de ejemplo para poder criticar la pantalla antes
de que exista la sesión. Devuelve 404 en producción.
