/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El webhook — donde se rompen todas las integraciones de pago.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Cubre los criterios 2, 3 y 4 del handoff:
 *
 *    2. Un webhook reenviado dos veces NO crea dos tenants.
 *    3. Firma inválida → rechazado y registrado.
 *    4. Si `provision()` falla, el webhook NO devuelve 200.
 *
 *  Las pruebas levantan un servidor de verdad y le hablan por HTTP, con el
 *  MISMO `express.json({ verify })` que monta apps/api. No es ceremonia: la
 *  causa número uno de "todos los webhooks fallan la firma" es que el cuerpo
 *  llega parseado y el HMAC se calcula sobre bytes distintos a los que firmó
 *  Stripe. Una prueba que le pasara el objeto directo a la función nunca
 *  vería ese fallo.
 */
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformError, __clearPorts, __setClientForTests, registerPort } from '@abraxa/db';
import { resetEnvCache } from '@abraxa/config';
import { FakeDb } from './pruebas/fake-db';
import { GatewayDoble, __setGatewayForTests, firmarComoStripe } from './gateway';
import type { SesionDePago } from './gateway';

/** Secreto de firma de juguete. No abre nada: sólo firma los payloads de prueba. */
const SECRETO = 'whsec_prueba_local_no_es_un_secreto_real'; // abraxa-allow-secret

let db: FakeDb;
let doble: GatewayDoble;
let servidor: Server;
let base: string;
let quitarCliente: () => void;
let quitarGateway: () => void;
let provisionLlamadas: Array<{ slug: string; name: string; ownerEmail: string }>;

/** Lo que `provision()` va a hacer en cada prueba. */
let provisionImpl: (i: {
  slug: string;
  name: string;
  ownerEmail: string;
}) => Promise<{ tenantId: string; created: boolean }>;

beforeEach(async () => {
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL = 'https://ejemplo.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'llave-de-servicio-de-prueba-suficientemente-larga';
  process.env.APP_BASE_URL = 'https://mi.abraxa.club';
  process.env.STRIPE_WEBHOOK_SECRET = SECRETO;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.RESEND_API_KEY;
  resetEnvCache();

  db = new FakeDb();
  quitarCliente = __setClientForTests(db as never);

  doble = new GatewayDoble(SECRETO);
  quitarGateway = __setGatewayForTests(doble);

  provisionLlamadas = [];
  provisionImpl = async ({ slug }) => ({ tenantId: `tenant-de-${slug}`, created: true });

  __clearPorts();
  registerPort('tenancy', {
    provision: async (i) => {
      provisionLlamadas.push(i);
      return provisionImpl(i);
    },
    contextFor: async () => {
      throw new Error('no se usa');
    },
    canSignIn: async () => false,
    primaryTenantSlugFor: async () => null,
    listMembers: async () => [],
  });

  // Silencia los `console.warn/error` esperados (modo doble, alta fallida).
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});

  base = await levantar();
});

afterEach(async () => {
  await new Promise<void>((r) => servidor.close(() => r()));
  quitarCliente();
  quitarGateway();
  __clearPorts();
  vi.restoreAllMocks();
});

/**
 * El mismo montaje que `apps/api/src/app.ts`. Se importa el router DESPUÉS de
 * fijar el entorno para que nada lo lea al cargarse.
 */
async function levantar(): Promise<string> {
  const { router } = await import('./http');
  const app = express();

  app.use(
    express.json({
      limit: '2mb',
      verify: (req, _res, buf) => {
        (req as Request & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );
  app.use('/billing', router);
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (PlatformError.is(err)) {
      res.status(err.status).json(err.toResponse());
      return;
    }
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Error interno' } });
  });

  servidor = app.listen(0);
  await new Promise<void>((r) => servidor.once('listening', () => r()));
  return `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
}

// ────────────────────────────────────────────────────────────────────────────

const SESION_PAGADA: SesionDePago = {
  id: 'cs_test_panaderia',
  paymentStatus: 'paid',
  amountTotalCentavos: 2500,
  currency: 'usd',
  customerEmail: 'Lupita@Ejemplo.MX',
  customerId: 'cus_test_lupita',
  subscriptionId: null,
  businessName: 'Panadería Lupita',
  planId: 'pro',
};

/** Un `checkout.session.completed` con la forma que manda Stripe. */
function eventoCheckout(sessionId = SESION_PAGADA.id, id = 'evt_test_1'): string {
  return JSON.stringify({
    id,
    object: 'event',
    type: 'checkout.session.completed',
    created: 1_700_000_000,
    data: { object: { id: sessionId, object: 'checkout.session' } },
  });
}

async function mandarWebhook(cuerpo: string, firma?: string) {
  return fetch(`${base}/billing/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': firma ?? firmarComoStripe(cuerpo, SECRETO),
    },
    body: cuerpo,
  });
}

// ════════════════════════════════════════════════════════════════════════════

