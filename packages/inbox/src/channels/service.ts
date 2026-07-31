/**
 * Alta, estado y baja de canales.
 *
 * Todo lo específico del proveedor vive en su driver: aquí sólo se guarda la
 * fila, se le pide al driver que aprovisione y se sanea lo que sale al
 * navegador.
 *
 * ── El apretón de manos con `provisionChannel` ─────────────────────────────
 *
 * El port declara `provisionChannel({ tenantId, name, config })` y devuelve
 * `{ externalId, status, qr? }`. No hay forma de devolver la config de vuelta,
 * y el driver necesita guardar cosas en ella (la instancia de Evolution, el
 * token del webhook). La convención es que el driver ESCRIBE en el objeto
 * `config` que recibe, y este servicio persiste el resultado.
 *
 * Y el orden es: INSERT primero, aprovisionar después. El driver necesita el id
 * del canal para armar la URL del webhook, y ese id lo genera la base. Se le
 * pasa dentro de `config.channelId` — H12 y H13 pueden contar con él.
 */
import { PlatformError, tenantDb } from '@abraxa/db';
import type { ChannelType, TenantContext } from '@abraxa/db';
import { zonaValida } from '../bridge/hours';
import { IDS_POR_LOTE } from '../config';
import { driverFor, hasDriver } from '../drivers/registry';
import { log } from '../logger';
import type { BusinessHours, ChannelRow } from '../types';
import { normalizarFila } from './lookup';

/** La fila sin sus secretos. Es lo único que puede salir al navegador. */
export type CanalPublico = Omit<ChannelRow, 'config'> & {
  config: Record<string, unknown>;
  /** `true` si la línea ya está lista para mandar y recibir. */
  conectado: boolean;
};

const SECRETOS = ['webhook_token', 'api_key', 'apikey', 'token', 'secret', 'password'];

/** Quita del `config` todo lo que no debería cruzar la red. */
export function sanearCanal(fila: ChannelRow): CanalPublico {
  const config: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fila.config ?? {})) {
    if (!SECRETOS.includes(k.toLowerCase())) config[k] = v;
  }
  return { ...fila, config, conectado: fila.status === 'active' };
}

export async function listarCanales(ctx: TenantContext): Promise<CanalPublico[]> {
  const { data, error } = await tenantDb(ctx).from('channels').select('*').order('created_at');
  if (error) throw new PlatformError('INTERNAL', `No se pudieron leer los canales: ${error.message}`);
  return ((data as Record<string, unknown>[] | null) ?? []).map((f) => sanearCanal(normalizarFila(f)));
}

export interface EntradaCanal {
  type: ChannelType;
  name: string;
  /** Por defecto, el mismo nombre del tipo: `whatsapp` → driver `whatsapp`. */
  driver?: string;
  agentRole?: ChannelRow['agent_role'];
  businessHours?: BusinessHours;
  aiOutsideHours?: boolean;
  /** Config inicial del driver (una instancia ya existente, por ejemplo). */
  config?: Record<string, unknown>;
}

/**
 * Da de alta un canal y lo aprovisiona con su proveedor.
 *
 * Si el aprovisionamiento falla, la fila queda en `error` con el motivo en vez
 * de borrarse: el emprendedor ve QUÉ pasó y puede reintentar, en lugar de que
 * el canal desaparezca sin explicación.
 */
