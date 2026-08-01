/**
 * ════════════════════════════════════════════════════════════════════════════
 *  "Qué estás usando" — con un hueco honesto donde todavía no hay dato.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * El segundo bloque de `/ajustes/plan`: asientos, contactos, canales, flujos,
 * agentes y gasto de IA del mes, cada uno contra el límite de su plan.
 *
 * ── La regla que hace que esta pantalla no mienta ───────────────────────────
 *
 * **H16 no cuenta lo que no es suyo.** Contar contactos significaría leer
 * `crm.contacts` (H15); contar flujos, leer las tablas de H8. Hacerlo sería
 * invadir dos carriles para pintar un número, y sería frágil: el día que H15
 * cambie su modelo, esta pantalla se rompe sin que nadie sepa por qué.
 *
 * Lo que H16 expone es `assertQuota()` —que ya existe en H2— para que cada
 * dueño cuente lo suyo y lo pase. Mientras un dueño no conteste, su renglón se
 * muestra como **`sin-cablear`**, que es un estado distinto de cero.
 *
 * Esa distinción es el punto entero del archivo. Un cero silencioso parece un
 * dato: "tienes 0 contactos" en la pantalla de plan de alguien que tiene
 * cuatrocientos es la clase de mensaje que manda a depurar un sistema que está
 * bien, o peor, que hace dudar de todos los demás números de la pantalla.
 *
 * ── Qué está cableado hoy ───────────────────────────────────────────────────
 *
 *   maxSeats      SÍ — lo cuenta H2, porque las membresías son suyas
 *                 (`services/plans.ts:99-106`)
 *   monthlyAiUsd  SÍ — sale del ledger de H3 a través de `AgentPort`, si está
 *                 registrado; si no, sin-cablear
 *   el resto      sin-cablear, hasta que su dueño lo reporte
 */
import { tryPort } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
// `quotaFor` es de H2 y hace exactamente esto. Reusarla y no copiarla es lo que
// impide que el "te pasaste" de la pantalla y el de `assertQuota()` un día
// discrepen en el borde — que el límite se cuenta al LLEGAR, no al pasarlo.
import { limitsFor, quotaFor, seatsFor } from '../services/plans';
import type { QuotaKey, QuotaState } from '../types';
import { log } from './logger';

/**
 * Un renglón del bloque de consumo.
 *
 * `estado` es la parte importante:
 *
 *   'dato'         hay un número real y se puede comparar con el límite
 *   'sin-cablear'  el dueño de ese número todavía no lo reporta
 *   'error'        se intentó y falló. NO es lo mismo que no haber intentado
 */
export type RenglonUso =
  | {
      key: QuotaKey;
      label: string;
      estado: 'dato';
      cuota: QuotaState;
      /** `true` cuando el límite se mide en dólares y no en filas. */
      esDinero?: boolean;
    }
  | { key: QuotaKey; label: string; estado: 'sin-cablear'; motivo: string; limite: number | null }
  | { key: QuotaKey; label: string; estado: 'error'; motivo: string; limite: number | null };

const ETIQUETAS: Record<QuotaKey, string> = {
  maxSeats: 'Personas en tu equipo',
  maxContacts: 'Contactos',
  maxChannels: 'Canales conectados',
  maxFlows: 'Automatizaciones',
  maxAgents: 'Agentes',
  monthlyAiUsd: 'Gasto de IA este mes',
};

/** Quién debería reportar cada número, para que el motivo diga algo útil. */
const DUENO: Record<QuotaKey, string> = {
  maxSeats: 'H2 (tenancy)',
  maxContacts: 'H15 (CRM)',
  maxChannels: 'H6 (bandeja)',
  maxFlows: 'H8 (automatizaciones)',
  maxAgents: 'H3 (agentes)',
  monthlyAiUsd: 'H3 (agentes)',
};

const ORDEN: QuotaKey[] = [
  'maxSeats',
  'maxContacts',
  'maxChannels',
  'maxFlows',
  'maxAgents',
  'monthlyAiUsd',
];

