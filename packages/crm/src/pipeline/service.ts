/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Embudo y etapas
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Lo importante de aquí es `moverEtapa`, que es el nodo `move_stage` de H8 y
 *  el disparador `stage_changed` al mismo tiempo. Tiene una regla que no se
 *  negocia y que GARDEN no tiene:
 *
 *      MOVER A LA ETAPA EN LA QUE YA ESTÁ NO EMITE NADA.
 *
 *  Sin eso, el ejemplo literal del handoff de H8 —"cuando entre un lead,
 *  métemelo en Contactado"— se dispara a sí mismo: mueve a Contactado, emite
 *  `stage_changed`, el flujo que escucha `stage_changed` mueve a Contactado,
 *  emite otra vez. El anti-loop de 100 pasos del motor lo corta, pero después
 *  de 100 mensajes al cliente. Se corta aquí, en el origen.
 */
import { PlatformError } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import type { Pipeline, PipelineStage } from '../port';
import type { FilaEmbudo, FilaEtapa, FilaPosicion } from '../types';
import { aNumero, ahora, aSlug, db, esDuplicado, fallo, lista } from '../store';
import { EMBUDO_POR_DEFECTO, ETAPAS_POR_DEFECTO } from './defaults';
import { registrarEvento } from '../timeline/service';
import { exigirContacto } from '../contacts/service';
import { emitir } from '../events';

// ════════════════════════════════════════════════════════════════════════════
// Lectura
// ════════════════════════════════════════════════════════════════════════════

function aEtapa(f: FilaEtapa): PipelineStage {
  return {
    id: f.id,
    slug: f.slug,
    name: f.name,
    position: f.position,
    probability: f.probability,
    isWon: f.is_won,
    isLost: f.is_lost,
  };
}

export async function listarEmbudos(ctx: TenantContext): Promise<Pipeline[]> {
  const [e, s] = await Promise.all([
    db(ctx).from('pipelines').select('*').order('position', { ascending: true }),
    db(ctx).from('pipeline_stages').select('*').order('position', { ascending: true }),
  ]);

  const embudos = lista(e, 'embudos') as unknown as FilaEmbudo[];
  const etapas = lista(s, 'etapas') as unknown as FilaEtapa[];

  const porEmbudo = new Map<string, PipelineStage[]>();
  for (const f of etapas) {
    if (!porEmbudo.has(f.pipeline_id)) porEmbudo.set(f.pipeline_id, []);
    porEmbudo.get(f.pipeline_id)?.push(aEtapa(f));
  }
  for (const v of porEmbudo.values()) v.sort((a, b) => a.position - b.position);

  return embudos
    .sort((a, b) => a.position - b.position)
    .map((f) => ({
      id: f.id,
      slug: f.slug,
      name: f.name,
      isDefault: f.is_default,
      position: f.position,
      stages: porEmbudo.get(f.id) ?? [],
    }));
}

/**
 * El embudo con el que trabajar cuando el llamador no dijo cuál.
 *
 * Prefiere el marcado por defecto; si no hay ninguno, el primero por posición.
 * No inventa uno: si el tenant no tiene embudos, quien llama debe correr
 * `sembrarEmbudoPorDefecto` — crear tablas de catálogo dentro de una operación
 * de negocio es cómo aparecen embudos fantasma en las cuentas.
 */
async function resolverEmbudo(ctx: TenantContext, referencia?: string): Promise<FilaEmbudo> {
  const filas = lista(
    await db(ctx).from('pipelines').select('*').order('position', { ascending: true }),
    'embudos',
  ) as unknown as FilaEmbudo[];

  if (filas.length === 0) {
    throw new PlatformError(
      'NOT_FOUND',
      'Este negocio no tiene ningún embudo. Corre ensureDefaultPipeline() primero ' +
        '(lo hace H7 al terminar el Ritual de Fundación).',
    );
  }

  if (referencia) {
    const hallado = filas.find((f) => f.id === referencia || f.slug === referencia);
    if (!hallado) {
      throw new PlatformError('NOT_FOUND', `No existe el embudo "${referencia}"`);
    }
    return hallado;
  }

  const porDefecto = filas.find((f) => f.is_default);
  const primero = filas[0];
  if (porDefecto) return porDefecto;
  if (primero) return primero;
  throw new PlatformError('NOT_FOUND', 'Este negocio no tiene ningún embudo');
}

