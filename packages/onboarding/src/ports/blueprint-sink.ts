/**
 * ════════════════════════════════════════════════════════════════════════════
 *  BlueprintSink — el contrato que le falta a AreasPort, declarado aquí.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  ── EL PROBLEMA ──────────────────────────────────────────────────────────
 *
 *  El §7 del handoff de H7 manda persistir `tenant_areas[]` y
 *  `tenant_milestones[]` al cerrar la fase 6. Al escribir esto:
 *
 *    · las dos tablas las crea H11 en su migración 090 — ola 3, no existen;
 *    · `AreasPort` (packages/db/ports.ts:412) declara SÓLO lectura:
 *      `listAreas()` y `unlockArea()`. No hay método para escribir;
 *    · `ports.ts` es de H1 y el gate de propiedad falla el PR de quien lo
 *      edite. La regla lo dice con todas sus letras: anótalo en el PR, no lo
 *      cambies debajo de cuatro conversaciones vivas.
 *
 *  ── LA DECISIÓN ──────────────────────────────────────────────────────────
 *
 *  Se aplicó la regla #5 del plan —"programa contra interfaces, nunca contra
 *  implementaciones"— al caso en que la interfaz todavía no existe: **si el
 *  contrato que necesitas no está declarado, decláralo en tu carril y programa
 *  contra él.**
 *
 *  El Ritual produce un BLUEPRINT y lo persiste en `app.onboarding_blueprints`
 *  (migración 051), que es suya. Ése es el registro de lo que se decidió y no
 *  depende de nadie. Proyectarlo a las tablas de H11 es un paso APARTE, detrás
 *  de esta interfaz.
 *
 *  Mientras H11 no aterrice no hay sink registrado: el blueprint queda guardado
 *  con `applied_at` en NULL. Eso no es un fallo — es el estado correcto de un
 *  sistema en el que la ola 3 aún no empieza, y queda visible en la base en vez
 *  de perderse en un log.
 *
 *  ── QUÉ TIENE QUE HACER H11 (tres pasos, ningún archivo mío cambia) ───────
 *
 *    1. Implementar `BlueprintSink` en `packages/areas/`: leer `areas[]` y
 *       `milestones[]` del blueprint e insertarlos en `app.tenant_areas` y
 *       `app.tenant_milestones`. Los campos ya vienen con SU vocabulario:
 *       `AreaState` de ports.ts y `requirements` como condiciones evaluables
 *       (`{type:'has_channel', min:1}`), tal como los pide su §5.
 *    2. Registrarlo: `registrarBlueprintSink(miSink)` desde su `src/index.ts`.
 *    3. Correr `aplicarBlueprintsPendientes(ctx)` una vez por tenant. Los
 *       rituales que ya se completaron se proyectan solos, sin re-entrevistar
 *       a nadie.
 *
 *  ── LO QUE SE PROPONE PARA `ports.ts` (para el PR) ────────────────────────
 *
 *  Cuando H1 haga una pasada de mantenimiento, esto debería subir a `AreasPort`
 *  y este archivo se vuelve un adaptador de tres líneas:
 *
 *      applyBlueprint(ctx, b: { industryType, areas, milestones }): Promise<void>;
 *
 *  No se hizo aquí porque cambiar `ports.ts` con cuatro carriles vivos cuesta
 *  más que esperar — que es exactamente lo que dice el encabezado de ese
 *  archivo.
 */
import type { TenantContext } from '@abraxa/db';
import { log } from '../logger';
import type { BlueprintGuardado } from '../types';

export interface BlueprintSink {
  /** Quién lo implementa. Aparece en `applied_by` y en los logs. */
  readonly nombre: string;

  /**
   * Proyecta el blueprint a donde vivan las áreas operables.
   *
   * Tiene que ser IDEMPOTENTE: se puede reintentar sobre un tenant que ya se
   * proyectó a medias. El barrido de recuperación lo va a llamar más de una vez
   * y no puede dejar áreas duplicadas.
   */
  aplicar(ctx: TenantContext, blueprint: BlueprintGuardado): Promise<void>;
}

let registrado: BlueprintSink | null = null;

/**
 * Registra quién materializa los blueprints. Lo llama H11 desde su `index.ts`.
 *
 * Pasar `null` lo desregistra — sólo para pruebas.
 */
export function registrarBlueprintSink(sink: BlueprintSink | null): void {
  registrado = sink;
  if (sink) log.info(`BlueprintSink registrado: ${sink.nombre}`);
}

/** El sink registrado, o `null` si la ola 3 todavía no llega. */
export function blueprintSink(): BlueprintSink | null {
  return registrado;
}

export function haySink(): boolean {
  return registrado !== null;
}