export async function crearCanal(ctx: TenantContext, entrada: EntradaCanal): Promise<CanalPublico> {
  const db = tenantDb(ctx);

  if (!entrada?.name?.trim()) {
    throw new PlatformError('VALIDATION', 'El canal necesita un nombre.');
  }
  if (!hasDriver(entrada.type)) {
    // Falla aquí y no al primer mensaje: una fila de canal sin driver es una
    // bandeja que se ve bien y no funciona.
    driverFor(entrada.type);
  }
  // Se valida ANTES del INSERT, igual que en `ajustarCanal`: un horario mal
  // formado no debe llegar a existir ni un instante.
  const horario = entrada.businessHours ? validarHorario(entrada.businessHours) : {};

  const { data: creado, error } = await db
    .from('channels')
    .insert({
      type: entrada.type,
      driver: entrada.driver ?? entrada.type,
      name: entrada.name.trim(),
      config: entrada.config ?? {},
      status: 'pending',
      agent_role: entrada.agentRole ?? 'sales',
      business_hours: horario,
      ai_outside_hours: entrada.aiOutsideHours !== false,
    })
    .select()
    .single();

  if (error || !creado) {
    throw new PlatformError('INTERNAL', `No se pudo crear el canal: ${error?.message ?? 'sin fila'}`);
  }
  const fila = normalizarFila(creado as Record<string, unknown>);

  const driver = driverFor(fila.type);
  if (!driver.provisionChannel) {
    log.info(`el driver ${fila.type} no aprovisiona nada; el canal queda listo`);
    return sanearCanal(fila);
  }

  // El driver escribe sus secretos en este objeto. Ver el encabezado.
  const config: Record<string, unknown> = { ...fila.config, channelId: fila.id };

  try {
    const r = await driver.provisionChannel({ tenantId: ctx.tenantId, name: fila.name, config });
    const patch = {
      config,
      // Vacío = todavía sin dirección propia (nadie ha escaneado el QR).
      external_id: r.externalId || null,
      status: estadoValido(r.status),
      updated_at: new Date().toISOString(),
    };
    await db.from('channels').update(patch).eq('id', fila.id);
    return sanearCanal({ ...fila, ...patch } as ChannelRow);
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err);
    await db
      .from('channels')
      .update({ status: 'error', config, updated_at: new Date().toISOString() })
      .eq('id', fila.id);
    log.error(`no se pudo aprovisionar el canal ${fila.name}: ${motivo}`);
    throw err;
  }
}

/** Estado vivo de la línea + lo que haga falta para vincularla (QR). */
export async function estadoCanal(
  ctx: TenantContext,
  channelId: string,
): Promise<{ channel: CanalPublico; qr: string | null }> {
  const db = tenantDb(ctx);
  const { data } = await db.from('channels').select('*').eq('id', channelId).maybeSingle();
  if (!data) throw new PlatformError('NOT_FOUND', 'Canal no encontrado.');
  const fila = normalizarFila(data as Record<string, unknown>);

  const driver = driverFor(fila.type);
  if (!driver.channelStatus) return { channel: sanearCanal(fila), qr: null };

  const r = await driver.channelStatus({ channelId: fila.id, config: fila.config });
  const status = estadoValido(r.status);

  if (status !== fila.status || (r.externalId && r.externalId !== fila.external_id)) {
    const patch = {
      status,
      external_id: r.externalId ?? fila.external_id,
      updated_at: new Date().toISOString(),
    };
    await db.from('channels').update(patch).eq('id', fila.id);
    Object.assign(fila, patch);
  }
  return { channel: sanearCanal(fila), qr: r.qr ?? null };
}

export interface AjustesCanal {
  name?: string;
  agentRole?: ChannelRow['agent_role'];
  aiEnabled?: boolean;
  businessHours?: BusinessHours;
  aiOutsideHours?: boolean;
}

/** La política de la IA del canal: qué agente, si contesta, y en qué horario. */
export async function ajustarCanal(
  ctx: TenantContext,
  channelId: string,
  ajustes: AjustesCanal,
): Promise<CanalPublico> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (ajustes.name !== undefined) patch.name = ajustes.name.trim();
  if (ajustes.agentRole !== undefined) patch.agent_role = ajustes.agentRole;
  if (ajustes.aiEnabled !== undefined) patch.ai_enabled = ajustes.aiEnabled;
  if (ajustes.aiOutsideHours !== undefined) patch.ai_outside_hours = ajustes.aiOutsideHours;
  if (ajustes.businessHours !== undefined) {
    patch.business_hours = validarHorario(ajustes.businessHours);
  }

  const db = tenantDb(ctx);
  const { error } = await db.from('channels').update(patch).eq('id', channelId);
  if (error) throw new PlatformError('INTERNAL', `No se pudo ajustar el canal: ${error.message}`);

  const { data } = await db.from('channels').select('*').eq('id', channelId).maybeSingle();
  if (!data) throw new PlatformError('NOT_FOUND', 'Canal no encontrado.');
  return sanearCanal(normalizarFila(data as Record<string, unknown>));
}

export interface ResultadoBaja {
  /** `true` si la FILA del canal desapareció. */
  borrado: boolean;
  /** Hilos que tenía el canal. Se conservan salvo `purgar`. */
  hilos: number;
  /** Mensajes de esos hilos. */
  mensajes: number;
  /** Qué pasó, en una frase, para que la UI la pueda enseñar tal cual. */
  detalle: string;
}

