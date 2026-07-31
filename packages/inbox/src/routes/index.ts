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
 *
 * ── Y la membresía NO es la identidad (2026-07-31) ─────────────────────────
 *
 * Este archivo cumplía el párrafo de arriba a medias: no se inventaba el
 * tenant, se lo pasaba a `contextFor()` para que H2 validara la membresía. Y
 * eso NO alcanza. `contextFor()` comprueba que ese correo pertenezca a esa
 * empresa; no comprueba que el correo sea de quien está llamando. Con H2 en
 * `main`, bastaba conocer el correo de un miembro y el slug de una empresa
 * —los dos salen en firmas de correo, invitaciones y URLs— para hacer:
 *
 *   curl -H 'x-user-email: …' -H 'x-tenant-slug: …' https://api…/inbox/threads
 *
 * y recibir 200 con la bandeja completa de esa empresa. Con un POST, mandar un
 * WhatsApp real desde su línea. Es el mismo defecto que H0 cerró en
 * `packages/agents/src/routes.ts` (PR #12) el día anterior, y aquí duele más:
 * es la superficie con TODAS las conversaciones de TODOS los clientes, y es el
 * único carril que obliga a que `apps/api` sea alcanzable desde fuera (Evolution
 * tiene que poder hacer POST a `/inbox/webhooks/:id`).
 *
 * ── Cómo se cierra: NO con un resolvedor propio ────────────────────────────
 *
 * H0 aterrizó la pieza canónica en `main` (PR #16) precisamente porque cuatro
 * carriles escribieron cuatro `contextoDe` y tres salieron mal igual. Así que
 * aquí no hay un `contextoDe` de la bandeja: se importa el único.
 *
 *     import { contextoDePeticion } from '@abraxa/db';
 *
 * Trae las tres puertas en el orden correcto —secreto del BFF, identidad
 * presente, membresía por `TenancyPort.contextFor()`— y con ellas cosas que un
 * resolvedor casero de este carril no tenía: normalización del correo a
 * minúsculas y la cabecera repetida resuelta como la resuelve Express (gana la
 * primera), para que mandar `x-user-email` dos veces no deje elegir cuál cuenta.
 * `@abraxa/db` ya era dependencia declarada de `@abraxa/inbox`, así que esto no
 * mueve el `package-lock.json` (que es de H1).
 *
 * Ver `routes/index.test.ts` para el escenario que ahora queda cubierto.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { contextoDePeticion, responderError } from '@abraxa/db';
import type { ChannelType, TenantContext } from '@abraxa/db';
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

/**
 * Dar de baja la línea.
 *
 * Por defecto NO borra el historial: deja el canal `disconnected` y conserva
 * los hilos. `?purge=true` es el borrado destructivo, y hay que pedirlo por su
 * nombre. La respuesta dice siempre cuántos hilos y mensajes había — un
 * `{ ok: true }` a secas fue justo lo que hacía invisible la pérdida.
 */
router.delete(
  '/channels/:id',
  conContexto(async (ctx, req) => {
    const purgar = String(req.query.purge ?? '') === 'true';
    const r = await borrarCanal(ctx, String(req.params.id), { purgar });
    return { ok: true, ...r };
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

/**
 * Envuelve una ruta con el contexto verificado y la traducción de errores.
 *
 * `contextoDePeticion` lanza `UNAUTHENTICATED` si la petición no viene del BFF,
 * `VALIDATION` si falta el slug y `FORBIDDEN` si el correo no es miembro de esa
 * empresa. `responderError` los traduce a HTTP sin filtrar `details`.
 */
function conContexto(fn: Manejador) {
  return (req: Request, res: Response): void => {
    void (async () => {
      try {
        const ctx = await contextoDePeticion(req);
        res.json(await fn(ctx, req));
      } catch (err) {
        responderError(res, err);
      }
    })();
  };
}
