/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El catálogo de planes — la fuente de verdad.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Aquí se decide qué planes existen y qué límites tienen. `app.plans` es el
 *  espejo, no el original: la migración 080 lo siembra y `syncPlanCatalog()`
 *  lo reconcilia en cada arranque.
 *
 *  ── Por qué el dueño es H10 y no H2 ────────────────────────────────────────
 *
 *  H2 crea la tabla y siembra un catálogo de arranque porque su
 *  `provision_tenant()` se niega a dar de alta contra un plan inexistente:
 *  sin esa siembra, H2 no se puede probar solo. Pero quién cobra, qué se
 *  vende y qué incluye cada plan es una decisión comercial, y esa vive del
 *  lado del cobro. Un dueño de la decisión, varios consumidores
 *  (`assertQuota()` de H2, el panel de H14, la landing de aquí).
 *
 *  ── v1 vende dos planes ────────────────────────────────────────────────────
 *
 *  `free` y `pro`. `pro` es de MONTO LIBRE: el emprendedor decide cuánto
 *  paga, así que el precio NO está en este archivo — no existe. Lo que existe
 *  son los límites, que sí son del producto.
 *
 *  Los planes intermedios (starter, agency) y las banderas booleanas de
 *  features son de H16. No los agregues aquí: un plan de más en este arreglo
 *  es un plan que alguien puede comprar mañana.
 */

/** Límites de un plan. Las llaves son las que compara `assertQuota()` de H2:
 *  agregar una es gratis, quitar una rompe su motor de cuotas en silencio. */
export interface PlanLimits {
  maxSeats: number;
  maxContacts: number;
  maxChannels: number;
  maxFlows: number;
  maxAgents: number;
  monthlyAiUsd: number;
}

export interface Plan {
  /** Debe cumplir el CHECK de `app.plans`: `^[a-z][a-z0-9_]{1,30}$`. */
  id: string;
  name: string;
  limits: PlanLimits;
  position: number;
  active: boolean;
  /** Lo que se le promete al emprendedor en la landing. No va a la DB. */
  pitch: string;
}

/** Los identificadores que v1 conoce. Un `PlanId` que no esté aquí no se vende. */
export type PlanId = 'free' | 'pro';

/**
 * ⚠️ Estos valores están espejeados en `migrations/080_billing.sql`. Si cambias
 * uno, cambia el otro en el mismo commit: `limits` es UNA columna jsonb, no un
 * merge — un objeto más pobre no actualiza los límites, los borra.
 */
export const PLAN_CATALOG: readonly Plan[] = Object.freeze([
  Object.freeze({
    id: 'free',
    name: 'Gratis',
    limits: Object.freeze({
      maxSeats: 2,
      maxContacts: 500,
      maxChannels: 1,
      maxFlows: 3,
      maxAgents: 1,
      monthlyAiUsd: 5,
    }),
    position: 0,
    active: true,
    pitch: 'Tu agente maestro, un canal y lo suficiente para ver si esto te sirve.',
  }),
  Object.freeze({
    id: 'pro',
    name: 'Pro',
    limits: Object.freeze({
      maxSeats: 10,
      maxContacts: 10000,
      maxChannels: 3,
      maxFlows: 25,
      maxAgents: 5,
      monthlyAiUsd: 50,
    }),
    position: 1,
    active: true,
    pitch: 'Tu equipo completo de agentes, tus canales conectados y tu operación corriendo sola.',
  }),
] as Plan[]);

/** El plan con el que nace todo tenant. H2 también lo asume por defecto. */
export const PLAN_POR_DEFECTO: PlanId = 'free';

/** El plan que se cobra en v1. El único que pasa por Stripe. */
export const PLAN_DE_PAGO: PlanId = 'pro';

export function getPlan(id: string): Plan | null {
  return PLAN_CATALOG.find((p) => p.id === id) ?? null;
}

/** `true` si el id es uno de los planes que v1 vende. */
export function isSellablePlan(id: string): id is PlanId {
  const p = getPlan(id);
  return p !== null && p.active;
}

// ────────────────────────────────────────────────────────────────────────────
// Dinero
// ────────────────────────────────────────────────────────────────────────────

/**
 * La moneda del cobro.
 *
 * Es `usd` porque la columna del modelo es `app.subscriptions.amount_usd` y
 * guardar pesos en una columna que se llama `usd` es la clase de mentira que
 * nadie descubre hasta que alguien suma una columna de ingresos.
 *
 * El público de la landing es mexicano, así que cobrar en MXN probablemente
 * convierta mejor. Eso NO se arregla cambiando esta constante: hace falta
 * decidir de dónde sale el tipo de cambio y migrar la columna. Es una decisión
 * de producto pendiente, anotada en el PR.
 */
export const MONEDA = 'usd' as const;

/**
 * Los topes del monto libre, en centavos.
 *
 * `MINIMO` no es un capricho: por debajo del mínimo de Stripe (50¢ USD) el
 * cargo se rechaza en la pasarela, después de que el emprendedor ya escribió
 * su número. Se corta antes, con un mensaje que se entiende.
 *
 * `MAXIMO` existe para que un dedo de más en el teclado no genere un cargo de
 * cinco cifras y un reembolso incómodo.
 */
export const MONTO = Object.freeze({
  MINIMO_CENTAVOS: 100,
  PRESET_CENTAVOS: 2000,
  MAXIMO_CENTAVOS: 500_000,
});

/** Centavos → el `numeric(10,2)` de `amount_usd`. */
export function centavosADecimal(centavos: number): number {
  return Math.round(centavos) / 100;
}
