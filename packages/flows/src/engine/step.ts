/**
 * ════════════════════════════════════════════════════════════════════════════
 *  `ejecutarPaso` — un job = un nodo de una corrida.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Carga → decide → ejecuta → decide → guarda → encola el siguiente.
 *
 *  ── Lo que NO hay aquí ─────────────────────────────────────────────────────
 *
 *  Ni un `import` de pg-boss. La cola entra por `encolar`, que es un parámetro:
 *  en producción la pone `queue.ts` y en las pruebas se pasa una que ejecuta
 *  en el momento. Por eso el 100% de la idempotencia, el tope anti-bucle, la
 *  pausa y la reanudación se prueban en CI, donde no hay ni base ni schema
 *  `pgboss` (el schema no existe en la base todavía: este carril es el primero
 *  que de verdad necesita una cola).
 *
 *  ── El orden de las tres escrituras, que no es casual ──────────────────────
 *
 *    1. se REGISTRA el paso
 *    2. se AVANZA el puntero
 *    3. se ENCOLA el siguiente
 *
 *  Si (3) falla, el reintento del job actual se auto-aborta porque el puntero
 *  ya cambió (`decidirAntes`). Si (2) falla, se relanza y el reintento
 *  re-ejecuta este nodo — pero el guard de doble envío y el índice único de la
 *  migración 061 impiden que el mensaje salga dos veces. No hay orden en el que
 *  un fallo mande dos mensajes.
 */
import type { TenantContext } from '@abraxa/db';
import { PlatformError } from '@abraxa/db';
import { construirVariables } from '../templating';
import type { FlowDefinition } from '../types';
import { decidirAntes, decidirDespues } from './decision';
import type { EstadoDeCorrida } from './decision';
import { ejecutarNodo } from './nodes';
import type { EntornoDeNodo } from './nodes';
import * as store from '../store';

/** Lo que viaja en un job de la cola. */
export interface TrabajoDePaso {
  tenantId: string;
  tenantSlug: string;
  runId: string;
  nodeId: string;
}

export interface Encolar {
  (trabajo: TrabajoDePaso, opciones?: { startAfter?: Date }): Promise<boolean>;
}

export interface EntornoDelMotor {
  encolar: Encolar;
  ahora?: () => Date;
  fetch?: typeof globalThis.fetch;
}

/** Qué pasó con este job. Es lo que devuelve para las pruebas y la bitácora. */
export interface ResultadoDePaso {
  accion: 'ignorado' | 'pausado' | 'terminado' | 'avanzado';
  razon?: string;
  siguiente?: string;
  estado?: string;
}

/**
 * El contexto de una corrida que ejecuta el worker.
 *
 * No hay sesión: quien dispara es un evento, no una persona. Es el mismo
 * atajo explícito que H6 escribió para sus webhooks (`packages/inbox/src/
 * context.ts`) y lleva las mismas dos garantías: `userEmail: null` porque no
 * hay nadie a quien atribuirlo, y `role: null` + `areas: {}` porque este
 * contexto NO autoriza a nada — sólo ACOTA a un tenant para que `tenantDb`
 * filtre.
 *
 * Que un flujo no pueda hacer más que lo que hace su dueño se garantiza en
 * otro lado: al ACTIVARLO, que sí exige rol admin y sí tiene sesión.
 */
export function contextoDelMotor(tenantId: string, tenantSlug = ''): TenantContext {
  if (!tenantId) {
    throw new PlatformError('INTERNAL', 'un job de flujo sin tenantId no se puede ejecutar');
  }
  return { tenantId, tenantSlug, userEmail: null, role: null, areas: {} };
}

/**
 * Ejecuta un paso. Devuelve qué se hizo; sólo lanza cuando hay que reintentar
 * el job entero (un fallo de infraestructura, no del flujo).
 */
