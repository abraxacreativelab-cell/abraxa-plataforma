/**
 * El vocabulario de H11. Todo lo de aquí es puro: ni una consulta, ni un
 * `import` de `@abraxa/db` que arrastre el cliente de Supabase.
 *
 * `AreaState` y `AreaSummary` NO se redefinen: son del contrato cruzado
 * (`packages/db/ports.ts`) y se re-exportan para que el resto del paquete no
 * tenga que acordarse de dónde viven.
 */
import type { AreaAccess, AreaState, AreaSummary } from '@abraxa/db';

export type { AreaAccess, AreaState, AreaSummary };

// ════════════════════════════════════════════════════════════════════════════
// Las señales
// ════════════════════════════════════════════════════════════════════════════

/**
 * La foto del negocio contra la que se evalúa un requisito. La devuelve
 * `app.areas_signals()` — ver la 090 §5 para por qué es una sola función de
 * Postgres y no siete consultas desde aquí.
 */
export interface Signals {
  /** Canales con `status = 'active'`. Un canal a medio dar de alta no cuenta. */
  channels_active: number;
  /** Etapas de embudo definidas. El embudo existe cuando tiene etapas. */
  pipeline_stages: number;
  /** Valores canónicos ACTIVOS. Los borradores de la bóveda no cuentan. */
  values_active: number;
  documents: number;
  /** Contactos que siguen en juego (no `churned`). */
  contacts_active: number;
  /** Contactos parados en una etapa marcada `is_won`. */
  deals_won: number;
  months_operating: number;
}

export const SIGNALS_CERO: Signals = {
  channels_active: 0,
  pipeline_stages: 0,
  values_active: 0,
  documents: 0,
  contacts_active: 0,
  deals_won: 0,
  months_operating: 0,
};

/** Las claves de `Signals`, para validar sin repetir la lista a mano. */
export const SIGNAL_KEYS = Object.keys(SIGNALS_CERO) as Array<keyof Signals>;

// ════════════════════════════════════════════════════════════════════════════
// Los requisitos
// ════════════════════════════════════════════════════════════════════════════

/**
 * Una condición evaluable. Vive en DATOS (`area_catalog.requirements` y
 * `tenant_areas.requirements`), no en código: ajustar cuándo se abre un área
 * para un giro es un UPDATE, no un deploy.
 *
 * El tipo es abierto a propósito en el borde —lo que llega de la base es
 * `unknown`— y se estrecha con `parseRequirement`. Un requisito que el sistema
 * no entiende NO se ignora: ver `evaluate`.
 */
export type Requirement =
  /** Se abre de entrada. Para las áreas que son el negocio mismo. */
  | { type: 'always' }
  /** Nunca se abre sola: hace falta una acción explícita. */
  | { type: 'manual' }
  | { type: 'has_channel'; min: number }
  | { type: 'pipeline_defined' }
  | { type: 'value_count'; min: number }
  | { type: 'document_count'; min: number }
  | { type: 'contact_count'; min: number }
  | { type: 'deal_won'; min: number }
  | { type: 'months_operating'; min: number }
  /** Lo declaró el emprendedor. Vive en `tenant_areas.progress.declared`. */
  | { type: 'declared'; key: string }
  /** Cualquiera de los de dentro basta. Es el "un documento O tres valores". */
  | { type: 'any_of'; of: Requirement[] };

export type RequirementType = Requirement['type'];

/** Los tipos que el evaluador sabe resolver. Uno fuera de esta lista es un
 *  requisito roto, y se trata como tal. */
export const TIPOS_CONOCIDOS: readonly RequirementType[] = [
  'always',
  'manual',
  'has_channel',
  'pipeline_defined',
  'value_count',
  'document_count',
  'contact_count',
  'deal_won',
  'months_operating',
  'declared',
  'any_of',
] as const;

/** Cómo quedó UNA condición, con lo necesario para explicársela a alguien. */
export interface RequirementCheck {
  requirement: Requirement;
  met: boolean;
  /** Cuánto lleva y cuánto necesita, cuando la condición es de conteo. */
  progress: { current: number; needed: number } | null;
  /** En español, para el candado. "conectas un canal" / "te faltan 2 contactos". */
  label: string;
}

/** El veredicto de un área entera. */
export interface Evaluation {
  met: boolean;
  checks: RequirementCheck[];
  /** Lo que falta, ya redactado. Vacío si `met`. */
  missing: string[];
}

// ════════════════════════════════════════════════════════════════════════════
// Las filas
// ════════════════════════════════════════════════════════════════════════════

/** Una fila de `app.tenant_areas`, tal como llega de PostgREST. */
export interface TenantAreaRow {
  tenant_id: string;
  area_slug: string;
  state: AreaState;
  label: string;
  icon: string;
  blurb: string;
  tools: unknown;
  requirements: unknown;
  progress: unknown;
  unlocked_at: string | null;
  position: number;
}

