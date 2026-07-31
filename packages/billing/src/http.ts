/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Las rutas de cobro. Se montan en /billing (apps/api lo hace por nosotros).
 * ════════════════════════════════════════════════════════════════════════════
 *
 *    GET  /billing/plans      catálogo público, lo pinta la landing
 *    POST /billing/checkout   crea la sesión de pago de monto libre
 *    POST /billing/webhook    Stripe nos habla de vuelta ← el archivo entero
 *    POST /billing/alta-gratis  el plan free, contra una sesión verificada
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { env, HEADER, isProduction } from '@abraxa/config';
import { PlatformError, usePort } from '@abraxa/db';
import { z } from 'zod';
import { PLAN_CATALOG, PLAN_DE_PAGO, PLAN_POR_DEFECTO, MONEDA, MONTO } from './catalog';
import { gateway } from './gateway';
import { enlaceDeEntrada, enviarBienvenida } from './correo';
import { altaDesdeSesion, type ResultadoDeAlta } from './service';
import { marcarError, marcarProcesado, registrarEvento, slugOcupado } from './store';
import { derivarSlug } from './slug';

export const router: Router = Router();

/** Envuelve un handler async para que un throw llegue al manejador de errores. */
const asyncH =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };

// ════════════════════════════════════════════════════════════════════════════
// GET /billing/plans — lo que la landing necesita saber
// ════════════════════════════════════════════════════════════════════════════

router.get('/plans', (_req, res) => {
  res.json({
    plans: PLAN_CATALOG.map((p) => ({
      id: p.id,
      name: p.name,
      pitch: p.pitch,
      limits: p.limits,
      position: p.position,
    })),
    // El monto libre lo dibuja el front; que los topes vengan de aquí evita
    // que el formulario y Stripe discrepen sobre el mínimo.
    monto: {
      moneda: MONEDA,
      minimoCentavos: MONTO.MINIMO_CENTAVOS,
      presetCentavos: MONTO.PRESET_CENTAVOS,
      maximoCentavos: MONTO.MAXIMO_CENTAVOS,
    },
    planDePago: PLAN_DE_PAGO,
  });
});

// ════════════════════════════════════════════════════════════════════════════
// POST /billing/checkout
// ════════════════════════════════════════════════════════════════════════════

const CheckoutBody = z.object({
  businessName: z.string().trim().min(2, 'Escribe el nombre de tu negocio.').max(120),
  ownerEmail: z.string().trim().toLowerCase().email().optional(),
});

router.post(
  '/checkout',
  asyncH(async (req, res) => {
    const parsed = CheckoutBody.safeParse(req.body);
    if (!parsed.success) {
      throw new PlatformError(
        'VALIDATION',
        parsed.error.issues[0]?.message ?? 'Datos inválidos.',
      );
    }

    const base = env().APP_BASE_URL.replace(/\/+$/, '');
    const sesion = await gateway().crearCheckout({
      businessName: parsed.data.businessName,
      planId: PLAN_DE_PAGO,
      ...(parsed.data.ownerEmail ? { ownerEmail: parsed.data.ownerEmail } : {}),
      // `{CHECKOUT_SESSION_ID}` lo sustituye Stripe. La página de gracias lo
      // usa para saludar por nombre sin volver a preguntar nada.
      successUrl: `${base}/gracias?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${base}/?cancelado=1`,
    });

    res.json({ sessionId: sesion.id, url: sesion.url, modo: gateway().modo });
  }),
);

// ════════════════════════════════════════════════════════════════════════════
// POST /billing/webhook — las cinco reglas del handoff, en orden
// ════════════════════════════════════════════════════════════════════════════

/** Tipos que este carril procesa. El resto se registra y se ignora. */
const TIPO_ALTA = 'checkout.session.completed';

/**
 * Lo que se hace DESPUÉS de responder 200. Se expone para que las pruebas
 * puedan esperarlo: un `void promesa` no se puede afirmar, y un correo que
 * nadie verifica es un correo que algún día deja de mandarse en silencio.
 */