export async function ejecutarPaso(
  trabajo: TrabajoDePaso,
  entorno: EntornoDelMotor,
): Promise<ResultadoDePaso> {
  const ctx = contextoDelMotor(trabajo.tenantId, trabajo.tenantSlug);
  const ahora = entorno.ahora?.() ?? new Date();

  const corrida = await store.obtenerCorrida(ctx, trabajo.runId);
  if (!corrida) return { accion: 'ignorado', razon: 'la corrida ya no existe' };

  // La definición sale de la VERSIÓN con la que arrancó, no del flujo vigente:
  // editar un flujo no cambia el guion de una corrida en vuelo.
  const definicion = await definicionDeLaCorrida(ctx, corrida.flowId, corrida.version);
  if (!definicion) {
    await store.terminarCorrida(ctx, corrida.id, 'error', 'la versión del flujo ya no existe');
    return { accion: 'terminado', razon: 'la versión del flujo ya no existe' };
  }

  const estado: EstadoDeCorrida = {
    runId: corrida.id,
    status: corrida.status,
    currentNode: corrida.currentNode,
    nodeId: trabajo.nodeId,
    // Ejecuciones, no filas guardadas: ver `store.sumarEjecucion`.
    pasosDados: corrida.stepsTaken,
    definition: definicion,
    nodoYaCompletado: await store.nodoYaCompletado(ctx, corrida.id, trabajo.nodeId),
  };

  const antes = decidirAntes(estado);
  if (antes.accion === 'ignorar') return { accion: 'ignorado', razon: antes.razon };
  if (antes.accion === 'terminar') {
    await store.terminarCorrida(ctx, corrida.id, antes.status, antes.razon);
    return { accion: 'terminado', razon: antes.razon };
  }

  const nodo = antes.nodo;
  const arranque = ahora.toISOString();

  const entornoNodo: EntornoDeNodo = {
    ctx,
    run: {
      id: corrida.id,
      contactId: corrida.contactId,
      context: corrida.context,
      isTest: corrida.isTest,
    },
    vars: await construirVariables(ctx, corrida.context, ahora),
    ahora,
    fetch: entorno.fetch ?? globalThis.fetch,
    yaCompletado: estado.nodoYaCompletado,
  };

  // Un nodo no debe poder tumbar al worker: lo que se le escape se trata como
  // fallo del paso, y `decidirDespues` decide si eso mata la corrida o la
  // pausa. Lo que sí se relanza son los fallos de ESCRITURA, más abajo.
  let resultado;
  try {
    resultado = await ejecutarNodo(nodo, entornoNodo);
  } catch (err) {
    resultado = {
      status: 'failed' as const,
      error: err instanceof Error ? err.message : 'el paso falló sin decir por qué',
    };
  }

  const despues = decidirDespues(estado, nodo, resultado);

  if (despues.accion === 'pausar') {
    // Sin paso escrito y sin mover el puntero: al reanudar se re-ejecuta ESTE
    // nodo, y por eso una espera larga no le gasta los 100 pasos a la corrida.
    await store.pausarCorrida(ctx, corrida.id, despues.razon);
    return { accion: 'pausado', razon: despues.razon };
  }

  const escrito = await store.registrarPaso(ctx, { ...despues.paso, runId: corrida.id, startedAt: arranque });
  // `false` = el índice único rechazó el paso porque otro intento ya lo había
  // completado. No es un error: es el criterio #5 funcionando. Se sigue.

  // El contador sube SIEMPRE, se haya escrito el paso o no. Si sólo subiera
  // con la fila, un flujo con ciclo lo dejaría clavado —el índice único
  // rechaza el segundo `ok` del mismo nodo— y el tope anti-bucle no saltaría
  // nunca.
  await store.sumarEjecucion(ctx, corrida.id, estado.pasosDados);

  if (despues.accion === 'terminar') {
    await store.terminarCorrida(ctx, corrida.id, despues.status, despues.error);
    return { accion: 'terminado', estado: despues.status, ...(despues.error ? { razon: despues.error } : {}) };
  }

  await store.moverPuntero(ctx, corrida.id, {
    currentNode: despues.siguiente,
    status: despues.status,
    wakeAt: despues.wakeAt,
  });

  const encolado = await entorno.encolar(
    { ...trabajo, nodeId: despues.siguiente },
    despues.wakeAt ? { startAfter: new Date(despues.wakeAt) } : undefined,
  );

  if (!encolado) {
    // La cola no aceptó el trabajo. Dejar la corrida en 'running' sin job
    // pendiente la volvería un zombi invisible: nadie la mueve y nadie sabe
    // por qué. Se marca como pausada, que es el estado del que el barrido de
    // reanudación sí la rescata.
    await store.pausarCorrida(
      ctx,
      corrida.id,
      'no se pudo encolar el siguiente paso; se reintentará al reanudar',
    );
    return { accion: 'pausado', razon: 'la cola no aceptó el siguiente paso' };
  }

  return {
    accion: 'avanzado',
    siguiente: despues.siguiente,
    estado: despues.status,
    ...(escrito ? {} : { razon: 'el paso ya estaba registrado (reintento)' }),
  };
}

/**
 * La definición congelada de una corrida.
 *
 * Se lee de `flow_versions`, y sólo se cae al flujo vigente si esa versión no
 * existe —flujos creados antes de que el historial guardara la v1—.
 */
async function definicionDeLaCorrida(
  ctx: TenantContext,
  flowId: string,
  version: number,
): Promise<FlowDefinition | null> {
  const v = await store.obtenerVersion(ctx, flowId, version);
  if (v) return v.definition;
  const flujo = await store.obtenerFlujo(ctx, flowId);
  return flujo?.definition ?? null;
}

/**
 * Reanuda una corrida pausada. La llama el barrido del worker y también el
 * botón "reintentar" del panel.
 *
 * Idempotente por partida doble: `reclamarPausada` sólo la gana un llamador, y
 * si dos pasaran, el guard de doble envío del nodo impide el segundo mensaje.
 */
export async function reanudar(
  trabajo: Omit<TrabajoDePaso, 'nodeId'>,
  entorno: EntornoDelMotor,
): Promise<boolean> {
  const ctx = contextoDelMotor(trabajo.tenantId, trabajo.tenantSlug);
  const corrida = await store.obtenerCorrida(ctx, trabajo.runId);
  if (!corrida?.currentNode) return false;
  if (corrida.status !== 'paused' && corrida.status !== 'waiting') return false;

  if (corrida.status === 'paused' && !(await store.reclamarPausada(ctx, corrida.id))) {
    return false; // otro la reanudó primero
  }

  const encolado = await entorno.encolar({ ...trabajo, nodeId: corrida.currentNode });
  if (!encolado) {
    await store.pausarCorrida(ctx, corrida.id, 'la cola no aceptó la reanudación');
    return false;
  }
  return true;
}
