/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Rutas HTTP de áreas, mapa y roadmap. `apps/api` ya las monta en `/areas`.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  ── El contexto NO se arma aquí ────────────────────────────────────────────
 *
 *  Entre el 2026-07-30 y el 07-31, CINCO carriles escribieron cada uno su
 *  propio resolvedor de contexto a partir de las cabeceras, y cuatro salieron
 *  mal de la misma manera: leían `x-user-email` sin comprobar antes el secreto
 *  compartido del BFF, que es lo único que hace que esa cabecera signifique
 *  algo. Uno llegó a `main` sirviendo la bóveda a cualquiera con `curl`.
 *
 *  Aquí se importa la pieza canónica: `contextoDePeticion(req)` de `@abraxa/db`
 *  hace las tres puertas en orden —proxy verificado ANTES de mirar identidad,
 *  identidad presente, membresía validada por H2— y falla cerrada en producción
 *  sin `PROXY_SECRET`. Ningún router de dominio escribe el suyo, y ESLint marca
 *  la lectura directa de esas cabeceras fuera de la pieza. Este archivo no mira
 *  una sola cabecera.
 *
 *  Y no es teórico: `apps/api/src/packages.ts` monta este router en `/areas` y
 *  H2 ya mergeó, así que `registerPort('tenancy')` corre. Dos cabeceras
 *  inventadas bastarían para abrirle áreas a la empresa de otro.
 *
 *  ── Los permisos son los de H2 ─────────────────────────────────────────────
 *
 *  El RBAC por área ya existe (`app.area_grants` + `loadAreaGrants`), y llega
 *  resuelto en `ctx.areas`. Los servicios lo consultan con `accessFor()`, que
 *  respeta el comodín `'*'` de owner/admin y niega por defecto. Aquí no hay un
 *  segundo modelo de permisos ni un guard paralelo.
 *
 *  ── Y por qué la pantalla NO pasa por aquí ─────────────────────────────────
 *
 *  `/mapa` es Next en el servidor: llama a los servicios en proceso con el mismo
 *  `TenantContext`, sin dar la vuelta por HTTP. Estas rutas son para los otros
 *  clientes —el Tótem, un móvil, el ritual de H7— y para poder probar el
 *  contrato de la API sin navegador.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { PlatformError, contextoDePeticion, responderError } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import { meta } from './meta';
import * as areas from './services/areas';
import * as milestones from './services/milestones';
import * as onboarding from './services/onboarding';

export const router: Router = Router();

/**
 * Un parámetro de ruta que de verdad llegó.
 *
 * Puede venir como arreglo: los tipos de Express declaran `string | string[]`
 * porque un patrón con el mismo nombre repetido captura varios valores.
 * Quedarse con el primero es lo correcto — nunca `String(valor)`, que
 * convertiría `['a','b']` en el slug `"a,b"` y acabaría en un 404 raro.
 */
function param(req: Request, nombre: string): string {
  const crudo = req.params[nombre];
  const valor = Array.isArray(crudo) ? crudo[0] : crudo;
  if (!valor) throw new PlatformError('VALIDATION', `Falta el parámetro ${nombre}`);
  return valor;
}

/** El cuerpo, como objeto. Un `null` o un arreglo no es un cuerpo válido. */
function cuerpo(req: Request): Record<string, unknown> {
  const b: unknown = req.body;
  return typeof b === 'object' && b !== null && !Array.isArray(b)
    ? (b as Record<string, unknown>)
    : {};
}

/**
 * Un solo envoltorio para todas las rutas.
 *
 * Express 4 no captura el rechazo de una promesa: un `async` que lanza deja la
 * petición colgada hasta el timeout. Por eso ninguna ruta de abajo es `async`
 * directamente — todas pasan por aquí.
 */
const ruta =
  (handler: (ctx: TenantContext, req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response): void => {
    void (async () => {
      try {
        // Las tres puertas. Nada de este archivo mira una cabecera.
        const ctx = await contextoDePeticion(req);
        const salida = await handler(ctx, req, res);
        if (!res.headersSent) res.json(salida);
      } catch (err) {
        if (!res.headersSent) responderError(res, err);
      }
    })();
  };

// ── Salud ───────────────────────────────────────────────────────────────────

router.get('/_status', (_req, res) => {
  res.json({
    ready: meta.ready,
    handoff: meta.handoff,
    limits: { areas: areas.LIMITE_AREAS, milestones: milestones.LIMITE_HITOS },
  });
});

// ── El mapa ─────────────────────────────────────────────────────────────────

/** Lo que H5 necesita para pintar la navegación (criterio 8). */
router.get('/', ruta((ctx) => areas.listAreas(ctx)));

/** Todo lo que la pantalla del mapa necesita, de un viaje. */
router.get('/map', ruta((ctx) => areas.loadMap(ctx)));

/** Siembra desde la plantilla del giro. Idempotente: la puede llamar H7 al
 *  cerrar el ritual sin comprobar antes si ya se sembró. */
router.post('/seed', ruta((ctx) => areas.seedTenant(ctx)));

// ── Hitos ───────────────────────────────────────────────────────────────────
//
// Van ANTES de `/:slug`, o Express enruta `milestones` como un slug de área.

router.get('/milestones', ruta((ctx) => milestones.listMilestones(ctx)));

router.post(
  '/milestones',
  ruta(async (ctx, req, res) => {
    const hito = await milestones.createMilestone(ctx, cuerpo(req));
    res.status(201).json(hito);
    return null;
  }),
);

router.post('/milestones/reorder', ruta((ctx, req) => milestones.reorderMilestones(ctx, cuerpo(req).ids)));

/** Le pide al agente maestro que proponga el roadmap. No borra lo que ya hay. */
router.post('/milestones/propose', ruta((ctx) => milestones.proposeMilestones(ctx)));

router.patch(
  '/milestones/:id',
  ruta((ctx, req) => milestones.updateMilestone(ctx, param(req, 'id'), cuerpo(req))),
);

router.delete(
  '/milestones/:id',
  ruta((ctx, req) => milestones.deleteMilestone(ctx, param(req, 'id'))),
);

// ── Un área ─────────────────────────────────────────────────────────────────

router.get('/:slug', ruta((ctx, req) => areas.getArea(ctx, param(req, 'slug'))));

router.post('/:slug/unlock', ruta((ctx, req) => areas.unlockArea(ctx, param(req, 'slug'))));

router.post('/:slug/lock', ruta((ctx, req) => areas.lockArea(ctx, param(req, 'slug'))));

/** El emprendedor declara algo que ninguna tabla puede contar — "voy a
 *  contratar" —, y eso puede abrir el área en esta misma petición. */
router.post(
  '/:slug/declare',
  ruta((ctx, req) => {
    const b = cuerpo(req);
    return areas.declare(ctx, param(req, 'slug'), String(b.key ?? ''), b.value !== false);
  }),
);

// ── El mini-onboarding del área ─────────────────────────────────────────────

router.get(
  '/:slug/onboarding',
  ruta((ctx, req) => onboarding.getOnboarding(ctx, param(req, 'slug'))),
);

router.post(
  '/:slug/onboarding/start',
  ruta((ctx, req) => onboarding.start(ctx, param(req, 'slug'))),
);

router.post(
  '/:slug/onboarding/answer',
  ruta((ctx, req) => {
    const b = cuerpo(req);
    return onboarding.answer(ctx, param(req, 'slug'), b.key, b.answer);
  }),
);

router.post(
  '/:slug/onboarding/finish',
  ruta((ctx, req) => onboarding.finish(ctx, param(req, 'slug'))),
);
