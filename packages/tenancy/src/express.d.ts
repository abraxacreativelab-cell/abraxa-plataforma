import type { FullTenantContext } from './types';

/**
 * `req.tenant` — el contexto verificado de la petición.
 *
 * Lo pone `tenantMiddleware` y nadie más. Que sea opcional en el tipo es
 * deliberado: obliga a cada guard a comprobar que existe antes de decidir, y
 * esa comprobación es la que convierte "no pasó por el middleware" en un 401
 * en vez de en un `undefined` que se lee como "sin restricciones".
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      tenant?: FullTenantContext;
    }
  }
}

export {};
