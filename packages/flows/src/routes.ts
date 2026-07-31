/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Las rutas. `apps/api` ya las monta en `/flows`.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  El contexto se arma SIEMPRE con `contextoDePeticion(req)` de `@abraxa/db`.
 *  Ningún router de dominio escribe el suyo: cuatro carriles lo hicieron entre
 *  el 2026-07-30 y el 07-31 y tres dejaron abierta la suplantación por header
 *  — uno llegó a `main` sirviendo la bóveda a cualquiera con `curl`. La pieza
 *  canónica hace las tres puertas en orden (proxy verificado → identidad →
 *  membresía validada por H2) y `eslint.config.mjs` marca como ERROR leer
 *  `x-user-email` a mano, así que este archivo tampoco PUEDE reescribirla.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { PlatformError, contextoDePeticion, responderError } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import { CATALOGO, DISPARADORES } from './catalog';
import { proponer } from './assist';
import { encolar } from './queue';
import * as servicio from './service';

export const router: Router = Router();

function responder(res: Response, err: unknown): void {
  // Un 403 de aislamiento no es un incidente; un TypeError sí.
  if (!PlatformError.is(err)) console.error('[flows] error no controlado', err);
  responderError(res, err);
}

/** La envoltura que evita repetir el try/catch en cada ruta. */
function ruta(manejador: (ctx: TenantContext, req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response): void => {
    void (async () => {
      try {
        const ctx = await contextoDePeticion(req);
        res.json(await manejador(ctx, req, res));
      } catch (err) {
        responder(res, err);
      }
    })();
  };
}

const cuerpo = <T>(req: Request): T => (req.body ?? {}) as T;
const entero = (v: unknown, porDefecto: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : porDefecto;
};

// ── Salud y catálogo ─────────────────────────────────────────────────────────

/** No pide contexto: dice si el paquete está vivo, no datos de nadie. */
router.get('/_status', (_req, res) => {
  res.json({ ready: true, port: 'flows', owner: 'H8 · packages/flows' });
});

/**
 * La paleta del builder. Es el MISMO catálogo que ejecuta el motor y que
 * alimenta el prompt del asistente: una sola lista, tres consumidores.
 */
router.get('/catalogo', (_req, res) => {
  res.json({ nodos: CATALOGO, disparadores: DISPARADORES });
});

/** Etapas y equipo reales, para los selectores del builder. */
router.get(
  '/catalogo/empresa',
  ruta((ctx) => servicio.catalogoDelTenant(ctx)),
);

// ── Corridas ─────────────────────────────────────────────────────────────────
// Va ANTES de `/:id`: si no, Express tomaría "runs" como el id de un flujo.

/**
 * La foto de una corrida. **Es el endpoint del panel en vivo**, que lo pide
 * cada segundo.
 *
 * `Cache-Control: no-store` no es decoración: sin él, un proxy intermedio
 * puede servir la misma foto durante todo el minuto y el panel se vería
 * congelado mientras la corrida avanza de verdad.
 */
router.get(
  '/runs/:id',
  ruta(async (ctx, req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    return servicio.corrida(ctx, String(req.params.id));
  }),
);

router.get(
  '/runs',
  ruta((ctx, req) =>
    servicio.corridas(ctx, {
      ...(typeof req.query.flujo === 'string' ? { flowId: req.query.flujo } : {}),
      limit: entero(req.query.limit, 30),
    }),
  ),
);

// ── Asistente y validación ───────────────────────────────────────────────────

router.post(
  '/asistente',
  ruta((ctx, req) => proponer(ctx, cuerpo<{ descripcion?: string }>(req).descripcion ?? '')),
);

/** Revisa sin guardar: el builder avisa mientras editas. */
router.post(
  '/revisar',
  ruta((ctx, req) => servicio.revisar(ctx, cuerpo(req))),
);

// ── Flujos ───────────────────────────────────────────────────────────────────

router.get(
  '/',
  ruta((ctx) => servicio.listar(ctx)),
);

router.post(
  '/',
  ruta((ctx, req) => servicio.crear(ctx, cuerpo(req))),
);

router.get(
  '/:id',
  ruta((ctx, req) => servicio.obtener(ctx, String(req.params.id))),
);

router.put(
  '/:id',
  ruta((ctx, req) => {
    const b = cuerpo<{ nota?: string }>(req);
    return servicio.guardar(ctx, String(req.params.id), req.body, b.nota);
  }),
);

router.post(
  '/:id/activar',
  ruta((ctx, req) => servicio.activar(ctx, String(req.params.id))),
);

router.post(
  '/:id/pausar',
  ruta((ctx, req) => servicio.pausar(ctx, String(req.params.id))),
);

router.delete(
  '/:id',
  ruta(async (ctx, req) => {
    await servicio.archivar(ctx, String(req.params.id));
    return { ok: true };
  }),
);

/**
 * Probar: enrola UN contacto en ESTE flujo y sólo en éste.
 *
 * Exige admin (lo comprueba el servicio) y marca la corrida como prueba, para
 * que el historial real no se llene de ensayos.
 */
router.post(
  '/:id/probar',
  ruta((ctx, req) =>
    servicio.probar(ctx, String(req.params.id), {
      ...(typeof cuerpo<{ contactId?: string }>(req).contactId === 'string'
        ? { contactId: cuerpo<{ contactId: string }>(req).contactId }
        : {}),
      encolar: encolar(),
    }),
  ),
);

// ── Versiones ────────────────────────────────────────────────────────────────

router.get(
  '/:id/versiones',
  ruta((ctx, req) => servicio.versiones(ctx, String(req.params.id))),
);

/**
 * Volver a una versión anterior. La tabla que en GARDEN nadie leía, leída.
 */
router.post(
  '/:id/versiones/:version/restaurar',
  ruta((ctx, req) =>
    servicio.volverAVersion(ctx, String(req.params.id), entero(req.params.version, 0)),
  ),
);

export default router;
