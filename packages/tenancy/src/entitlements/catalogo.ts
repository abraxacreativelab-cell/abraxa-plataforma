/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El eje que faltaba: QUÉ compra un plan.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * `app.plans.limits` sabe CUÁNTO (010_tenancy.sql:107-114): seis llaves y las
 * seis numéricas. No hay forma de expresar "este plan incluye automatizaciones"
 * ni "este plan no incluye Instagram", y ésas son las dos preguntas que un plan
 * de verdad contesta: nadie paga por un contador más alto, se paga por una
 * función que antes no se tenía.
 *
 * Este archivo es el vocabulario de ese eje. La verdad en tiempo de ejecución
 * vive en `app.features` (migración 130); esto es su espejo en el compilador,
 * para que `can(ctx, 'flows.publsh')` sea un error de compilación y no un
 * `false` silencioso en producción.
 *
 * ── Agregar una función ─────────────────────────────────────────────────────
 *
 * Dos pasos, y el orden importa: primero la fila en una migración del bloque
 * 130–139, después la llave aquí. Al revés, el código promete algo que la base
 * no conoce y `can()` responde `false` — que es correcto (deny por defecto) y
 * desconcertante.
 */

/**
 * ── DENY POR DEFECTO, y por qué es al revés que en los límites ──────────────
 *
 * En `services/plans.ts:10-14` un límite AUSENTE es ILIMITADO. Aquí una función
 * ausente está APAGADA. La asimetría es deliberada, y es una decisión sobre de
 * qué lado fallar:
 *
 *   · olvidar declarar un límite → el cliente recibe servicio de MÁS. Nadie se
 *     entera hasta que llega la factura de tokens, que puede ser un mes después;
 *   · olvidar declarar una función → el cliente la pierde y levanta la mano en
 *     minutos.
 *
 * Se falla del lado que se descubre rápido. Un catálogo incompleto no regala
 * funciones.
 */
export const DENY_POR_DEFECTO = true as const;

/**
 * Las funciones que existen hoy. Cada una apaga algo que otro carril YA
 * construyó: ninguna es especulativa.
 */
export const FEATURE_KEYS = [
  'inbox.whatsapp',
  'inbox.meta',
  'inbox.email',
  'inbox.sms',
  'inbox.ai_reply',
  'flows.publish',
  'flows.ai_assist',
  'agents.custom',
  'vault.ingest',
  'work.projects',
  'crm.pipelines',
  'team.invite',
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

const CONOCIDAS: ReadonlySet<string> = new Set(FEATURE_KEYS);

/** `true` si la llave está en el catálogo que conoce el compilador. */
export const esFeatureKey = (k: string): k is FeatureKey => CONOCIDAS.has(k);

/**
 * Qué le pasa a lo que YA existe cuando la función se apaga.
 *
 *   pause     lo que estaba corriendo se detiene y queda marcado como pausado
 *             por plan. No se borra, no se archiva, no se desactiva "para
 *             siempre".
 *   readonly  se puede leer y exportar; no se puede crear ni editar. No se
 *             oculta ni se vacía.
 *   keep      no pasa nada.
 *
 * No existe `delete`, y no es un olvido: ver `lifecycle.ts`.
 */
export type OnDowngrade = 'pause' | 'readonly' | 'keep';

/** De dónde salió la respuesta de `can()`. Lo enseña `/ajustes/plan`. */
export type EntitlementSource = 'override' | 'plan' | 'none' | 'tenant_inactive';

/** Una fila de `app.features`. */
export interface FeatureRow {
  key: string;
  label: string;
  /** Copy de producto: es lo que ve quien topa el 402, no un mensaje de error. */
  blurb: string;
  on_downgrade: OnDowngrade;
  position: number;
}

/**
 * Una fila de la vista `app.tenant_entitlements_effective`.
 *
 * NO extiende `FeatureRow` a propósito, aunque comparta casi todo: la vista
 * llama a la llave `feature_key` y no `key`. Heredar declararía un campo `key`
 * que la consulta no trae, y un tipo que promete un campo inexistente es peor
 * que uno repetido — el compilador deja de avisar justo donde haría falta.
 */
export interface EntitlementRow {
  tenant_id: string;
  feature_key: string;
  label: string;
  blurb: string;
  on_downgrade: OnDowngrade;
  position: number;
  granted: boolean;
  source: EntitlementSource;
  override_expires_at: string | null;
  override_note: string | null;
}

/** Lo que `entitlementsFor()` devuelve por función, ya resuelto. */
export interface EntitlementState {
  key: string;
  label: string;
  blurb: string;
  granted: boolean;
  source: EntitlementSource;
  onDowngrade: OnDowngrade;
  position: number;
  /** Vencimiento de la concesión temporal, si la respuesta vino de un override. */
  expiresAt: string | null;
  /** La razón escrita del trato especial. Obligatoria en la base. */
  note: string | null;
}

/** Una pausa viva, como la ve la pantalla y el carril dueño del recurso. */
export interface FeaturePause {
  id: number;
  featureKey: string;
  /** `*` = toda la función. Cualquier otro texto es un recurso del carril dueño. */
  resourceRef: string;
  pausedBy: 'plan' | 'user';
  note: string | null;
  createdAt: string;
}

/** Estados de una empresa. Sólo `active` consume recursos. */
export type TenantLiveness =
  | { live: true }
  | { live: false; reason: 'suspended' | 'archived' | 'unknown' };

/** Por qué un trabajo no se corrió. Se escribe en `app.plan_skips`. */
export type SkipReason =
  | 'feature_not_in_plan'
  | 'tenant_suspended'
  | 'tenant_archived'
  | 'tenant_unknown';

/** El efecto observable de un cambio de plan, tal como queda en la bitácora. */
export interface PlanChangeEffect {
  feature: string;
  action: 'paused' | 'readonly' | 'restored';
}

export type PlanChangeReason =
  | 'checkout'
  | 'payment_failed'
  | 'cancel'
  | 'staff'
  | 'trial_end';

export type PlanChangeStatus = 'active' | 'suspended' | 'archived';
