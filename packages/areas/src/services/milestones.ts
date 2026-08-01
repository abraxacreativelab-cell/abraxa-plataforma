/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El roadmap de hitos
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Lo propone el agente maestro y el emprendedor lo edita, lo reordena y lo
 *  marca (criterio 7). Va al lado del mapa: las áreas dicen QUÉ tiene, los
 *  hitos dicen QUÉ SIGUE.
 *
 *  ── Por qué los hitos no son tareas ────────────────────────────────────────
 *
 *  H9 ya tiene tareas, y sería fácil decir que un hito es una tarea con una
 *  bandera. No lo es: una tarea es algo que alguien hace esta semana, y un hito
 *  es algo que el NEGOCIO alcanza —"tener el primer empleado", "cobrar sin
 *  perseguir a nadie"—. Meterlos en la misma tabla convertiría el roadmap en
 *  una lista de pendientes, que es exactamente lo que el handoff pide que NO
 *  se sienta. El propio `packages/work` lo dice en su cabecera: *"los hitos son
 *  del roadmap del negocio (H11), no de las tareas"*.
 */
import { PlatformError, tenantDb, tryPort } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import type { Milestone, MilestoneRow } from '../domain/types';
import { COLUMNAS_HITO as COLUMNAS, LIMITE_HITOS } from '../data/tablas';

export { LIMITE_HITOS };

function aHito(row: MilestoneRow): Milestone {
  return {
    id: row.id,
    areaSlug: row.area_slug,
    title: row.title,
    description: row.description,
    position: Number(row.position ?? 0),
    done: row.done_at !== null,
    doneAt: row.done_at,
    generatedBy: row.generated_by,
  };
}

const texto = (v: unknown, campo: string, max = 200): string => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) throw new PlatformError('VALIDATION', `Falta ${campo}.`);
  if (s.length > max) throw new PlatformError('VALIDATION', `${campo} no puede pasar de ${max} caracteres.`);
  return s;
};

// ════════════════════════════════════════════════════════════════════════════

export async function listMilestones(ctx: TenantContext): Promise<Milestone[]> {
  const { data, error } = await tenantDb(ctx)
    .from('tenant_milestones')
    .select(COLUMNAS)
    .order('position', { ascending: true })
    .limit(LIMITE_HITOS);

  if (error) throw new PlatformError('INTERNAL', `No se pudo leer el roadmap: ${error.message}`);
  return ((data ?? []) as unknown as MilestoneRow[]).map(aHito);
}

/**
 * `title` es OPCIONAL en el tipo y obligatorio en tiempo de ejecución, y no es
 * una contradicción: esto se llama con el cuerpo de una petición HTTP, donde
 * la clave puede sencillamente no venir. Declararla requerida obligaría al
 * router a mentirle al compilador con un cast para poder pasarle lo que de
 * verdad llegó por la red. Quien valida es `texto()`, que lanza VALIDATION con
 * un mensaje que el usuario puede leer.
 */
export async function createMilestone(
  ctx: TenantContext,
  i: { title?: unknown; description?: unknown; areaSlug?: unknown; position?: unknown },
): Promise<Milestone> {
  const actuales = await listMilestones(ctx);
  if (actuales.length >= LIMITE_HITOS) {
    throw new PlatformError('VALIDATION', `El roadmap ya tiene ${LIMITE_HITOS} hitos.`);
  }

  // Al final por defecto: un hito nuevo no se cuela en medio del plan.
  const position =
    typeof i.position === 'number' && Number.isFinite(i.position)
      ? i.position
      : (actuales.at(-1)?.position ?? 0) + 1;

  const { data, error } = await tenantDb(ctx)
    .from('tenant_milestones')
    .insert({
      title: texto(i.title, 'el título del hito'),
      description: typeof i.description === 'string' ? i.description.trim() || null : null,
      area_slug: typeof i.areaSlug === 'string' && i.areaSlug.trim() ? i.areaSlug.trim() : null,
      position,
      generated_by: 'user',
    })
    .select(COLUMNAS)
    .single();

  if (error) throw new PlatformError('INTERNAL', `No se pudo crear el hito: ${error.message}`);
  return aHito(data as unknown as MilestoneRow);
}

