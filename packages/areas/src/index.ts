/**
 * @abraxa/areas — Áreas del negocio, desbloqueo y gamificación (H11)
 *
 * El emprendedor no llega con su empresa lista. Empieza con un área encendida y
 * va desbloqueando las demás, y cada una le explica ANTES qué gana su negocio
 * con tenerla — no qué botones trae. Este paquete es ese avance.
 *
 * ── Las dos decisiones que mandan sobre todo lo demás ───────────────────────
 *
 *  1. LAS REGLAS DE DESBLOQUEO VIVEN EN DATOS. `app.area_catalog` y
 *     `tenant_areas.requirements` guardan condiciones evaluables; el código sólo
 *     sabe LEERLAS. Ajustar cuándo se abre Finanzas para restaurantes es un
 *     UPDATE, no un deploy — y el agente maestro puede proponer sus propias
 *     condiciones sin que nadie compile nada.
 *
 *  2. LAS ÁREAS BLOQUEADAS SE VEN, con candado y su promesa. `listAreas()`
 *     devuelve TODAS a propósito. Esconderlas mataría el motor del producto:
 *     ver "RH · graduarte de solopreneur" con candado le planta una idea que va
 *     a querer.
 *
 * ── El mapa ────────────────────────────────────────────────────────────────
 *
 *   domain/     puro y probado sin base: el evaluador de requisitos y la
 *               máquina de estados. Ahí se decide un desbloqueo.
 *   data/       el puente a las dos funciones de la 090 y al catálogo.
 *   services/   el trabajo real, siempre por `tenantDb(ctx)`.
 *   routes.ts   la API. `apps/api` la monta en `/areas`.
 *
 * La pantalla vive en `apps/web/app/(app)/mapa/` y llama a `services/` en
 * proceso, no por HTTP.
 */
// `tables.d.ts` aumenta `DomainTableRegistry` de `@abraxa/db`, y una aumentación
// sólo aplica si su archivo está DENTRO del programa. El proyecto de Node lo
// recoge por glob (`packages/*/src/**/*.ts`), pero el de `apps/web` llega hasta
// aquí siguiendo un import y nunca vería el `.d.ts` suelto: sin esta referencia,
// `tenantDb(ctx).from('tenant_areas')` no compila en `typecheck:web`.
//
// La regla de ESLint pide un `import` en su lugar, y no aplica: un `.d.ts` no se
// puede importar sin renombrarlo a `.ts`, y el nombre `tables.d.ts` es la
// convención que documenta `packages/db/src/tables.ts` y que siguen H3 y H9.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./tables.d.ts" />
import { registerPort } from '@abraxa/db';
import { areasPort } from './port';
import { registrarSink } from './services/blueprint';

// Registrado al importar el paquete. `apps/api` lo importa al arrancar, y
// `(app)/layout.tsx` de H5 lo encuentra con `tryPort('areas')` — que es como el
// sidebar deja de usar su mock y empieza a pintar áreas de verdad, sin que H5
// cambie una línea.
registerPort('areas', areasPort);

/**
 * El paso 2 de los tres que `packages/onboarding/src/ports/blueprint-sink.ts`
 * le dejó anotados a este carril: **registrarlo**.
 *
 * Sin esta línea, un Ritual que se cierra guarda su blueprint con `applied_at`
 * en NULL y el emprendedor llega al panel sin una sola área suya. Eso es
 * exactamente lo que estaba pasando en producción.
 *
 * `void` y no `await`: un módulo no puede esperar a nadie para terminar de
 * cargarse. La resolución es un `import()` de un paquete que ya está en el
 * grafo, o sea un microtask, y quien de verdad importa —el cierre del Ritual—
 * ocurre muchos turnos de evento después. Y si aun así llegara antes, no se
 * pierde nada: el blueprint queda pendiente y `leerFilasSembrando()` lo
 * proyecta en la primera carga del mapa. Dos redes, no una.
 */
void registrarSink();

export { router } from './routes';
export { meta } from './meta';
export { areasPort };

// ── Dominio (puro — lo consume también la pantalla) ─────────────────────────
export * from './domain/types';
export {
  completionRatio,
  evaluate,
  parseProgress,
  parseRequirement,
  parseRequirements,
  parseSignals,
} from './domain/requirements';
export {
  RANGO_ESTADO,
  completeOnboarding,
  estaAbierta,
  navegable,
  reconcile,
  startOnboarding,
  type Transition,
} from './domain/state';

// ── Servicios (servidor) ────────────────────────────────────────────────────
export {
  LIMITE_AREAS,
  accessFor,
  declare,
  getArea,
  listAreas,
  loadMap,
  lockArea,
  seedTenant,
  unlockArea,
} from './services/areas';
export {
  NOMBRE_DEL_SINK,
  aplicarBlueprintDelRitual,
  proyectarBlueprint,
  registrarSink,
} from './services/blueprint';
export {
  type BlueprintDelRitual,
  hitosQueFaltan,
  leerBlueprint,
  planDeArea,
  planDeProyeccion,
  traducirRequisito,
  traducirRequisitos,
} from './domain/blueprint';
export {
  LIMITE_HITOS,
  createMilestone,
  deleteMilestone,
  listMilestones,
  proposeMilestones,
  reorderMilestones,
  updateMilestone,
} from './services/milestones';
export * as areaOnboarding from './services/onboarding';
export type { OnboardingView } from './services/onboarding';
