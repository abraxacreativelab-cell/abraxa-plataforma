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
 * verificada server-side. Mientras el port de H2 no esté registrado, estas
 * rutas responden 501 nombrando a quién se está esperando — eso lo hace
 * `usePort` de H1 solo.
 *
 * Lo que NO se hace es leer el tenant de un header y seguir adelante: ese 403
 * es lo único que impide que el cliente A lea los datos del B, y una ruta que
 * "mientras tanto" confía en el navegador es exactamente cómo se cuela un
 * agujero de aislamiento a producción.
 *
 * ── El 501 no es una defensa (H0, 2026-07-31) ──────────────────────────────
 *
 * Este archivo leía `x-user-email` crudo y se lo pasaba a `usePort('tenancy')`.
 * Respondía 501 porque el port no estaba registrado, así que "no pasaba nada".
 * El día que mergeó el PR #6 (H2), `registerPort('tenancy')` empezó a
 * funcionar y ESA MISMA LÍNEA habría servido datos reales de un tenant
 * autenticados por un header que cualquiera pone con `curl`. El PR #12 la
 * cerró antes de que se activara.
 *
 * ── Y por qué ya no hay un `contextoDe` aquí (H0, 2026-07-31) ──────────────
 *
 * Porque el PR #12 arregló ESTE archivo, y la auditoría encontró el mismo
 * agujero escrito de nuevo desde cero en otros tres carriles: H6 (PR #10),
 * H7 (PR #8) y H4 —que ya estaba en `main` sirviendo la bóveda—. Cuatro
 * carriles reescribiendo el mismo resolvedor no es descuido: es que el patrón
 * correcto no estaba disponible como pieza importable.
 *
 * Ahora lo está. `contextoDePeticion(req)` de `@abraxa/db` hace las tres
 * puertas en orden —proxy verificado, identidad presente, membresía validada
 * por H2— y es la ÚNICA forma correcta de convertir una petición en contexto.
 * Ningún router de dominio escribe el suyo. Ver
 * `packages/db/src/http/tenant-context.ts` y `routes.test.ts`.
 */
import { Router } from 'express';
import { contextoDePeticion, responderError } from '@abraxa/db';
import { estadoPresupuesto } from './ledger/budget';
import { listarDefiniciones, sembrarAgentes } from './definitions/repository';
import { toolRegistry } from './tools/registry';

export const router: Router = Router();

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
      const ctx = await contextoDePeticion(req);
      res.json({ agents: await listarDefiniciones(ctx) });
    } catch (err) {
      responderError(res, err);
    }
  })();
});

/** Consumo y presupuesto del mes. Es la vista que evita la sorpresa a fin de mes. */
router.get('/budget', (req, res) => {
  void (async () => {
    try {
      const ctx = await contextoDePeticion(req);
      res.json(await estadoPresupuesto(ctx));
    } catch (err) {
      responderError(res, err);
    }
  })();
});

/** Siembra los cinco agentes por defecto. Lo llama H2 al aprovisionar. */
router.post('/seed', (req, res) => {
  void (async () => {
    try {
      const ctx = await contextoDePeticion(req);
      const body = req.body as { masterName?: string } | undefined;
      const opts = body?.masterName ? { nombreDelMaestro: body.masterName } : undefined;
      res.json(await sembrarAgentes(ctx, opts));
    } catch (err) {
      responderError(res, err);
    }
  })();
});
