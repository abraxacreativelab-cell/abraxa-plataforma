/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El único acceso sin filtro de tenant de todo H2.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Todo lo demás del paquete usa `tenantDb(ctx)`. Aquí no se puede, y la razón
 * no es comodidad: son las operaciones que ocurren ANTES de que exista un
 * contexto de empresa, o sobre tablas que no pertenecen a ninguna.
 *
 *   · `provisionTenant`  — crea el tenant; no hay tenant al cual acotarse.
 *   · `findTenantBySlug` / `findMembership` / `loadGrantRows`
 *                        — son lo que CONSTRUYE el contexto. Acotarlas al
 *                          contexto sería circular.
 *   · `acceptInvitation` — quien acepta todavía no es miembro de nada.
 *   · `users` / `plans`  — tablas globales, declaradas `-- tenantless:`.
 *
 * Por eso este archivo vive en `src/db/` y no en `src/services/`: ESLint
 * prohíbe `adminDb()` dentro de `services/` y `routes/` justamente para que
 * esta lista no crezca sin que nadie lo note. Si algo nuevo necesita entrar
 * aquí, tiene que poder explicarse en una línea como las de arriba.
 */
import { adminDb } from '@abraxa/db';
import { mapPgError } from '../errors';
import type {
  AcceptedInvitation,
  AreaGrantRow,
  MembershipRole,
  MembershipRow,
  PlanRow,
  TenantEventRow,
  TenantRow,
  TenantStatus,
  TenantSummary,
  UserRow,
} from '../types';

const COLS_TENANT = 'id, slug, name, industry_type, stage, settings, plan, status, created_at';

// ─── Alta ─────────────────────────────────────────────────────────────────

export interface ProvisionArgs {
  slug: string;
  name: string;
  ownerEmail: string;
  industryType?: string | undefined;
  plan?: string | undefined;
}

/**
 * Llama a `app.provision_tenant()`. Toda la atomicidad vive allá adentro.
 *
 * Aquí no hay ninguna secuencia que pueda quedar a medias porque aquí no hay
 * secuencia: es una sola llamada.
 */
export async function provisionTenant(
  i: ProvisionArgs,
): Promise<{ tenantId: string; created: boolean }> {
  const { data, error } = await adminDb().rpc('provision_tenant', {
    p_slug: i.slug,
    p_name: i.name,
    p_owner_email: i.ownerEmail,
    p_industry_type: i.industryType ?? null,
    p_plan: i.plan ?? 'free',
  });

  if (error) throw mapPgError(error, 'No se pudo dar de alta la empresa');

  const fila = (Array.isArray(data) ? data[0] : data) as
    | { tenant_id?: string; created?: boolean }
    | null
    | undefined;

  if (!fila?.tenant_id) {
    throw mapPgError(
      { message: 'provision_tenant no devolvió un tenant' },
      'No se pudo dar de alta la empresa',
    );
  }

  return { tenantId: fila.tenant_id, created: fila.created === true };
}

// ─── Invitaciones ─────────────────────────────────────────────────────────

export async function acceptInvitation(
  tokenHash: string,
  email: string,
  name?: string | undefined,
): Promise<AcceptedInvitation> {
  const { data, error } = await adminDb().rpc('accept_invitation', {
    p_token_hash: tokenHash,
    p_email: email,
    p_name: name ?? null,
  });

  if (error) throw mapPgError(error, 'No se pudo aceptar la invitación');

  const fila = (Array.isArray(data) ? data[0] : data) as
    | { tenant_id?: string; tenant_slug?: string; role?: MembershipRole }
    | null
    | undefined;

  if (!fila?.tenant_id || !fila.tenant_slug || !fila.role) {
    throw mapPgError(
      { message: 'accept_invitation no devolvió la membresía' },
      'No se pudo aceptar la invitación',
    );
  }

  return { tenantId: fila.tenant_id, tenantSlug: fila.tenant_slug, role: fila.role };
}

/** Baja atómica: membresía + grants + invitaciones pendientes. */
export async function removeMember(tenantId: string, email: string): Promise<boolean> {
  const { data, error } = await adminDb().rpc('remove_member', {
    p_tenant_id: tenantId,
    p_email: email,
  });
  if (error) throw mapPgError(error, 'No se pudo quitar al miembro');
  return data === true;
}

// ─── Lo que construye el contexto ─────────────────────────────────────────

export async function findTenantBySlug(slug: string): Promise<TenantRow | null> {
  const { data, error } = await adminDb()
    .from('tenants')
    .select(COLS_TENANT)
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw mapPgError(error, 'No se pudo cargar la empresa');
  return (data as TenantRow | null) ?? null;
}

