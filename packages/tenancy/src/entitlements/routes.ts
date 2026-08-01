/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Las rutas de H16. Las consume `/ajustes/plan`.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ── Quién pide ──────────────────────────────────────────────────────────────
 *
 * `contextoDePeticion(req)` de `@abraxa/db`, y nada más. Es la única forma
 * correcta de convertir una petición en un `TenantContext`: hace `proxyVerified()`
 * ANTES de mirar una sola cabecera de identidad, falla cerrado en producción sin
 * `PROXY_SECRET`, y valida la membresía contra H2.
 *
 * Este carril no escribe su propio `contextoDe` y no copia el de nadie. Entre
 * el 2026-07-30 y el 07-31, CUATRO carriles escribieron el suyo y TRES salieron
 * mal de la misma manera; uno llegó a `main` sirviendo la bóveda a cualquiera
 * con `curl` (CONTRIBUTING.md §"Quién pide"). El patrón correcto ya existe como
 * pieza importable y ésta es la quinta vez que NO se reescribe.
 *
 * ── Este router todavía no está montado ────────────────────────────────────
 *
 * `apps/api/src/packages.ts` es de H1 y `packages/tenancy/src/index.ts` es de
 * H2: ninguno de los dos se toca desde aquí. Montarlo es una línea, anotada
 * como enganche en el PR. Mientras tanto la pantalla entra en `sin-cablear`,
 * que es la respuesta honesta — ver `_lib/datos.ts`.
 */
import { Router } from 'express';
import { contextoDePeticion, responderError, PlatformError } from '@abraxa/db';
import { LIMITE_HISTORIAL_PLAN } from './config';
import { entitlementDetailsFor } from './can';
import { planHistoryFor, pausesFor, setUserPause } from './lifecycle';
import { usageFor, type ConsumosConocidos } from './uso';
import { planFor } from '../services/plans';
import { findTenantById } from '../db/queries';
import type { QuotaKey } from '../types';

export const entitlementsRouter: Router = Router();

/** Las llaves de cuota que un llamador puede reportar por query string. */
const CUOTAS: readonly QuotaKey[] = [
  'maxSeats',
  'maxContacts',
  'maxChannels',
  'maxFlows',
  'maxAgents',
  'monthlyAiUsd',
];

/**
 * Consumos que otro carril reporta por query (`?maxContacts=412`).
 *
 * Existe para que H15 pueda hacer que su contador aparezca en la pantalla el
 * día que quiera, con un parámetro y sin que H16 lea su tabla. Se ignora todo
 * lo que no sea un número finito y no negativo: un valor basura pintaría un
 * dato falso, y un dato falso en la pantalla de plan es peor que un hueco
 * declarado.
 */
function consumosDe(query: Record<string, unknown>): ConsumosConocidos {
  const salida: ConsumosConocidos = {};
  for (const k of CUOTAS) {
    const crudo = query[k];
    if (crudo === undefined) continue;
    const n = Number(crudo);
    if (Number.isFinite(n) && n >= 0) salida[k] = n;
  }
  return salida;
}

/**
 * `GET /entitlements/plan` — todo lo que pinta la pantalla, en una petición.
 *
 * Una sola llamada y no cuatro a propósito: los cuatro bloques cuentan la misma
 * historia y verlos aparecer de uno en uno hace que la pantalla parezca estar
 * cargando para siempre.
 */
entitlementsRouter.get('/plan', (req, res) => {
  void (async () => {
    try {
      const ctx = await contextoDePeticion(req);

      const [features, uso, pausas, historial] = await Promise.all([
        entitlementDetailsFor(ctx),
        usageFor(ctx, consumosDe(req.query as Record<string, unknown>)),
        pausesFor(ctx),
        planHistoryFor(ctx, LIMITE_HISTORIAL_PLAN),
      ]);

      /*
       * El nombre del plan se resuelve al final y dentro de su propio `catch`.
       *
       * Es lo menos importante de la respuesta y lo único que puede faltar sin
       * que la pantalla deje de servir: se puede vivir sin saber que tu plan se
       * llama "Pro", no sin saber qué incluye. Que un catálogo incompleto se
       * lleve los otros cuatro bloques sería cambiar un dato cosmético por toda
       * la información útil.
       */
      let plan: { id: string; name: string } | null = null;
      try {
        const fila = await planFor((await findTenantById(ctx.tenantId))?.plan ?? 'free');
        plan = { id: fila.id, name: fila.name };
      } catch {
        plan = null;
      }

      res.json({ plan, features, uso, pausas, historial });
    } catch (err) {
      responderError(res, err);
    }
  })();
});

/**
 * `POST /entitlements/pausas` — el emprendedor pausa o reactiva algo suyo.
 *
 * Es la contraparte del botón del tercer bloque de la pantalla. La pausa que
 * escribe lleva `paused_by='user'`, y por eso una reactivación de plan no se la
 * lleva por delante — ver `lifecycle.ts` y el criterio #9.
 */
entitlementsRouter.post('/pausas', (req, res) => {
  void (async () => {
    try {
      const ctx = await contextoDePeticion(req);
      const cuerpo = (req.body ?? {}) as {
        feature?: unknown;
        resourceRef?: unknown;
        paused?: unknown;
        note?: unknown;
      };

      const feature = typeof cuerpo.feature === 'string' ? cuerpo.feature.trim() : '';
      if (!feature) throw new PlatformError('VALIDATION', 'Falta `feature`.');
      if (typeof cuerpo.paused !== 'boolean') {
        throw new PlatformError('VALIDATION', '`paused` tiene que ser true o false.');
      }

      /*
       * Sólo el dueño o un admin. Pausar una función es una decisión de negocio
       * que afecta a toda la empresa: que la pueda tomar un `viewer` sería que
       * cualquiera con acceso de lectura apague el WhatsApp del negocio.
       */
      if (ctx.role !== 'owner' && ctx.role !== 'admin') {
        throw new PlatformError(
          'FORBIDDEN',
          'Sólo el dueño o un administrador pueden pausar una función de la empresa.',
        );
      }

      const cambio = await setUserPause(ctx, {
        feature,
        paused: cuerpo.paused,
        ...(typeof cuerpo.resourceRef === 'string' ? { resourceRef: cuerpo.resourceRef } : {}),
        ...(typeof cuerpo.note === 'string' ? { note: cuerpo.note } : {}),
      });

      res.json({ changed: cambio, pausas: await pausesFor(ctx) });
    } catch (err) {
      responderError(res, err);
    }
  })();
});

