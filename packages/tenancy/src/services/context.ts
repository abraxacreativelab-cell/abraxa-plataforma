/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Quién eres, en qué empresa estás, y qué puedes tocar.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * `contextFor()` es la única función de todo el producto que decide si una
 * persona puede entrar a una empresa. Su 403 es lo único que impide que el
 * cliente A lea los datos del cliente B — literalmente lo único: `tenantDb()`
 * filtra por el `tenantId` que sale de aquí, así que si esto se equivoca, todo
 * lo de abajo filtra correctamente hacia la empresa equivocada.
 *
 * Por eso no tiene atajos, ni cachés, ni bypass.
 */
import { PlatformError } from '@abraxa/db';
import {
  findMembership,
  findTenantBySlug,
  hasAnyMembership,
  listTenantsForEmail,
} from '../db/queries';
import { esAdminDelTenant, loadAreaGrants } from '../middleware/rbac';
import { normalizeEmail, normalizeSlug } from '../schemas';
import type { FullTenantContext, TenantSummary } from '../types';

/**
 * Mismo error para "la empresa no existe" y para "no eres miembro".
 *
 * Distinguirlos sería más amable y convertiría este endpoint en un directorio
 * de clientes: probando slugs, cualquiera con una sesión válida sabría qué
 * empresas están en la plataforma. Un 404 y un 403 distintos son una fuga de
 * información aunque ninguno de los dos entregue un solo dato del tenant.
 */
const negarAcceso = (): PlatformError =>
  new PlatformError('FORBIDDEN', 'No tienes acceso a esta empresa.');

// ─── La función que aísla ─────────────────────────────────────────────────

export interface ContextForInput {
  userEmail: string;
  tenantSlug: string;
}

/**
 * El contexto verificado, o 403.
 *
 * `tenantSlug` viene del navegador y NO se confía: se valida contra
 * `app.memberships`. `userEmail` viene de la sesión verificada server-side por
 * el BFF, nunca de un header que puso el cliente (ver middleware/proxy.ts).
 */
export async function contextFor(i: ContextForInput): Promise<FullTenantContext> {
  const email = normalizeEmail(i.userEmail ?? '');
  const slug = normalizeSlug(i.tenantSlug ?? '');

  if (!email || !slug) throw negarAcceso();

  const tenant = await findTenantBySlug(slug);
  if (!tenant) throw negarAcceso();

  const membresia = await findMembership(tenant.id, email);
  if (!membresia) throw negarAcceso();

  /*
   * Una empresa suspendida o archivada no se abre.
   *
   * Aquí sí se puede decir el motivo: quien pregunta ya demostró ser miembro,
   * así que no hay nada que enumerar, y necesita saber por qué no entra.
   */
  if (tenant.status !== 'active') {
    throw new PlatformError(
      'FORBIDDEN',
      tenant.status === 'suspended'
        ? 'Esta empresa está suspendida.'
        : 'Esta empresa está archivada.',
      { details: { status: tenant.status } },
    );
  }

  const areas = await loadAreaGrants(tenant.id, email, esAdminDelTenant(membresia.role));

  return {
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    tenantName: tenant.name,
    tenantStatus: tenant.status,
    userEmail: email,
    role: membresia.role,
    areas,
    plan: tenant.plan,
    isPlatformStaff: false,
  };
}

// ─── La vía de staff — separada a propósito ───────────────────────────────

