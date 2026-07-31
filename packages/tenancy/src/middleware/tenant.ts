/**
 * ════════════════════════════════════════════════════════════════════════════
 *  De una petición HTTP a un contexto de empresa verificado.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Portado de GARDEN (src/api/middleware/tenant.ts:59-108) con dos cosas
 * quitadas:
 *
 *   · **la vía de API key** — no está en el alcance de H2; cuando exista, será
 *     su propio camino y no un `if` más dentro de éste.
 *   · **el bypass de super-admin** — ver la explicación larga en
 *     services/context.ts. Es el cambio que hace que el criterio #3 sea cierto
 *     y no sólo verde.
 *
 * Lo que queda es una sola vía: proxy verificado → correo de la sesión → slug
 * del navegador → membresía. Y la membresía es la que manda.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { HEADER } from '@abraxa/config';
import { PlatformError } from '@abraxa/db';
import { contextFor } from '../services/context';
import { proxyVerified } from './proxy';

/**
 * Los fallos de autenticación se responden aquí y no se delegan a `next(err)`.
 *
 * `apps/api` tiene un manejador central que traduce `PlatformError` a HTTP, y
 * funciona. Pero éste es el límite de seguridad del producto: si mañana
 * alguien monta este router en otro lado y olvida el manejador, un 403 que se
 * escapa por `next()` se convierte en un 500 — o peor, en un handler que
 * corre sin contexto. Responder aquí hace que la negación no dependa de que
 * alguien más esté bien cableado.
 */
const negar = (res: Response, err: PlatformError): void => {
  res.status(err.status).json(err.toResponse());
};

const correoDeLaSesion = (req: Request): string | null => {
  const crudo = String(req.headers[HEADER.userEmail] ?? '').trim().toLowerCase();
  return crudo.length > 0 ? crudo : null;
};

/**
 * Exige una sesión verificada, sin resolver empresa.
 *
 * Para lo que ocurre antes de pertenecer a una: crear tu empresa, listar las
 * tuyas, aceptar una invitación.
 */
export const sessionMiddleware: RequestHandler = (req, res, next) => {
  if (!proxyVerified(req)) {
    return negar(
      res,
      new PlatformError(
        'UNAUTHENTICATED',
        'Sólo por el proxy verificado de la aplicación (sesión server-side).',
      ),
    );
  }

  const email = correoDeLaSesion(req);
  if (!email) {
    return negar(res, new PlatformError('UNAUTHENTICATED', 'Falta el correo de la sesión.'));
  }

  // Contexto parcial: hay persona, todavía no hay empresa.
  req.tenant = {
    tenantId: '',
    tenantSlug: '',
    tenantName: '',
    tenantStatus: 'active',
    userEmail: email,
    role: null,
    areas: {},
    plan: 'free',
    isPlatformStaff: false,
  };

  next();
};

/**
 * Resuelve la empresa activa y la deja en `req.tenant`.
 *
 * El `x-tenant-slug` lo manda el navegador y NO se confía: `contextFor()` lo
 * valida contra `app.memberships`. Ese 403 es lo único que impide que el
 * cliente A lea los datos del cliente B.
 */
export async function tenantMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!proxyVerified(req)) {
      return negar(
        res,
        new PlatformError(
          'UNAUTHENTICATED',
          'Sólo por el proxy verificado de la aplicación (sesión server-side).',
        ),
      );
    }

    const email = correoDeLaSesion(req);
    if (!email) {
      return negar(res, new PlatformError('UNAUTHENTICATED', 'Falta el correo de la sesión.'));
    }

    const slug = String(req.headers[HEADER.tenantSlug] ?? '').trim();
    if (!slug) {
      return negar(
        res,
        new PlatformError('VALIDATION', `Falta el header ${HEADER.tenantSlug}.`),
      );
    }

    req.tenant = await contextFor({ userEmail: email, tenantSlug: slug });
    next();
  } catch (err) {
    if (PlatformError.is(err)) return negar(res, err);
    next(err);
  }
}

/**
 * Puerta de las rutas internas servidor-a-servidor. Portada de GARDEN
 * (routes/crm/internal.ts:16-27) tal cual, incluido el 503 sin secreto: aquí
 * no hay escotilla de desarrollo porque no hay navegador del otro lado.
 */
export const requireProxySecret: RequestHandler = (req, res, next) => {
  if (!process.env.PROXY_SECRET) {
    res.status(503).json({ error: { code: 'INTERNAL', message: 'PROXY_SECRET no configurado.' } });
    return;
  }
  if (!proxyVerified(req)) {
    res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'unauthorized' } });
    return;
  }
  next();
};

/**
 * Envuelve un handler asíncrono.
 *
 * Express 4 no atrapa el rechazo de una promesa: sin esto, un `await` que
 * lanza deja la petición colgada hasta el timeout en vez de responder.
 */
export const asyncHandler =
  (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch((err: unknown) => {
      if (PlatformError.is(err)) return negar(res, err);
      next(err);
    });
  };

/** El contexto de la petición, o lanza. Evita el `!` en cada handler. */
export function contextoDe(req: Request) {
  if (!req.tenant) {
    throw new PlatformError('UNAUTHENTICATED', 'Sin contexto de empresa.');
  }
  return req.tenant;
}
