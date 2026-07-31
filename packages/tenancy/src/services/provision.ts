/**
 * `provision()` — el alta completa de un cliente.
 *
 * Este archivo es corto a propósito. Toda la parte difícil — la atomicidad, la
 * idempotencia, la carrera entre dos webhooks simultáneos — vive en
 * `app.provision_tenant()` (migración 011), porque ahí se hereda en vez de
 * implementarse. Aquí sólo queda validar la entrada y traducir errores.
 *
 * Si algún día alguien siente la tentación de "simplificar" esto haciendo los
 * cinco INSERT desde TypeScript: eso es exactamente lo que hace el seed de
 * GARDEN, y por eso ahí una falla a media secuencia deja una empresa a la que
 * su dueño no puede entrar.
 */
import { provisionTenant } from '../db/queries';
import { validar } from '../errors';
import { provisionInputSchema } from '../schemas';

export interface ProvisionInput {
  slug: string;
  name: string;
  ownerEmail: string;
  industryType?: string;
  plan?: string;
}

export interface ProvisionResult {
  tenantId: string;
  /** `false` cuando el slug ya existía y se devolvió el mismo tenant. */
  created: boolean;
}

/**
 * Da de alta una empresa con su dueño, sus permisos y su plan.
 *
 * Idempotente por `slug` **para el mismo dueño**: H10 reintenta un webhook de
 * Stripe y recibe el mismo `tenantId` sin duplicar nada.
 *
 * Si el slug existe y pertenece a otra persona, lanza `CONFLICT` en vez de
 * devolver el tenant ajeno. Esa distinción es de seguridad, no de pulcritud:
 * H10 confía en esta respuesta para dar acceso a quien acaba de pagar.
 *
 * NO siembra áreas de negocio ni pipelines: eso lo hace H11 escuchando
 * `tenant_provisioned`, que esta operación deja en el outbox.
 */
export async function provision(entrada: ProvisionInput): Promise<ProvisionResult> {
  const i = validar(provisionInputSchema, entrada, 'No se pudo dar de alta la empresa');

  return provisionTenant({
    slug: i.slug,
    name: i.name,
    ownerEmail: i.ownerEmail,
    industryType: i.industryType,
    plan: i.plan,
  });
}
