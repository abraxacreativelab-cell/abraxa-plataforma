/**
 * Rutas HTTP del Ritual. `apps/api` ya las monta en `/onboarding`.
 *
 * ── Sobre el contexto ──────────────────────────────────────────────────────
 *
 * `TenantContext` se arma con `TenancyPort.contextFor()` desde una sesión
 * verificada server-side. Ese port es de H2 y todavía no aterriza, así que
 * estas rutas responden 501 nombrando a quién se espera — eso lo hace `usePort`
 * de H1 solo, sin que aquí haya que escribir nada.
 *
 * Lo que NO se hace es leer el tenant de un header y seguir adelante. Es
 * tentador "mientras tanto", y es exactamente cómo se cuela un agujero de
 * aislamiento a producción: ese 403 es lo único que impide que el cliente A lea
 * los datos del B.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { PlatformError, usePort } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import { HEADER } from '@abraxa/config';
import { FASES, FICHAS } from './interview/fases';
import { tieneMarcadores } from './interview/marcadores';
import { log } from './logger';
import { haySink } from './ports/blueprint-sink';
import { fotoDelRitual, iniciar, pausar, responder } from './session/ritual';
import { aplicarBlueprintsPendientes, blueprintVigente } from './synthesis/blueprint';

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

function responderError(res: Response, err: unknown): void {
  if (PlatformError.is(err)) {
    res.status(err.status).json(err.toResponse());
    return;
  }
  log.error(`error no controlado en una ruta del Ritual: ${String(err)}`);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Error interno' } });
}

/**
 * Guardia del criterio #5.
 *
 * Es redundante con `limpiarMarcadores` a propósito. Un marcador visible es un
 * fallo de producto silencioso —nadie abre un ticket por un corchete raro, sólo
 * se ve poco serio— así que la última frontera antes del navegador lo vuelve a
 * revisar y lo deja escrito en el log si algo se coló.
 */
function sinMarcadores(mensaje: string): string {
  if (mensaje && tieneMarcadores(mensaje)) {
    log.error(`un marcador llegó hasta la ruta. Revisa interview/marcadores.ts: ${mensaje}`);
  }
  return mensaje;
}

const manejar = (fn: (req: Request, res: Response) => Promise<void>) => {
  return (req: Request, res: Response): void => {
    void fn(req, res).catch((err: unknown) => responderError(res, err));
  };
};

// ════════════════════════════════════════════════════════════════════════════

/** Salud del carril. No necesita tenant: sirve para saber qué falta. */
router.get('/_status', (_req, res) => {
  res.json({
    ready: true,
    fases: FASES.map((f) => ({ fase: f, ...FICHAS[f] })),
    blueprintSink: haySink() ? 'registrado' : 'pendiente (H11 · packages/areas)',
  });
});

/**
 * El estado del Ritual, sin gastar un token.
 *
 * Es lo primero que pide la pantalla al cargar. Que no llame al modelo es lo
 * que hace que quien vuelve al día siguiente vea su conversación de inmediato.
 */
router.get(
  '/ritual',
  manejar(async (req, res) => {
    res.json(await fotoDelRitual(await contextoDe(req)));
  }),
);

/** Arranca el Ritual, o produce el saludo de regreso si venía a medias. */
router.post(
  '/ritual/iniciar',
  manejar(async (req, res) => {
    const r = await iniciar(await contextoDe(req));
    res.json({ ...r, mensaje: sinMarcadores(r.mensaje) });
  }),
);

/** Un turno de la entrevista. */
router.post(
  '/ritual/turno',
  manejar(async (req, res) => {
    const body = req.body as { texto?: unknown } | undefined;
    const texto = typeof body?.texto === 'string' ? body.texto : '';
    const r = await responder(await contextoDe(req), texto);
    res.json({ ...r, mensaje: sinMarcadores(r.mensaje) });
  }),
);

/** "Guardar y seguir después". */
router.post(
  '/ritual/pausa',
  manejar(async (req, res) => {
    res.json({ vista: await pausar(await contextoDe(req)) });
  }),
);

/** El Mapa de Negocio vigente. */
router.get(
  '/ritual/mapa',
  manejar(async (req, res) => {
    const mapa = await blueprintVigente(await contextoDe(req));
    if (!mapa) {
      res
        .status(404)
        .json({ error: { code: 'NOT_FOUND', message: 'Este negocio todavía no tiene mapa.' } });
      return;
    }
    res.json(mapa);
  }),
);

/**
 * Proyecta los blueprints que quedaron pendientes.
 *
 * Es el barrido de una pasada que H11 corre el día que registre su
 * `BlueprintSink`. Sin sink registrado devuelve 0 y no hace nada: es idempotente
 * y se puede llamar cuando sea. Ver packages/onboarding/src/ports/blueprint-sink.ts.
 */
router.post(
  '/ritual/proyectar-pendientes',
  manejar(async (req, res) => {
    const aplicados = await aplicarBlueprintsPendientes(await contextoDe(req));
    res.json({ aplicados, sink: haySink() ? 'registrado' : 'pendiente' });
  }),
);
