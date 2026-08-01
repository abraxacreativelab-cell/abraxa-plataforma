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
    ayudas.ts          los botones y ejemplos de cada dato      ← el embudo invertido
    marcadores.ts      el canal lateral modelo → máquina        ← criterio #5
    maquina.ts         aplicarTurno(): la transición, pura      ← criterios #6 y #8
    guion.ts           lo que se le antepone al agente cada turno
    regreso.ts         el "esto es lo que ya sé de ti", sin modelo
  sitio/             leer su página web — lo único que sale a internet
    url.ts             qué se puede pedir, y el guardia de SSRF
    leer.ts            bajarla sin colgarse ni seguir a la red de adentro
    extraer.ts         qué dice, según el MODELO
  session/
    repositorio.ts     la sesión en la base. Nada en memoria.
    ritual.ts          el orquestador de un turno
  synthesis/          el Mapa de Negocio — también puro
    catalogo.ts        las 6 áreas genéricas y su regla de arranque
    mapa.ts            construirMapa(): áreas + hitos + documento madre ← criterio #4
    industria.ts       el giro, resuelto contra app.industry_templates (H4)
    blueprint.ts       persistir la decisión, y proyectarla si hay quién
    entrega.ts         giro, bóveda y bautizo del agente
  ports/
    blueprint-sink.ts  EL CONTRATO QUE LE FALTA A AreasPort — leer abajo
```

---

## El embudo invertido (2026-08-01)

Hasta esta fecha el Ritual preguntaba mucho y entregaba al final: quien se salía a los diez
minutos se iba con las manos vacías y el producto se quedaba sin nada que construirle. Ahora es al
revés, con una sola regla: **lo que se contesta con el pulgar va primero; lo que hay que pensar va
después.**

### El orden

```
bienvenida → identidad → modelo → proceso → gente → dolor → sintesis
   bautizo    LO ESENCIAL
```

| Fase | Qué pide | Cómo se contesta |
|---|---|---|
| `bienvenida` | el nombre de su agente | 5 nombres a un toque, o el suyo |
| `identidad` | categoría · cuántos son · giro · etapa | **3 botones y una frase** |
| `modelo` | nicho · cómo cobra · ticket · margen · canales | 3 de 5 con botones |
| `proceso` | recorrido de 3 pasos · herramientas | ejemplos + botones múltiples |
| `gente` | quién hace qué, o qué soltaría primero | ejemplos |
| `dolor` | 2 dolores + **1 hito que él no pidió** | ejemplos, y el agente ataca |
| `sintesis` | — | el Mapa de Negocio |

Tres movimientos, y cada uno tiene su razón:

- **`equipo` (cuántos son) subió de `gente` a `identidad`.** Es un botón y cambia el mapa: el área
  de Equipo nace abierta o con candado según esto. Un dato de un segundo que mueve el resultado va
  al principio.
- **`nicho` bajó de `identidad` a `modelo`.** Es una frase pensada y pertenece al lado comercial.
- **`dolor` se movió al final**, pegada a la síntesis. Es la fase que da el "wow" —el hito que él
  no había pedido— y ese wow aterriza mejor un minuto antes del mapa que cinco.

`tamano` dejó de ser condición de cierre: se sigue guardando cuando lo suelta, pero ya no puede
detener una entrevista, porque es el único dato de su fase que no se contesta con el pulgar y ya
está implícito en el ticket.

**Lo que NO cambió:** cada fase sigue teniendo condiciones de cierre duras y `[FASE_COMPLETA:x]`
sigue siendo una petición que decide `puedeCerrar()`. Ir más rápido no es preguntar menos.

### Las ayudas viven en `interview/ayudas.ts`, y tienen DOS lectores

La pantalla las pinta (`VistaDelRitual.ayuda`) y el guion se las describe al modelo. Con la lista
escondida en el `.tsx`, el agente preguntaba «¿en qué etapa va tu negocio?» y abajo aparecían
botones de categorías — y el que se ve mal en esa foto es el agente, que es lo único que el
producto tiene. Una tabla, dos consumidores, y `session/solo-con-el-pulgar.test.ts` lo fija.

Qué ayuda toca en cada turno lo decide `primerFaltante(fase, estado)`: el mismo dato que el guion
le pone al frente al agente. No se adivina del texto del modelo.

### Leer su página — `src/sitio/`

`POST /onboarding/ritual/sitio { url }`. **No escribe nada**: devuelve propuestas que el invitado
corrige y confirma, y confirmarlas manda un turno normal por `/ritual/turno`. Un camino de
escritura paralelo podría cerrar fases con datos que su dueño nunca vio.

Es el único punto del Ritual que sale a internet, así que:

| Puerta | Dónde |
|---|---|
| sólo `http:`/`https:` | `url.ts` |
| IP privadas, loopback, link-local, metadatos, y las IPv4 mapeadas en IPv6 | `url.ts` |
| decimal/octal/hexadecimal (`http://2130706433/`) | los normaliza `URL`, y se revisa después |
| **el DNS que resuelve a una IP privada** | `leer.ts` · `dns.lookup(all)` antes de cada petición |
| **la redirección a una IP privada** | `leer.ts` · `redirect: 'manual'`, cada salto revisado |
| 8 s · 3 saltos · 512 KB | `leer.ts` |