/**
 * Consumos que el llamador ya conoce y quiere que se pinten.
 *
 * Es la puerta por la que cada carril entrega SU número sin que H16 tenga que
 * ir a buscarlo: el día que H15 quiera que su contador aparezca aquí, pasa
 * `{ maxContacts: 412 }` desde su propio código y deja de estar sin cablear.
 */
export type ConsumosConocidos = Partial<Record<QuotaKey, number>>;

/**
 * El gasto de IA del mes, si H3 está en el proceso.
 *
 * `tryPort` y no `usePort` a propósito: la pantalla de plan tiene que poder
 * pintarse en un proceso donde el motor de agentes no esté montado. Es el
 * camino best-effort que describe CONTRIBUTING.md §5.
 */
async function gastoDeIa(ctx: TenantContext): Promise<number | null> {
  /*
   * `budgetStateFor` NO está en `AgentPort` (ports.ts es de H1 y no se toca
   * desde aquí). Se pregunta por el método en tiempo de ejecución: si H3 lo
   * expone algún día, este renglón se enciende solo; mientras tanto se muestra
   * `sin-cablear`, que es la verdad. El `as unknown as` es el precio de no
   * poder ampliar el port — y es preferible a inventar un contador propio.
   */
  const agents = tryPort('agents') as unknown as
    | { budgetStateFor?: (c: TenantContext) => Promise<{ gastadoUsd: number }> }
    | undefined;

  if (typeof agents?.budgetStateFor !== 'function') return null;

  try {
    return (await agents.budgetStateFor(ctx)).gastadoUsd;
  } catch (e) {
    log.warn(`no se pudo leer el gasto de IA del mes: ${String(e)}`);
    return null;
  }
}

/**
 * El bloque de consumo completo.
 *
 * Nunca lanza por un renglón: un contador que falla se pinta como `error` y los
 * otros cinco siguen siendo ciertos. Que una consulta rota se lleve la pantalla
 * entera es lo contrario de informar.
 */
export async function usageFor(
  ctx: TenantContext,
  conocidos: ConsumosConocidos = {},
): Promise<RenglonUso[]> {
  const limites = await limitsFor(ctx);

  // Asientos: los cuenta H2. Es el único que hoy está cableado de origen.
  let asientos: QuotaState | null = null;
  let errorAsientos: string | null = null;
  try {
    asientos = await seatsFor(ctx);
  } catch (e) {
    errorAsientos = String(e);
    log.warn(`no se pudieron contar los asientos: ${errorAsientos}`);
  }

  const gasto = conocidos.monthlyAiUsd ?? (await gastoDeIa(ctx));

  return ORDEN.map((key): RenglonUso => {
    const label = ETIQUETAS[key];
    const limite = limites[key] ?? null;

    if (key === 'maxSeats') {
      if (asientos) return { key, label, estado: 'dato', cuota: asientos };
      return {
        key,
        label,
        estado: 'error',
        limite,
        motivo: 'No se pudieron contar las membresías de esta empresa.',
      };
    }

    if (key === 'monthlyAiUsd') {
      if (typeof gasto === 'number') {
        return { key, label, estado: 'dato', cuota: quotaFor(limites, key, gasto), esDinero: true };
      }
      return {
        key,
        label,
        estado: 'sin-cablear',
        limite,
        motivo:
          'El motor de agentes (H3) no está montado en este proceso, o todavía no expone el ' +
          'gasto del mes por su port. El límite del plan sí es real.',
      };
    }

    const usado = conocidos[key];
    if (typeof usado === 'number') {
      return { key, label, estado: 'dato', cuota: quotaFor(limites, key, usado) };
    }

    return {
      key,
      label,
      estado: 'sin-cablear',
      limite,
      motivo:
        `Este número lo cuenta ${DUENO[key]}, que es su dueño. H16 no lee las tablas de otro ` +
        'carril para pintarlo: se muestra el límite de tu plan y se dice que el consumo todavía ' +
        'no está conectado, en vez de enseñar un cero que parecería un dato.',
    };
  });
}
