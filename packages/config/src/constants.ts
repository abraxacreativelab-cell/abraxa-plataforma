/** Los 12 paquetes del monorepo. `apps/api` los importa todos al arrancar. */
export const PACKAGES = [
  'config',
  'db',
  'tenancy',
  'agents',
  'vault',
  'ui',
  'inbox',
  'onboarding',
  'flows',
  'work',
  'billing',
  'areas',
] as const;

export type PackageName = (typeof PACKAGES)[number];

/** Orden de acceso a un área. Sirve para comparar: `RANK.admin > RANK.view`. */
export const ACCESS_RANK = { view: 1, edit: 2, admin: 3 } as const;

/** Headers del contrato BFF→API. El correo SIEMPRE sale de la sesión
 *  verificada server-side, nunca de lo que mandó el navegador. */
export const HEADER = {
  userEmail: 'x-user-email',
  tenantSlug: 'x-tenant-slug',
  proxySecret: 'x-proxy-secret',
  requestId: 'x-request-id',
} as const;

/** Modelos por defecto por rol de agente (H3 §4). Una fila de DB los sobreescribe. */
export const DEFAULT_MODEL_BY_ROLE = {
  master: 'claude-sonnet-5',
  sales: 'claude-haiku-4-5',
  service: 'claude-haiku-4-5',
  social: 'claude-haiku-4-5',
  analyst: 'claude-sonnet-5',
} as const;

/**
 * Mínimo de tokens para que el caché de prompt sirva.
 * Si el system prompt de un sub-agente no llega al mínimo de su modelo, NO
 * cachea y el costo se triplica en silencio. H3 lo mide, no lo asume.
 */
export const CACHE_MIN_TOKENS = { 'claude-haiku-4-5': 4096, 'claude-sonnet-5': 1024 } as const;
