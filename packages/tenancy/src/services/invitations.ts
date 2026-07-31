/**
 * Invitaciones.
 *
 * ── El token se guarda hasheado ───────────────────────────────────────────
 *
 * Una invitación pendiente es una llave que abre una empresa con un rol. Si la
 * tabla se guarda en claro, una fuga de base de datos entrega todas las llaves
 * vivas del sistema a la vez, sin que nadie se entere y sin nada que rotar.
 *
 * Se guarda `sha256(token)` y el claro se devuelve UNA vez, a quien invita.
 * Es exactamente lo que GARDEN ya hacía con sus API keys
 * (`crm_api_keys.key_hash`), aplicado al caso que sí importa aquí.
 *
 * El precio: no se puede reenviar el correo con el mismo enlace. Reinvitar
 * emite un token nuevo — que además invalida el anterior, y eso es lo que uno
 * quiere al reinvitar.
 */
import { createHash, randomBytes } from 'node:crypto';
import { PlatformError, tenantDb } from '@abraxa/db';
import { acceptInvitation as acceptInvitationRpc } from '../db/queries';
import { mapPgError, validar } from '../errors';
import {
  acceptInvitationSchema,
  assignableRoleSchema,
  emailSchema,
  inviteInputSchema,
} from '../schemas';
import { assertSeatAvailable } from './plans';
import type {
  AcceptedInvitation,
  AreaAccess,
  InvitationRow,
  IssuedInvitation,
  MembershipRole,
  TenantContext,
} from '../types';

/** 256 bits en base64url: 43 caracteres, seguros dentro de una URL. */
const nuevoToken = (): string => randomBytes(32).toString('base64url');

/** Debe coincidir con `invitations_token_hasheado` de la migración 010. */
export const hashToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

const baseDeLaApp = (): string =>
  (process.env.APP_BASE_URL ?? 'https://mi.abraxa.club').replace(/\/+$/, '');

export const urlDeInvitacion = (token: string): string =>
  `${baseDeLaApp()}/invitacion/${encodeURIComponent(token)}`;

// ─── Crear ────────────────────────────────────────────────────────────────

export interface InviteInput {
  email: string;
  role?: MembershipRole;
  areas?: Record<string, AreaAccess>;
  expiresInDays?: number;
}

/**
 * Invita a alguien a la empresa del contexto.
 *
 * Reinvitar al mismo correo reemite el token sobre la misma fila: la
 * restricción `UNIQUE (tenant_id, email)` garantiza que no se acumulen
 * invitaciones vivas para la misma persona, cada una abriendo una puerta.
 */
export async function createInvitation(
  ctx: TenantContext,
  entrada: InviteInput,
): Promise<IssuedInvitation> {
  const i = validar(inviteInputSchema, entrada, 'No se pudo crear la invitación');

  // `owner` no se invita: la empresa tiene uno y transferir la propiedad es
  // otra operación. El índice único lo impediría igual, con peor mensaje.
  const role = validar(
    assignableRoleSchema,
    i.role,
    'No se puede invitar como dueño. La propiedad de la empresa se transfiere aparte',
  );

  const db = tenantDb(ctx);

  const { data: yaMiembro, error: errorMiembro } = await db
    .from('memberships')
    .select('user_email')
    .eq('user_email', i.email)
    .maybeSingle();
  if (errorMiembro) throw mapPgError(errorMiembro, 'No se pudo verificar la membresía');
  if (yaMiembro) {
    throw new PlatformError('CONFLICT', 'Esa persona ya es miembro de esta empresa.');
  }

  // Aviso temprano y con buen mensaje. La verificación que de verdad protege
  // el asiento está dentro de `app.accept_invitation()`, en la transacción que
  // lo consume.
  await assertSeatAvailable(ctx);

  const token = nuevoToken();
  const expiresAt = new Date(Date.now() + i.expiresInDays * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await db
    .from('invitations')
    .upsert(
      {
        email: i.email,
        role,
        areas: i.areas,
        token_hash: hashToken(token),
        invited_by: ctx.userEmail,
        accepted_at: null,
        expires_at: expiresAt,
      },
      { onConflict: 'tenant_id,email' },
    )
    .select('id, email, role, areas, expires_at')
    .maybeSingle();

  if (error) throw mapPgError(error, 'No se pudo crear la invitación');

  const fila = data as Pick<InvitationRow, 'id' | 'email' | 'role' | 'areas' | 'expires_at'> | null;
  if (!fila) throw new PlatformError('INTERNAL', 'La invitación no se guardó.');

  return {
    id: fila.id,
    email: fila.email,
    role: fila.role,
    areas: fila.areas ?? {},
    expiresAt: fila.expires_at,
    token,
    acceptUrl: urlDeInvitacion(token),
  };
}

// ─── Listar y revocar ─────────────────────────────────────────────────────

export interface PendingInvitation {
  id: string;
  email: string;
  role: MembershipRole;
  areas: Record<string, AreaAccess>;
  invitedBy: string | null;
  expiresAt: string;
  expired: boolean;
  createdAt: string;
}

/** Las invitaciones vivas. Nunca devuelve el hash: no le sirve a nadie de fuera. */
export async function listInvitations(ctx: TenantContext): Promise<PendingInvitation[]> {
  const { data, error } = await tenantDb(ctx)
    .from('invitations')
    .select('id, email, role, areas, invited_by, expires_at, created_at, accepted_at')
    .is('accepted_at', null)
    .order('created_at');
  if (error) throw mapPgError(error, 'No se pudieron cargar las invitaciones');

  const ahora = Date.now();
  return (((data as InvitationRow[] | null) ?? [])).map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role,
    areas: r.areas ?? {},
    invitedBy: r.invited_by,
    expiresAt: r.expires_at,
    expired: new Date(r.expires_at).getTime() <= ahora,
    createdAt: r.created_at,
  }));
}

export async function revokeInvitation(ctx: TenantContext, id: string): Promise<boolean> {
  const { data, error } = await tenantDb(ctx)
    .from('invitations')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) throw mapPgError(error, 'No se pudo revocar la invitación');
  return (((data as unknown[] | null) ?? []).length) > 0;
}

// ─── Aceptar ──────────────────────────────────────────────────────────────

export interface AcceptInput {
  token: string;
  /** De la sesión verificada. NUNCA del formulario. */
  userEmail: string;
  name?: string;
}

/**
 * Acepta una invitación.
 *
 * El correo viene de la sesión verificada y `app.accept_invitation()` lo
 * compara contra el de la invitación. Sin esa comparación, el token dejaría de
 * ser una invitación para convertirse en una llave al portador: quien
 * interceptara el enlace entraría con el rol que se le dio a otra persona.
 *
 * Todo lo demás — usuario, membresía, grants, quemar la invitación, verificar
 * vigencia y asiento — ocurre allá adentro, en una transacción.
 */
export async function acceptInvitation(entrada: AcceptInput): Promise<AcceptedInvitation> {
  const { token, name } = validar(
    acceptInvitationSchema,
    { token: entrada.token, name: entrada.name },
    'No se pudo aceptar la invitación',
  );
  const email = validar(emailSchema, entrada.userEmail, 'Correo inválido');

  return acceptInvitationRpc(hashToken(token), email, name);
}