async function resolverEtapa(
  ctx: TenantContext,
  pipelineId: string,
  referencia: string,
): Promise<FilaEtapa> {
  const filas = lista(
    await db(ctx).from('pipeline_stages').select('*').eq('pipeline_id', pipelineId),
    'etapas',
  ) as unknown as FilaEtapa[];

  const hallada = filas.find((f) => f.id === referencia || f.slug === referencia);
  if (hallada) return hallada;

  // El asistente de H8 propone en español: "Contactado" en vez de "contactado".
  // Aceptarlo aquí evita que una automatización válida falle por una mayúscula.
  const porSlug = aSlug(referencia);
  const porNombre = filas.find((f) => f.slug === porSlug || aSlug(f.name) === porSlug);
  if (porNombre) return porNombre;

  throw new PlatformError(
    'NOT_FOUND',
    `No existe la etapa "${referencia}" en este embudo. ` +
      `Las que hay: ${filas.map((f) => f.slug).join(', ') || '(ninguna)'}.`,
    { details: { pipelineId, disponibles: filas.map((f) => f.slug) } },
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Siembra
// ════════════════════════════════════════════════════════════════════════════

/**
 * Crea el embudo por defecto si el tenant no tiene ninguno. Idempotente.
 *
 * Lo llama H7 al final del Ritual. Si ya hay embudos, NO agrega nada: un
 * emprendedor que se armó el suyo no quiere encontrarse otro que no pidió.
 */
export async function sembrarEmbudoPorDefecto(
  ctx: TenantContext,
): Promise<{ pipelineId: string; created: boolean }> {
  const existentes = lista(
    await db(ctx).from('pipelines').select('*'),
    'embudos',
  ) as unknown as FilaEmbudo[];

  const yaEsta = existentes.find((f) => f.slug === EMBUDO_POR_DEFECTO.slug);
  if (yaEsta) return { pipelineId: yaEsta.id, created: false };
  const primero = existentes[0];
  if (primero) return { pipelineId: primero.id, created: false };

  const alta = await db(ctx)
    .from('pipelines')
    .insert({
      slug: EMBUDO_POR_DEFECTO.slug,
      name: EMBUDO_POR_DEFECTO.name,
      is_default: true,
      position: 0,
    })
    .select('id');

  if (alta.error) {
    /* Otro proceso lo sembró entre nuestro SELECT y nuestro INSERT — H7 y el
       webhook de alta de H10 pueden correr casi a la vez. El índice único
       `(tenant_id, slug)` es el árbitro; aquí sólo se relee al ganador. */
    if (!esDuplicado(alta.error)) throw fallo(alta.error, 'crear embudo por defecto');
    const reintento = lista(
      await db(ctx).from('pipelines').select('*').eq('slug', EMBUDO_POR_DEFECTO.slug).limit(1),
      'embudo por defecto',
    ) as unknown as FilaEmbudo[];
    const ganador = reintento[0];
    if (!ganador) throw fallo(alta.error, 'crear embudo por defecto');
    return { pipelineId: ganador.id, created: false };
  }

  const filas = (alta.data ?? []) as Array<{ id: string }>;
  const pipelineId = filas[0]?.id;
  if (!pipelineId) {
    throw new PlatformError('INTERNAL', 'crear embudo por defecto: el INSERT no devolvió id');
  }

  for (const [indice, etapa] of ETAPAS_POR_DEFECTO.entries()) {
    const r = await db(ctx)
      .from('pipeline_stages')
      .insert({
        pipeline_id: pipelineId,
        slug: etapa.slug,
        name: etapa.name,
        position: indice,
        probability: etapa.probability,
        is_won: etapa.isWon ?? false,
        is_lost: etapa.isLost ?? false,
      });
    if (r.error && !esDuplicado(r.error)) throw fallo(r.error, `crear etapa ${etapa.slug}`);
  }

  return { pipelineId, created: true };
}

// ════════════════════════════════════════════════════════════════════════════
// Moneda
// ════════════════════════════════════════════════════════════════════════════

/**
 * `currency` existía en la columna (121: `text NOT NULL DEFAULT 'MXN'`) y en
 * `ContactPlacement`, pero NINGUNA ruta podía escribirla: `moveStage` no
 * recibía moneda. Un negocio que cotiza en dólares mandaba
 * `{"stage":"propuesta","amount":5000}` para 5,000 USD y la fila quedaba en
 * MXN, que la ficha imprimía como "$5,000.00" en pesos. Es el mismo defecto que
 * la auditoría encontró en H4 —un monto en USD guardado como MXN— sólo que
 * aquí el usuario ni siquiera podía declarar la moneda. El tipo del port
 * prometía una capacidad que el backend no cumplía.
 *
 * Se valida la FORMA (ISO-4217: tres letras) y no contra un catálogo cerrado:
 * una lista blanca en este archivo es una migración de otro carril cada vez que
 * alguien vende en una moneda nueva.
 */
export function normalizarMoneda(entrada?: string | null): string | undefined {
  if (entrada === undefined || entrada === null) return undefined;
  const m = String(entrada).trim().toUpperCase();
  if (!m) return undefined;
  if (!/^[A-Z]{3}$/.test(m)) {
    throw new PlatformError(
      'VALIDATION',
      `"${entrada}" no es un código de moneda ISO-4217 (tres letras, como MXN o USD).`,
    );
  }
  return m;
}

// ════════════════════════════════════════════════════════════════════════════
// El nodo move_stage
// ════════════════════════════════════════════════════════════════════════════

export async function moverEtapa(
  ctx: TenantContext,
  i: {
    contactId: string;
    stage: string;
    pipeline?: string;
    amount?: number;
    /** ISO-4217. Si no se dice, la columna se queda con su DEFAULT 'MXN'. */
    currency?: string;
    actor?: string;
  },
): Promise<{ moved: boolean; stageId: string; previousStageId: string | null }> {
  // 404 legible antes de tocar el embudo. `moverEtapa` ya fallaba con un id
  // inexistente, pero por accidente —su INSERT tropezaba con la FK— y con un
  // VALIDATION que hablaba de "referencia inexistente" en vez de decir que el
  // contacto no existe. Ver `exigirContacto` en contacts/service.ts.
  await exigirContacto(ctx, i.contactId);

  const embudo = await resolverEmbudo(ctx, i.pipeline);
  const etapa = await resolverEtapa(ctx, embudo.id, i.stage);
  const moneda = normalizarMoneda(i.currency);

  const actuales = lista(
    await db(ctx)
      .from('contact_stages')
      .select('*')
      .eq('contact_id', i.contactId)
      .eq('pipeline_id', embudo.id),
    'posición actual',
  ) as unknown as FilaPosicion[];
  const actual = actuales[0] ?? null;
  const anterior = actual?.stage_id ?? null;

  // ── La regla anti-bucle ─────────────────────────────────────────────────
  if (anterior === etapa.id) {
    // El monto sí se puede actualizar sin que eso sea "un cambio de etapa".
    const cambiaMonto = i.amount !== undefined && aNumero(actual?.amount ?? null) !== i.amount;
    const cambiaMoneda = moneda !== undefined && actual?.currency !== moneda;
    if (cambiaMonto || cambiaMoneda) {
      const r = await db(ctx)
        .from('contact_stages')
        .update({
          ...(i.amount !== undefined ? { amount: i.amount } : {}),
          ...(moneda !== undefined ? { currency: moneda } : {}),
          updated_at: ahora(),
        })
        .eq('contact_id', i.contactId)
        .eq('pipeline_id', embudo.id);
      if (r.error) throw fallo(r.error, 'actualizar monto');
    }
    return { moved: false, stageId: etapa.id, previousStageId: anterior };
  }

  const t = ahora();
  if (actual) {
    const r = await db(ctx)
      .from('contact_stages')
      .update({
        stage_id: etapa.id,
        entered_at: t,
        updated_at: t,
        ...(i.amount !== undefined ? { amount: i.amount } : {}),
        ...(moneda !== undefined ? { currency: moneda } : {}),
      })
      .eq('contact_id', i.contactId)
      .eq('pipeline_id', embudo.id);
    if (r.error) throw fallo(r.error, 'mover de etapa');
  } else {
    const r = await db(ctx)
      .from('contact_stages')
      .insert({
        contact_id: i.contactId,
        pipeline_id: embudo.id,
        stage_id: etapa.id,
        amount: i.amount ?? null,
        ...(moneda !== undefined ? { currency: moneda } : {}),
        entered_at: t,
        updated_at: t,
      });
    if (r.error) throw fallo(r.error, 'colocar en el embudo');
  }

  await db(ctx).from('contacts').update({ last_activity_at: t }).eq('id', i.contactId);

  const nombreAnterior = anterior
    ? (
        lista(
          await db(ctx).from('pipeline_stages').select('name').eq('id', anterior).limit(1),
          'etapa anterior',
        ) as unknown as Array<{ name: string }>
      )[0]?.name
    : null;

  await registrarEvento(ctx, {
    contactId: i.contactId,
    type: 'stage_changed',
    summary: nombreAnterior
      ? `${nombreAnterior} → ${etapa.name}`
      : `Entró al embudo ${embudo.name} en "${etapa.name}"`,
    payload: {
      pipelineId: embudo.id,
      pipelineSlug: embudo.slug,
      stageId: etapa.id,
      stageSlug: etapa.slug,
      previousStageId: anterior,
    },
    actor: i.actor ?? 'system',
  });

  await emitir(ctx, 'stage_changed', {
    contactId: i.contactId,
    pipelineId: embudo.id,
    pipelineSlug: embudo.slug,
    stageId: etapa.id,
    stageSlug: etapa.slug,
    previousStageId: anterior,
    isWon: etapa.is_won,
    isLost: etapa.is_lost,
  });

  return { moved: true, stageId: etapa.id, previousStageId: anterior };
}

// ════════════════════════════════════════════════════════════════════════════
// Tablero
// ════════════════════════════════════════════════════════════════════════════

/**
 * El tablero.
 *
 * `amounts` es un mapa `{ MXN: 120000, USD: 5000 }` y NO un número pelón.
 * Antes se sumaba `amount` ignorando `currency` y el resultado se pintaba con
 * MXN duro: el día que cualquier vía —una importación, H10, un `update` a
 * mano— escribiera `currency='USD'`, el tablero sumaba 1,000 USD + 1,000 MXN y
 * mostraba "$2,000". Agrupar no es una mejora cosmética: es lo que hace que
 * sumar mezclado deje de ser representable.
 *
 * `amount` se conserva por compatibilidad con quien ya lo consume, y es la suma
 * de la moneda MAYORITARIA del embudo, no de todas — nunca un total mezclado.
 */
export async function estadisticasEmbudo(
  ctx: TenantContext,
  i: { pipeline?: string } = {},
): Promise<{
  pipelineId: string;
  /** La moneda con más dinero en este embudo. Es la que debe pintar la UI. */
  currency: string;
  stages: Array<{
    stageId: string;
    slug: string;
    name: string;
    count: number;
    amount: number;
    amounts: Record<string, number>;
  }>;
}> {
  const embudo = await resolverEmbudo(ctx, i.pipeline);

  const etapas = (
    lista(
      await db(ctx).from('pipeline_stages').select('*').eq('pipeline_id', embudo.id),
      'etapas',
    ) as unknown as FilaEtapa[]
  ).sort((a, b) => a.position - b.position);

  const posiciones = lista(
    await db(ctx).from('contact_stages').select('*').eq('pipeline_id', embudo.id),
    'posiciones',
  ) as unknown as FilaPosicion[];

  /* Los contactos fusionados siguen en `contact_stages` hasta que alguien
     ejecute una limpieza, y contarlos inflaría el tablero con tarjetas que el
     emprendedor ya no ve. Se descartan aquí. */
  const fusionados = new Set(
    (
      lista(
        await db(ctx).from('contacts').select('id, merged_into').limit(5000),
        'contactos fusionados',
      ) as unknown as Array<{ id: string; merged_into: string | null }>
    )
      .filter((c) => c.merged_into)
      .map((c) => c.id),
  );

  const conteo = new Map<string, { count: number; amounts: Record<string, number> }>();
  const totalPorMoneda = new Map<string, number>();

  for (const p of posiciones) {
    if (fusionados.has(p.contact_id)) continue;
    const previo = conteo.get(p.stage_id) ?? { count: 0, amounts: {} };
    const monto = aNumero(p.amount) ?? 0;
    const moneda = p.currency || 'MXN';
    previo.count += 1;
    if (monto !== 0) {
      previo.amounts[moneda] = (previo.amounts[moneda] ?? 0) + monto;
      totalPorMoneda.set(moneda, (totalPorMoneda.get(moneda) ?? 0) + monto);
    }
    conteo.set(p.stage_id, previo);
  }

  /* La moneda que la UI va a pintar se DERIVA de los datos, no se asume. Si el
     embudo está vacío o nadie puso monto, MXN es el default de la columna. */
  const dominante =
    [...totalPorMoneda.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'MXN';

  return {
    pipelineId: embudo.id,
    currency: dominante,
    stages: etapas.map((e) => {
      const c = conteo.get(e.id) ?? { count: 0, amounts: {} };
      return {
        stageId: e.id,
        slug: e.slug,
        name: e.name,
        count: c.count,
        amount: c.amounts[dominante] ?? 0,
        amounts: c.amounts,
      };
    }),
  };
}
