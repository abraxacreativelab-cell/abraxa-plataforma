/**
 * Miembros de una empresa: quién está, con qué rol y con qué áreas.
 *
 * Portado de GARDEN (src/api/routes/crm/memberships.ts) conservando lo que
 * hacía bien — el orden usuario→membresía, y borrar los grants al dar de baja
 * — y cerrando dos huecos que tenía.
 *
 * Todo pasa por `tenantDb(ctx)`. No hay una sola consulta aquí que pueda ver
 * una fila de otra empresa, ni aunque alguien mande el `email` de un miembro
 * ajeno: el filtro no está escrito, está en el tipo.
 */
import { PlatformError, tenantDb } from '@abraxa/db';
import { findUsers, removeMember as removeMemberRpc, upsertUser } from '../db/queries';
import { mapPgError, validar } from '../errors';
import { assignableRoleSchema, emailSchema, setAreasSchema } from '../schemas';
import type {
  AreaAccess,
  AreaGrantRow,
  MemberSummary,
  MembershipRole,
  MembershipRow,
  TenantContext,
} from '../types';

/** Los miembros con su rol, sus áreas y su nombre. */
export async function listMembers(ctx: TenantContext): Promise<MemberSummary[]> {
  const db = tenantDb(ctx);

  const { data: mems, error } = await db
    .from('memberships')
    .select('tenant_id, user_email, role, created_at')
    .order('created_at');
  if (error) throw mapPgError(error, 'No se pudieron cargar los miembros');

  const filas = (mems as MembershipRow[] | null) ?? [];
  if (filas.length === 0) return [];

  const { data: grants, error: errorGrants } = await db
    .from('area_grants')
    .select('tenant_id, user_email, area_slug, access');
  if (errorGrants) throw mapPgError(errorGrants, 'No se pudieron cargar los permisos por área');

  const porCorreo = new Map<string, Record<string, AreaAccess>>();
  for (const g of ((grants as AreaGrantRow[] | null) ?? [])) {
    const actual = porCorreo.get(g.user_email) ?? {};
    actual[g.area_slug] = g.access;
    porCorreo.set(g.user_email, actual);
  }

  // `app.users` es global (no tiene tenant_id), así que se lee aparte y sólo
  // para los correos que YA demostraron tener membresía en esta empresa.
  const usuarios = await findUsers(filas.map((m) => m.user_email));
  const nombrePor = new Map(usuarios.map((u) => [u.email, u.name] as const));

  return filas.map((m) => ({
    email: m.user_email,
    name: nombrePor.get(m.user_email) ?? null,
    role: m.role,
    areas: porCorreo.get(m.user_email) ?? {},
    createdAt: m.created_at,
  }));
}

async function membresiaDe(
  ctx: TenantContext,
  email: string,
): Promise<MembershipRow | null> {
  const { data, error } = await tenantDb(ctx)
    .from('memberships')
    .select('tenant_id, user_email, role, created_at')
    .eq('user_email', email)
    .maybeSingle();
  if (error) throw mapPgError(error, 'No se pudo cargar la membresía');
  return (data as MembershipRow | null) ?? null;
}

/**
 * Cambia el rol de un miembro.
 *
 * `owner` no es asignable (ver `assignableRoleSchema`), y al dueño no se le
 * cambia el rol: sería quedarse sin dueño por la puerta de atrás, que es lo
 * mismo que `remove_member` ya impide por el frente.
 */
export async function setRole(
  ctx: TenantContext,
  emailCrudo: string,
  role: unknown,
): Promise<{ email: string; role: MembershipRole }> {
  const email = validar(emailSchema, emailCrudo, 'Correo inválido');
  const nuevoRol = validar(
    assignableRoleSchema,
    role,
    'Rol inválido (admin | member | viewer). La propiedad de la empresa se transfiere aparte',
  );

  const actual = await membresiaDe(ctx, email);
  if (!actual) throw new PlatformError('NOT_FOUND', 'Esa persona no es miembro de esta empresa.');

  if (actual.role === 'owner') {
    throw new PlatformError(
      'CONFLICT',
      'No puedes cambiarle el rol al dueño de la empresa. Transfiere la propiedad primero.',
    );
  }

  const { error } = await tenantDb(ctx)
    .from('memberships')
    .update({ role: nuevoRol })
    .eq('user_email', email);
  if (error) throw mapPgError(error, 'No se pudo cambiar el rol');

  return { email, role: nuevoRol };
}

