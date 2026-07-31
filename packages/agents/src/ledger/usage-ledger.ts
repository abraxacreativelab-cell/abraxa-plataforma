/**
 * Escritura del libro de consumo.
 *
 * Dos decisiones que valen la pena explicar:
 *
 * 1. UNA FILA POR CORRIDA, no por iteración. Una corrida del agent loop puede
 *    dar diez vueltas llamando tools; lo que el cliente pidió fue una respuesta.
 *    Las iteraciones van en su columna para poder detectar un agente que se
 *    está dando de topes, sin inflar el número de filas.
 *
 * 2. SE ESCRIBE AUNQUE LA LLAMADA FALLE. Un error del proveedor a media
 *    generación ya consumió tokens y ya se va a facturar. Un ledger que sólo
 *    anota los éxitos subestima el gasto justo cuando algo anda mal — que es
 *    cuando más importa saberlo.
 */
import { tenantDb } from '@abraxa/db';
import type { AgentRole, ProviderName, TenantContext } from '@abraxa/db';
import type { CostoCalculado, RawUsage } from '../types';
import { log } from '../logger';

export interface EntradaLedger {
  role: AgentRole;
  agentDefinitionId: string | null;
  provider: ProviderName;
  model: string;
  usage: RawUsage;
  costo: CostoCalculado;
  threadId?: string | undefined;
  workspaceId?: string | undefined;
  iterations: number;
  latencyMs: number;
  status: 'ok' | 'error' | 'partial';
}

/**
 * Registra una corrida.
 *
 * Nunca lanza. Es deliberado: si la escritura del ledger tumbara la respuesta,
 * un problema de contabilidad se convertiría en una caída de cara al cliente
 * final. El fallo se registra en el log y la respuesta sigue su camino.
 *
 * El riesgo aceptado —perder una fila de consumo— está acotado por el otro
 * lado: el presupuesto se consulta ANTES de llamar al modelo, así que una fila
 * perdida atrasa el corte, no lo elimina.
 */
export async function registrarConsumo(ctx: TenantContext, e: EntradaLedger): Promise<void> {
  try {
    const fila: Record<string, unknown> = {
      agent_role: e.role,
      agent_definition_id: e.agentDefinitionId,
      provider: e.provider,
      model: e.model,
      input_tokens: e.usage.inputTokens,
      output_tokens: e.usage.outputTokens,
      cache_read_tokens: e.usage.cacheReadTokens,
      cache_write_5m_tokens: e.usage.cacheWrite5mTokens,
      cache_write_1h_tokens: e.usage.cacheWrite1hTokens,
      cost_usd: e.costo.costUsd,
      // Lo que cuenta contra el tope. Igual a cost_usd salvo en 'unpriced',
      // donde es el piso conservador (migración 026).
      budgeted_usd: e.costo.budgetedUsd,
      cost_source: e.costo.source,
      pricing_id: e.costo.pricingId,
      request_id: e.usage.requestId,
      thread_id: e.threadId ?? null,
      workspace_id: e.workspaceId ?? null,
      iterations: e.iterations,
      latency_ms: e.latencyMs,
      status: e.status,
    };

    const escribir = async (f: Record<string, unknown>) =>
      (await tenantDb(ctx).from('usage_ledger').insert(f)).error;

    let error = await escribir(fila);

    // Código desplegado ANTES de la migración 026: la columna no existe todavía
    // y PostgREST rechaza el INSERT entero con PGRST204 / 42703. Sin este
    // reintento se perdería la fila COMPLETA —tokens crudos incluidos—, no sólo
    // la columna nueva: el tope dejaría de avanzar, `corridasDesde` devolvería 0
    // y el rate limit también quedaría ciego. O sea, un agujero PEOR que el que
    // este PR vino a cerrar, abierto por la ventana de un despliegue.
    //
    // La 026 defiende la dirección contraria con su DEFAULT 0 (base migrada,
    // código viejo). Ésta es la otra mitad.
    if (error && esColumnaInexistente(error)) {
      log.warn(
        'app.usage_ledger.budgeted_usd no existe todavía: se registra el consumo ' +
          'sin ella. Aplica la migración 026 (npm run migrate) para que el tope ' +
          'vea el piso de las corridas sin precio.',
      );
      const { budgeted_usd: _sinColumna, ...sinBudgeted } = fila;
      error = await escribir(sinBudgeted);
    }

    if (error) {
      // 23505 = unique_violation. Es el índice de idempotencia haciendo su
      // trabajo: el mismo request_id ya estaba anotado, o sea que esto es un
      // reintento. No cobrar dos veces es exactamente lo que queríamos.
      if (error.code === '23505') {
        log.debug(`consumo ya registrado para request_id=${e.usage.requestId ?? '?'}; se ignora`);
        return;
      }
      log.error(`no se pudo registrar el consumo: ${error.message}`);
      return;
    }

    if (e.costo.source === 'unpriced') {
      // Ruidoso a propósito. Es la señal de que falta capturar un precio, y es
      // justo la que GARDEN no tenía: su fallback silencioso inventaba uno.
      //
      // Antes era la ÚNICA señal, y por eso no bastaba: un log.warn por corrida
      // no detiene nada. Ahora la fila también lleva `budgeted_usd` con el piso,
      // así que el tope sí ve este gasto aunque nadie lea el log.
      log.warn(
        `consumo SIN PRECIO: ${e.provider}/${e.model} — registrado en 0 USD, ` +
          `pero cuenta $${e.costo.budgetedUsd.toFixed(6)} contra el tope (piso conservador). ` +
          `Captura la fila en app.model_pricing y recalcula.`,
      );
    }
  } catch (err) {
    log.error(`fallo inesperado al registrar consumo: ${String(err)}`);
  }
}

