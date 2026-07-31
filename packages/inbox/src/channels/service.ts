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

/** Baja de la línea con el proveedor y borrado de la fila. */
export async function borrarCanal(ctx: TenantContext, channelId: string): Promise<void> {
  const db = tenantDb(ctx);
  const { data } = await db.from('channels').select('*').eq('id', channelId).maybeSingle();
  if (!data) throw new PlatformError('NOT_FOUND', 'Canal no encontrado.');
  const fila = normalizarFila(data as Record<string, unknown>);

  const driver = hasDriver(fila.type) ? driverFor(fila.type) : null;
  if (driver?.teardownChannel) {
    // Que el proveedor no responda no puede dejar al cliente con un canal
    // muerto que no se puede borrar. Queda en el log.
    await driver
      .teardownChannel({ channelId: fila.id, config: fila.config })
      .catch((e: unknown) => log.warn(`baja del canal ${fila.name} con el proveedor: ${String(e)}`));
  }

  const { error } = await db.from('channels').delete().eq('id', channelId);
  if (error) throw new PlatformError('INTERNAL', `No se pudo borrar el canal: ${error.message}`);
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
  return h;
}

function estadoValido(s: string | undefined): ChannelRow['status'] {
  return s === 'active' || s === 'disconnected' || s === 'error' || s === 'pending' ? s : 'pending';
}
