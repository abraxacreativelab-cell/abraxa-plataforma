/**
 * Validación de entrada de H2.
 *
 * ── Por qué esto duplica los CHECK de la migración 010 ────────────────────
 *
 * No es duplicación por descuido. La base valida porque es la última puerta y
 * porque `app.provision_tenant()` es invocable desde psql; zod valida porque
 * un error de validación tiene que salir como 422 con un mensaje que se
 * entiende, no como un 500 con el texto de una restricción de Postgres.
 *
 * Lo que sí sería un error es que se separen. Por eso las reglas de formato
 * viven en constantes exportadas y `schemas.test.ts` compara la lista de slugs
 * reservados contra la que está escrita en la migración: si alguien agrega uno
 * en un lado y no en el otro, la prueba falla.
 */
import { z } from 'zod';
import type { AreaAccess, MembershipRole } from './types';

// ─── Formatos, en un solo lugar ───────────────────────────────────────────

/** Debe ser idéntico a `tenants_slug_formato` en migrations/010_tenancy.sql. */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

/** Debe ser idéntico a `area_grants_slug_valido` (sin el comodín). */
export const AREA_SLUG_RE = /^[a-z][a-z0-9-]{1,38}$/;

/** Debe ser idéntico al predicado `app.es_correo`. */
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Slugs que no puede tomar una empresa.
 *
 * Debe ser idéntica a `tenants_slug_no_reservado` en la migración 010.
 * Un slug igual a una ruta del producto hace que la empresa de alguien tape
 * una pantalla; uno igual a `api` rompe el enrutamiento para todos.
 */
export const RESERVED_SLUGS: readonly string[] = [
  'api', 'admin', 'app', 'auth', 'www', 'static', 'assets', 'public',
  'login', 'logout', 'signin', 'signup', 'health', 'internal', 'webhook',
  'webhooks', 'stripe', 'tenants', 'tenant', 'invitations', 'invite',
  'onboarding', 'ritual', 'bandeja', 'mapa', 'tareas', 'automatizaciones',
  'direccion', 'settings', 'ajustes', 'billing', 'cobro', 'support',
  'soporte', 'docs', 'blog', 'status', 'null', 'undefined',
];

export const MEMBERSHIP_ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
export const AREA_ACCESSES = ['view', 'edit', 'admin'] as const;

// ─── Normalizadores ───────────────────────────────────────────────────────

/**
 * El correo se normaliza SIEMPRE en el borde.
 *
 * `app.memberships` compara texto exacto. Si 'Ana@x.com' entra sin normalizar,
 * queda una fila que `contextFor()` nunca va a encontrar: una persona con
 * membresía real a la que el producto le niega la entrada, sin explicación.
 */
export const normalizeEmail = (v: string): string => v.trim().toLowerCase();
export const normalizeSlug = (v: string): string => v.trim().toLowerCase();

// ─── Piezas ───────────────────────────────────────────────────────────────

export const emailSchema = z
  .string()
  .transform(normalizeEmail)
  .refine((v) => v.length > 0 && v.length <= 320, 'El correo es obligatorio.')
  .refine((v) => EMAIL_RE.test(v), 'Correo inválido.');

export const slugSchema = z
  .string()
  .transform(normalizeSlug)
  .refine((v) => SLUG_RE.test(v), 'El slug lleva de 3 a 40 caracteres: minúsculas, números y guiones.')
  .refine((v) => !RESERVED_SLUGS.includes(v), (v) => ({ message: `"${v}" es un nombre reservado de la plataforma.` }));

export const roleSchema: z.ZodType<MembershipRole> = z.enum(MEMBERSHIP_ROLES);
export const accessSchema: z.ZodType<AreaAccess> = z.enum(AREA_ACCESSES);

export const areaSlugSchema = z
  .string()
  .transform(normalizeSlug)
  .refine((v) => AREA_SLUG_RE.test(v) || v === '*', 'Slug de área inválido.');

/** Mapa `{ area: acceso }`. Vacío = sin accesos, que es el default correcto. */
export const areasSchema = z
  .record(z.string(), accessSchema)
  .default({})
  .transform((raw) => {
    const salida: Record<string, AreaAccess> = {};
    for (const [k, v] of Object.entries(raw)) {
      const slug = normalizeSlug(k);
      if (!AREA_SLUG_RE.test(slug) && slug !== '*') {
        throw new z.ZodError([
          { code: 'custom', path: ['areas', k], message: `Slug de área inválido: "${k}".` },
        ]);
      }
      salida[slug] = v;
    }
    return salida;
  });

// ─── Entradas ─────────────────────────────────────────────────────────────

export const provisionInputSchema = z.object({
  slug: slugSchema,
  name: z.string().transform((v) => v.trim()).refine((v) => v.length >= 2 && v.length <= 120, 'El nombre de la empresa lleva de 2 a 120 caracteres.'),
  ownerEmail: emailSchema,
  industryType: z.string().trim().max(60).optional().transform((v) => (v ? v : undefined)),
  plan: z.string().trim().toLowerCase().optional(),
});

export type ProvisionInputParsed = z.infer<typeof provisionInputSchema>;

export const inviteInputSchema = z.object({
  email: emailSchema,
  role: roleSchema.default('member'),
  areas: areasSchema,
  /** Días de vigencia. Corto a propósito: una invitación es una llave viva. */
  expiresInDays: z.number().int().min(1).max(30).default(7),
});

export const acceptInvitationSchema = z.object({
  token: z.string().trim().min(20, 'Token inválido.').max(200),
  name: z.string().trim().max(120).optional(),
});

export const setRoleSchema = z.object({ role: roleSchema });

export const setAreasSchema = z.object({ areas: areasSchema });

/**
 * `owner` no se otorga por invitación ni por cambio de rol.
 *
 * El índice `memberships_un_solo_owner_idx` ya impide que existan dos, así que
 * intentarlo devolvería un choque de restricción con un mensaje ilegible.
 * Además, transferir la propiedad de una empresa es una operación con
 * consecuencias que merece su propio flujo explícito, no un select en un
 * formulario de permisos.
 */
export const assignableRoleSchema: z.ZodType<Exclude<MembershipRole, 'owner'>> = z.enum([
  'admin',
  'member',
  'viewer',
]);