export async function updateMilestone(
  ctx: TenantContext,
  id: string,
  patch: { title?: unknown; description?: unknown; areaSlug?: unknown; done?: unknown },
): Promise<Milestone> {
  const cambios: Record<string, unknown> = {};

  if (patch.title !== undefined) cambios.title = texto(patch.title, 'el título del hito');
  if (patch.description !== undefined) {
    cambios.description = typeof patch.description === 'string' ? patch.description.trim() || null : null;
  }
  if (patch.areaSlug !== undefined) {
    cambios.area_slug =
      typeof patch.areaSlug === 'string' && patch.areaSlug.trim() ? patch.areaSlug.trim() : null;
  }
  // Marcar y desmarcar. `done_at` guarda CUÁNDO, no sólo que sí: es lo que
  // permite que el mapa enseñe lo que ya construyó y cuándo.
  if (patch.done !== undefined) {
    cambios.done_at = patch.done === true ? new Date().toISOString() : null;
  }

  if (!Object.keys(cambios).length) {
    throw new PlatformError('VALIDATION', 'No hay nada que cambiar en el hito.');
  }

  const { data, error } = await tenantDb(ctx)
    .from('tenant_milestones')
    .update(cambios)
    .eq('id', id)
    .select(COLUMNAS)
    .maybeSingle();

  if (error) throw new PlatformError('INTERNAL', `No se pudo cambiar el hito: ${error.message}`);
  if (!data) throw new PlatformError('NOT_FOUND', 'Ese hito no existe.');
  return aHito(data as unknown as MilestoneRow);
}

export async function deleteMilestone(ctx: TenantContext, id: string): Promise<{ deleted: boolean }> {
  const { error } = await tenantDb(ctx).from('tenant_milestones').delete().eq('id', id);
  if (error) throw new PlatformError('INTERNAL', `No se pudo borrar el hito: ${error.message}`);
  return { deleted: true };
}

/**
 * Reordena el roadmap.
 *
 * Recibe los ids en el orden nuevo y les asigna posiciones 1..N. Se escriben
 * una por una: si la quinta falla, las cuatro anteriores quedan movidas y el
 * usuario ve un orden a medias que puede volver a arrastrar. La alternativa
 * —una función transaccional como la de H9— existe porque allá reordenar
 * arrastra estados y jerarquía; aquí sólo es un número, y el peor caso es
 * cosmético y auto-reparable.
 *
 * Los ids que no son del tenant simplemente no se encuentran: el filtro lo pone
 * `tenantDb(ctx)`.
 */
export async function reorderMilestones(ctx: TenantContext, ids: unknown): Promise<Milestone[]> {
  if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string')) {
    throw new PlatformError('VALIDATION', 'Se esperaba la lista de ids del roadmap en su orden nuevo.');
  }
  if (ids.length > LIMITE_HITOS) {
    throw new PlatformError('VALIDATION', `No se pueden reordenar más de ${LIMITE_HITOS} hitos.`);
  }

  let i = 0;
  for (const id of ids as string[]) {
    i += 1;
    const { error } = await tenantDb(ctx)
      .from('tenant_milestones')
      .update({ position: i })
      .eq('id', id);
    if (error) throw new PlatformError('INTERNAL', `No se pudo reordenar el roadmap: ${error.message}`);
  }

  return listMilestones(ctx);
}

// ════════════════════════════════════════════════════════════════════════════
// El roadmap que propone el agente maestro
// ════════════════════════════════════════════════════════════════════════════

/** Cuántos hitos se le piden al agente. Menos de cuatro no es un plan; más de
 *  seis ya no se lee de un vistazo. */
const HITOS_PEDIDOS = 5;

