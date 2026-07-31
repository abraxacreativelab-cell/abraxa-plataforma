/**
 * ════════════════════════════════════════════════════════════════════════════
 *  La cola. Es lo ÚNICO de este paquete que necesita pg-boss.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  El motor (`engine/`) no la conoce: recibe una función `encolar` y ya. Aquí
 *  viven las tres implementaciones de esa función, y el resto del paquete no
 *  cambia según cuál esté puesta.
 *
 *    · `colaDePgBoss(boss)`  producción, en el worker
 *    · `colaEnLinea()`       ejecuta el siguiente paso en el momento
 *    · `colaAusente()`       devuelve `false` — la corrida se pausa y lo dice
 *
 *  ── Por qué `batchSize: 1` no se sube ──────────────────────────────────────
 *
 *  Está heredado de GARDEN y `apps/worker/src/index.ts` lo repite: con lotes,
 *  un paso que falla arrastra a sus vecinos y los re-ejecuta. Aquí eso
 *  significa mandarle a un cliente el mismo WhatsApp otra vez.
 *
 *  ── El estado real del cableado, verificado el 2026-07-31 ──────────────────
 *
 *  `apps/worker/src/index.ts` expone `registerQueue()` y dice "llámalo desde el
 *  index de tu paquete". No se puede: ese archivo NO importa ningún paquete
 *  (`apps/worker` es de H1 y no se toca desde este carril), así que si este
 *  paquete llamara a `registerQueue`, nadie ejecutaría esa línea — y de paso
 *  importar el worker desde un paquete dispararía su `start()`, que revienta
 *  sin `DATABASE_URL`.
 *
 *  Lo que se entrega en su lugar es `descriptorDeCola()`: el worker se cablea
 *  con UNA línea, anotada en el PR para el orquestador:
 *
 *      import { descriptorDeCola } from '@abraxa/flows';
 *      registerQueue(descriptorDeCola());
 *
 *  Y el schema `pgboss` todavía no existe en la base: este carril es el primero
 *  que de verdad necesita una cola. Mientras no exista, `colaAusente()` deja
 *  las corridas en `paused` con su razón a la vista, y `reanudarPendientes()`
 *  las rescata en cuanto haya cola. No se pierde ninguna.
 */
import { ejecutarPaso, reanudar } from './engine/step';
import type { Encolar, EntornoDelMotor, TrabajoDePaso } from './engine/step';
import * as store from './store';
import { contextoDelMotor } from './engine/step';

/** El nombre de la cola en pg-boss. */
export const COLA = 'flows.step';

/** Lo mínimo de pg-boss que este archivo usa. Tiparlo así lo hace probable. */
export interface ColaCompatible {
  send(
    nombre: string,
    datos: Record<string, unknown>,
    opciones?: { startAfter?: Date; retryLimit?: number },
  ): Promise<string | null>;
}

/**
 * La cola de verdad. Un job = un paso.
 *
 * `retryLimit: 3` porque los reintentos son SEGUROS aquí: el fence de
 * `current_node`, el guard de doble envío y el índice único de la migración
 * 061 hacen que re-ejecutar un paso no repita su efecto. Sin esas tres
 * piezas, reintentar sería exactamente lo que no hay que hacer.
 */
export function colaDePgBoss(boss: ColaCompatible): Encolar {
  return async (trabajo, opciones) => {
    try {
      const id = await boss.send(COLA, { ...trabajo }, { retryLimit: 3, ...(opciones ?? {}) });
      return id !== null;
    } catch (err) {
      console.error('[flows] no se pudo encolar el paso', err);
      return false;
    }
  };
}

/**
 * Sin cola: el siguiente paso corre AQUÍ MISMO, en cadena.
 *
 * Es lo que hace que el motor se pueda probar entero sin pg-boss, y también
 * sirve para `npm run dev` sin worker. NO es para producción: un proceso web
 * que ejecuta pasos bloquea la petición y pierde el trabajo si se reinicia.
 *
 * `startAfter` se IGNORA a propósito y se anota en el resultado: dormir de
 * verdad 24 horas dentro de un proceso web no es una espera, es una fuga. Las
 * corridas que piden esperar quedan en `waiting` con su `wake_at` escrito y
 * las despierta `reanudarPendientes()`.
 */
export function colaEnLinea(entorno: Omit<EntornoDelMotor, 'encolar'> = {}): Encolar {
  const encolar: Encolar = async (trabajo, opciones) => {
    if (opciones?.startAfter) return true; // queda dormida; la despierta el barrido
    await ejecutarPaso(trabajo, { ...entorno, encolar });
    return true;
  };
  return encolar;
}

/** No hay cola. La corrida se pausa con su razón escrita. */
export function colaAusente(): Encolar {
  return () => Promise.resolve(false);
}

// ════════════════════════════════════════════════════════════════════════════
// La cola registrada en este proceso
// ════════════════════════════════════════════════════════════════════════════

let cola: Encolar = colaAusente();

/** La pone el worker al arrancar (o una prueba). */
export function configurarCola(nueva: Encolar): void {
  cola = nueva;
}

/** La cola de este proceso. Es lo que usan las rutas y `FlowPort.emit`. */
export function encolar(): Encolar {
  return (trabajo, opciones) => cola(trabajo, opciones);
}

/**
 * El descriptor que el worker le pasa a `registerQueue()`. Una línea de
 * cableado, sin que este paquete importe `apps/worker`.
 */
export function descriptorDeCola(): {
  name: string;
  handler: (job: unknown) => Promise<void>;
  options: { batchSize: number };
} {
  return {
    name: COLA,
    // pg-boss entrega `{ id, name, data }`. Se acepta también el trabajo
    // pelado para que el descriptor se pueda probar sin pg-boss.
    handler: async (job: unknown) => {
      const datos = (job && typeof job === 'object' && 'data' in job
        ? (job as { data: unknown }).data
        : job) as Partial<TrabajoDePaso> | null;

      if (!datos?.tenantId || !datos.runId || !datos.nodeId) {
        console.error('[flows] job sin tenantId/runId/nodeId, ignorado');
        return;
      }
      await ejecutarPaso(
        {
          tenantId: datos.tenantId,
          tenantSlug: datos.tenantSlug ?? '',
          runId: datos.runId,
          nodeId: datos.nodeId,
        },
        { encolar: encolar() },
      );
    },
    options: { batchSize: 1 },
  };
}

/**
 * Despierta lo que toca: las dormidas cuyo `wake_at` ya pasó y las pausadas
 * cuyo canal volvió.
 *
 * Es idempotente por dos vías —`reclamarPausada` sólo la gana uno, y el guard
 * de doble envío cubre el resto—, así que llamarlo de más nunca duplica un
 * mensaje. Lo dispara el barrido del worker; puede dispararlo también un
 * webhook de canal reconectado.
 */
export async function reanudarPendientes(
  tenantId: string,
  tenantSlug = '',
  ahora = new Date(),
): Promise<number> {
  const ctx = contextoDelMotor(tenantId, tenantSlug);
  const pendientes = await store.corridasPendientes(ctx, ahora);
  let despertadas = 0;

  for (const corrida of pendientes) {
    const ok = await reanudar(
      { tenantId, tenantSlug, runId: corrida.id },
      { encolar: encolar() },
    );
    if (ok) despertadas += 1;
  }
  return despertadas;
}