export let ultimoEnvio: Promise<unknown> = Promise.resolve();

router.post(
  '/webhook',
  asyncH(async (req, res) => {
    // ── Regla 1 · verificar la firma. Siempre. ──────────────────────────────
    //
    // `rawBody` lo guarda `express.json({verify})` de apps/api. Verificar
    // contra `req.body` ya parseado calcula el HMAC sobre bytes distintos a
    // los que firmó Stripe: se caen TODOS los eventos legítimos, y el síntoma
    // parece un problema de secretos.
    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!raw) {
      throw new PlatformError(
        'INTERNAL',
        'El webhook no recibió el cuerpo crudo. apps/api debe montar ' +
          'express.json({ verify }) para conservarlo; sin eso la firma no se ' +
          'puede verificar y no se procesa nada.',
      );
    }

    // Si la firma no cuadra esto lanza 401. No se registra en billing_events:
    // el `event.id` de un payload sin firma válida no es un dato confiable, y
    // escribirlo dejaría que cualquiera llene la tabla desde fuera. Va a los
    // logs, que es donde se investiga un ataque.
    let evento;
    try {
      evento = gateway().verificarEvento(raw, req.header('stripe-signature') ?? '');
    } catch (e) {
      console.error(
        '[billing] webhook RECHAZADO por firma inválida.',
        e instanceof Error ? e.message : e,
      );
      throw e;
    }

    // ── Regla 2 · idempotencia, y regla 5 · registrar TODO ──────────────────
    const { duplicado } = await registrarEvento({
      stripeEventId: evento.id,
      type: evento.type,
      payload: evento.raw,
    });

    if (duplicado) {
      // Stripe reintentó algo que ya procesamos. 200 y nada más: es la
      // respuesta que le dice "ya, deja de mandarlo".
      res.json({ ok: true, duplicado: true });
      return;
    }

    // Los tipos que no nos tocan quedan registrados y cerrados. Se responde
    // 200 porque reintentarlos no cambiaría nada.
    if (evento.type !== TIPO_ALTA) {
      await marcarProcesado(evento.id);
      res.json({ ok: true, ignorado: evento.type });
      return;
    }

    if (!evento.sessionId) {
      await marcarError(evento.id, 'checkout.session.completed sin id de sesión');
      throw new PlatformError('VALIDATION', 'El evento no trae id de sesión de checkout.');
    }

    // ── Regla 4 · si el alta falla, NO 200 ──────────────────────────────────
    //
    // Se anota el motivo y se relanza. El manejador de errores de apps/api lo
    // convierte en 4xx/5xx y Stripe reintenta. Un pago cobrado sin cuenta
    // creada es el peor estado posible: que suene la alarma es el objetivo.
    let alta: ResultadoDeAlta;
    try {
      alta = await altaDesdeSesion(evento.sessionId);
    } catch (e) {
      const motivo = e instanceof Error ? e.message : String(e);
      await marcarError(evento.id, motivo);
      console.error(`[billing] ALTA FALLIDA para el evento ${evento.id}: ${motivo}`);
      throw e;
    }

    await marcarProcesado(evento.id);

    // ── Regla 3 · responder rápido, lo pesado después ───────────────────────
    //
    // La cuenta ya existe, que es lo que condiciona el 200. El correo va
    // después: si Resend está caído, se reenvía a mano — pero no se le pide a
    // Stripe que repita un alta que sí funcionó.
    res.json({ ok: true, tenantId: alta.tenantId, slug: alta.slug, creado: alta.creado });

    ultimoEnvio = enviarBienvenida({
      para: alta.ownerEmail,
      businessName: alta.businessName,
      slug: alta.slug,
      enlace: enlaceDeEntrada(alta.slug),
    }).then((r) => {
      if (!r.enviado) {
        console.error(
          `[billing] el tenant ${alta.slug} quedó creado pero SIN correo de ` +
            `bienvenida (${r.motivo}). Reenvíaselo: ${enlaceDeEntrada(alta.slug)}`,
        );
      }
      return r;
    });
  }),
);

