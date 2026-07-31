/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El endpoint por el que entra un mensaje real.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *      POST /inbox/webhooks/:channelId?token=…
 *
 *  Es la única ruta del producto que se atiende SIN sesión, y por eso es la que
 *  más cuidado lleva:
 *
 *  · El token se verifica en tiempo constante contra `config.webhook_token` del
 *    canal (`channels/lookup.ts`). Un canal sin token se rechaza: fail-closed.
 *  · La empresa NO se lee de nada que mande quien llama. Sale de la fila del
 *    canal, que es lo que el token acaba de probar que se tiene derecho a usar.
 *  · **Se responde 200 aunque la ingesta falle**, y eso es a propósito. El
 *    proveedor reintrega el LOTE ENTERO ante un no-200, así que un error en un
 *    mensaje raro se llevaría por delante a los que sí entraron bien. La
 *    idempotencia por `external_id` cubre el reintento legítimo; el 500 sólo
 *    agrega ruido y respuestas duplicadas.
 *
 *  Las dos excepciones son 401 y 404: ahí no hay nada que reintentar y decirlo
 *  claro le ahorra a alguien media tarde de depurar por qué "el webhook no
 *  hace nada".
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { PlatformError } from '@abraxa/db';
import { resolverCanalDeWebhook } from '../channels/lookup';
import { ingerirWebhook } from '../ingest';
import { log } from '../logger';

export const webhooksRouter: Router = Router();

/** Ping del proveedor para verificar que la URL existe. */
webhooksRouter.get('/webhooks/:channelId', (_req, res) => {
  res.json({ ok: true });
});

webhooksRouter.post('/webhooks/:channelId', (req: Request, res: Response) => {
  void (async () => {
    const channelId = String(req.params.channelId ?? '');
    const token = tokenDe(req);

    let canal;
    try {
      canal = await resolverCanalDeWebhook(channelId, token);
    } catch (err) {
      if (PlatformError.is(err)) {
        res.status(err.status).json(err.toResponse());
        return;
      }
      res.status(500).json({ error: { code: 'INTERNAL', message: 'Error interno' } });
      return;
    }

    // A partir de aquí, 200 pase lo que pase. Ver el encabezado.
    try {
      const r = await ingerirWebhook(canal, {
        channelId: canal.id,
        payload: req.body,
        headers: req.headers as Record<string, string | undefined>,
      });

      const contestados = r.mensajes.filter((m) => m.ai?.outcome === 'answered').length;
      const repetidos = r.mensajes.filter((m) => m.duplicado).length;
      if (r.mensajes.length > 0) {
        log.info(
          `webhook ${canal.name}: ${r.mensajes.length} mensaje(s), ` +
            `${repetidos} repetido(s), ${contestados} contestado(s) por la IA`,
        );
      }

      res.json({
        ok: true,
        received: r.mensajes.length,
        duplicated: repetidos,
        answered: contestados,
      });
    } catch (err) {
      log.error(`webhook del canal ${canal.id} falló: ${String(err)}`);
      res.json({ ok: true, received: 0, error: 'ingesta fallida, registrada en el log' });
    }
  })();
});

/**
 * El token, de la query o de una cabecera.
 *
 * Evolution lo manda en la URL porque es lo único que su configuración de
 * webhook permite. Meta y Twilio firman cabeceras. Se aceptan las dos formas
 * para que H12 y H13 no tengan que tocar esta ruta.
 */
function tokenDe(req: Request): string {
  const query = req.query?.token;
  if (typeof query === 'string' && query.length > 0) return query;

  const cabecera = req.header('x-webhook-token');
  if (cabecera) return cabecera;

  const auth = req.header('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();

  return '';
}
