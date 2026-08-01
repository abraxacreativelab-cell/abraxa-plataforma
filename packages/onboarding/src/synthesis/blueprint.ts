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
  'id, tenant_id, session_id, version, industry_type, areas, milestones, summary, applied_at, applied_by, apply_error, vault_document_id, created_at';

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
  vault_document_id: string | null;
  created_at: string;
}

/** El SQLSTATE de una violación de UNIQUE. Lo devuelve PostgREST tal cual. */
const CHOQUE_DE_UNICIDAD = '23505';

function esChoqueDeUnicidad(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === CHOQUE_DE_UNICIDAD
  );
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
    vaultDocumentId: f.vault_document_id ?? null,
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

/** El blueprint de una sesión concreta, o `null`. */
export async function blueprintDeSesion(
  ctx: TenantContext,
  sessionId: string,
): Promise<BlueprintGuardado | null> {
  return (await listarBlueprints(ctx)).find((b) => b.sessionId === sessionId) ?? null;
}

/**
 * Persiste el mapa del Ritual. Un Ritual, un mapa.
 *
 * ── Por qué ya no crea una versión nueva cada vez (auditoría PR #8) ───────
 *
 * Antes calculaba `version = previa + 1` y siempre insertaba, con este
 * razonamiento: «un emprendedor puede corregir un dato y volver a pedir su
 * mapa, y lo que se le prometió la primera vez sigue siendo parte de su
 * historia». La intención está bien; el problema es que esa puerta nunca se
 * abrió —`responder()` corta en seco cuando el status es 'completada', así que
 * no hay camino de producto que pida una re-síntesis— y el único que llegaba a
 * usar el `+1` era un defecto: la segunda entrada a la fase 6, que insertaba
 * una v2 idéntica sin violar nada y dejaba al emprendedor con dos mapas y dos
 * documentos madre.
 *
 * Ahora es idempotente por sesión. Y lo es en dos capas a propósito:
 *
 *   · la lectura de arriba resuelve el caso normal —volver a entrar a la fase
 *     6— sin provocar un error en la base;
 *   · el `UNIQUE (tenant_id, session_id)` de la 052 resuelve el caso que la
 *     lectura no puede ver, que es el único que importa de verdad: dos cierres
 *     que leyeron los dos "no hay blueprint" antes de que ninguno insertara.
 *     Ahí el árbitro es Postgres, y el que pierde se lleva el mapa del que ganó
 *     en vez de un 500.
 *
 * Comprobar y además dejar que la base compruebe no es redundancia: es que una
 * de las dos comprobaciones no puede correr dentro de la carrera y la otra sí.
 */
export async function guardarBlueprint(
  ctx: TenantContext,
  sessionId: string,
  mapa: MapaDeNegocio,
): Promise<BlueprintGuardado> {
  const previos = await listarBlueprints(ctx);

  const suyo = previos.find((b) => b.sessionId === sessionId);
  if (suyo) {
    log.info(
      `el ritual ${sessionId} ya tenía su blueprint (v${suyo.version}); ` +
        'no se crea otro. La fase 6 se volvió a pedir y es idempotente.',
    );
    return suyo;
  }

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

  if (error) {
    if (esChoqueDeUnicidad(error)) {
      const ganador = await blueprintDeSesion(ctx, sessionId);
      if (ganador) {
        log.info(
          `dos cierres del ritual ${sessionId} insertaron a la vez; ` +
            `gana el v${ganador.version} y este se descarta sin tocar nada.`,
        );
        return ganador;
      }
    }
    throw error;
  }

  const fila = (data as FilaBlueprint[] | null)?.[0];
  if (!fila) throw new Error('El blueprint se guardó pero la base no devolvió la fila.');

  log.info(
    `blueprint v${version} guardado: ${mapa.areas.length} áreas, ${mapa.hitos.length} hitos`,
  );
  return mapear(fila);
}

/**
 * Anota qué documento madre entró a la bóveda, para no volver a mandarlo.
 *
 * `VaultPort.ingestDocument()` no recibe llave de idempotencia —el port es de
 * H1 y agregársela falla el gate de propiedad—, así que la llave vive aquí: una
 * fila por Ritual, con el acuse de la ingesta. Lleno = ya entró.
 *
 * Igual que `marcarAplicado`, sólo se registra: el documento YA está en la
 * bóveda y no poder anotarlo no cambia ese hecho. Lo único que se pierde es la
 * protección contra un segundo envío, y para eso está el resto del cierre.
 */
export async function marcarDocumentoMadre(
  ctx: TenantContext,
  blueprintId: string,
  documentId: string,
): Promise<void> {
  const { error } = await tenantDb(ctx)
    .from('onboarding_blueprints')
    .update({ vault_document_id: documentId })
    .eq('id', blueprintId);

  if (error) {
    log.warn(
      `no se pudo anotar el documento madre ${documentId} en el blueprint ${blueprintId}: ` +
        String(error),
    );
  }
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