const PROMPT = `Eres el agente maestro de este negocio. Propón exactamente ${HITOS_PEDIDOS} hitos
para los próximos meses: cosas que el NEGOCIO alcanza, no tareas de una semana.

Reglas:
- Habla de su negocio con sus palabras, no de software.
- Cada hito tiene que ser verificable: se sabe si ya pasó o no.
- Ordénalos como se van a lograr, del más cercano al más lejano.

Responde SÓLO con un arreglo JSON, sin texto alrededor:
[{"title":"...","description":"...","areaSlug":"ventas"}]
El campo areaSlug es opcional y sólo si el hito claramente es de un área.`;

/** Lo que el modelo devolvió, si es que devolvió algo utilizable. */
function leerPropuesta(texto: string): Array<{ title: string; description?: string; areaSlug?: string }> {
  // El modelo a veces envuelve el JSON en ``` o lo precede de una frase. Se
  // recorta al primer arreglo bien formado en vez de fallar por el envoltorio.
  const inicio = texto.indexOf('[');
  const fin = texto.lastIndexOf(']');
  if (inicio < 0 || fin <= inicio) return [];

  try {
    const crudo: unknown = JSON.parse(texto.slice(inicio, fin + 1));
    if (!Array.isArray(crudo)) return [];
    return crudo
      .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
      .map((x) => ({
        title: String(x.title ?? '').trim(),
        description: typeof x.description === 'string' ? x.description.trim() : undefined,
        areaSlug: typeof x.areaSlug === 'string' ? x.areaSlug.trim() : undefined,
      }))
      .filter((x) => x.title.length > 0);
  } catch {
    // Un JSON roto del modelo no es un error del sistema: es una propuesta que
    // no sirvió. Se devuelve vacío y el llamador lo dice.
    return [];
  }
}

/**
 * Le pide al agente maestro (H3) que proponga el roadmap.
 *
 * NO borra lo que ya hay: se agrega al final. El roadmap es del emprendedor —
 * si ya marcó tres hitos y editó otro, una propuesta nueva no puede llevárselos.
 *
 * Si H3 no está registrado, devuelve `{ created: 0, reason }` en vez de lanzar.
 * El mapa tiene que servir aunque el motor de agentes no esté: el roadmap es
 * una parte de la pantalla, no la pantalla.
 */
export async function proposeMilestones(
  ctx: TenantContext,
): Promise<{ created: number; milestones: Milestone[]; reason: string | null }> {
  const agents = tryPort('agents');
  if (!agents) {
    return {
      created: 0,
      milestones: await listMilestones(ctx),
      reason: 'El motor de agentes (H3) todavía no está registrado.',
    };
  }

  const salida = await agents.run(ctx, { role: 'master', input: PROMPT });
  const propuesta = leerPropuesta(salida.text).slice(0, HITOS_PEDIDOS);

  if (!propuesta.length) {
    return {
      created: 0,
      milestones: await listMilestones(ctx),
      reason: `${salida.agentName} no devolvió un roadmap que se pudiera leer.`,
    };
  }

  const actuales = await listMilestones(ctx);
  const base = actuales.at(-1)?.position ?? 0;
  const cupo = Math.max(0, LIMITE_HITOS - actuales.length);

  const filas = propuesta.slice(0, cupo).map((p, i) => ({
    title: p.title.slice(0, 200),
    description: p.description?.slice(0, 1000) ?? null,
    area_slug: p.areaSlug || null,
    position: base + i + 1,
    generated_by: 'master_agent',
  }));

  if (!filas.length) {
    return { created: 0, milestones: actuales, reason: 'El roadmap ya está lleno.' };
  }

  const { error } = await tenantDb(ctx).from('tenant_milestones').insert(filas);
  if (error) throw new PlatformError('INTERNAL', `No se pudo guardar el roadmap: ${error.message}`);

  return { created: filas.length, milestones: await listMilestones(ctx), reason: null };
}
