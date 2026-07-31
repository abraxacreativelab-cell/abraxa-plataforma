/**
 * Rutas HTTP de la bandeja. `apps/api` ya las monta en `/inbox`.
 *
 * ── Sobre el contexto ──────────────────────────────────────────────────────
 *
 * Salvo el webhook, TODA ruta de aquí exige un `TenantContext` armado por
 * `TenancyPort.contextFor()` desde una sesión verificada server-side. Ese port
 * es de H2; mientras no aterrice, `usePort` lanza 501 nombrando a quién se está
 * esperando.
 *
 * Lo que NO se hace es leer el tenant de una cabecera y seguir adelante. Ese
 * 403 es lo único que impide que el cliente A lea los hilos del B, y una ruta
 * que "mientras tanto" confía en el navegador es exactamente cómo se cuela un
 * agujero de aislamiento a producción.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { PlatformError, usePort } from '@abraxa/db';
import type { ChannelType, TenantContext } from '@abraxa/db';
import { HEADER } from '@abraxa/config';
import {
  ajustarCanal,
  borrarCanal,
  crearCanal,
  estadoCanal,
  listarCanales,
} from '../channels/service';
import { listDrivers } from '../drivers/registry';
import { contarNoLeidos, listarHilos, verHilo } from '../inbox/queries';
import { createInboxService, enviarEnHilo, pausarIA } from '../inbox/service';
import { webhooksRouter } from './webhooks';

export const router: Router = Router();

// El webhook va primero y no lleva el guardia de sesión.
router.use(webhooksRouter);

const inbox = createInboxService();

/** Salud del carril: qué drivers hay enchufados y por quién. */
router.get('/_status', (_req, res) => {
  res.json({ ready: true, drivers: listDrivers() });
});

// ── Canales ─────────────────────────────────────────────────────────────────

router.get('/channels', conContexto(async (ctx) => ({ channels: await listarCanales(ctx) })));

router.post(
  '/channels',
  conContexto(async (ctx, req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    return {
      channel: await crearCanal(ctx, {
        type: b.type as ChannelType,
        name: String(b.name ?? ''),
        ...(typeof b.driver === 'string' ? { driver: b.driver } : {}),
        ...(b.agentRole ? { agentRole: b.agentRole as 'sales' } : {}),
        ...(b.businessHours ? { businessHours: b.businessHours as never } : {}),
        ...(b.aiOutsideHours !== undefined ? { aiOutsideHours: Boolean(b.aiOutsideHours) } : {}),
      }),
    };
  }),
);

router.get(
  '/channels/:id/status',
  conContexto(async (ctx, req) => estadoCanal(ctx, String(req.params.id))),
);

router.patch(
  '/channels/:id',
  conContexto(async (ctx, req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    return {
      channel: await ajustarCanal(ctx, String(req.params.id), {
        ...(typeof b.name === 'string' ? { name: b.name } : {}),
        ...(b.agentRole ? { agentRole: b.agentRole as 'sales' } : {}),
        ...(b.aiEnabled !== undefined ? { aiEnabled: Boolean(b.aiEnabled) } : {}),
        ...(b.businessHours ? { businessHours: b.businessHours as never } : {}),
        ...(b.aiOutsideHours !== undefined ? { aiOutsideHours: Boolean(b.aiOutsideHours) } : {}),
      }),
    };
  }),
);

router.delete(
  '/channels/:id',
  conContexto(async (ctx, req) => {
    await borrarCanal(ctx, String(req.params.id));
    return { ok: true };
  }),
);

// ── Hilos ───────────────────────────────────────────────────────────────────

router.get(
  '/threads',
  conContexto(async (ctx, req) => ({
    threads: await listarHilos(ctx, {
      ...(req.query.status ? { status: req.query.status as never } : {}),
      ...(req.query.channelId ? { channelId: String(req.query.channelId) } : {}),
    }),
    unread: await contarNoLeidos(ctx),
  })),
);

router.get(
  '/threads/:id',
  conContexto(async (ctx, req) => verHilo(ctx, String(req.params.id))),
);

/** Escribir en el hilo. Si viene `author`, un humano lo toma y la IA se calla. */
router.post(
  '/threads/:id/messages',
  conContexto(async (ctx, req) => {
    const b = (req.body ?? {}) as { body?: string; media?: string[] };
    const { message } = await enviarEnHilo(ctx, {
      threadId: String(req.params.id),
      body: String(b.body ?? ''),
      ...(Array.isArray(b.media) ? { media: b.media } : {}),
      // El correo sale del contexto verificado, NUNCA del cuerpo: si el cliente
      // pudiera declarar quién escribe, podría hacerse pasar por otro y —peor—
      // marcar como humano un mensaje de la IA.
      author: ctx.userEmail,
    });
    return { message };
  }),
);

/** El interruptor que el emprendedor tiene que poder accionar en un clic. */
router.patch(
  '/threads/:id',
  conContexto(async (ctx, req) => {
    const b = (req.body ?? {}) as {
      aiEnabled?: boolean;
      assignedTo?: string | null;
      pauseMinutes?: number;
    };
    const threadId = String(req.params.id);

    if (b.aiEnabled !== undefined) {
      await inbox.setAiEnabled(ctx, { threadId, enabled: Boolean(b.aiEnabled) });
    }
    // Después de `setAiEnabled`, que limpia la pausa al encender: mandar los dos
    // juntos ("enciéndela pero pausada una hora") tiene que dejar la pausa.
    if (b.pauseMinutes !== undefined) {
      await pausarIA(ctx, { threadId, minutos: Number(b.pauseMinutes) });
    }
    if (b.assignedTo !== undefined) {
      await inbox.assign(ctx, { threadId, userEmail: b.assignedTo });
    }
    return verHilo(ctx, threadId);
  }),
);

// ════════════════════════════════════════════════════════════════════════════

type Manejador = (ctx: TenantContext, req: Request) => Promise<unknown>;

/** Envuelve una ruta con el contexto verificado y la traducción de errores. */
function conContexto(fn: Manejador) {
  return (req: Request, res: Response): void => {
    void (async () => {
      try {
        const ctx = await contextoDe(req);
        res.json(await fn(ctx, req));
      } catch (err) {
        if (PlatformError.is(err)) {
          res.status(err.status).json(err.toResponse());
          return;
        }
        res.status(500).json({ error: { code: 'INTERNAL', message: 'Error interno' } });
      }
    })();
  };
}

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
