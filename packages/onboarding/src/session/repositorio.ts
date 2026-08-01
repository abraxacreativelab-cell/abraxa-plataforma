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
 *
 *  ── Y una sola escritura POR TURNO (auditoría PR #8) ──────────────────────
 *
 *  Escribir la fila entera de una vez arregla el turno partido a la mitad, pero
 *  no arregla dos turnos que se pisan. Un turno del Ritual es leer-pensar-
 *  escribir con una llamada al modelo en medio: entre la lectura y la escritura
 *  pasan segundos. Dos pestañas abiertas, un doble Enter o un reintento del
 *  navegador y las dos peticiones leen la MISMA fila, las dos calculan sobre el
 *  mismo transcript y la segunda en llegar reescribe la fila entera — el turno
 *  de la primera desaparece sin dejar rastro, y con él el mensaje que el
 *  emprendedor sí vio en pantalla.
 *
 *  `turns` es el número de versión de la fila. Cada escritura exige el valor
 *  que leyó (`turnoPrevio`) y falla con CONFLICT si ya no es ése. Perder una
 *  carrera es recuperable —la pantalla recarga y ve el turno que sí quedó—;
 *  perder el turno en silencio, no.
 */
import { PlatformError, tenantDb } from '@abraxa/db';
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
  'id, tenant_id, phase, state, transcript, status, checkpoint_at, completed_at, turns, last_turn_id, created_at, updated_at';

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
  last_turn_id: string | null;
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
    // `?? null` y no el valor crudo por la misma razón que en blueprint.ts: una
    // columna que nunca se escribió llega como `undefined` desde algunos
    // clientes, y la comparación que decide si un envío es un reenvío tiene que
    // poder confiar en que `null` significa "ninguno".
    ultimoEnvio: f.last_turn_id ?? null,
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
 *
 * ── `ignoreDuplicates` no es un detalle (auditoría PR #8) ─────────────────
 *
 * Sin él, el `upsert` de PostgREST es `ON CONFLICT DO UPDATE`: PISA la fila.
 * Y lo que se manda arriba es un ritual RECIÉN NACIDO — `phase: 'bienvenida'`,
 * `transcript: []`, `turns: 0`. O sea que la carrera que este código dice
 * manejar era exactamente la que borraba la entrevista: la pestaña que leyó
 * "no hay ritual" hace tres segundos, cuando por fin escribe, deja en cero la
 * conversación que la otra pestaña ya empezó, y el `.select()` le devuelve esa
 * fila vacía como si fuera suya. Veinte minutos de entrevista, sin excepción y
 * sin rastro.
 *
 * Con `ignoreDuplicates: true` es `ON CONFLICT DO NOTHING`: la segunda no
 * escribe nada, no recibe fila, y cae a la relectura de abajo — que es lo que
 * el comentario de la carrera siempre dijo que pasaba.
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
      { onConflict: 'tenant_id', ignoreDuplicates: true },
    )
    .select(COLUMNAS);

  if (error) throw error;
  const fila = (data as FilaSesion[] | null)?.[0];
  if (fila) return mapear(fila);

  // Carrera perdida contra otra pestaña: el upsert no escribió nada porque
  // alguien más insertó primero. Volver a leer es la respuesta correcta,
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
  /**
   * El `turns` que traía la fila CUANDO SE LEYÓ.
   *
   * Es la versión sobre la que se calculó este turno. Si la fila ya no está en
   * ese número, alguien más escribió mientras el modelo pensaba y esta
   * escritura pisaría su trabajo: se rechaza en vez de aplicarse.
   */
  turnoPrevio: number;
  /**
   * El id del ENVÍO que produjo este turno, si el navegador mandó uno.
   *
   * Va en la MISMA escritura que el turno, y no en una aparte, por la misma
   * razón que todo lo demás de esta interfaz: si se pudiera guardar el turno sin
   * guardar de qué envío vino, un reintento que cayera justo en ese hueco no
   * tendría con qué reconocerse y volvería a aplicarse.
   */
  envioId?: string | null;
}

/**
 * El error de la carrera perdida.
 *
 * Se nombra aparte porque quien lo atrape tiene que poder distinguirlo de
 * cualquier otro CONFLICT sin leer el mensaje.
 */
export const CONFLICTO_DE_TURNO =
  'Alguien más avanzó este Ritual mientras se preparaba tu turno. ' +
  'Nada se perdió: vuelve a cargar y sigue desde donde quedó.';

/**
 * Guarda el turno completo. Una sola escritura, y sólo si nadie se adelantó.
 *
 * `checkpoint_at` se mueve nada más cuando `cerroFase` — es "hasta dónde llegó",
 * no "cuándo escribió". Esa distinción es la que le permite a la UI decirle al
 * que vuelve "cerraste la fase de tu modelo de negocio el martes" en vez de
 * "tu última actividad fue el martes", que no le dice nada.
 *
 * ── El `.eq('turns', …)` es lo que hace que un turno no se pierda ─────────
 *
 * Es control de concurrencia optimista con `turns` de número de versión, y va
 * en el WHERE del mismo UPDATE: Postgres resuelve la carrera al nivel de la
 * fila, sin transacción explícita y sin un SELECT ... FOR UPDATE que PostgREST
 * no sabe mandar. La perdedora actualiza CERO filas — y eso, que sin `.select()`
 * es indistinguible del éxito, es justamente lo que hacía que el turno se
 * esfumara callado. Por eso se piden las filas tocadas y se cuentan.
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
  // `undefined` = este turno no vino de un envío del navegador (lo disparó
  // `iniciar`, o un cliente viejo que todavía no manda id). No se toca la
  // columna: dejarla en NULL borraría el acuse del envío anterior y volvería
  // reprocesable un reenvío que ya estaba cubierto.
  if (cambios.envioId !== undefined) patch.last_turn_id = cambios.envioId;

  const { data, error } = await tenantDb(ctx)
    .from('onboarding_sessions')
    .update(patch)
    .eq('id', sesionId)
    .eq('turns', cambios.turnoPrevio)
    .select('id');

  if (error) throw error;

  if (!data || (data as unknown[]).length === 0) {
    // Cero filas tocadas con un id que sí existe = otra petición escribió
    // primero. No se reintenta desde aquí: este turno se calculó sobre un
    // transcript que ya es viejo, y reescribirlo es exactamente el bug.
    log.warn(
      `turno descartado por carrera en el ritual ${sesionId}: ` +
        `se esperaba turns=${cambios.turnoPrevio} y la fila ya avanzó`,
    );
    throw new PlatformError('CONFLICT', CONFLICTO_DE_TURNO);
  }
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
