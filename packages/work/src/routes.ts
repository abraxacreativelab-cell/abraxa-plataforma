/**
 * Rutas HTTP de tareas y proyectos. `apps/api` ya las monta en `/work`.
 *
 * ── Sobre el contexto ───────────────────────────────────────────────────────
 *
 * `TenantContext` se arma con `TenancyPort.contextFor()` desde una sesión
 * verificada server-side. Ese port es de H2; mientras no aterrice, `usePort`
 * lanza `PORT_NOT_IMPLEMENTED` diciendo a quién se espera, y estas rutas
 * responden 501. Eso es lo correcto: leer el tenant de un header que mandó el
 * navegador y seguir adelante es exactamente cómo se cuela un agujero de
 * aislamiento a producción.
 *
 * ── Y sobre por qué la pantalla NO pasa por aquí ────────────────────────────
 *
 * `/tareas` es Next en el servidor: llama a los servicios en proceso con el
 * mismo `TenantContext`, sin dar la vuelta por HTTP. Estas rutas son para los
 * otros clientes —el Tótem, un móvil, una automatización de H8 que quiera algo
 * más que `createTask`— y para poder probar el contrato de la API sin navegador.
 */
import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { HEADER } from '@abraxa/config';
import { PlatformError, usePort } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import { meta } from './meta';
import * as projects from './services/projects';
import * as tasks from './services/tasks';
import * as views from './services/views';
import { listMembers } from './services/members';
import { loadWorkspace } from './services/workspace';

export const router: Router = Router();

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
  return usePort('tenancy').contextFor({ userEmail, tenantSlug });
}

/**
 * Un parámetro de ruta que de verdad llegó.
 *
 * Puede venir como arreglo: los tipos de Express declaran `string | string[]`
 * porque un patrón con el mismo nombre repetido captura varios valores. No
 * pasa en las rutas de aquí abajo, pero el tipo lo contempla y quedarse con el
 * primero es lo correcto — nunca `String(valor)`, que convertiría `['a','b']`
 * en el id `"a,b"` y acabaría en un 404 imposible de entender.
 */
function param(req: Request, nombre: string): string {
  const crudo = req.params[nombre];
  const valor = Array.isArray(crudo) ? crudo[0] : crudo;
  if (!valor) throw new PlatformError('VALIDATION', `Falta el parámetro ${nombre}`);
  return valor;
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
  (req: Request, res: Response, next: NextFunction): void => {
    void (async () => {
      try {
        const ctx = await contextoDe(req);
        const salida = await handler(ctx, req, res);
        if (!res.headersSent) res.json(salida);
      } catch (err) {
        // El manejador de errores de `apps/api` traduce `PlatformError` a su
        // código HTTP y nunca filtra `details` hacia afuera.
        next(err);
      }
    })();
  };

// ── Salud ───────────────────────────────────────────────────────────────────

router.get('/_status', (_req, res) => {
  res.json({ ready: meta.ready, handoff: meta.handoff, limits: { tasks: tasks.LIMITE_TAREAS } });
});

// ── Todo lo que pinta la pantalla, de un viaje ──────────────────────────────

router.get('/workspace', ruta((ctx) => loadWorkspace(ctx)));
router.get('/members', ruta((ctx) => listMembers(ctx)));

// ── Tareas ──────────────────────────────────────────────────────────────────

router.get('/tasks', ruta((ctx) => tasks.listTasks(ctx)));

// `/tasks/reorder` va ANTES que `/tasks/:id`, o Express lo enruta como un id.
router.post('/tasks/reorder', ruta((ctx, req) => tasks.reorder(ctx, req.body)));

router.post(
  '/tasks',
  ruta(async (ctx, req, res) => {
    const task = await tasks.createTask(ctx, req.body);
    res.status(201).json(task);
    return null;
  }),
);

router.get('/tasks/:id', ruta((ctx, req) => tasks.getTask(ctx, param(req, 'id'))));
router.patch('/tasks/:id', ruta((ctx, req) => tasks.updateTask(ctx, param(req, 'id'), req.body)));

router.delete(
  '/tasks/:id',
  ruta(async (ctx, req) => {
    await tasks.deleteTask(ctx, param(req, 'id'));
    return { ok: true };
  }),
);

/** La salida del 409. Cierra las subtareas abiertas y el padre, o no cierra
 *  nada: es una sola transacción. */
router.post('/tasks/:id/complete-all', ruta((ctx, req) => tasks.completeAll(ctx, param(req, 'id'))));

router.post(
  '/tasks/:id/comments',
  ruta(async (ctx, req, res) => {
    const comentario = await tasks.addComment(ctx, param(req, 'id'), req.body);
    res.status(201).json(comentario);
    return null;
  }),
);

// ── Proyectos ───────────────────────────────────────────────────────────────

router.get('/projects', ruta(async (ctx) => ({ projects: await projects.listProjects(ctx) })));

router.post(
  '/projects',
  ruta(async (ctx, req, res) => {
    res.status(201).json(await projects.createProject(ctx, req.body));
    return null;
  }),
);

router.patch('/projects/:id', ruta((ctx, req) => projects.updateProject(ctx, param(req, 'id'), req.body)));
router.delete('/projects/:id', ruta((ctx, req) => projects.deleteProject(ctx, param(req, 'id'))));

// ── Vistas guardadas ────────────────────────────────────────────────────────

router.get('/views', ruta(async (ctx) => ({ views: await views.listViews(ctx) })));

router.post(
  '/views',
  ruta(async (ctx, req, res) => {
    res.status(201).json(await views.createView(ctx, req.body));
    return null;
  }),
);

router.get('/views/:id', ruta((ctx, req) => views.getView(ctx, param(req, 'id'))));
router.patch('/views/:id', ruta((ctx, req) => views.updateView(ctx, param(req, 'id'), req.body)));

router.delete(
  '/views/:id',
  ruta(async (ctx, req) => {
    await views.deleteView(ctx, param(req, 'id'));
    return { ok: true };
  }),
);
