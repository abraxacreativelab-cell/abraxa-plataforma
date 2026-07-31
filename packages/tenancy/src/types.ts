/**
 * Tipos de H2 — Tenancy.
 *
 * Las filas se declaran en snake_case, calcando la tabla, y sin capa de mapeo.
 * Es la misma decisión que tomó GARDEN (src/crm/types.ts) y por la misma
 * razón: una capa de traducción entre la fila y el objeto es un lugar más
 * donde un campo se puede perder en silencio, y aquí los campos que se
 * pierden son de identidad.
 */
import type { AreaAccess, MembershipRole, TenantContext } from '@abraxa/db/ports';

export type { AreaAccess, MembershipRole, TenantContext };

/** Estados de una empresa. Sólo `active` puede entrar al producto. */
export type TenantStatus = 'active' | 'suspended' | 'archived';

// ─── Filas ────────────────────────────────────────────────────────────────

export interface TenantRow {
  id: string;
  slug: string;
  name: string;
  industry_type: string | null;
  stage: string | null;
  settings: Record<string, unknown>;
  plan: string;
  status: TenantStatus;
  created_at: string;
}

export interface UserRow {
  email: string;
  name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface MembershipRow {
  tenant_id: string;
  user_email: string;
  role: MembershipRole;
  created_at: string;
}

export interface AreaGrantRow {
  tenant_id: string;
  user_email: string;
  area_slug: string;
  access: AreaAccess;
}

export interface InvitationRow {
  id: string;
  tenant_id: string;
  email: string;
  role: MembershipRole;
  areas: Record<string, AreaAccess>;
  token_hash: string;
  invited_by: string | null;
  accepted_at: string | null;
  expires_at: string;
  created_at: string;
}

export interface PlanRow {
  id: string;
  name: string;
  limits: PlanLimits;
  position: number;
  active: boolean;
  created_at: string;
}

export interface TenantEventRow {
  id: string;
  tenant_id: string;
  type: string;
  payload: Record<string, unknown>;
  created_at: string;
  delivered_at: string | null;
}

// ─── Planes y cuotas ──────────────────────────────────────────────────────

/**
 * Límites de un plan. Todos opcionales a propósito: un límite ausente es
 * ILIMITADO, no cero. Un plan al que se le olvidó declarar `maxContacts` no
 * puede dejar a un cliente que paga sin poder crear contactos.
 */
export interface PlanLimits {
  maxSeats?: number;
  maxContacts?: number;
  maxChannels?: number;
  maxFlows?: number;
  maxAgents?: number;
  monthlyAiUsd?: number;
}

export type QuotaKey = keyof PlanLimits;

export interface QuotaState {
  key: QuotaKey;
  limit: number | null;
  used: number;
  remaining: number | null;
  exceeded: boolean;
}

// ─── Contexto ─────────────────────────────────────────────────────────────

/**
 * El contexto que resuelve H2, con lo que el resto del producto necesita
 * además de lo que exige `TenantContext` de ports.ts.
 *
 * `isPlatformStaff` NUNCA lo pone `contextFor()`. Sólo lo pone la vía
 * explícita de staff, y existe para que un endpoint pueda auditar por dónde
 * entró quien está pidiendo. Ver services/context.ts.
 */
export interface FullTenantContext extends TenantContext {
  tenantName: string;
  tenantStatus: TenantStatus;
  plan: string;
  isPlatformStaff: boolean;
}

export interface MemberSummary {
  email: string;
  name: string | null;
  role: MembershipRole;
  areas: Record<string, AreaAccess>;
  createdAt: string;
}

export interface TenantSummary {
  tenantId: string;
  slug: string;
  name: string;
  role: MembershipRole;
  status: TenantStatus;
}

/** Lo que devuelve crear una invitación. El token en claro sale UNA vez. */
export interface IssuedInvitation {
  id: string;
  email: string;
  role: MembershipRole;
  areas: Record<string, AreaAccess>;
  expiresAt: string;
  /** Sólo en la respuesta a quien invita. No se vuelve a poder leer. */
  token: string;
  acceptUrl: string;
}

export interface AcceptedInvitation {
  tenantId: string;
  tenantSlug: string;
  role: MembershipRole;
}