/**
 * Gasto acumulado del tenant desde una fecha. Lo usa el presupuesto.
 *
 * Suma `budgeted_usd`, NO `cost_usd`. La diferencia sólo aparece en las
 * corridas `unpriced` —donde `cost_usd` es 0 por honestidad y `budgeted_usd`
 * trae el piso conservador— y es justo ahí donde el tope se quedaba ciego.
 *
 * El `??` no es defensivo de más: las filas escritas ANTES de la migración 026
 * se rellenaron con `cost_usd`, pero cualquier fila que llegue sin la columna
 * (una base a medio migrar, un doble de pruebas que siembra a mano) tiene que
 * seguir contando por su costo en vez de desaparecer del total. Fallar hacia
 * "cuenta algo" y nunca hacia "cuenta cero".
 */
export async function gastoDesde(ctx: TenantContext, desde: Date): Promise<number> {
  return (await gastoDelMes(ctx, desde)).computadoUsd;
}

export interface GastoDelMes {
  /** Lo que cuenta contra el tope: costo real + piso de lo `unpriced`. */
  computadoUsd: number;
  /** Lo que de verdad costó. El número conciliable con la factura. */
  realUsd: number;
}

/**
 * Los dos números de una sola lectura.
 *
 * Existe porque `estadoPresupuesto` necesita ambos y pedirlos por separado
 * paginaba el ledger DOS veces por cada `GET /agents/budget` — el doble de
 * viajes para responder lo que la misma consulta ya trae. Y con dos lecturas
 * consecutivas los números pueden venir de instantes distintos: una corrida que
 * entra en medio hace que el "gastado" y el "computado" no cuadren entre sí.
 */
export async function gastoDelMes(ctx: TenantContext, desde: Date): Promise<GastoDelMes> {
  const filas = await leerFilasDelMes(ctx, desde);
  return {
    computadoUsd: sumar(filas, (f) => f.budgeted_usd ?? f.cost_usd),
    realUsd: sumar(filas, (f) => f.cost_usd),
  };
}

/**
 * Lo que de verdad COSTÓ el mes, sin el piso. Es el número honesto, y es el
 * que ve el cliente.
 *
 * Existe porque `gastoDesde` dejó de ser reportable: al sumar el piso —que se
 * calcula al precio de Fable 5 y no corresponde a ninguna factura— un tenant
 * con un modelo sin precio vería un "gastado" inflado que no puede conciliar
 * con nada. El tope necesita el piso; la pantalla necesita la verdad.
 */
export async function gastoRealDesde(ctx: TenantContext, desde: Date): Promise<number> {
  return (await gastoDelMes(ctx, desde)).realUsd;
}

interface FilaDeCosto {
  cost_usd: string | number | null;
  budgeted_usd?: string | number | null;
}

/** El corte por omisión de PostgREST. Se pagina justo por él. */
const FILAS_POR_PAGINA = 1000;

/** Suma un campo de las filas, tolerando `numeric` como string y nulos. */
function sumar(
  filas: FilaDeCosto[],
  extraer: (f: FilaDeCosto) => string | number | null | undefined,
): number {
  return filas.reduce((suma, f) => {
    const bruto = extraer(f);
    if (bruto === null || bruto === undefined) return suma;
    const v = typeof bruto === 'number' ? bruto : Number.parseFloat(bruto);
    return suma + (Number.isFinite(v) ? v : 0);
  }, 0);
}