const staffPermitido = (): string[] =>
  (process.env.PLATFORM_STAFF_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

export const esStaffDePlataforma = (email: string): boolean =>
  staffPermitido().includes(normalizeEmail(email));

/**
 * Acceso de staff de la plataforma a una empresa que no es suya.
 *
 * ── Por qué esto NO vive dentro de `contextFor()` ─────────────────────────
 *
 * En GARDEN, el bypass de super-admin estaba dentro del middleware de tenant:
 * quien estuviera en `CRM_SUPER_ADMINS` entraba a cualquier sub-cuenta por la
 * ruta normal. Eso significa que el aislamiento entre clientes dependía de una
 * variable de entorno, y que la prueba de aislamiento podía pasar en verde sin
 * que el aislamiento fuera cierto.
 *
 * Aquí la ruta normal no tiene ese camino, ni siquiera para el staff. Quien
 * necesite acceso transversal — el panel de agencia de H14 — tiene que llamar
 * a ESTA función, a sabiendas, y queda registrado.
 *
 * Apagado por defecto: sin `PLATFORM_STAFF_EMAILS`, la lista es vacía y esto
 * no deja pasar a nadie.
 */
export async function staffContextFor(i: ContextForInput): Promise<FullTenantContext> {
  const email = normalizeEmail(i.userEmail ?? '');
  const slug = normalizeSlug(i.tenantSlug ?? '');

  if (!email || !slug) throw negarAcceso();
  if (!esStaffDePlataforma(email)) throw negarAcceso();

  const tenant = await findTenantBySlug(slug);
  if (!tenant) throw negarAcceso();

  return {
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    tenantName: tenant.name,
    tenantStatus: tenant.status,
    userEmail: email,
    role: 'admin',
    areas: { '*': 'admin' },
    plan: tenant.plan,
    isPlatformStaff: true,
  };
}

// ─── Entrada a la plataforma ──────────────────────────────────────────────

export interface CanSignInDeps {
  allowed?: string[];
  membership?: (email: string) => Promise<boolean>;
  env?: string | undefined;
}

const allowlistDelEquipo = (): string[] =>
  (process.env.AUTH_ALLOWED_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

/**
 * ¿Este correo puede entrar a la plataforma? Portado de GARDEN
 * (garden-os/lib/auth.ts:42-56), incluida la inyección de dependencias, que es
 * lo que permite probarlo sin red.
 *
 * Doble puerta: el equipo de la plataforma, o cualquiera con membresía activa
 * en alguna empresa. Invitar a alguien desde Permisos es su alta completa.
 *
 * ── Fail-closed ───────────────────────────────────────────────────────────
 *
 * Un error de red, un timeout o una respuesta rara devuelven `false`. Nunca
 * `true`. La única forma de entrar es que algo diga explícitamente que sí.
 *
 * Ojo con la última línea: la escotilla de desarrollo exige que la allowlist
 * esté VACÍA. Con allowlist configurada, un correo fuera de ella no entra ni
 * en local — que es lo que uno quiere al probar permisos.
 */
export async function canSignIn(
  email: string | null | undefined,
  deps: CanSignInDeps = {},
): Promise<boolean> {
  const allowed = deps.allowed ?? allowlistDelEquipo();
  const membership = deps.membership ?? hasAnyMembership;
  const env = deps.env ?? process.env.NODE_ENV;

  const e = normalizeEmail(email ?? '');
  if (!e) return false;

  if (allowed.includes(e)) return true;

  try {
    if (await membership(e)) return true;
  } catch {
    // Fail-closed: un error consultando la membresía jamás abre la puerta.
  }

  return allowed.length === 0 && env !== 'production';
}

/** Las empresas de un correo. Lo consume el selector de empresa del BFF. */
export async function tenantsFor(email: string): Promise<TenantSummary[]> {
  const e = normalizeEmail(email ?? '');
  if (!e) return [];
  return listTenantsForEmail(e);
}

/**
 * El slug al que mandar a alguien después de entrar.
 *
 * Devuelve `null` si no tiene empresa (va al Ritual de Fundación de H7) y
 * también si tiene más de una (va al selector). Elegir por él cuando hay
 * varias sería adivinar.
 */
export async function primaryTenantSlugFor(email: string): Promise<string | null> {
  const empresas = (await tenantsFor(email)).filter((t) => t.status === 'active');
  return empresas.length === 1 ? (empresas[0]?.slug ?? null) : null;
}
