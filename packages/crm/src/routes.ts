/**
 * Rutas HTTP del CRM. `apps/api` las monta en `/crm`.
 *
 * ── Sobre el contexto: ya no hay un `contextoDe` aquí ─────────────────────
 *
 * Lo hubo, y estaba bien escrito: comprobaba `proxyVerified()` ANTES de mirar
 * un solo header, que es justo lo que a tres carriles se les olvidó. Pero era
 * la QUINTA copia de la misma función en el repo, y una copia correcta hoy es
 * una copia que mañana diverge — que fue exactamente lo que pasó entre el
 * 2026-07-30 y el 07-31 con H3, H6, H7 y H4.
 *
 * El PR #16 de H0 puso la pieza en un solo lugar. Se importa:
 *
 *     import { contextoDePeticion, responderError } from '@abraxa/db';
 *
 * Hace las tres puertas en orden —proxy verificado, identidad presente,
 * membresía validada por H2 vía `usePort('tenancy').contextFor()`— y es la
 * ÚNICA forma correcta de convertir una petición en `TenantContext`. Mientras
 * H2 no esté registrado, `usePort` responde 501 nombrando a quién se espera;
 * jamás inventa un contexto. Ver `packages/db/src/http/tenant-context.ts`.
 *
 * `eslint.config.mjs` marca como error leer `x-user-email` / `x-tenant-slug` /
 * `x-proxy-secret` fuera de la pieza canónica, así que este archivo tampoco
 * PUEDE volver a escribir el suyo.
 *
 * ── Sobre el pendiente de montaje ──────────────────────────────────────────
 *
 * `apps/api/src/packages.ts` es de H1 y no se puede tocar desde este carril,
 * así que este router NO está montado todavía. Es una línea para el
 * orquestador y está escrita textual en docs/handoffs/H15-crm.md §9. Hasta
 * entonces la vía real de consumo es la del proceso —`useContacts()`—, que es
 * como lo van a llamar H6 y H8 de todos modos.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { PlatformError, contextoDePeticion, responderError } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import { useContacts } from './port-registration';
import type { IdentityChannel, Lifecycle, UpdateContactInput } from './port';

export const router: Router = Router();

/**
 * Traduce el error a HTTP.
 *
 * Delega en `responderError()` de `@abraxa/db` —que nunca filtra `details`
 * internos— y sólo agrega la línea de bitácora para lo que NO es un
 * `PlatformError`, que es lo único que de verdad hay que ir a mirar. Un 403 de
 * aislamiento no es un incidente; un `TypeError` sí.
 */
function responder(res: Response, err: unknown): void {
  if (!PlatformError.is(err)) console.error('[crm] error no controlado', err);
  responderError(res, err);
}