/**
 * Todas las filas de consumo del mes, paginadas.
 *
 * ── Por qué se pagina ──────────────────────────────────────────────────────
 *
 * PostgREST corta en 1,000 filas por omisión y NO avisa: devuelve las mil
 * primeras con un 200. Un tenant con más de mil corridas en el mes vería su
 * gasto truncado justo cuando más se acerca al tope — la misma ceguera del
 * hallazgo, por volumen en vez de por precio, y por el camino más callado: aquí
 * no hay ni un `log.warn` del que enterarse.
 *
 * **Sin freno de emergencia y a propósito.** Una versión anterior cortaba a las
 * 100,000 filas para acotar la latencia, y eso reintroducía el bug: devolvía un
 * total que se sabía corto, así que el tope volvía a subestimar el gasto — en
 * silencio otra vez. El bucle termina solo cuando llega una página incompleta;
 * si algún mes hay tantas filas que esto pesa, la respuesta es agregar en la
 * base (una RPC), no contar de menos.
 *
 * ── Por qué el orden explícito ─────────────────────────────────────────────
 *
 * `range()` es OFFSET/LIMIT, y sin `ORDER BY` el orden entre páginas no está
 * garantizado. Con el índice `(tenant_id, created_at DESC)` de la 023 el
 * barrido va de lo más nuevo a lo más viejo: una corrida que entra entre la
 * página 1 y la 2 desplaza todo y la fila del borde se lee DOS veces. Contra el
 * tope eso es conservador, pero ensucia el número que el cliente tiene que
 * poder conciliar con su factura. Se ordena por `id`, que es inmutable.
 *
 * ── Por qué el reintento sin `budgeted_usd` ────────────────────────────────
 *
 * En este workspace las migraciones se aplican por separado del despliegue. Si
 * el código sale antes que la 026, `select('budgeted_usd')` devuelve 42703 y
 * `verificarPresupuesto` NO lo envuelve: toda corrida de todo tenant moriría.
 * Un arreglo del tope que tumba el motor por una ventana de despliegue no es un
 * arreglo. Cualquier otro error sube como siempre.
 */
async function leerFilasDelMes(ctx: TenantContext, desde: Date): Promise<FilaDeCosto[]> {
  const leerPagina = async (columnas: string, inicio: number): Promise<FilaDeCosto[]> => {
    const { data, error } = await tenantDb(ctx)
      .from('usage_ledger')
      .select(columnas)
      .gte('created_at', desde.toISOString())
      .order('id', { ascending: true })
      .range(inicio, inicio + FILAS_POR_PAGINA - 1);
    if (error) throw error;
    return (data ?? []) as unknown as FilaDeCosto[];
  };

  const leerTodo = async (columnas: string): Promise<FilaDeCosto[]> => {
    const todas: FilaDeCosto[] = [];
    for (let inicio = 0; ; inicio += FILAS_POR_PAGINA) {
      const pagina = await leerPagina(columnas, inicio);
      todas.push(...pagina);
      // Página incompleta = última página. Es el criterio que no depende de
      // conocer el total por adelantado.
      if (pagina.length < FILAS_POR_PAGINA) return todas;
    }
  };

  try {
    return await leerTodo('cost_usd, budgeted_usd');
  } catch (err) {
    if (!esColumnaInexistente(err)) throw err;
    log.warn(
      'app.usage_ledger.budgeted_usd no existe todavía: se cuenta por cost_usd. ' +
        'Aplica la migración 026 (npm run migrate) para que el tope vea el piso.',
    );
    return leerTodo('cost_usd');
  }
}

/**
 * La columna no existe todavía. Es el único error que se reintenta.
 *
 * `42703` es el código de Postgres; `PGRST204` es el que devuelve PostgREST
 * cuando la columna no está en su caché de esquema, que es justo lo que pasa
 * en la ventana entre desplegar el código y correr la migración.
 */
function esColumnaInexistente(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (e?.code === '42703' || e?.code === 'PGRST204') return true;
  return /budgeted_usd/.test(e?.message ?? '');
}

/** Cuántas corridas lleva el tenant desde un instante. Lo usa el rate limit. */
export async function corridasDesde(ctx: TenantContext, desde: Date): Promise<number> {
  const { count, error } = await tenantDb(ctx)
    .from('usage_ledger')
    .select('id', { head: true, count: 'exact' })
    .gte('created_at', desde.toISOString());

  if (error) throw error;
  return count ?? 0;
}