/**
 * Reemplaza los accesos por área de un miembro.
 *
 * Reemplaza en vez de mezclar: quitar un permiso tiene que ser posible
 * mandando el mapa sin él. Un `PATCH` que sólo agrega convierte la pantalla de
 * permisos en una donde nada se puede revocar.
 */
export async function setAreas(
  ctx: TenantContext,
  emailCrudo: string,
  entrada: unknown,
): Promise<{ email: string; areas: Record<string, AreaAccess> }> {
  const email = validar(emailSchema, emailCrudo, 'Correo inválido');
  const { areas } = validar(setAreasSchema, entrada, 'Permisos por área inválidos');

  const actual = await membresiaDe(ctx, email);
  if (!actual) throw new PlatformError('NOT_FOUND', 'Esa persona no es miembro de esta empresa.');

  const db = tenantDb(ctx);

  const { error: errorBorrado } = await db.from('area_grants').delete().eq('user_email', email);
  if (errorBorrado) throw mapPgError(errorBorrado, 'No se pudieron limpiar los permisos');

  const nuevas = Object.entries(areas);
  if (nuevas.length > 0) {
    const { error } = await db
      .from('area_grants')
      .insert(nuevas.map(([area_slug, access]) => ({ user_email: email, area_slug, access })));
    if (error) throw mapPgError(error, 'No se pudieron guardar los permisos');
  }

  return { email, areas };
}

/**
 * Da de baja a un miembro, con sus grants y sus invitaciones pendientes.
 *
 * Dos reglas heredadas de GARDEN y una nueva:
 *   · no puedes quitarte a ti mismo (GARDEN, memberships.ts:67)
 *   · los grants se van con la membresía (GARDEN, memberships.ts:74)
 *   · no puedes quitar al dueño — la que faltaba. Sin ella, una empresa se
 *     puede quedar sin nadie que la administre.
 *
 * La baja en sí ocurre dentro de `app.remove_member()` para que las tres
 * tablas se toquen en una transacción.
 */
export async function removeMember(
  ctx: TenantContext,
  emailCrudo: string,
): Promise<{ email: string; removed: boolean }> {
  const email = validar(emailSchema, emailCrudo, 'Correo inválido');

  if (email === (ctx.userEmail ?? '').toLowerCase()) {
    throw new PlatformError('CONFLICT', 'No puedes quitarte a ti mismo.');
  }

  // Se comprueba la membresía por la vía aislada ANTES de llamar a la función:
  // así, un correo de otra empresa no llega siquiera a la RPC.
  const actual = await membresiaDe(ctx, email);
  if (!actual) throw new PlatformError('NOT_FOUND', 'Esa persona no es miembro de esta empresa.');

  const removed = await removeMemberRpc(ctx.tenantId, email);
  return { email, removed };
}

/**
 * Alta directa de un miembro, sin invitación.
 *
 * Es la vía que usa el panel de permisos cuando el correo ya está en el
 * equipo. El orden — usuario primero, membresía después — es el de GARDEN
 * (memberships.ts:51-56) y no es cosmético: `app.memberships` tiene una FK
 * hacia `app.users` desde la migración 010.
 */
export async function upsertMember(
  ctx: TenantContext,
  emailCrudo: string,
  role: unknown,
): Promise<{ email: string; role: MembershipRole }> {
  const email = validar(emailSchema, emailCrudo, 'Correo inválido');
  const nuevoRol = validar(assignableRoleSchema, role, 'Rol inválido (admin | member | viewer)');

  const existente = await membresiaDe(ctx, email);
  if (existente?.role === 'owner') {
    throw new PlatformError('CONFLICT', 'No puedes cambiarle el rol al dueño de la empresa.');
  }

  await upsertUser(email);

  const { error } = await tenantDb(ctx)
    .from('memberships')
    .upsert({ user_email: email, role: nuevoRol }, { onConflict: 'tenant_id,user_email' });
  if (error) throw mapPgError(error, 'No se pudo dar de alta al miembro');

  return { email, role: nuevoRol };
}
