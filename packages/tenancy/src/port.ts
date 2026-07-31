/**
 * La implementación de `TenancyPort`.
 *
 * Es lo que ven los otros trece handoffs: H10 llama `provision()` desde su
 * webhook de Stripe, H7 lo llama al terminar el Ritual de Fundación, y todos
 * usan `contextFor()` sin saber nada de cómo se resuelve.
 *
 * Se registra en `src/index.ts` con `registerPort('tenancy', tenancyPort)`.
 */
import type { MembershipRole, TenancyPort, TenantContext } from '@abraxa/db/ports';
import { canSignIn, contextFor, primaryTenantSlugFor } from './services/context';
import { listMembers } from './services/memberships';
import { provision } from './services/provision';

export const tenancyPort: TenancyPort = {
  provision: (i) =>
    provision({
      slug: i.slug,
      name: i.name,
      ownerEmail: i.ownerEmail,
      ...(i.industryType ? { industryType: i.industryType } : {}),
    }),

  contextFor: (i) => contextFor(i),

  canSignIn: (email) => canSignIn(email),

  primaryTenantSlugFor: (email) => primaryTenantSlugFor(email),

  /**
   * El port pide sólo correo, nombre y rol; el servicio devuelve además las
   * áreas. Se recorta aquí en vez de ensanchar el contrato: H9 lo consume para
   * un selector de responsable y no le hacen falta los permisos de nadie.
   */
  listMembers: async (
    ctx: TenantContext,
  ): Promise<Array<{ email: string; name: string | null; role: MembershipRole }>> => {
    const miembros = await listMembers(ctx);
    return miembros.map((m) => ({ email: m.email, name: m.name, role: m.role }));
  },
};
