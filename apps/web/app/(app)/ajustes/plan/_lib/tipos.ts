/**
 * La forma de lo que devuelve `GET /entitlements/plan`.
 *
 * Se declara aquí y no se importa de `@abraxa/tenancy` a propósito: la pantalla
 * habla con la API por HTTP, así que lo que recibe es JSON y no los objetos del
 * paquete. Importar los tipos del servidor daría la ilusión de que están atados
 * cuando en realidad los separa una red — y el día que la API cambie una llave,
 * el compilador diría que todo está bien.
 */

export type OnDowngrade = 'pause' | 'readonly' | 'keep';
export type EntitlementSource = 'override' | 'plan' | 'none' | 'tenant_inactive';

export interface Feature {
  key: string;
  label: string;
  blurb: string;
  granted: boolean;
  source: EntitlementSource;
  onDowngrade: OnDowngrade;
  position: number;
  expiresAt: string | null;
  note: string | null;
}

export interface Cuota {
  key: string;
  limit: number | null;
  used: number;
  remaining: number | null;
  exceeded: boolean;
}

export type Renglon =
  | { key: string; label: string; estado: 'dato'; cuota: Cuota; esDinero?: boolean }
  | { key: string; label: string; estado: 'sin-cablear'; motivo: string; limite: number | null }
  | { key: string; label: string; estado: 'error'; motivo: string; limite: number | null };

export interface Pausa {
  id: number;
  featureKey: string;
  resourceRef: string;
  pausedBy: 'plan' | 'user';
  note: string | null;
  createdAt: string;
}

export interface CambioDePlan {
  id: number;
  fromPlan: string | null;
  toPlan: string;
  fromStatus: string | null;
  toStatus: string;
  reason: 'checkout' | 'payment_failed' | 'cancel' | 'staff' | 'trial_end';
  actor: string | null;
  effects: Array<{ feature: string; action: 'paused' | 'readonly' | 'restored' }>;
  createdAt: string;
}

export interface RespuestaPlan {
  plan: { id: string; name: string } | null;
  features: Feature[];
  uso: Renglon[];
  pausas: Pausa[];
  historial: CambioDePlan[];
}