// ════════════════════════════════════════════════════════════════════════════
// POST /billing/alta-gratis — el plan free
// ════════════════════════════════════════════════════════════════════════════

/**
 * ── Por qué esto exige una sesión verificada ───────────────────────────────
 *
 * El plan free no pasa por Stripe, así que no hay un pago que pruebe quién es
 * la persona. Sin esa prueba, un endpoint que acepte `{email}` del cuerpo es
 * una máquina de crear empresas a nombre de cualquiera.
 *
 * El correo sale del contrato BFF→API que documenta H2 (§7): la cabecera
 * `x-user-email` sólo se acepta si viene acompañada del secreto compartido, y
 * en producción, sin secreto configurado, se rechaza todo. Fail-closed.
 *
 * El login con Google es de H18. Hasta que aterrice, esta ruta está cableada y
 * probada pero nadie la puede llamar desde el navegador — que es exactamente
 * como debe estar.
 */
function correoDeSesionVerificada(req: Request): string {
  const e = env();
  const secreto = e.PROXY_SECRET;

  if (!secreto) {
    if (isProduction()) {
      throw new PlatformError(
        'UNAUTHENTICATED',
        'PROXY_SECRET no está configurado. En producción la vía de cabeceras se ' +
          'rechaza: sin secreto, cualquiera puede afirmar ser cualquiera.',
      );
    }
    // En desarrollo se deja pasar para poder probar el flujo sin montar el
    // BFF. Se avisa, porque el día que esto corra en un servidor expuesto con
    // NODE_ENV mal puesto, el aviso en los logs es la única pista.
    console.warn('[billing] PROXY_SECRET ausente: se confía en x-user-email (sólo desarrollo).');
  } else if (!secretoValido(req.header(HEADER.proxySecret), secreto)) {
    throw new PlatformError('UNAUTHENTICATED', 'Secreto de proxy inválido.');
  }

  const correo = (req.header(HEADER.userEmail) ?? '').trim().toLowerCase();
  if (!correo) {
    throw new PlatformError(
      'UNAUTHENTICATED',
      'Falta la sesión. Inicia sesión antes de crear tu espacio.',
    );
  }
  return correo;
}

/** Comparación en tiempo constante. `===` sobre un secreto filtra su longitud
 *  y, con suficientes intentos, su contenido. */
function secretoValido(recibido: string | undefined, esperado: string): boolean {
  if (!recibido) return false;
  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const AltaGratisBody = z.object({
  businessName: z.string().trim().min(2, 'Escribe el nombre de tu negocio.').max(120),
});

router.post(
  '/alta-gratis',
  asyncH(async (req, res) => {
    const ownerEmail = correoDeSesionVerificada(req);

    const parsed = AltaGratisBody.safeParse(req.body);
    if (!parsed.success) {
      throw new PlatformError('VALIDATION', parsed.error.issues[0]?.message ?? 'Datos inválidos.');
    }

    const slug = await derivarSlug(parsed.data.businessName, slugOcupado);
    const { tenantId, created } = await usePort('tenancy').provision({
      slug,
      name: parsed.data.businessName,
      ownerEmail,
    });

    // Sin suscripción: el plan free no cobra, y `provision()` ya lo asigna.
    // Una fila en `app.subscriptions` con amount 0 sólo ensuciaría el reporte
    // de ingresos con clientes que nunca pagaron.
    res.json({ tenantId, slug, creado: created, plan: PLAN_POR_DEFECTO });

    ultimoEnvio = enviarBienvenida({
      para: ownerEmail,
      businessName: parsed.data.businessName,
      slug,
      enlace: enlaceDeEntrada(slug),
    });
  }),
);