describe('el camino feliz', () => {
  it('un pago crea el tenant, la suscripción y deja el evento procesado', async () => {
    doble.sembrarSesion(SESION_PAGADA);

    const r = await mandarWebhook(eventoCheckout());
    const cuerpo = await r.json();

    expect(r.status).toBe(200);
    expect(cuerpo).toMatchObject({ ok: true, slug: 'panaderia-lupita', creado: true });

    expect(provisionLlamadas).toEqual([
      {
        slug: 'panaderia-lupita',
        name: 'Panadería Lupita',
        // El correo se normaliza: `app.users.email` tiene un CHECK que exige
        // minúsculas y sin espacios.
        ownerEmail: 'lupita@ejemplo.mx',
      },
    ]);

    const suscripciones = db.tabla('subscriptions');
    expect(suscripciones).toHaveLength(1);
    expect(suscripciones[0]).toMatchObject({
      tenant_id: 'tenant-de-panaderia-lupita',
      plan_id: 'pro',
      status: 'active',
      amount_usd: 25,
      stripe_customer_id: 'cus_test_lupita',
    });

    const eventos = db.tabla('billing_events');
    expect(eventos).toHaveLength(1);
    expect(eventos[0].processed_at).toBeTruthy();
    expect(eventos[0].error).toBeNull();
  });

  it('registra el evento crudo aunque sea de un tipo que ignora — regla 5', async () => {
    const cuerpo = JSON.stringify({
      id: 'evt_test_ignorado',
      object: 'event',
      type: 'payment_intent.created',
      data: { object: { id: 'pi_test', object: 'payment_intent' } },
    });

    const r = await mandarWebhook(cuerpo);

    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ignorado: 'payment_intent.created' });
    expect(provisionLlamadas).toHaveLength(0);

    const eventos = db.tabla('billing_events');
    expect(eventos).toHaveLength(1);
    expect(eventos[0].type).toBe('payment_intent.created');
    expect(eventos[0].processed_at).toBeTruthy();
  });
});

