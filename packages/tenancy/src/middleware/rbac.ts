/**
 * ════════════════════════════════════════════════════════════════════════════
 *  RBAC por área. Portado de GARDEN (src/api/middleware/tenant.ts:119-177).
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Es la parte de GARDEN que está bien hecha y se lleva casi tal cual: deny por
 * defecto, comodín `'*'`, rangos comparables, y lanza si un grant viene
 * malformado de la base en vez de tratarlo como "sin acceso".
 *
 * ── Los tres cambios al portarlo ──────────────────────────────────────────
 *
 * 1. `CrmError` → `PlatformError` de @abraxa/db, para que el error cruce la
 *    frontera entre paquetes con un código que los demás entienden.
 * 2. Roles nuevos: `owner | admin | member | viewer` en vez de los cuatro del
 *    CRM (`agency_admin | account_admin | agent | viewer`).
 * 3. **Fuera el bypass de super-admin.** En GARDEN, quien estuviera en
 *    `CRM_SUPER_ADMINS` entraba a cualquier tenant (tenant.ts:85). Portado tal
 *    cual, el aislamiento entre clientes se vencería editando una variable de
 *    entorno — y el criterio #3 pasaría en verde sin ser cierto. Aquí no
 *    existe ese camino. Ver services/context.ts para la vía de staff, que es
 *    explícita, está apagada por defecto y no pasa por aquí.
 */
import type { NextFunction, Request, Response } from 'express';
import { ACCESS_RANK } from '@abraxa/config';
import { PlatformError } from '@abraxa/db';
import { loadGrantRows } from '../db/queries';
import type { AreaAccess, MembershipRole, TenantContext } from '../types';

export { ACCESS_RANK };

/** Roles con acceso total dentro de su empresa. */
const ROLES_ADMIN: ReadonlySet<MembershipRole> = new Set<MembershipRole>(['owner', 'admin']);

export const esAdminDelTenant = (role: MembershipRole | null): boolean =>
  role !== null && ROLES_ADMIN.has(role);

const esAccesoValido = (v: unknown): v is AreaAccess =>
  typeof v === 'string' && Object.hasOwn(ACCESS_RANK, v);

/**
 * Los accesos por área del usuario en esta empresa.
 *
 * `owner` y `admin` reciben `{ '*': 'admin' }` sin consultar la tabla: su
 * acceso total viene del rol, no de filas que alguien podría borrar por error
 * dejando al dueño fuera de su propia empresa.
 *
 * Para todos los demás: deny por defecto. Sólo lo que esté otorgado.
 *
 * ── Por qué lanza ante un grant malformado ────────────────────────────────
 *
 * Criterio #6 del handoff. Si en la base aparece un `access` que no es
 * `view|edit|admin`, la respuesta correcta NO es ignorar la fila: alguien
 * escribió algo que el sistema no entiende en la tabla que decide quién ve
 * qué. Ignorarla degrada permisos en silencio; interpretarla podría otorgar de
 * más. Se cae, ruidosamente, y alguien lo arregla.
 */
export async function loadAreaGrants(
  tenantId: string,
  email: string | null,
  esAdmin: boolean,
): Promise<Record<string, AreaAccess>> {
  if (esAdmin) return { '*': 'admin' };
  if (!email) return {};

  const filas = await loadGrantRows(tenantId, email);
  const mapa: Record<string, AreaAccess> = {};

  for (const fila of filas) {
    const area = String(fila?.area_slug ?? '');
    const acceso: unknown = fila?.access;

    if (!area || !esAccesoValido(acceso)) {
      throw new PlatformError(
        'INTERNAL',
        'Permiso por área inválido en la base de datos.',
        { details: { tenantId, email, areaSlug: area, access: String(acceso) } },
      );
    }
    mapa[area] = acceso;
  }

  return mapa;
}

/** ¿El contexto tiene al menos `min` de acceso al área? Deny por defecto. */
export function hasArea(
  ctx: TenantContext | null | undefined,
  area: string,
  min: AreaAccess = 'view',
): boolean {
  if (!ctx) return false;
  const areas = ctx.areas ?? {};
  const grant = areas['*'] ?? areas[area];
  return grant !== undefined && ACCESS_RANK[grant] >= ACCESS_RANK[min];
}

// ─── Guards de ruta ───────────────────────────────────────────────────────

const negar = (res: Response, err: PlatformError): void => {
  res.status(err.status).json(err.toResponse());
};

const sinContexto = (): PlatformError =>
  new PlatformError(
    'UNAUTHENTICATED',
    'Sin contexto de empresa. La petición no pasó por el proxy verificado.',
  );

/** Exige acceso `min` al área. */
export function requireArea(area: string, min: AreaAccess = 'view') {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.tenant) return negar(res, sinContexto());
    if (hasArea(req.tenant, area, min)) return next();
    negar(res, new PlatformError('FORBIDDEN', `Sin acceso al área "${area}" (requiere ${min}).`));
  };
}

/** Exige acceso `min` en al menos una de las áreas. */
export function requireAnyArea(areas: string[], min: AreaAccess = 'view') {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.tenant) return negar(res, sinContexto());
    if (areas.some((area) => hasArea(req.tenant, area, min))) return next();
    negar(
      res,
      new PlatformError('FORBIDDEN', `Sin acceso a ${areas.join(' o ')} (requiere ${min}).`),
    );
  };
}

/**
 * Política REST: leer exige `view`; mutar exige `edit` (o `admin` si se pide).
 *
 * Se porta tal cual de GARDEN porque resuelve bien el caso aburrido y
 * frecuente: un CRUD entero queda protegido con una línea y sin que nadie
 * tenga que acordarse de poner el guard correcto en cada verbo.
 */
export function requireAreaOperation(area: string, mutation: AreaAccess = 'edit') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const min: AreaAccess = ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? 'view' : mutation;
    return requireArea(area, min)(req, res, next);
  };
}

/** Exige que el rol dentro de la empresa esté entre los permitidos. */
export function requireRole(...roles: MembershipRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.tenant) return negar(res, sinContexto());
    const role = req.tenant.role;
    if (role !== null && roles.includes(role)) return next();
    negar(res, new PlatformError('FORBIDDEN', `Requiere rol: ${roles.join(' | ')}.`));
  };
}

/** Atajo: sólo quien administra la empresa. */
export const requireTenantAdmin = () => requireRole('owner', 'admin');
