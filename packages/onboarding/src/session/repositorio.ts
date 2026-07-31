/**
 * ════════════════════════════════════════════════════════════════════════════
 *  La sesión del Ritual, en la base. Nada en memoria.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  El bug que este archivo existe para no repetir:
 *
 *  GARDEN guarda fase y datos en Postgres pero el HISTORIAL de la conversación
 *  en un `Map` del proceso (extensions/abraxa-bookkeeper/handler.ts:36). Un
 *  deploy, un reinicio o una segunda instancia y el entrevistado vuelve a un
 *  agente que conserva sus datos y perdió el hilo. Aquí NO hay una sola
 *  variable de módulo con estado de sesión: si no está en la fila, no existe.
 *
 *  ── Una escritura por turno ───────────────────────────────────────────────
 *
 *  Fase, estado, transcript y contador se guardan en el MISMO UPDATE. No es
 *  cosmética: si fueran tres escrituras y el proceso se muriera entre la
 *  primera y la segunda, la sesión quedaría en una fase que sus datos no
 *  soportan — y la siguiente vuelta la máquina de estados leería un estado
 *  imposible. Un turno se guarda entero o no se guarda.
 */
import { tenantDb } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import { log } from '../logger';
import type {
  EstadoNegocio,
  EstadoSesion,
  Fase,
  SesionRitual,
  TurnoTranscrito,
} from '../types';

const COLUMNAS =
  'id, tenant_id, phase, state, transcript, status, checkpoint_at, completed_at, turns, created_at, updated_at';

interface FilaSesion {
  id: string;
  tenant_id: string;
  phase: string;
  state: EstadoNegocio | null;
  transcript: TurnoTranscrito[] | null;
  status: string;
  checkpoint_at: string | null;
  completed_at: string | null;
  turns: number | null;
  created_at: string;
  updated_at: string;
}

function mapear(f: FilaSesion): SesionRitual {
  return {
    id: f.id,
    tenantId: f.tenant_id,
    fase: f.phase as Fase,
    estado: f.state ?? {},
    transcript: Array.isArray(f.transcript) ? f.transcript : [],
    status: f.status as EstadoSesion,
    checkpointAt: f.checkpoint_at ?? null,
    completedAt: f.completed_at ?? null,
    turnos: f.turns ?? 0,
    createdAt: f.created_at,
    updatedAt: f.updated_at,
  };
}

/** El ritual de esta empresa, o `null` si nunca ha empezado. */
export async function cargarSesion(ctx: TenantContext): Promise<SesionRitual | null> {
  const { data, error } = await tenantDb(ctx)
    .from('onboarding_sessions')
    .select(COLUMNAS)
    .limit(1);

  if (error) throw error;
  const fila = (data as FilaSesion[] | null)?.[0];
  return fila ? mapear(fila) : null;
}

/**
 * Empieza el ritual, o devuelve el que ya había.
 *
 * Idempotente por el UNIQUE (tenant_id) de la migración 050: abrir dos pestañas
 * no crea dos rituales, y el primer turno de la segunda pestaña continúa el
 * mismo hilo en vez de arrancar de cero.
 */
export async function abrirSesion(ctx: TenantContext): Promise<SesionRitual> {
  const existente = await cargarSesion(ctx);
  if (existente) return existente;

  const { data, error } = await tenantDb(ctx)
    .from('onboarding_sessions')
    .upsert(
      {
        phase: 'bienvenida',
        state: {},
        transcript: [],
        status: 'activa',
        turns: 0,
      },
      { onConflict: 'tenant_id' },
    )
    .select(COLUMNAS);

  if (error) throw error;
  const fila = (data as FilaSesion[] | null)?.[0];
  if (fila) return mapear(fila);

  // Carrera perdida contra otra pestaña: el upsert no devolvió fila porque
  // alguien más la insertó primero. Volver a leer es la respuesta correcta,
  // no reintentar la escritura.
  const recargada = await cargarSesion(ctx);
  if (!recargada) throw new Error('No se pudo abrir el Ritual de Fundación.');
  return recargada;
}

export interface CambiosDelTurno {
  fase: Fase;
  estado: EstadoNegocio;
  transcript: TurnoTranscrito[];
  turnos: number;
  status: EstadoSesion;
  /** Se sella sólo cuando una fase cerró de verdad. */
  cerroFase: boolean;
  completada?: boolean;
}

/**
 * Guarda el turno completo. Una sola escritura.
 *
 * `checkpoint_at` se mueve nada más cuando `cerroFase` — es "hasta dónde llegó",
 * no "cuándo escribió". Esa distinción es la que le permite a la UI decirle al
 * que vuelve "cerraste la fase de tu modelo de negocio el martes" en vez de
 * "tu última actividad fue el martes", que no le dice nada.
 */
export async function guardarTurno(
  ctx: TenantContext,
  sesionId: string,
  cambios: CambiosDelTurno,
  ahora: Date = new Date(),
): Promise<void> {
  const iso = ahora.toISOString();

  const patch: Record<string, unknown> = {
    phase: cambios.fase,
    state: cambios.estado,
    transcript: cambios.transcript,
    turns: cambios.turnos,
    status: cambios.status,
    updated_at: iso,
  };

  if (cambios.cerroFase) patch.checkpoint_at = iso;
  if (cambios.completada) patch.completed_at = iso;

  const { error } = await tenantDb(ctx)
    .from('onboarding_sessions')
    .update(patch)
    .eq('id', sesionId);

  if (error) throw error;
}

/**
 * Cambia sólo el estado de la sesión: pausar o retomar.
 *
 * Se expone aparte porque el botón "guardar y seguir después" no puede depender
 * de que haya un turno en curso. Es una promesa de la UI y tiene que funcionar
 * en cualquier momento, incluso mientras el modelo está pensando.
 */
export async function marcarEstado(
  ctx: TenantContext,
  sesionId: string,
  status: EstadoSesion,
): Promise<void> {
  const { error } = await tenantDb(ctx)
    .from('onboarding_sessions')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', sesionId);

  if (error) throw error;
  log.info(`ritual ${sesionId} → ${status}`);
}
