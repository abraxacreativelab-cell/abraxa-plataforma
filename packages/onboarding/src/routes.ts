/**
 * Rutas HTTP del Ritual. `apps/api` ya las monta en `/onboarding`.
 *
 * ── Sobre el contexto ──────────────────────────────────────────────────────
 *
 * `TenantContext` se arma con `contextoDePeticion(req)` de `@abraxa/db`, y NO
 * con un resolvedor escrito aquí. Ésa es la única forma correcta: hace las tres
 * puertas en orden —proxy verificado, identidad presente, membresía validada
 * por H2— y ninguna se puede saltar por accidente.
 *
 * ── Por qué ya no hay un `contextoDe` en este archivo (auditoría PR #8) ────
 *
 * Este archivo tenía el suyo, y estaba mal de la misma forma en que lo estaban
 * los de otros tres carriles: leía `x-user-email` crudo y se lo pasaba a
 * `usePort('tenancy').contextFor()` SIN comprobar antes el secreto compartido
 * del BFF. Un header es texto libre; lo pone cualquiera con un `curl`. Lo único
 * que hacía que "no pasara nada" era que el port de H2 todavía no estaba
 * registrado — y H2 mergeó (PR #6). Es decir: la defensa no era el código, era
 * un accidente de calendario que ya venció.
 *
 * Con la cabecera forjada, un atacante habría podido leer el Ritual completo de
 * cualquier empresa: su giro, su ticket, su margen, sus dolores y su
 * conversación literal con el agente. Y además ESCRIBIR en él.
 *
 * La pieza canónica cierra eso en un solo archivo para los catorce carriles.
 * Ver `packages/db/src/http/tenant-context.ts` y `routes.test.ts`.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { PlatformError, contextoDePeticion, responderError } from '@abraxa/db';
import { FASES, FICHAS } from './interview/fases';
import { tieneMarcadores } from './interview/marcadores';
import { log } from './logger';
import { haySink } from './ports/blueprint-sink';
import { fotoDelRitual, iniciar, pausar, responder } from './session/ritual';
import { aplicarBlueprintsPendientes, blueprintVigente } from './synthesis/blueprint';

export const router: Router = Router();

/**
 * Responde el error y, si no era del catálogo, lo deja escrito.
 *
 * La traducción a HTTP la hace `responderError` de `@abraxa/db` —que nunca
 * filtra `details` internos—; lo único propio de aquí es el log, que existe
 * porque un 500 silencioso en el Ritual es media hora de entrevista perdida sin
 * rastro de por qué.
 */
function fallar(res: Response, err: unknown): void {
  if (!PlatformError.is(err)) {
    log.error(`error no controlado en una ruta del Ritual: ${String(err)}`);
  }
  responderError(res, err);
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
    void fn(req, res).catch((err: unknown) => fallar(res, err));
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
    res.json(await fotoDelRitual(await contextoDePeticion(req)));
  }),
);

/** Arranca el Ritual, o produce el saludo de regreso si venía a medias. */
router.post(
  '/ritual/iniciar',
  manejar(async (req, res) => {
    const r = await iniciar(await contextoDePeticion(req));
    res.json({ ...r, mensaje: sinMarcadores(r.mensaje) });
  }),
);

/**
 * Un turno de la entrevista.
 *
 * `turnoId` es la llave de idempotencia del ENVÍO, y llega del navegador. Se
 * valida su forma antes de usarlo: es texto libre que viene de fuera, y lo que
 * hace con él el motor es compararlo contra una columna `uuid`. Un id con
 * cualquier otra forma se ignora —el turno se procesa normal, sin protección de
 * reenvío— en vez de reventar la petición: perder la idempotencia es peor que
 * un 400, pero mucho mejor que tirarle el turno en la cara a quien escribió.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.post(
  '/ritual/turno',
  manejar(async (req, res) => {
    const body = req.body as { texto?: unknown; turnoId?: unknown } | undefined;
    const texto = typeof body?.texto === 'string' ? body.texto : '';
    const crudo = typeof body?.turnoId === 'string' ? body.turnoId.trim() : '';
    const turnoId = UUID.test(crudo) ? crudo : undefined;

    if (crudo && !turnoId) {
      log.warn(`llegó un turnoId con forma inválida y se ignoró: ${crudo.slice(0, 60)}`);
    }

    const r = await responder(await contextoDePeticion(req), texto, { turnoId });
    res.json({ ...r, mensaje: sinMarcadores(r.mensaje) });
  }),
);

/** "Guardar y seguir después". */
router.post(
  '/ritual/pausa',
  manejar(async (req, res) => {
    res.json({ vista: await pausar(await contextoDePeticion(req)) });
  }),
);

/** El Mapa de Negocio vigente. */
router.get(
  '/ritual/mapa',
  manejar(async (req, res) => {
    const mapa = await blueprintVigente(await contextoDePeticion(req));
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
    const aplicados = await aplicarBlueprintsPendientes(await contextoDePeticion(req));
    res.json({ aplicados, sink: haySink() ? 'registrado' : 'pendiente' });
  }),
);
