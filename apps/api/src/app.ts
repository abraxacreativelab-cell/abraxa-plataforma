import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { PlatformError, listPorts } from '@abraxa/db';
import { MOUNTS, PACKAGE_META } from './packages';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  // El webhook de Stripe (H10) necesita el cuerpo CRUDO para verificar la
  // firma. Por eso `express.json()` guarda una copia sin parsear.
  app.use(
    express.json({
      limit: '2mb',
      verify: (req, _res, buf) => {
        (req as Request & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'abraxa-plataforma-api' });
  });

  /**
   * El avance de las olas, en vivo.
   *
   * Un paquete con `ready: false` es un carril que todavía no aterriza; un
   * port con `ready: false` es un contrato que nadie ha registrado. El
   * orquestador ve aquí qué handoffs ya están de verdad en producción, sin
   * tener que leer 14 PRs.
   */
  app.get('/_health/packages', (_req, res) => {
    const packages = PACKAGE_META.map((m) => ({ ...m }));
    res.json({
      ok: true,
      packages,
      packagesReady: packages.filter((p) => p.ready).length,
      packagesTotal: packages.length,
      ports: listPorts(),
    });
  });

  for (const [prefix, router] of MOUNTS) app.use(prefix, router);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Ruta no encontrada' } });
  });

  // Un solo lugar traduce errores de dominio a HTTP. Los `details` nunca salen.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (PlatformError.is(err)) {
      res.status(err.status).json(err.toResponse());
      return;
    }
    console.error('[api] error no controlado', err);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Error interno' } });
  });

  return app;
}
