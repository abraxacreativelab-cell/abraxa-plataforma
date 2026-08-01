/**
 * ════════════════════════════════════════════════════════════════════════════
 *  De un id de Meta al canal que le corresponde.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  ── `adminDb()` aquí, y por qué ────────────────────────────────────────────
 *
 *  Mismo motivo exacto que `channels/lookup.ts` de H6, que es el otro sitio del
 *  paquete donde aparece: **un webhook no trae empresa**. Llega de Meta con un
 *  `entry[].id` y hasta que no se lee la fila del canal no se sabe de quién es.
 *  Por definición no se puede usar `tenantDb(ctx)`: el `ctx` es justamente lo
 *  que se está resolviendo.
 *
 *  Las mismas tres reglas se cumplen aquí:
 *
 *    1. Se lee por una llave exacta, nunca un listado abierto.
 *    2. Lo que sale alimenta un `TenantContext` sintético (`contextoDeCanal`),
 *       y de ahí en adelante todo vuelve a pasar por `tenantDb(ctx)`.
 *    3. No vive en `routes/` ni en `services/` — ESLint prohíbe `adminDb` ahí
 *       dentro, y con razón.
 *
 *  ── Para qué se usa hoy, y para qué hará falta ─────────────────────────────
 *
 *  **Hoy:** para impedir que dos empresas conecten la MISMA cuenta de
 *  Instagram. Sin esta comprobación, la segunda que la conecta se queda con un
 *  canal que se ve bien y no recibe nada —el guardia de `parse.ts` descarta sus
 *  entradas— y nadie sabría por qué.
 *
 *  **Mañana:** es la pieza que le falta a la ruta de nivel de app. El webhook de
 *  Meta es por APP, no por canal: una sola URL para todos los clientes. Resolver
 *  el canal por `entry[].id` **antes** de construir el `TenantContext` es lo que
 *  hace que eso sea seguro. El parche exacto está en el README; la pieza está
 *  aquí, construida y probada, para que sea de verdad un parche y no un diseño.
 */
// adminDb: un webhook llega sin sesión y el id de la página ES lo que dice a
// qué tenant pertenece. No hay `ctx` con el que filtrar todavía.
import { adminDb } from '@abraxa/db';
import type { ChannelRow } from '../../types';
import { normalizarFila } from '../../channels/lookup';
import type { CanalMeta } from './ajustes';

/** Los dos canales que resuelve este driver. */
const CANALES: readonly CanalMeta[] = ['instagram', 'messenger'];

/**
 * El canal cuyo `entry[].id` es éste, o `null`.
 *
 * Se busca por las dos llaves porque el id de entrada no es el mismo en los dos
 * canales: en Messenger es la página, en Instagram es la cuenta de Instagram. Y
 * se busca dentro de `config`, que es donde el canal guarda los suyos.
 */
export async function resolverCanalPorEntrada(idDeEntrada: string): Promise<ChannelRow | null> {
  const id = String(idDeEntrada ?? '').trim();
  if (!id) return null;

  const porIg = await buscar('config->>ig_user_id', id, 'instagram');
  if (porIg) return porIg;

  return buscar('config->>page_id', id, 'messenger');
}

/**
 * ¿Alguien ya conectó este id de Meta? Devuelve el canal que lo tiene.
 *
 * Se consulta sin filtrar por tenant **a propósito**: la pregunta es
 * precisamente si otra empresa lo tiene. Lo único que sale de aquí hacia el
 * llamador es si existe y a qué canal pertenece — `provisionChannel()` no
 * revela de quién es, sólo se niega a duplicarlo. Decir «esta cuenta ya está
 * conectada por Fulanito S.A.» le filtraría a un cliente el nombre de otro.
 */
export async function idYaConectado(i: {
  pageId?: string;
  igUserId?: string;
  excluirCanalId?: string;
}): Promise<boolean> {
  for (const [columna, valor] of [
    ['config->>page_id', i.pageId],
    ['config->>ig_user_id', i.igUserId],
  ] as const) {
    if (!valor) continue;
    const fila = await buscar(columna, valor);
    if (fila && fila.id !== i.excluirCanalId) return true;
  }
  return false;
}

async function buscar(
  columna: string,
  valor: string,
  tipo?: CanalMeta,
): Promise<ChannelRow | null> {
  const consulta = adminDb()
    .from('channels')
    .select('*')
    .eq(columna, valor)
    .in('type', tipo ? [tipo] : [...CANALES])
    .limit(1);

  const { data, error } = await consulta;
  if (error || !Array.isArray(data)) return null;
  const fila = data[0] as Record<string, unknown> | undefined;
  return fila ? normalizarFila(fila) : null;
}