Queda un TOCTOU documentado en el encabezado de `leer.ts`: entre resolver y pedir, el DNS podría
cambiar. Cerrarlo exige pedirle a la IP con `Host` a mano, lo que rompe TLS con SNI para medio
internet. Se documenta, no se esconde.

Los cuatro caminos que no funcionan —no contesta, no es una página, es una SPA en blanco, es un
Instagram— **nunca son un error en pantalla**: cada uno tiene su frase, y la de la SPA importa más
que ninguna porque Framer, Wix y Squarespace son la mitad de las páginas de negocio mexicanas y
las tres devuelven 200 con cero texto.

---

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
| 8 | La fase del dolor genera un hito que él no pidió | condición de cierre de `dolor` + `maquina.test.ts` |
| — | **Sólo con el pulgar se llega al mapa** | `session/solo-con-el-pulgar.test.ts` |
| — | **Salirse tras la fase 1 ya deja algo construido** | idem · giro sembrado + agente que lo conoce |

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
| `POST /onboarding/ritual/sitio` | `{ url }` → propuestas que él confirma. No escribe nada. |
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
- **"Guardar y seguir después" SALE AL PANEL.** Antes se quedaba aquí escribiendo "guardado"
  debajo del mismo compositor, que no es una salida: es una pantalla quieta, y quien quería irse se
  iba del producto entero. Hoy manda a `/mapa` — la ruta que existe en `main`; `/panel` todavía no,
  y por eso el destino vive en la constante `EL_PANEL` de `ritual.tsx`, para que el día que exista
  sea una línea.
- **El bautizo es un momento**, no un campo: una sola pregunta a pantalla completa, con cinco
  nombres a un toque para que nadie se congele.
- **Botones y ejemplos** (`componentes/ayudas.tsx`): un toque manda, salvo cuando se pueden elegir
  varias; los ejemplos se tocan y caen en el campo para editarlos.
- **La voz** (`lib/voz-del-ritual.ts`, sobre `apps/web/src/voz/`): narra cada pregunta al aparecer,
  **se calla** al primer teclazo, al dictar y al mandar; el micrófono graba en el navegador y
  transcribe en el servidor, que es lo único que funciona en iPhone. Es opcional, se recuerda,
  arranca apagada y respeta `prefers-reduced-motion`. **Degrada en silencio**: 402, 501, 429 o un
  micrófono denegado apagan la voz sin un solo error en pantalla — la pregunta ya está escrita.
- **El Mapa de Negocio como cierre con peso**, con las áreas bloqueadas a la vista, con candado y
  con su promesa.

`/ritual/vista-previa` es un storyboard con datos de ejemplo para poder criticar la pantalla antes
de que exista la sesión. Devuelve 404 en producción.