describe('criterio 3 — firma inválida', () => {
  it('rechaza una firma que no cuadra y no da de alta a nadie', async () => {
    doble.sembrarSesion(SESION_PAGADA);
    const cuerpo = eventoCheckout();

    const r = await mandarWebhook(cuerpo, firmarComoStripe(cuerpo, 'whsec_otro_secreto_distinto')); // abraxa-allow-secret

    expect(r.status).toBe(401);
    expect(provisionLlamadas).toHaveLength(0);
    expect(db.tabla('tenants')).toHaveLength(0);
  });

  it('rechaza si no viene la cabecera', async () => {
    const r = await fetch(`${base}/billing/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: eventoCheckout(),
    });

    expect(r.status).toBe(401);
    expect(provisionLlamadas).toHaveLength(0);
  });

  it('queda registrado en los logs — es la única pista de un intento de fraude', async () => {
    const cuerpo = eventoCheckout();
    await mandarWebhook(cuerpo, 'v1=nada');

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('firma inválida'),
      expect.anything(),
    );
  });

  it('un cuerpo alterado después de firmarlo ya no verifica', async () => {
    const cuerpo = eventoCheckout();
    const firma = firmarComoStripe(cuerpo, SECRETO);

    const alterado = cuerpo.replace('cs_test_panaderia', 'cs_test_del_atacante');
    const r = await mandarWebhook(alterado, firma);

    expect(r.status).toBe(401);
    expect(provisionLlamadas).toHaveLength(0);
  });
});

describe('criterio 2 — idempotencia', () => {
  it('el mismo evento dos veces NO crea dos tenants', async () => {
    doble.sembrarSesion(SESION_PAGADA);
    const cuerpo = eventoCheckout();

    const primera = await mandarWebhook(cuerpo);
    const segunda = await mandarWebhook(cuerpo);

    expect(primera.status).toBe(200);
    expect(segunda.status).toBe(200);
    expect(await segunda.json()).toMatchObject({ duplicado: true });

    // Lo que de verdad importa: provision() se llamó UNA vez.
    expect(provisionLlamadas).toHaveLength(1);
    expect(db.tabla('billing_events')).toHaveLength(1);
    expect(db.tabla('subscriptions')).toHaveLength(1);
  });

  it('dos reintentos simultáneos tampoco pasan los dos', async () => {
    // El caso que un "SELECT y si no está, INSERT" no cubre: Stripe reintenta
    // mientras el primero sigue en vuelo.
    doble.sembrarSesion(SESION_PAGADA);
    const cuerpo = eventoCheckout();

    const [a, b] = await Promise.all([mandarWebhook(cuerpo), mandarWebhook(cuerpo)]);

    expect([a.status, b.status]).toEqual([200, 200]);
    expect(provisionLlamadas).toHaveLength(1);
    expect(db.tabla('subscriptions')).toHaveLength(1);
  });

  it('dos eventos DISTINTOS del mismo pago siguen dando un solo tenant', async () => {
    // La segunda red: `provision()` es idempotente por slug (H2) y la
    // suscripción choca contra UNIQUE (tenant_id).
    doble.sembrarSesion(SESION_PAGADA);
    provisionImpl = async ({ slug }) => ({
      tenantId: `tenant-de-${slug}`,
      created: provisionLlamadas.length === 1,
    });

    await mandarWebhook(eventoCheckout(SESION_PAGADA.id, 'evt_uno'));
    await mandarWebhook(eventoCheckout(SESION_PAGADA.id, 'evt_dos'));

    expect(provisionLlamadas).toHaveLength(2);
    expect(db.tabla('billing_events')).toHaveLength(2);
    // Una sola empresa y una sola suscripción.
    expect(new Set(provisionLlamadas.map((p) => p.slug)).size).toBe(1);
    expect(db.tabla('subscriptions')).toHaveLength(1);
  });
});

describe('criterio 4 — si el alta falla, NO 200', () => {
  it('provision() que truena deja que Stripe reintente', async () => {
    doble.sembrarSesion(SESION_PAGADA);
    provisionImpl = async () => {
      throw new PlatformError('INTERNAL', 'la base no contestó', { retryable: true });
    };

    const r = await mandarWebhook(eventoCheckout());

    expect(r.status).not.toBe(200);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(db.tabla('subscriptions')).toHaveLength(0);
  });

  it('anota el motivo en la bitácora antes de relanzar', async () => {
    doble.sembrarSesion(SESION_PAGADA);
    provisionImpl = async () => {
      throw new PlatformError('CONFLICT', 'el slug ya es de otro dueño');
    };

    await mandarWebhook(eventoCheckout());

    const evento = db.tabla('billing_events')[0];
    expect(evento.error).toContain('el slug ya es de otro dueño');
    expect(evento.processed_at).toBeFalsy();
    expect(evento.attempts).toBe(1);
  });

  it('guardar la suscripción que falla tampoco devuelve 200', async () => {
    // El tenant YA se creó. Si esto devolviera 200, quedaría una empresa sin
    // registro de su cobro y nadie se enteraría.
    doble.sembrarSesion(SESION_PAGADA);
    db.fallarEn = { tabla: 'subscriptions', mensaje: 'se cayó la conexión' };

    const r = await mandarWebhook(eventoCheckout());

    expect(r.status).not.toBe(200);
    expect(db.tabla('billing_events')[0].error).toContain('se cayó la conexión');
  });

  it('una sesión sin pagar no da de alta a nadie', async () => {
    doble.sembrarSesion({ ...SESION_PAGADA, paymentStatus: 'unpaid' });

    const r = await mandarWebhook(eventoCheckout());

    expect(r.status).not.toBe(200);
    expect(provisionLlamadas).toHaveLength(0);
  });

  it('una sesión pagada sin correo grita en vez de inventar un dueño', async () => {
    doble.sembrarSesion({ ...SESION_PAGADA, customerEmail: null });

    const r = await mandarWebhook(eventoCheckout());

    expect(r.status).not.toBe(200);
    expect(provisionLlamadas).toHaveLength(0);
    expect(db.tabla('billing_events')[0].error).toContain('no trae correo');
  });
});

describe('criterio 7 — el correo de bienvenida', () => {
  it('sale DESPUÉS del 200 y con un enlace a la empresa correcta', async () => {
    doble.sembrarSesion(SESION_PAGADA);

    const r = await mandarWebhook(eventoCheckout());
    expect(r.status).toBe(200);

    const { ultimoEnvio } = await import('./http');
    const resultado = await ultimoEnvio;

    // Sin RESEND_API_KEY no sale de verdad, pero sí queda escrito el enlace
    // exacto que habría llevado.
    expect(resultado).toMatchObject({ enviado: false, via: 'doble' });
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('https://mi.abraxa.club/bienvenida?empresa=panaderia-lupita'),
    );
  });

  it('un correo que falla NO tumba un alta que sí funcionó', async () => {
    doble.sembrarSesion(SESION_PAGADA);

    const r = await mandarWebhook(eventoCheckout());

    expect(r.status).toBe(200);
    expect(db.tabla('subscriptions')).toHaveLength(1);
  });
});

describe('el cuerpo crudo', () => {
  it('sin `rawBody` se rechaza en vez de verificar contra bytes equivocados', async () => {
    const { router } = await import('./http');
    const app = express();
    // A propósito SIN el `verify` que guarda el cuerpo: es el error de montaje
    // que hace fallar todos los webhooks legítimos.
    app.use(express.json());
    app.use('/billing', router);
    app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
      res.status(PlatformError.is(err) ? err.status : 500).json({ error: String(err) });
    });

    const s = app.listen(0);
    await new Promise<void>((r) => s.once('listening', () => r()));
    const puerto = (s.address() as AddressInfo).port;

    const cuerpo = eventoCheckout();
    const r = await fetch(`http://127.0.0.1:${puerto}/billing/webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': firmarComoStripe(cuerpo, SECRETO),
      },
      body: cuerpo,
    });

    expect(r.status).toBe(500);
    expect(provisionLlamadas).toHaveLength(0);
    await new Promise<void>((res) => s.close(() => res()));
  });
});
