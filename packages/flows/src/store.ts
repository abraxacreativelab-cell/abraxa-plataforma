/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El acceso a datos. Todo por `tenantDb(ctx)`, sin una sola excepción.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  El filtro por `tenant_id` no se escribe aquí: lo pone `tenantDb`. Por eso la
 *  prueba «un flujo del tenant A no toca datos del B» (criterio #8) significa
 *  algo — no comprueba que alguien se acordó de filtrar, comprueba que no hay
 *  forma de no hacerlo.
 *
 *  Este archivo traduce entre las filas (snake_case, como la migración) y los
 *  tipos del dominio (camelCase, como el resto del paquete). Es aburrido a
 *  propósito: la lógica vive en `engine/decision.ts`, que no sabe que existe
 *  una base de datos.
 */
import { PlatformError, tenantDb } from '@abraxa/db';
import type { TenantContext, TriggerType } from '@abraxa/db';
import type {
  Flow,
  FlowDefinition,
  FlowRun,
  FlowStatus,
  FlowStep,
  FlowVersion,
  NodeType,
  RunContext,
  RunStatus,
  StepStatus,
} from './types';

type Fila = Record<string, unknown>;

const txt = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const definicionDe = (v: unknown): FlowDefinition => {
  const d = obj(v);
  return {
    nodes: Array.isArray(d.nodes) ? (d.nodes as FlowDefinition['nodes']) : [],
    edges: Array.isArray(d.edges) ? (d.edges as FlowDefinition['edges']) : [],
  };
};

/**
 * PostgREST no lanza: devuelve `{ data, error }`. Tragarse ese error deja al
 * llamador creyendo que una tabla está vacía cuando lo que pasó es que la
 * consulta falló — que es exactamente cómo una corrida se queda zombi.
 */
function exigir<T>(r: { data: T; error: { message: string } | null }, quehacer: string): T {
  if (r.error) throw new PlatformError('INTERNAL', `${quehacer}: ${r.error.message}`);
  return r.data;
}

/** `true` si el error es el choque de un índice único. */
const esDuplicado = (e: { code?: string } | null): boolean => e?.code === '23505';

// ════════════════════════════════════════════════════════════════════════════
// Traducción
// ════════════════════════════════════════════════════════════════════════════

export function aFlujo(f: Fila): Flow {
  return {
    id: String(f.id),
    name: String(f.name ?? ''),
    description: txt(f.description),
    triggerType: String(f.trigger_type) as TriggerType,
    triggerConfig: obj(f.trigger_config),
    definition: definicionDe(f.definition),
    status: String(f.status ?? 'paused') as FlowStatus,
    version: Number(f.version ?? 1),
    createdBy: txt(f.created_by),
    activatedBy: txt(f.activated_by),
    activatedAt: txt(f.activated_at),
    createdAt: String(f.created_at ?? ''),
    updatedAt: String(f.updated_at ?? ''),
  };
}

export function aVersion(f: Fila): FlowVersion {
  return {
    version: Number(f.version ?? 1),
    name: String(f.name ?? ''),
    triggerType: String(f.trigger_type) as TriggerType,
    triggerConfig: obj(f.trigger_config),
    definition: definicionDe(f.definition),
    note: txt(f.note),
    createdBy: txt(f.created_by),
    createdAt: String(f.created_at ?? ''),
  };
}

export function aCorrida(f: Fila): FlowRun {
  return {
    id: String(f.id),
    flowId: String(f.flow_id),
    version: Number(f.version ?? 1),
    contactId: txt(f.contact_id),
    status: String(f.status ?? 'running') as RunStatus,
    currentNode: txt(f.current_node),
    context: obj(f.context) as RunContext,
    triggerType: String(f.trigger_type) as TriggerType,
    isTest: f.is_test === true,
    error: txt(f.error),
    startedAt: String(f.started_at ?? ''),
    wakeAt: txt(f.wake_at),
    completedAt: txt(f.completed_at),
    updatedAt: String(f.updated_at ?? ''),
  };
}

export function aPaso(f: Fila): FlowStep {
  return {
    id: String(f.id),
    runId: String(f.run_id),
    nodeId: String(f.node_id),
    nodeType: String(f.node_type) as NodeType,
    status: String(f.status) as StepStatus,
    input: obj(f.input),
    output: obj(f.output),
    error: txt(f.error),
    startedAt: String(f.started_at ?? ''),
    completedAt: txt(f.completed_at),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Flujos
// ════════════════════════════════════════════════════════════════════════════

export interface AltaDeFlujo {
  name: string;
  description?: string | null;
  triggerType: TriggerType;
  triggerConfig: Record<string, unknown>;
  definition: FlowDefinition;
  createdBy?: string | null;
}

/**
 * Da de alta un flujo. **Siempre en pausa**: ni siquiera se le pasa `status`.
 * El DEFAULT de la migración 060 es la garantía, y no pasarlo aquí es la
 * segunda: no hay ninguna ruta del código por la que un flujo nazca encendido.
 */
export async function crearFlujo(ctx: TenantContext, i: AltaDeFlujo): Promise<Flow> {
  const fila = exigir(
    await tenantDb(ctx)
      .from('flows')
      .insert({
        name: i.name,
        description: i.description ?? null,
        trigger_type: i.triggerType,
        trigger_config: i.triggerConfig,
        definition: i.definition,
        version: 1,
        created_by: i.createdBy ?? null,
      })
      .select('*')
      .single(),
    'no se pudo crear el flujo',
  ) as Fila | null;

  if (!fila) throw new PlatformError('INTERNAL', 'el alta del flujo no devolvió la fila');
  const flujo = aFlujo(fila);
  await guardarVersion(ctx, flujo, 1, 'versión inicial', i.createdBy ?? null);
  return flujo;
}

export async function listarFlujos(ctx: TenantContext): Promise<Flow[]> {
  const filas = exigir(
    await tenantDb(ctx).from('flows').select('*').neq('status', 'archived').order('updated_at', {
      ascending: false,
    }),
    'no se pudieron listar los flujos',
  ) as Fila[] | null;
  return (filas ?? []).map(aFlujo);
}

export async function obtenerFlujo(ctx: TenantContext, id: string): Promise<Flow | null> {
  const fila = exigir(
    await tenantDb(ctx).from('flows').select('*').eq('id', id).maybeSingle(),
    'no se pudo leer el flujo',
  ) as Fila | null;
  return fila ? aFlujo(fila) : null;
}

/** El flujo o un 404 con nombre. Lo usan las rutas para no repetir el `if`. */
export async function exigirFlujo(ctx: TenantContext, id: string): Promise<Flow> {
  const f = await obtenerFlujo(ctx, id);
  if (!f) throw new PlatformError('NOT_FOUND', 'no existe esa automatización');
  return f;
}

export interface CambioDeFlujo {
  name?: string;
  description?: string | null;
  triggerType?: TriggerType;
  triggerConfig?: Record<string, unknown>;
  definition?: FlowDefinition;
  note?: string;
  actor?: string | null;
}

/**
 * Guarda una edición y **escribe una versión nueva**.
 *
 * El número se calcula leyendo el máximo y sumando uno, y si dos guardados
 * simultáneos piden el mismo, el índice único `(tenant_id, flow_id, version)`
 * rechaza al segundo y aquí se reintenta. Sin ese índice, dos "v4" distintas
 * convertirían el rollback en una lotería.
 */
export async function guardarFlujo(
  ctx: TenantContext,
  flujo: Flow,
  cambio: CambioDeFlujo,
): Promise<Flow> {
  const nuevo: Flow = {
    ...flujo,
    ...(cambio.name !== undefined ? { name: cambio.name } : {}),
    ...(cambio.description !== undefined ? { description: cambio.description } : {}),
    ...(cambio.triggerType !== undefined ? { triggerType: cambio.triggerType } : {}),
    ...(cambio.triggerConfig !== undefined ? { triggerConfig: cambio.triggerConfig } : {}),
    ...(cambio.definition !== undefined ? { definition: cambio.definition } : {}),
  };

  const version = await guardarVersion(
    ctx,
    nuevo,
    (await ultimaVersion(ctx, flujo.id)) + 1,
    cambio.note ?? 'edición a mano',
    cambio.actor ?? null,
  );

  exigir(
    await tenantDb(ctx)
      .from('flows')
      .update({
        name: nuevo.name,
        description: nuevo.description,
        trigger_type: nuevo.triggerType,
        trigger_config: nuevo.triggerConfig,
        definition: nuevo.definition,
        version,
        updated_at: new Date().toISOString(),
      })
      .eq('id', flujo.id),
    'no se pudo guardar el flujo',
  );

  return { ...nuevo, version };
}

/**
 * Enciende o apaga.
 *
 * Activar deja NOMBRE y HORA: es la acción que hace que el flujo empiece a
 * actuar sobre contactos reales, y una acción así no puede ser anónima.
 */
export async function cambiarEstado(
  ctx: TenantContext,
  flujoId: string,
  status: FlowStatus,
  actor: string | null,
): Promise<void> {
  exigir(
    await tenantDb(ctx)
      .from('flows')
      .update({
        status,
        updated_at: new Date().toISOString(),
        ...(status === 'active'
          ? { activated_by: actor, activated_at: new Date().toISOString() }
          : {}),
      })
      .eq('id', flujoId),
    'no se pudo cambiar el estado del flujo',
  );
}

/** Los flujos ACTIVOS que escuchan este disparador. El camino caliente. */
export async function flujosActivosPara(
  ctx: TenantContext,
  trigger: TriggerType,
): Promise<Flow[]> {
  const filas = exigir(
    await tenantDb(ctx)
      .from('flows')
      .select('*')
      .eq('status', 'active')
      .eq('trigger_type', trigger),
    'no se pudieron leer los flujos activos',
  ) as Fila[] | null;
  return (filas ?? []).map(aFlujo);
}

// ════════════════════════════════════════════════════════════════════════════
// Versiones — las que SÍ se leen
// ════════════════════════════════════════════════════════════════════════════

async function ultimaVersion(ctx: TenantContext, flujoId: string): Promise<number> {
  const filas = exigir(
    await tenantDb(ctx)
      .from('flow_versions')
      .select('version')
      .eq('flow_id', flujoId)
      .order('version', { ascending: false })
      .limit(1),
    'no se pudo leer el historial',
  ) as Fila[] | null;
  return Number(filas?.[0]?.version ?? 0);
}

async function guardarVersion(
  ctx: TenantContext,
  flujo: Flow,
  desde: number,
  note: string,
  actor: string | null,
): Promise<number> {
  // Hasta 5 intentos: si dos guardados chocan por el número, el segundo toma
  // el siguiente en vez de perder la edición del usuario.
  let version = Math.max(1, desde);
  for (let intento = 0; intento < 5; intento++) {
    const r = await tenantDb(ctx)
      .from('flow_versions')
      .insert({
        flow_id: flujo.id,
        version,
        name: flujo.name,
        trigger_type: flujo.triggerType,
        trigger_config: flujo.triggerConfig,
        definition: flujo.definition,
        note,
        created_by: actor,
      });
    if (!r.error) return version;
    if (!esDuplicado(r.error)) {
      throw new PlatformError('INTERNAL', `no se pudo guardar la versión: ${r.error.message}`);
    }
    version = (await ultimaVersion(ctx, flujo.id)) + 1;
  }
  throw new PlatformError('CONFLICT', 'el flujo se está guardando desde varios lados a la vez');
}

export async function listarVersiones(ctx: TenantContext, flujoId: string): Promise<FlowVersion[]> {
  const filas = exigir(
    await tenantDb(ctx)
      .from('flow_versions')
      .select('*')
      .eq('flow_id', flujoId)
      .order('version', { ascending: false }),
    'no se pudo leer el historial',
  ) as Fila[] | null;
  return (filas ?? []).map(aVersion);
}

export async function obtenerVersion(
  ctx: TenantContext,
  flujoId: string,
  version: number,
): Promise<FlowVersion | null> {
  const fila = exigir(
    await tenantDb(ctx)
      .from('flow_versions')
      .select('*')
      .eq('flow_id', flujoId)
      .eq('version', version)
      .maybeSingle(),
    'no se pudo leer esa versión',
  ) as Fila | null;
  return fila ? aVersion(fila) : null;
}

// ════════════════════════════════════════════════════════════════════════════
// Corridas
// ════════════════════════════════════════════════════════════════════════════

export interface AltaDeCorrida {
  flowId: string;
  version: number;
  contactId: string | null;
  triggerType: TriggerType;
  context: RunContext;
  currentNode: string | null;
  isTest: boolean;
}

/**
 * Enrola. Devuelve `null` si el contacto YA está corriendo este flujo — el
 * índice parcial `flow_runs_viva_idx` lo rechaza con 23505.
 *
 * Que sea `null` y no una excepción es deliberado: que un formulario enviado
 * tres veces seguidas no mande tres bienvenidas no es un error del sistema,
 * es el sistema funcionando.
 */
export async function crearCorrida(
  ctx: TenantContext,
  i: AltaDeCorrida,
): Promise<FlowRun | null> {
  const r = await tenantDb(ctx)
    .from('flow_runs')
    .insert({
      flow_id: i.flowId,
      version: i.version,
      contact_id: i.contactId,
      trigger_type: i.triggerType,
      context: i.context,
      current_node: i.currentNode,
      is_test: i.isTest,
      status: 'running',
    })
    .select('*')
    .single();

  if (r.error) {
    if (esDuplicado(r.error)) return null;
    throw new PlatformError('INTERNAL', `no se pudo enrolar: ${r.error.message}`);
  }
  return r.data ? aCorrida(r.data as Fila) : null;
}

export async function obtenerCorrida(ctx: TenantContext, id: string): Promise<FlowRun | null> {
  const fila = exigir(
    await tenantDb(ctx).from('flow_runs').select('*').eq('id', id).maybeSingle(),
    'no se pudo leer la corrida',
  ) as Fila | null;
  return fila ? aCorrida(fila) : null;
}

export async function listarCorridas(
  ctx: TenantContext,
  i: { flowId?: string; limit?: number },
): Promise<FlowRun[]> {
  let q = tenantDb(ctx).from('flow_runs').select('*');
  if (i.flowId) q = q.eq('flow_id', i.flowId);
  const filas = exigir(
    await q.order('started_at', { ascending: false }).limit(i.limit ?? 30),
    'no se pudieron listar las corridas',
  ) as Fila[] | null;
  return (filas ?? []).map(aCorrida);
}

export async function moverPuntero(
  ctx: TenantContext,
  runId: string,
  i: { currentNode: string; status: RunStatus; wakeAt: string | null },
): Promise<void> {
  exigir(
    await tenantDb(ctx)
      .from('flow_runs')
      .update({
        current_node: i.currentNode,
        status: i.status,
        wake_at: i.wakeAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', runId),
    'no se pudo avanzar la corrida',
  );
}

export async function pausarCorrida(
  ctx: TenantContext,
  runId: string,
  razon: string,
): Promise<void> {
  exigir(
    await tenantDb(ctx)
      .from('flow_runs')
      .update({ status: 'paused', error: razon, updated_at: new Date().toISOString() })
      .eq('id', runId),
    'no se pudo pausar la corrida',
  );
}

export async function terminarCorrida(
  ctx: TenantContext,
  runId: string,
  status: RunStatus,
  error: string | null,
): Promise<void> {
  exigir(
    await tenantDb(ctx)
      .from('flow_runs')
      .update({
        status,
        error,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', runId),
    'no se pudo cerrar la corrida',
  );
}

/**
 * Reclama una corrida pausada para reanudarla.
 *
 * El `.eq('status','paused')` en el UPDATE es lo que la hace segura entre dos
 * reanudaciones simultáneas: la segunda no afecta ninguna fila y se va sin
 * encolar nada. Sin ese filtro, el webhook del canal y el barrido periódico
 * reanudarían la misma corrida a la vez.
 */
export async function reclamarPausada(ctx: TenantContext, runId: string): Promise<boolean> {
  const r = await tenantDb(ctx)
    .from('flow_runs')
    .update({ status: 'running', error: null, updated_at: new Date().toISOString() })
    .eq('id', runId)
    .eq('status', 'paused')
    .select('id');
  if (r.error) throw new PlatformError('INTERNAL', `no se pudo reclamar la corrida: ${r.error.message}`);
  return Array.isArray(r.data) && r.data.length > 0;
}

/** Corridas dormidas o pausadas que ya toca despertar. */
export async function corridasPendientes(
  ctx: TenantContext,
  ahora: Date,
  limite = 100,
): Promise<FlowRun[]> {
  const filas = exigir(
    await tenantDb(ctx)
      .from('flow_runs')
      .select('*')
      .in('status', ['paused', 'waiting'])
      .limit(limite),
    'no se pudieron leer las corridas pendientes',
  ) as Fila[] | null;

  return (filas ?? [])
    .map(aCorrida)
    .filter((r) => r.status === 'paused' || !r.wakeAt || new Date(r.wakeAt) <= ahora);
}

// ════════════════════════════════════════════════════════════════════════════
// Pasos
// ════════════════════════════════════════════════════════════════════════════

export async function listarPasos(ctx: TenantContext, runId: string): Promise<FlowStep[]> {
  const filas = exigir(
    await tenantDb(ctx)
      .from('flow_steps')
      .select('*')
      .eq('run_id', runId)
      .order('started_at', { ascending: true }),
    'no se pudieron leer los pasos',
  ) as Fila[] | null;
  return (filas ?? []).map(aPaso);
}

export async function contarPasos(ctx: TenantContext, runId: string): Promise<number> {
  const r = await tenantDb(ctx)
    .from('flow_steps')
    .select('id', { head: true, count: 'exact' })
    .eq('run_id', runId);
  if (r.error) throw new PlatformError('INTERNAL', `no se pudieron contar los pasos: ${r.error.message}`);
  return r.count ?? 0;
}

/** ¿Este nodo ya se completó con éxito en esta corrida? El guard de doble envío. */
export async function nodoYaCompletado(
  ctx: TenantContext,
  runId: string,
  nodeId: string,
): Promise<boolean> {
  const r = await tenantDb(ctx)
    .from('flow_steps')
    .select('id', { head: true, count: 'exact' })
    .eq('run_id', runId)
    .eq('node_id', nodeId)
    .eq('status', 'ok');
  if (r.error) throw new PlatformError('INTERNAL', `no se pudo revisar el paso: ${r.error.message}`);
  return (r.count ?? 0) > 0;
}

export interface PasoNuevo {
  runId: string;
  nodeId: string;
  nodeType: NodeType;
  status: StepStatus;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error: string | null;
  startedAt: string;
}

/**
 * Deja el paso escrito. Devuelve `false` si el índice único parcial lo rechazó
 * —es decir, si otro intento ya lo había completado con éxito—.
 *
 * ESE `false` ES EL CRITERIO #5. No es un error que haya que reportar: es el
 * sistema impidiendo el segundo mensaje al cliente. Quien llama sigue adelante
 * como si lo hubiera escrito él, porque el efecto ya está.
 */
export async function registrarPaso(ctx: TenantContext, p: PasoNuevo): Promise<boolean> {
  const r = await tenantDb(ctx).from('flow_steps').insert({
    run_id: p.runId,
    node_id: p.nodeId,
    node_type: p.nodeType,
    status: p.status,
    input: p.input,
    output: p.output,
    error: p.error,
    started_at: p.startedAt,
    completed_at: new Date().toISOString(),
  });
  if (r.error) {
    if (esDuplicado(r.error)) return false;
    throw new PlatformError('INTERNAL', `no se pudo registrar el paso: ${r.error.message}`);
  }
  return true;
}