export async function findTenantById(id: string): Promise<TenantRow | null> {
  const { data, error } = await adminDb()
    .from('tenants')
    .select(COLS_TENANT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw mapPgError(error, 'No se pudo cargar la empresa');
  return (data as TenantRow | null) ?? null;
}

export async function findMembership(
  tenantId: string,
  email: string,
): Promise<MembershipRow | null> {
  const { data, error } = await adminDb()
    .from('memberships')
    .select('tenant_id, user_email, role, created_at')
    .eq('tenant_id', tenantId)
    .eq('user_email', email)
    .maybeSingle();
  if (error) throw mapPgError(error, 'No se pudo cargar la membresía');
  return (data as MembershipRow | null) ?? null;
}

export async function loadGrantRows(tenantId: string, email: string): Promise<AreaGrantRow[]> {
  const { data, error } = await adminDb()
    .from('area_grants')
    .select('tenant_id, user_email, area_slug, access')
    .eq('tenant_id', tenantId)
    .eq('user_email', email);
  if (error) throw mapPgError(error, 'No se pudieron cargar los permisos por área');
  return (data as AreaGrantRow[] | null) ?? [];
}

/**
 * Las empresas de un correo. Atraviesa tenants a propósito: es la consulta del
 * selector de empresa y del login, y sólo devuelve aquellas donde la persona
 * TIENE membresía — que es precisamente el filtro que aísla.
 */
export async function listTenantsForEmail(email: string): Promise<TenantSummary[]> {
  const { data: mems, error } = await adminDb()
    .from('memberships')
    .select('tenant_id, role')
    .eq('user_email', email);
  if (error) throw mapPgError(error, 'No se pudieron cargar tus empresas');

  const filas = (mems as Array<{ tenant_id: string; role: MembershipRole }> | null) ?? [];
  if (filas.length === 0) return [];

  const { data: tenants, error: errorTenants } = await adminDb()
    .from('tenants')
    .select('id, slug, name, status')
    .in(
      'id',
      filas.map((m) => m.tenant_id),
    );
  if (errorTenants) throw mapPgError(errorTenants, 'No se pudieron cargar tus empresas');

  const porId = new Map(
    ((tenants as Array<{ id: string; slug: string; name: string; status: TenantStatus }> | null) ?? []).map(
      (t) => [t.id, t] as const,
    ),
  );

  const salida: TenantSummary[] = [];
  for (const m of filas) {
    const t = porId.get(m.tenant_id);
    if (!t) continue;
    salida.push({
      tenantId: t.id,
      slug: t.slug,
      name: t.name,
      role: m.role,
      status: t.status,
    });
  }
  return salida.sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

/**
 * ¿Este correo pertenece a alguna empresa?
 *
 * Lo consume `canSignIn()`. Que LANCE en vez de devolver `false` es
 * deliberado: quien llama decide, y su decisión es fail-closed. Tragarse el
 * error aquí y devolver `false` sería lo mismo hoy, pero convertiría un fallo
 * de base de datos en "este usuario no existe" — indistinguible, y por lo
 * tanto imposible de alertar.
 */
export async function hasAnyMembership(email: string): Promise<boolean> {
  const { data, error } = await adminDb()
    .from('memberships')
    .select('tenant_id')
    .eq('user_email', email)
    .limit(1);
  if (error) throw mapPgError(error, 'No se pudo verificar la membresía');
  return ((data as unknown[] | null) ?? []).length > 0;
}

// ─── Tablas globales ──────────────────────────────────────────────────────

export async function upsertUser(
  email: string,
  patch: { name?: string | null; avatarUrl?: string | null } = {},
): Promise<void> {
  const fila: Record<string, unknown> = { email };
  if (patch.name !== undefined) fila.name = patch.name;
  if (patch.avatarUrl !== undefined) fila.avatar_url = patch.avatarUrl;

  const { error } = await adminDb().from('users').upsert(fila, { onConflict: 'email' });
  if (error) throw mapPgError(error, 'No se pudo guardar el usuario');
}

export async function findUsers(emails: string[]): Promise<UserRow[]> {
  if (emails.length === 0) return [];
  const { data, error } = await adminDb()
    .from('users')
    .select('email, name, avatar_url, created_at, updated_at')
    .in('email', emails);
  if (error) throw mapPgError(error, 'No se pudieron cargar los usuarios');
  return (data as UserRow[] | null) ?? [];
}

// ─── El outbox ────────────────────────────────────────────────────────────
//
// Drenar el outbox es trabajo de infraestructura: un worker que recorre los
// eventos de TODAS las empresas. No hay contexto de tenant al cual acotarse
// porque el drenador no actúa por cuenta de ningún cliente.

export async function fetchUndeliveredEvents(limite = 100): Promise<TenantEventRow[]> {
  const { data, error } = await adminDb()
    .from('tenant_events')
    .select('id, tenant_id, type, payload, created_at, delivered_at')
    .is('delivered_at', null)
    .order('created_at')
    .limit(limite);
  if (error) throw mapPgError(error, 'No se pudieron leer los eventos pendientes');
  return (data as TenantEventRow[] | null) ?? [];
}

export async function markEventDelivered(id: string): Promise<void> {
  const { error } = await adminDb()
    .from('tenant_events')
    .update({ delivered_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw mapPgError(error, 'No se pudo marcar el evento como entregado');
}

export async function findPlan(id: string): Promise<PlanRow | null> {
  const { data, error } = await adminDb()
    .from('plans')
    .select('id, name, limits, position, active, created_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw mapPgError(error, 'No se pudo cargar el plan');
  return (data as PlanRow | null) ?? null;
}

export async function listPlans(): Promise<PlanRow[]> {
  const { data, error } = await adminDb()
    .from('plans')
    .select('id, name, limits, position, active, created_at')
    .eq('active', true)
    .order('position');
  if (error) throw mapPgError(error, 'No se pudieron cargar los planes');
  return (data as PlanRow[] | null) ?? [];
}
