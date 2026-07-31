/**
 * Rutas HTTP de las integraciones. `apps/api` las monta en `/integrations`.
 *
 * ── Lo que este router NO hace, y es lo importante ─────────────────────────
 *
 * No devuelve un secreto. Nunca. Ni al dueño de la empresa, ni al staff, ni al
 * panel de agencia de H14. Lo que sale es la HUELLA —`••••4821 · a1b2c3d4`—,
 * que sirve para distinguir una credencial de otra sin poder usar ninguna.
 * La prueba que lo hace verdad está en `src/no-filtra.test.ts`: serializa la
 * respuesta completa y busca el texto claro.
 *
 * ── Sobre el contexto ──────────────────────────────────────────────────────
 *
 * Se importa el canónico. Ningún router de dominio escribe su propio
 * `contextoDe`: entre el 2026-07-30 y el 07-31 cuatro carriles lo hicieron y
 * tres dejaron abierta la suplantación de identidad por cabecera. En un router
 * que administra CREDENCIALES eso no sería una fuga de datos: sería entregarle
 * la llave del WhatsApp de un negocio a cualquiera con `curl`.
 *
 * ── Sobre el pendiente de montaje ──────────────────────────────────────────
 *
 * `apps/api/src/packages.ts` es de H1 y no se toca desde este carril, así que
 * este router todavía no está montado. Es una línea para el orquestador, en el
 * §10 del handoff. Mientras tanto la vía real de consumo es la del proceso
 * —`useIntegrations()`—, que es como lo van a llamar H6, H12 y H13 de todos
 * modos.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { PlatformError, contextoDePeticion, responderError } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import { hayLlave } from './crypto/secret-box';
import { useIntegrations } from './port-registration';

export const router: Router = Router();

function responder(res: Response, err: unknown): void {
  // Un 403 de aislamiento no es un incidente; un `TypeError` sí. Sólo lo
  // segundo merece una línea de bitácora.
  if (!PlatformError.is(err)) console.error('[integrations] error no controlado', err);
  responderError(res, err);
}

/** Envoltura para no repetir el try/catch en cada ruta. */
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

/**
 * No pide contexto: dice si el paquete está vivo, no datos de nadie.
 *
 * `keyConfigured` es la respuesta a la pregunta que se hace a las 3 de la
 * mañana: "¿por qué no puedo conectar nada?". Dice SI hay llave, jamás cuál.
 */
router.get('/_status', (_req, res) => {
  res.json({
    ready: true,
    port: 'integrations',
    owner: 'H17 · packages/integrations',
    keyConfigured: hayLlave(),
  });
});

/** El catálogo con la política de respaldo. Público dentro de la sesión: no
 *  hay nada de ninguna empresa aquí. */
router.get('/providers', (_req, res) => {
  res.json(useIntegrations().providers());
});

// ── Las integraciones de la empresa ──────────────────────────────────────────

router.get(
  '/',
  ruta((ctx, req) =>
    useIntegrations().list(ctx, {
      provider: typeof req.query.provider === 'string' ? req.query.provider : undefined,
      includeRevoked: req.query.revocadas === 'true',
    }),
  ),
);

router.get(
  '/eventos',
  ruta((ctx, req) =>
    useIntegrations().events(ctx, {
      integrationId: typeof req.query.integracion === 'string' ? req.query.integracion : undefined,
      limit: entero(req.query.limit, 50),
    }),
  ),
);

/**
 * Conectar o reconectar.
 *
 * Exige rol `admin` u `owner`: una credencial de canal es la llave del teléfono
 * del negocio. Es el mismo criterio con el que H15 protege fusionar contactos
 * y H8 activar un flujo — y aquí pesa más, porque quien la cambia puede
 * desviar las conversaciones del negocio entero.
 */
router.post(
  '/',
  ruta((ctx, req) => {
    exigirAdmin(ctx, 'conectar una integración');
    const b = cuerpo<{
      provider: string;
      label?: string;
      secret?: string;
      config?: Record<string, unknown>;
      externalAccountId?: string | null;
      expiresAt?: string | null;
      verify?: boolean;
    }>(req);

    return useIntegrations().save(ctx, {
      provider: String(b.provider ?? ''),
      label: b.label,
      secret: b.secret,
      config: b.config,
      externalAccountId: b.externalAccountId,
      expiresAt: b.expiresAt,
      verify: b.verify,
      actor: ctx.userEmail ?? undefined,
    });
  }),
);

router.get(
  '/:id',
  ruta(async (ctx, req) => {
    const una = await useIntegrations().get(ctx, String(req.params.id));
    // El mismo 404 para "no existe" y para "es de otra empresa": distinguirlos
    // convertiría esta ruta en un oráculo de qué ids existen en la plataforma.
    if (!una) throw new PlatformError('NOT_FOUND', 'No existe esa integración en esta empresa');
    return una;
  }),
);

/** Comprobar bajo demanda, que es el botón "volver a probar" de la pantalla. */
router.post(
  '/:id/verificar',
  ruta((ctx, req) => useIntegrations().verify(ctx, String(req.params.id))),
);

router.post(
  '/:id/revocar',
  ruta(async (ctx, req) => {
    exigirAdmin(ctx, 'revocar una integración');
    await useIntegrations().revoke(ctx, String(req.params.id), {
      actor: ctx.userEmail ?? undefined,
    });
    return { ok: true };
  }),
);

function exigirAdmin(ctx: TenantContext, accion: string): void {
  if (ctx.role !== 'admin' && ctx.role !== 'owner') {
    throw new PlatformError(
      'FORBIDDEN',
      `${accion} exige rol admin: una credencial de canal es la llave del teléfono y del ` +
        'correo del negocio, y cambiarla desvía las conversaciones de todos.',
    );
  }
}