/** Envoltura para no repetir el try/catch quince veces. */
function ruta(manejador: (ctx: TenantContext, req: Request) => Promise<unknown>) {
  return (req: Request, res: Response): void => {
    void (async () => {
      try {
        const ctx = await contextoDePeticion(req);
        res.json(await manejador(ctx, req));
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

// ── Salud ────────────────────────────────────────────────────────────────────

/** No pide contexto: dice si el paquete está vivo, no datos de nadie. */
router.get('/_status', (_req, res) => {
  res.json({ ready: true, port: 'contacts', owner: 'H15 · packages/crm' });
});

// ── Contactos ────────────────────────────────────────────────────────────────

router.get(
  '/contacts',
  ruta((ctx, req) =>
    useContacts().list(ctx, {
      search: typeof req.query.q === 'string' ? req.query.q : undefined,
      ownerEmail: typeof req.query.owner === 'string' ? req.query.owner : undefined,
      lifecycle: typeof req.query.lifecycle === 'string' ? (req.query.lifecycle as Lifecycle) : undefined,
      tag: typeof req.query.tag === 'string' ? req.query.tag : undefined,
      stageId: typeof req.query.stage === 'string' ? req.query.stage : undefined,
      pipelineId: typeof req.query.pipeline === 'string' ? req.query.pipeline : undefined,
      limit: entero(req.query.limit, 50),
      offset: entero(req.query.offset, 0),
    }),
  ),
);

router.post(
  '/contacts',
  ruta(async (ctx, req) => {
    const b = cuerpo<{
      displayName?: string;
      firstName?: string;
      lastName?: string;
      companyName?: string;
      ownerEmail?: string;
      lifecycle?: Lifecycle;
      source?: string;
      identities?: Array<{ channel: IdentityChannel; identifier: string; display?: string }>;
      tags?: string[];
    }>(req);
    return useContacts().create(ctx, { ...b, actor: ctx.userEmail ?? undefined });
  }),
);

router.get(
  '/contacts/:id',
  ruta(async (ctx, req) => {
    const contacto = await useContacts().get(ctx, String(req.params.id));
    if (!contacto) throw new PlatformError('NOT_FOUND', 'No existe ese contacto');
    return contacto;
  }),
);

router.patch(
  '/contacts/:id',
  ruta(async (ctx, req) => {
    await useContacts().update(ctx, String(req.params.id), {
      ...cuerpo<UpdateContactInput>(req),
      actor: ctx.userEmail ?? undefined,
    });
    return { ok: true };
  }),
);

router.get(
  '/contacts/:id/timeline',
  ruta((ctx, req) =>
    useContacts().timeline(ctx, {
      contactId: String(req.params.id),
      limit: entero(req.query.limit, 50),
      before: typeof req.query.before === 'string' ? req.query.before : undefined,
    }),
  ),
);

router.post(
  '/contacts/:id/identities',
  ruta((ctx, req) =>
    useContacts().addIdentity(ctx, {
      contactId: String(req.params.id),
      identity: cuerpo<{ channel: IdentityChannel; identifier: string }>(req),
      actor: ctx.userEmail ?? undefined,
    }),
  ),
);

router.post(
  '/contacts/:id/tags',
  ruta((ctx, req) =>
    useContacts().addTag(ctx, {
      contactId: String(req.params.id),
      tag: cuerpo<{ tag: string }>(req).tag,
      actor: ctx.userEmail ?? undefined,
    }),
  ),
);

router.delete(
  '/contacts/:id/tags/:tag',
  ruta((ctx, req) =>
    useContacts().removeTag(ctx, {
      contactId: String(req.params.id),
      tag: String(req.params.tag),
      actor: ctx.userEmail ?? undefined,
    }),
  ),
);

router.post(
  '/contacts/:id/owner',
  ruta(async (ctx, req) => {
    await useContacts().assignOwner(ctx, {
      contactId: String(req.params.id),
      ownerEmail: cuerpo<{ ownerEmail: string | null }>(req).ownerEmail ?? null,
      actor: ctx.userEmail ?? undefined,
    });
    return { ok: true };
  }),
);

router.post(
  '/contacts/:id/stage',
  ruta((ctx, req) => {
    const b = cuerpo<{
      stage: string;
      pipeline?: string;
      amount?: number;
      currency?: string;
    }>(req);
    return useContacts().moveStage(ctx, {
      contactId: String(req.params.id),
      stage: b.stage,
      pipeline: b.pipeline,
      amount: b.amount,
      currency: b.currency,
      actor: ctx.userEmail ?? undefined,
    });
  }),
);

// ── Fusión ───────────────────────────────────────────────────────────────────

router.get(
  '/duplicates',
  ruta((ctx, req) => useContacts().findDuplicates(ctx, { limit: entero(req.query.limit, 20) })),
);

/**
 * Fusionar es destructivo a los ojos del emprendedor: dos tarjetas se vuelven
 * una. Exige rol `admin` u `owner` — el mismo criterio con el que H8 protege
 * activar un flujo, y por la misma razón.
 */
router.post(
  '/merge',
  ruta((ctx, req) => {
    if (ctx.role !== 'admin' && ctx.role !== 'owner') {
      throw new PlatformError(
        'FORBIDDEN',
        'Fusionar contactos exige rol admin: junta dos historiales y no hay ' +
          'botón de deshacer en la interfaz.',
      );
    }
    const b = cuerpo<{ winnerId: string; loserId: string }>(req);
    return useContacts().merge(ctx, {
      winnerId: b.winnerId,
      loserId: b.loserId,
      actor: ctx.userEmail ?? undefined,
    });
  }),
);

// ── Embudo ───────────────────────────────────────────────────────────────────

router.get(
  '/pipelines',
  ruta((ctx) => useContacts().listPipelines(ctx)),
);

router.post(
  '/pipelines/seed',
  ruta((ctx) => useContacts().ensureDefaultPipeline(ctx)),
);

router.get(
  '/pipelines/stats',
  ruta((ctx, req) =>
    useContacts().pipelineStats(ctx, {
      pipeline: typeof req.query.pipeline === 'string' ? req.query.pipeline : undefined,
    }),
  ),
);
