/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El blueprint: guardarlo, y proyectarlo cuando haya a dónde.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Dos pasos separados a propósito. Guardar la decisión NUNCA puede fallar por
 *  culpa de un consumidor que todavía no existe: son 20 minutos de tiempo de un
 *  cliente y no se pierden porque la ola 3 no haya empezado.
 *
 *  Ver ports/blueprint-sink.ts para por qué el segundo paso vive detrás de una
 *  interfaz declarada en este carril.
 */
import { tenantDb } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import { log } from '../logger';
import { blueprintSink } from '../ports/blueprint-sink';
import type { AreaDelMapa, BlueprintGuardado, Hito, MapaDeNegocio } from '../types';

const COLUMNAS =
  'id, tenant_id, session_id, version, industry_type, areas, milestones, summary, applied_at, applied_by, apply_error, created_at';

interface FilaBlueprint {
  id: string;
  tenant_id: string;
  session_id: string;
  version: number;
  industry_type: string | null;
  areas: AreaDelMapa[] | null;
  milestones: Hito[] | null;
  summary: string | null;
  applied_at: string | null;
  applied_by: string | null;
  apply_error: string | null;
  created_at: string;
}

function mapear(f: FilaBlueprint): BlueprintGuardado {
  return {
    id: f.id,
    tenantId: f.tenant_id,
    sessionId: f.session_id,
    version: f.version,
    industryType: f.industry_type ?? null,
    areas: f.areas ?? [],
    hitos: f.milestones ?? [],
    resumen: f.summary ?? '',
    // `?? null` y no el valor crudo: una columna que nunca se escribió llega
    // como `undefined` desde algunos clientes y como `null` desde Postgres, y
    // `aplicarBlueprintsPendientes` filtra por `=== null`. Normalizar aquí es
    // lo que evita que un blueprint pendiente se vuelva invisible.
    appliedAt: f.applied_at ?? null,
    appliedBy: f.applied_by ?? null,
    applyError: f.apply_error ?? null,
    createdAt: f.created_at,
  };
}

/** Los blueprints del tenant, del más nuevo al más viejo. */
export async function listarBlueprints(ctx: TenantContext): Promise<BlueprintGuardado[]> {
  const { data, error } = await tenantDb(ctx)
    .from('onboarding_blueprints')
    .select(COLUMNAS)
    .order('version', { ascending: false });

  if (error) throw error;
  return ((data as FilaBlueprint[] | null) ?? []).map(mapear);
}

/** El vigente: la última versión sintetizada. */
export async function blueprintVigente(ctx: TenantContext): Promise<BlueprintGuardado | null> {
  const todos = await listarBlueprints(ctx);
  return todos[0] ?? null;
}

/**
 * Persiste el mapa como una versión nueva.
 *
 * No pisa la anterior. Un emprendedor puede corregir un dato y volver a pedir
 * su mapa, y lo que se le prometió la primera vez sigue siendo parte de su
 * historia — sobre todo si en el intermedio ya empezó a trabajar con él.
 */
export async function guardarBlueprint(
  ctx: TenantContext,
  sessionId: string,
  mapa: MapaDeNegocio,
): Promise<BlueprintGuardado> {
  const previos = await listarBlueprints(ctx);
  const version = (previos[0]?.version ?? 0) + 1;

  const { data, error } = await tenantDb(ctx)
    .from('onboarding_blueprints')
    .insert({
      session_id: sessionId,
      version,
      industry_type: mapa.industryType,
      areas: mapa.areas,
      milestones: mapa.hitos,
      summary: mapa.resumen,
    })
    .select(COLUMNAS);

  if (error) throw error;
  const fila = (data as FilaBlueprint[] | null)?.[0];
  if (!fila) throw new Error('El blueprint se guardó pero la base no devolvió la fila.');

  log.info(
    `blueprint v${version} guardado: ${mapa.areas.length} áreas, ${mapa.hitos.length} hitos`,
  );
  return mapear(fila);
}

/**
 * Proyecta un blueprint a las tablas operables, si hay quien las escriba.
 *
 * NUNCA lanza. Un fallo del sink deja `apply_error` escrito en la fila y la
 * marca como pendiente otra vez: el barrido la vuelve a tomar. Reventar aquí
 * tumbaría el último turno del Ritual —justo el del Mapa de Negocio— por un
 * problema que no es del emprendedor.
 *
 * @returns `true` si quedó proyectado.
 */
export async function aplicarBlueprint(
  ctx: TenantContext,
  blueprint: BlueprintGuardado,
): Promise<boolean> {
  const sink = blueprintSink();

  if (!sink) {
    log.info(
      `blueprint ${blueprint.id} guardado sin proyectar: no hay BlueprintSink registrado ` +
        '(lo entrega H11 · packages/areas). Queda pendiente en app.onboarding_blueprints ' +
        'y se aplica solo cuando aterrice.',
    );
    return false;
  }

  try {
    await sink.aplicar(ctx, blueprint);
    await marcarAplicado(ctx, blueprint.id, sink.nombre, null);
    log.info(`blueprint ${blueprint.id} proyectado por ${sink.nombre}`);
    return true;
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err);
    log.error(`el sink ${sink.nombre} falló con el blueprint ${blueprint.id}: ${motivo}`);
    await marcarAplicado(ctx, blueprint.id, null, motivo);
    return false;
  }
}

async function marcarAplicado(
  ctx: TenantContext,
  id: string,
  porQuien: string | null,
  error: string | null,
): Promise<void> {
  const patch: Record<string, unknown> = { apply_error: error };
  if (porQuien) {
    patch.applied_at = new Date().toISOString();
    patch.applied_by = porQuien;
  }

  const { error: fallo } = await tenantDb(ctx)
    .from('onboarding_blueprints')
    .update(patch)
    .eq('id', id);

  // Sólo se registra: el blueprint YA se aplicó o YA falló, y no poder anotarlo
  // no cambia ninguno de los dos hechos.
  if (fallo) log.warn(`no se pudo anotar el resultado del blueprint ${id}: ${String(fallo)}`);
}

/**
 * El barrido de recuperación: proyecta todo lo que quedó pendiente.
 *
 * Es lo que H11 corre UNA VEZ el día que aterrice, y lo que el Ritual llama al
 * arrancar por si el sink se registró después de que un cliente terminó.
 *
 * @returns cuántos quedaron proyectados.
 */
export async function aplicarBlueprintsPendientes(ctx: TenantContext): Promise<number> {
  if (!blueprintSink()) return 0;

  const pendientes = (await listarBlueprints(ctx)).filter((b) => b.appliedAt === null);
  let aplicados = 0;
  for (const b of pendientes) {
    if (await aplicarBlueprint(ctx, b)) aplicados++;
  }
  if (aplicados > 0) log.info(`barrido: ${aplicados} blueprint(s) pendiente(s) proyectados`);
  return aplicados;
}
