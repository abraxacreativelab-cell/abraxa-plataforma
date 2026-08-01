/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Nuestros propios ecos — para que el agente no se calle a sí mismo.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Meta devuelve por el webhook una copia de **todo** lo que sale de la página,
 *  marcada con `is_echo: true`. Eso es bueno y hay que conservarlo: cuando el
 *  emprendedor contesta desde la app de Instagram en su teléfono, ese eco es lo
 *  ÚNICO que le avisa al sistema, y H6 lo usa para callar a la IA —la regla #1
 *  del paquete, «un humano escribe en el hilo → la IA se calla»
 *  (`ingest.ts:263`)—.
 *
 *  Pero también vuelve el eco de lo que mandamos NOSOTROS, y ahí sería un
 *  desastre: el sistema leería su propia respuesta como «un humano tomó el
 *  hilo» y pausaría al agente una hora. El síntoma sería «el agente contesta
 *  una vez y se muere».
 *
 *  ── Por qué no basta con el índice único de H6 ─────────────────────────────
 *
 *  Para un envío de UNA llamada no hace falta nada de esto: `send()` devuelve el
 *  `mid`, H6 lo guarda en `messages.external_id`, y el eco choca con el índice
 *  único `(tenant_id, external_id)` — sale por `duplicado` y ahí muere
 *  (`ingest.ts:170-177`). Limpio y sin código extra.
 *
 *  El agujero está en los envíos de VARIAS llamadas, y en Meta son inevitables:
 *
 *    · Texto + adjunto → Meta no acepta pie de foto. Son dos llamadas.
 *    · Texto largo → Instagram corta en 1000 caracteres y Messenger en 2000.
 *
 *  `send()` sólo puede devolver UN `externalId`, así que del segundo `mid` en
 *  adelante nadie se acuerda: su eco no choca con nada, entra como mensaje
 *  nuevo `fromMe`, y pausa al agente. El fallo aparece **sólo** cuando el
 *  agente manda una foto o una respuesta larga — o sea, casi nunca en pruebas y
 *  a diario con clientes.
 *
 *  Así que se recuerdan todos los `mid` que salen de aquí. La tabla es pequeña
 *  por diseño: un eco llega en segundos y **se consume al leerse**.
 */
import { tenantDb } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import { log } from '../../logger';

/**
 * Cuántos días se guarda un `mid` cuyo eco nunca llegó.
 *
 * Si Meta no devolvió el eco en una semana, no va a llegar: o la página se
 * desuscribió de `message_echoes`, o el mensaje se borró. Se barren para que la
 * tabla no crezca sin fin.
 */
export const DIAS_DE_GRACIA = 7;

/**
 * Anota los `mid` que acabamos de mandar.
 *
 * Best-effort: si esto falla, el mensaje YA SALIÓ al cliente. Lanzar aquí
 * dejaría al emprendedor viendo un error sobre un mensaje que sí se entregó, y
 * el reintento lo mandaría dos veces. El precio de fallar es acotado y conocido
 * —una pausa de una hora en un hilo— y queda escrito en el log.
 */
export async function recordarMids(
  ctx: TenantContext,
  i: { channelId: string; mids: Array<string | null | undefined> },
): Promise<void> {
  const filas = i.mids
    .filter((m): m is string => typeof m === 'string' && m.length > 0)
    .map((mid) => ({ channel_id: i.channelId, mid }));

  if (filas.length === 0) return;

  try {
    // `ignoreDuplicates`: dos envíos concurrentes pueden repetir un mid en
    // teoría; que el segundo no reviente es más importante que anotarlo.
    const { error } = await tenantDb(ctx)
      .from('meta_outbound_mids')
      .upsert(filas, { onConflict: 'tenant_id,mid', ignoreDuplicates: true });
    if (error) throw error;
  } catch (err) {
    log.warn(`meta: no se pudieron anotar los mids salientes: ${String(err)}`);
  }
}

/**
 * De estos `mid`, ¿cuáles los mandamos nosotros?
 *
 * Devuelve un conjunto vacío ante cualquier problema, y eso es lo correcto: sin
 * esta información un eco nuestro se trata como un mensaje del teléfono y la IA
 * se pausa una hora. Molesto y reversible. Lo contrario —dar por propio un eco
 * que escribió un humano— dejaría al agente contestando encima de su dueño, que
 * es el fallo que H6 describe como el peor de todos.
 */
export async function midsPropios(
  ctx: TenantContext,
  i: { channelId: string; mids: string[] },
): Promise<Set<string>> {
  if (i.mids.length === 0) return new Set();

  try {
    const { data, error } = await tenantDb(ctx)
      .from('meta_outbound_mids')
      .select('mid')
      .eq('channel_id', i.channelId)
      .in('mid', i.mids);
    if (error) throw error;

    const encontrados = ((data as Array<{ mid: string }> | null) ?? []).map((f) => f.mid);

    // Se consumen: el eco ya llegó y esta fila no vuelve a servir para nada.
    // Es lo que mantiene la tabla del tamaño de «lo que está en vuelo».
    if (encontrados.length > 0) void olvidar(ctx, i.channelId, encontrados);

    return new Set(encontrados);
  } catch (err) {
    log.warn(`meta: no se pudieron leer los mids propios: ${String(err)}`);
    return new Set();
  }
}

async function olvidar(ctx: TenantContext, channelId: string, mids: string[]): Promise<void> {
  try {
    await tenantDb(ctx)
      .from('meta_outbound_mids')
      .delete()
      .eq('channel_id', channelId)
      .in('mid', mids);
  } catch (err) {
    log.debug(`meta: no se pudieron consumir los mids ya vistos: ${String(err)}`);
  }
}

/**
 * Barre los `mid` cuyo eco nunca llegó.
 *
 * Se llama desde `channelStatus()` —la pantalla de Ajustes— y no desde el
 * webhook: es una limpieza, y una limpieza no va en el camino por el que pasa
 * cada mensaje de cada cliente. Si nadie abre Ajustes nunca, lo que crece es
 * una tabla de dos columnas con las sobras de los envíos que Meta no devolvió;
 * es acotado y es visible.
 */
export async function barrerViejos(ctx: TenantContext, dias = DIAS_DE_GRACIA): Promise<number> {
  const limite = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();
  try {
    // `lte` y no `lt`: para un barrido de siete días el borde no significa
    // nada, y es el operador que entienden por igual PostgREST y el doble en
    // memoria de H6 — una prueba que no puede correr no prueba nada.
    const { count, error } = await tenantDb(ctx)
      .from('meta_outbound_mids')
      .delete()
      .lte('created_at', limite);
    if (error) throw error;
    return typeof count === 'number' ? count : 0;
  } catch (err) {
    log.debug(`meta: barrido de mids viejos sin efecto: ${String(err)}`);
    return 0;
  }
}
