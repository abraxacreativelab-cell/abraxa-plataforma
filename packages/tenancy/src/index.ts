/**
 * ════════════════════════════════════════════════════════════════════════════
 *  @abraxa/tenancy — H2
 *
 *  Quién es cada quien, a qué empresa pertenece, y qué puede tocar.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Todo lo demás del producto depende de esto. En concreto, de una sola cosa:
 * el 403 de `contextFor()` cuando no hay membresía. `tenantDb(ctx)` filtra por
 * el `tenantId` que sale de ahí, así que si esa comprobación se equivoca, todo
 * lo de abajo filtra impecablemente hacia la empresa equivocada.
 *
 * Lo que expone este paquete:
 *
 *   · `router`              — las rutas, que apps/api monta en /tenants
 *   · `tenancyPort`         — la implementación de TenancyPort (ports.ts)
 *   · `tenantMiddleware`    — resuelve la empresa activa de una petición
 *   · `requireArea` y cía.  — el RBAC por área, para los demás paquetes
 *   · `onTenantProvisioned` — el enganche que espera H11
 */
import { registerPort } from '@abraxa/db';
import { tenancyPort } from './port';

export { router } from './routes/index';
export { meta } from './meta';
export { tenancyPort };

// ─── Contexto e identidad ─────────────────────────────────────────────────
export {
  canSignIn,
  contextFor,
  esStaffDePlataforma,
  primaryTenantSlugFor,
  staffContextFor,
  tenantsFor,
  type CanSignInDeps,
  type ContextForInput,
} from './services/context';

// ─── Alta ─────────────────────────────────────────────────────────────────
export { provision, type ProvisionInput, type ProvisionResult } from './services/provision';

// ─── Miembros e invitaciones ──────────────────────────────────────────────
export { listMembers, removeMember, setAreas, setRole, upsertMember } from './services/memberships';

export {
  acceptInvitation,
  createInvitation,
  hashToken,
  listInvitations,
  revokeInvitation,
  urlDeInvitacion,
  type AcceptInput,
  type InviteInput,
  type PendingInvitation,
} from './services/invitations';

// ─── Planes y cuotas ──────────────────────────────────────────────────────
export {
  assertQuota,
  assertSeatAvailable,
  availablePlans,
  limitsFor,
  planFor,
  quotaFor,
  seatsFor,
} from './services/plans';

// ─── Eventos ──────────────────────────────────────────────────────────────
export {
  drainTenantEvents,
  emitTenantEvent,
  onTenantEvent,
  onTenantProvisioned,
  MEMBER_JOINED,
  MEMBER_REMOVED,
  TENANT_PROVISIONED,
  __clearTenantEventHandlers,
  type DrainResult,
  type TenantEventHandler,
} from './services/events';

// ─── RBAC y middleware, para los otros paquetes ───────────────────────────
export {
  ACCESS_RANK,
  esAdminDelTenant,
  hasArea,
  loadAreaGrants,
  requireAnyArea,
  requireArea,
  requireAreaOperation,
  requireRole,
  requireTenantAdmin,
} from './middleware/rbac';

export {
  asyncHandler,
  contextoDe,
  requireProxySecret,
  sessionMiddleware,
  tenantMiddleware,
} from './middleware/tenant';

export { proxyVerified } from './middleware/proxy';

// ─── Tipos y validación ───────────────────────────────────────────────────
export type {
  AreaAccess,
  AreaGrantRow,
  FullTenantContext,
  InvitationRow,
  IssuedInvitation,
  MemberSummary,
  MembershipRole,
  MembershipRow,
  PlanLimits,
  PlanRow,
  QuotaKey,
  QuotaState,
  TenantContext,
  TenantEventRow,
  TenantRow,
  TenantStatus,
  TenantSummary,
  UserRow,
} from './types';

export {
  AREA_SLUG_RE,
  EMAIL_RE,
  RESERVED_SLUGS,
  SLUG_RE,
  normalizeEmail,
  normalizeSlug,
} from './schemas';

export { TENANCY_SQLSTATE, mapPgError, validar } from './errors';

/**
 * El registro. Importar este paquete es lo que hace que `usePort('tenancy')`
 * funcione — y `apps/api` ya lo importa, así que nadie tiene que acordarse
 * de nada.
 */
registerPort('tenancy', tenancyPort);