export interface OpcionesBaja {
  /**
   * Destruir además TODO el historial del canal. Hay que pedirlo por su
   * nombre: `DELETE /inbox/channels/:id?purge=true`.
   */
  purgar?: boolean;
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Baja de la línea. Por defecto NO se lleva el historial por delante.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Esto hacía `DELETE FROM channels`, y la migración 040 traía
 * `threads.channel_id … ON DELETE CASCADE`. Sumadas, las dos cosas convertían
 * el camino natural de reconexión —la línea se cae, borro el canal y lo vuelvo
 * a crear para escanear un QR nuevo— en la destrucción irreversible de todas
 * las conversaciones con todos los clientes. Con `{ ok: true }` de respuesta,
 * sin confirmación y sin una línea de log que dijera cuántas filas se llevó.
 *
 * Ahora:
 *
 *   · Siempre se da de baja la línea con el proveedor y se vacía la `config`
 *     (ahí viven el token del webhook y la instancia: si la línea ya no es
 *     nuestra, sus secretos tampoco tienen por qué seguir guardados).
 *   · Si el canal tiene historial, la fila se conserva en `disconnected`. El
 *     canal deja de funcionar, que es lo que el usuario quería, y no se pierde
 *     nada.
 *   · Si no tiene ni un hilo, no hay nada que proteger: la fila se borra y la
 *     lista de canales queda limpia.
 *   · `purgar: true` es el borrado destructivo, explícito, y devuelve —y
 *     registra— exactamente cuántos hilos y cuántos mensajes destruyó.
 *
 * Y para reconectar NO hace falta nada de esto: `GET /inbox/channels/:id/status`
 * devuelve un QR nuevo cuando la instancia no está `open`.
 */
export async function borrarCanal(
  ctx: TenantContext,
  channelId: string,
  opts: OpcionesBaja = {},
): Promise<ResultadoBaja> {
  const db = tenantDb(ctx);
  const { data } = await db.from('channels').select('*').eq('id', channelId).maybeSingle();
  if (!data) throw new PlatformError('NOT_FOUND', 'Canal no encontrado.');
  const fila = normalizarFila(data as Record<string, unknown>);

  const driver = hasDriver(fila.type) ? driverFor(fila.type) : null;
  if (driver?.teardownChannel) {
    // Que el proveedor no responda no puede dejar al cliente con un canal
    // muerto que no se puede dar de baja. Queda en el log.
    await driver
      .teardownChannel({ channelId: fila.id, config: fila.config })
      .catch((e: unknown) => log.warn(`baja del canal ${fila.name} con el proveedor: ${String(e)}`));
  }

  // Qué hay en juego. Se cuenta ANTES de tocar nada, y se responde siempre:
  // una operación destructiva tiene que decir qué destruyó.
  const { data: filasHilos } = await db.from('threads').select('id').eq('channel_id', fila.id);
  const idsHilos = ((filasHilos as Array<{ id: string }> | null) ?? []).map((h) => h.id);

  let mensajes = 0;
  for (const lote of enLotes(idsHilos)) {
    const { count } = await db
      .from('messages')
      .select('id', { head: true, count: 'exact' })
      .in('thread_id', lote);
    mensajes += count ?? 0;
  }

  if (opts.purgar) {
    if (idsHilos.length > 0) {
      // El orden importa: los mensajes cuelgan de los hilos.
      for (const lote of enLotes(idsHilos)) {
        const { error: errMsg } = await db.from('messages').delete().in('thread_id', lote);
        if (errMsg) {
          throw new PlatformError(
            'INTERNAL',
            `No se pudieron borrar los mensajes: ${errMsg.message}`,
          );
        }
      }
      const { error: errHilos } = await db.from('threads').delete().eq('channel_id', fila.id);
      if (errHilos) {
        throw new PlatformError('INTERNAL', `No se pudieron borrar los hilos: ${errHilos.message}`);
      }
    }
    const { error } = await db.from('channels').delete().eq('id', fila.id);
    if (error) throw new PlatformError('INTERNAL', `No se pudo borrar el canal: ${error.message}`);

    // Que quede escrito. Un borrado irreversible sin rastro en el log es la
    // clase de cosa que nadie puede reconstruir después.
    log.warn(
      `PURGA del canal ${fila.name} (${fila.id}): ${idsHilos.length} hilo(s) y ` +
        `${mensajes} mensaje(s) destruidos de forma irreversible`,
    );
    return {
      borrado: true,
      hilos: idsHilos.length,
      mensajes,
      detalle: `Canal eliminado junto con ${idsHilos.length} conversación(es) y ${mensajes} mensaje(s).`,
    };
  }

  // Sin historial no hay nada que proteger: la fila se va y la lista queda
  // limpia.
  if (idsHilos.length === 0) {
    const { error } = await db.from('channels').delete().eq('id', fila.id);
    if (error) throw new PlatformError('INTERNAL', `No se pudo borrar el canal: ${error.message}`);
    log.info(`canal ${fila.name} eliminado (no tenía conversaciones)`);
    return { borrado: true, hilos: 0, mensajes: 0, detalle: 'Canal eliminado.' };
  }

  // Baja lógica. La línea deja de funcionar; el historial se queda.
  const { error } = await db
    .from('channels')
    .update({
      status: 'disconnected',
      // Los secretos de una línea que ya no es nuestra no se guardan.
      config: {},
      external_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', fila.id);
  if (error) {
    throw new PlatformError('INTERNAL', `No se pudo dar de baja el canal: ${error.message}`);
  }

  log.info(
    `canal ${fila.name} desconectado; se conservan ${idsHilos.length} hilo(s) y ` +
      `${mensajes} mensaje(s)`,
  );
  return {
    borrado: false,
    hilos: idsHilos.length,
    mensajes,
    detalle:
      `La línea quedó desconectada. Se conservan ${idsHilos.length} conversación(es) y ` +
      `${mensajes} mensaje(s): el historial con tus clientes no se borra al desconectar. ` +
      'Para eliminarlo todo de forma irreversible: ?purge=true.',
  };
}

/**
 * Un horario con tramos pero sin zona es una trampa: se interpretaría en UTC y
 * el agente se callaría seis horas antes de lo que el emprendedor cree.
 */
export function validarHorario(h: BusinessHours): BusinessHours {
  const tieneTramos = Object.values(h?.semana ?? {}).some((t) => Array.isArray(t) && t.length > 0);
  if (tieneTramos && !h.tz) {
    throw new PlatformError(
      'VALIDATION',
      'Un horario de atención necesita zona horaria (`tz`), por ejemplo "America/Mexico_City". ' +
        'Sin ella se interpretaría en UTC y el agente se callaría a la hora equivocada.',
    );
  }

  // Y que la zona EXISTA (2026-07-31).
  //
  // Faltaba justo la mitad de esta comprobación, y la mitad que faltaba era la
  // que se cuela: exigir que `tz` venga puesta pero no que signifique algo deja
  // pasar `"America/MexicoCity"`, `"GMT-6"` o `"CST"`. `momentoLocal()` no
  // podía hacer nada con eso salvo caer a UTC, y hasta hoy caía en silencio —
  // así que el síntoma llegaba como "mi agente contesta a deshoras", con la
  // pantalla de configuración mostrando el horario correcto.
  //
  // Se rechaza en la captura, que es el único momento en que hay una persona
  // delante capaz de corregirlo.
  if (h.tz && !zonaValida(h.tz)) {
    throw new PlatformError(
      'VALIDATION',
      `La zona horaria "${h.tz}" no existe. Usa un identificador de la IANA, ` +
        'por ejemplo "America/Mexico_City" o "America/Monterrey".',
    );
  }
  return h;
}

/**
 * Parte una lista de ids en lotes que quepan en una query string.
 *
 * Devuelve `[]` para una lista vacía, y eso importa: quien la recorre no tiene
 * que acordarse de comprobar el caso de cero antes del bucle.
 */
function enLotes(ids: string[], tamano = IDS_POR_LOTE): string[][] {
  const salida: string[][] = [];
  for (let i = 0; i < ids.length; i += tamano) salida.push(ids.slice(i, i + tamano));
  return salida;
}

function estadoValido(s: string | undefined): ChannelRow['status'] {
  return s === 'active' || s === 'disconnected' || s === 'error' || s === 'pending' ? s : 'pending';
}
