/**
 * Rutas HTTP del motor de agentes. `apps/api` ya las monta en `/agents`.
 *
 * Son deliberadamente pocas. La vía principal para hablar con un agente NO es
 * HTTP: es `usePort('agents').run(ctx, …)` desde el proceso — así es como lo
 * llaman H6 cuando entra un mensaje y H7 durante la entrevista. Lo que se
 * expone aquí es lo que de verdad necesita un cliente HTTP: administrar las
 * definiciones y ver el consumo.
 *
 * ── Sobre el contexto ──────────────────────────────────────────────────────
 *
 * `TenantContext` se arma con `TenancyPort.contextFor()` desde una sesión
 * verificada server-side. Ese port es de H2 y todavía no existe, así que estas
 * rutas responden 501 nombrando a quién se está esperando — eso lo hace
 * `usePort` de H1 solo.
 *
 * Lo que NO se hace es leer el tenant de un header y seguir adelante: ese 403
 * es lo único que impide que el cliente A lea los datos del B, y una ruta que
 * "mientras tanto" confía en el navegador es exactamente cómo se cuela un
 * agujero de aislamiento a producción.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { PlatformError, usePort } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import { HEADER } from '@abraxa/config';
import { estadoPresupuesto } from './ledger/budget';
import { listarDefiniciones, sembrarAgentes } from './definitions/repository';
import { toolRegistry } from './tools/registry';

export const router: Router = Router();

/** Contexto verificado, o el 501/403 que corresponda. */
async function contextoDe(req: Request): Promise<TenantContext> {
  const userEmail = req.header(HEADER.userEmail);
  const tenantSlug = req.header(HEADER.tenantSlug);

  if (!userEmail || !tenantSlug) {
    throw new PlatformError(
      'UNAUTHENTICATED',
      `Faltan las cabeceras ${HEADER.userEmail} y ${HEADER.tenantSlug}. ` +
        'Las pone el BFF desde la sesión verificada, no el navegador.',
    );
  }

  // Lanza PORT_NOT_IMPLEMENTED nombrando a H2 mientras tenancy no aterrice.
  return usePort('tenancy').contextFor({ userEmail, tenantSlug });
}

function responder(res: Response, err: unknown): void {
  if (PlatformError.is(err)) {
    res.status(err.status).json(err.toResponse());
    return;
  }
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Error interno' } });
}

/** Salud del motor: qué tools hay registradas y por quién. */
router.get('/_status', (_req, res) => {
  res.json({
    ready: true,
    tools: toolRegistry.listNames(),
    toolCount: toolRegistry.size,
  });
});

/** Los agentes del negocio. */
router.get('/', (req, res) => {
  void (async () => {
    try {
      const ctx = await contextoDe(req);
      res.json({ agents: await listarDefiniciones(ctx) });
    } catch (err) {
      responder(res, err);
    }
  })();
});

/** Consumo y presupuesto del mes. Es la vista que evita la sorpresa a fin de mes. */
router.get('/budget', (req, res) => {
  void (async () => {
    try {
      const ctx = await contextoDe(req);
      res.json(await estadoPresupuesto(ctx));
    } catch (err) {
      responder(res, err);
    }
  })();
});

/** Siembra los cinco agentes por defecto. Lo llama H2 al aprovisionar. */
router.post('/seed', (req, res) => {
  void (async () => {
    try {
      const ctx = await contextoDe(req);
      const body = req.body as { masterName?: string } | undefined;
      const opts = body?.masterName ? { nombreDelMaestro: body.masterName } : undefined;
      res.json(await sembrarAgentes(ctx, opts));
    } catch (err) {
      responder(res, err);
    }
  })();
});