/** Lo que el emprendedor ya cumplió o declaró. */
export interface Progress {
  /** Declaraciones suyas: `{ va_a_contratar: true }`. Ninguna tabla puede
   *  contar si va a contratar; sólo él lo sabe. */
  declared: Record<string, boolean>;
  /** Foto de las señales la última vez que se reconcilió. Es información, no
   *  la fuente de verdad: la fuente son las señales de ahora. */
  signals?: Partial<Signals>;
  /** Cuándo se evaluó por última vez. */
  checked_at?: string;
}

export const PROGRESS_VACIO: Progress = { declared: {} };

/** Una fila de `app.tenant_milestones`. */
export interface MilestoneRow {
  id: string;
  tenant_id: string;
  area_slug: string | null;
  title: string;
  description: string | null;
  position: number;
  done_at: string | null;
  generated_by: 'master_agent' | 'user' | 'seed';
  created_at: string;
}

/** Un hito ya listo para la pantalla. */
export interface Milestone {
  id: string;
  areaSlug: string | null;
  title: string;
  description: string | null;
  position: number;
  done: boolean;
  doneAt: string | null;
  generatedBy: MilestoneRow['generated_by'];
}

// ════════════════════════════════════════════════════════════════════════════
// El mini-onboarding
// ════════════════════════════════════════════════════════════════════════════

/** Una pregunta del guion. Tres por área, no veinte (handoff §6). */
export interface ScriptQuestion {
  key: string;
  prompt: string;
}

/**
 * El guion de un área × giro, como está en `area_catalog.script`.
 *
 * Es el mismo motor de entrevista de H7 con otro guion, y por eso el guion vive
 * en la base: uno por área × giro, sin desplegar.
 */
export interface AreaScript {
  /** Qué es esta área en SU empresa. */
  intro: string;
  /** Qué cambia cuando la tiene. Concreto, no una lista de funciones. */
  promise: string;
  questions: ScriptQuestion[];
  /** El primer resultado visible que se genera antes de terminar. */
  result: { kind: string; label: string } | null;
}

export const GUION_VACIO: AreaScript = {
  intro: '',
  promise: '',
  questions: [],
  result: null,
};

/** Una respuesta del emprendedor a una pregunta del guion. */
export interface ScriptAnswer {
  key: string;
  answer: string;
}

/** El estado de la corrida del mini-onboarding de un área. */
export interface OnboardingRun {
  areaSlug: string;
  step: number;
  answers: ScriptAnswer[];
  /** El primer resultado visible, ya generado. `null` mientras no termina. */
  result: { kind: string; label: string; body: string } | null;
  completedAt: string | null;
}

// ════════════════════════════════════════════════════════════════════════════
// Lo que ve la pantalla
// ════════════════════════════════════════════════════════════════════════════

/**
 * Un área en el Mapa de Negocio. Es `AreaSummary` (el contrato con H5) MÁS lo
 * que sólo el mapa necesita: por qué está bloqueada y cuánto lleva.
 *
 * H5 recibe el `AreaSummary` pelón por `listAreas()`; el mapa recibe esto.
 * Separarlos evita que el contrato cruzado crezca cada vez que el mapa quiere
 * enseñar un dato más.
 */
export interface AreaCard extends AreaSummary {
  /** Qué falta para abrirla, redactado. Vacío si ya está abierta. */
  missing: string[];
  /** Cuánto del camino lleva, 0–1. Para la barra del candado. */
  ratio: number;
  unlockedAt: string | null;
  /** `true` si se puede entrar. Las bloqueadas se ven pero no se abren. */
  navigable: boolean;
  /**
   * `true` si el área todavía no tiene una pantalla propia — sólo su
   * mini-onboarding.
   *
   * Existe para que la tarjeta pueda decirlo EN CASTELLANO: «todavía la estamos
   * construyendo». La alternativa que había en el producto era peor de dos
   * maneras a la vez: pintar la tarjeta idéntica a una que sí lleva a algún
   * lado, o —como hacen otras pantallas— explicarle al cliente que «packages/crm
   * está construido pero el registro vive en un archivo de H1». Ni una cosa ni
   * la otra: lo que falta lo debemos nosotros, y así se dice.
   *
   * Se calcula en el servidor a partir de `tools`, que es el dato de la 090.
   * `AreaCardView` lo AFINA en el navegador con el registro de herramientas de
   * H5 —que sólo existe ahí— y por eso una clave del catálogo que nadie
   * registró tampoco cuenta como pantalla.
   */
  enConstruccion: boolean;
}

/** Todo lo que el Mapa de Negocio necesita, de un viaje. */
export interface BusinessMap {
  areas: AreaCard[];
  milestones: Milestone[];
  signals: Signals;
  /** `true` si el mapa aún no se ha sembrado para esta empresa. */
  empty: boolean;
}
