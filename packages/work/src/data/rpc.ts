/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El puente a las dos funciones transaccionales de la 070.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  ── Por qué no pasa por `tenantDb(ctx)` ────────────────────────────────────
 *
 *  `tenantDb` cubre tablas: pone el `.eq('tenant_id', …)` que no se puede
 *  olvidar. No cubre `rpc()`, y no debería: una función de Postgres no tiene
 *  una columna que filtrar desde fuera.
 *
 *  Y hace falta una función de Postgres porque reordenar un tablero son N
 *  escrituras que valen como UNA. Si la quinta falla, las cuatro anteriores
 *  tienen que deshacerse. Eso no se puede hacer con N llamadas a PostgREST: se
 *  puede *intentar*, y el resultado es un tablero a medio mover que el usuario
 *  nunca dejó así.
 *
 *  ── Cómo se conserva el aislamiento ────────────────────────────────────────
 *
 *  `service_role` hace bypass de RLS, así que aquí el aislamiento NO lo pone
 *  Postgres: lo pone `p_tenant`. Por eso este módulo tiene una sola manera de
 *  llamar —`llamarRpc(ctx, …)`— que inyecta `ctx.tenantId` ella misma y no
 *  acepta que venga en los argumentos. Dentro del SQL, cada `WHERE` lleva
 *  `tenant_id = p_tenant`: una tarea de otro cliente no se encuentra y la
 *  transacción entera muere con `task_not_found`.
 *
 *  Es más fuerte que un `.eq()` escrito a mano, no más débil: el filtro está en
 *  la función, no en el llamador, y el llamador no puede quitarlo.
 *
 *  ESLint prohíbe `adminDb` dentro de `routes/` y `services/`. Este archivo
 *  vive en `data/` justamente para que esa prohibición siga en pie donde
 *  importa: los servicios llaman a las funciones de aquí abajo, nunca a
 *  `adminDb` directo.
 */
import { PlatformError, adminDb } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import { mapDbError } from './errors';
import type { Move } from '../domain/reorder';

/** Las únicas funciones que H9 puede invocar. Una lista cerrada y no un
 *  `string`: así el nombre de la función nunca puede venir de fuera. */
const FUNCIONES = {
  reorder: 'reorder_tasks',
  completeCascade: 'complete_task_cascade',
} as const;

type NombreRpc = (typeof FUNCIONES)[keyof typeof FUNCIONES];

async function llamarRpc(
  ctx: TenantContext,
  fn: NombreRpc,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (!ctx?.tenantId) {
    throw new PlatformError(
      'FORBIDDEN',
      'llamarRpc() sin tenantId. El contexto se arma con TenancyPort.contextFor() ' +
        'desde una sesión verificada, nunca desde un header del navegador.',
    );
  }
  if ('p_tenant' in args) {
    // Un `p_tenant` que viene en los argumentos es un `p_tenant` que pudo venir
    // de la red. No se pisa en silencio: se rechaza.
    throw new PlatformError('INTERNAL', 'p_tenant lo pone llamarRpc(), no el llamador');
  }

  const { data, error } = await adminDb().rpc(fn, { p_tenant: ctx.tenantId, ...args });
  const mapeado = mapDbError(error, `la función ${fn}`);
  if (mapeado) throw mapeado;
  return data;
}

/**
 * Aplica los movimientos como una sola transacción.
 *
 * El plan ya viene validado por `planReorder` (que además resuelve el 409 con
 * los títulos de las subtareas). Esto es el guard de la carrera: entre que el
 * servicio leyó y escribe, alguien más pudo abrir una subtarea. Si pasa, el RPC
 * lo ve con la fila bloqueada y revierte.
 */
export async function reorderTasks(ctx: TenantContext, moves: Move[]): Promise<number> {
  const data = await llamarRpc(ctx, FUNCIONES.reorder, {
    p_items: moves.map((m) => ({ ...m, actor: ctx.userEmail })),
  });
  return typeof data === 'number' ? data : moves.length;
}

/**
 * La salida del 409: cierra las subtareas abiertas y el padre, o no cierra
 * nada. Hacerlo con N llamadas desde el navegador deja el árbol a medias en
 * cuanto una falle — que es justo el estado del que el guard protegía.
 */
export async function completeTaskCascade(ctx: TenantContext, taskId: string): Promise<number> {
  const data = await llamarRpc(ctx, FUNCIONES.completeCascade, {
    p_task: taskId,
    p_actor: ctx.userEmail,
  });
  return typeof data === 'number' ? data : 0;
}
