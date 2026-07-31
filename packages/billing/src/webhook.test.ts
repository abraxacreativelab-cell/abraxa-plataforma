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
import { crearProvisionDoble, type ProvisionDoble } from './pruebas/tenancy-doble';
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

/**
 * El doble de `provision()`. Escribe de verdad en `db.tabla('tenants')` y
 * aplica la regla del dueño de la migración 011 — ver `pruebas/tenancy-doble.ts`
 * para la historia larga de por qué el doble anterior dejó pasar un bug alto.
 */
let tenancy: ProvisionDoble;
let provisionLlamadas: Array<{ slug: string; name: string; ownerEmail: string }>;

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

  tenancy = crearProvisionDoble(db);
  provisionLlamadas = tenancy.llamadas;

  __clearPorts();
  registerPort('tenancy', {
    provision: (i) => tenancy.provision(i),
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
    expect(suscripciones[0]!).toMatchObject({
      tenant_id: 'tenant-de-panaderia-lupita',
      plan_id: 'pro',
      status: 'active',
      // Cifra y moneda, juntas. Ver «la moneda viaja con la cifra».
      amount: 25,
      currency: 'usd',
      stripe_customer_id: 'cus_test_lupita',
    });

    // Y la empresa quedó en el plan que pagó, no en el de cortesía.
    expect(db.tabla('tenants')[0]!.plan).toBe('pro');

    const eventos = db.tabla('billing_events');
    expect(eventos).toHaveLength(1);
    expect(eventos[0]!.processed_at).toBeTruthy();
    expect(eventos[0]!.error).toBeNull();
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
    expect(eventos[0]!.type).toBe('payment_intent.created');
    expect(eventos[0]!.processed_at).toBeTruthy();
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
    // La segunda red: `provision()` es idempotente por slug PARA EL MISMO
    // DUEÑO (H2) y la suscripción choca contra UNIQUE (tenant_id).
    doble.sembrarSesion(SESION_PAGADA);

    await mandarWebhook(eventoCheckout(SESION_PAGADA.id, 'evt_uno'));
    await mandarWebhook(eventoCheckout(SESION_PAGADA.id, 'evt_dos'));

    expect(provisionLlamadas).toHaveLength(2);
    expect(db.tabla('billing_events')).toHaveLength(2);
    // Una sola empresa y una sola suscripción. Ahora se afirma contra la
    // tabla, no contra los argumentos de las llamadas: es la fila la que
    // demuestra que no se creó una empresa de más.
    expect(db.tabla('tenants')).toHaveLength(1);
    expect(db.tabla('tenants')[0]!.slug).toBe('panaderia-lupita');
    expect(db.tabla('subscriptions')).toHaveLength(1);
  });
});

describe('el reproceso NO puede crear una segunda empresa', () => {
  /*
   * ── El defecto que estas pruebas cierran ──────────────────────────────────
   *
   * El carril descubrió, con razón, que un alta que quedó a medias no se puede
   * dar por buena sólo porque la fila del evento exista, y abrió a propósito el
   * camino de reproceso. Ese camino NO era idempotente:
   *
   *   `derivarSlug()` volvía a preguntarle a la base si `panaderia-lupita`
   *   estaba ocupado, la base decía que SÍ —lo había ocupado el intento
   *   anterior— y el reproceso creaba `panaderia-lupita-2`: una segunda
   *   empresa, para un solo pago de $25.
   *
   * No lo vio nadie porque el `provision()` falso nunca escribía en la tabla
   * `tenants` del doble, así que "¿ocupado?" contestaba `false` siempre y la
   * aserción «sigue habiendo una sola empresa» era cierta del doble y falsa de
   * Postgres.
   */

  it('un alta que murió a la mitad se REPROCESA en la misma empresa, no en una nueva', async () => {
    doble.sembrarSesion(SESION_PAGADA);

    // 1er intento: el tenant se crea y el upsert de la suscripción se cae.
    db.fallarEn = { tabla: 'subscriptions', mensaje: 'se cayó a la mitad' };
    const primera = await mandarWebhook(eventoCheckout());

    expect(primera.status).not.toBe(200);
    expect(db.tabla('tenants')).toHaveLength(1);
    expect(db.tabla('subscriptions')).toHaveLength(0);

    // Stripe reintenta EL MISMO evento (o soporte lo reenvía a mano).
    const segunda = await mandarWebhook(eventoCheckout());
    const cuerpo = await segunda.json();

    expect(segunda.status).toBe(200);
    // Lo único que importa: UNA empresa, la misma, con el slug que la landing
    // le prometió en la vista previa.
    expect(db.tabla('tenants')).toHaveLength(1);
    expect(db.tabla('tenants')[0]!.slug).toBe('panaderia-lupita');
    expect(cuerpo).toMatchObject({
      slug: 'panaderia-lupita',
      tenantId: 'tenant-de-panaderia-lupita',
      // No es un alta nueva: es la misma empresa, terminada.
      creado: false,
    });
    // Y la suscripción quedó colgada del tenant que sí existe.
    expect(db.tabla('subscriptions')).toHaveLength(1);
    expect(db.tabla('subscriptions')[0]!.tenant_id).toBe('tenant-de-panaderia-lupita');
  });

  it('tres fallos seguidos NO dejan tres empresas', async () => {
    doble.sembrarSesion(SESION_PAGADA);

    for (let i = 0; i < 3; i++) {
      db.fallarEn = { tabla: 'subscriptions', mensaje: `blip ${i}` };
      const r = await mandarWebhook(eventoCheckout());
      expect(r.status).not.toBe(200);
    }

    const final = await mandarWebhook(eventoCheckout());

    expect(final.status).toBe(200);
    expect(db.tabla('tenants')).toHaveLength(1);
    expect(db.tabla('subscriptions')).toHaveLength(1);
    // Y el correo de bienvenida sigue llevando al slug correcto.
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('https://mi.abraxa.club/bienvenida?empresa=panaderia-lupita'),
    );
  });

  it('el correo del reproceso NO manda a la persona a una empresa distinta', async () => {
    doble.sembrarSesion(SESION_PAGADA);

    db.fallarEn = { tabla: 'subscriptions', mensaje: 'se cayó a la mitad' };
    await mandarWebhook(eventoCheckout());
    await mandarWebhook(eventoCheckout());

    const { ultimoEnvio } = await import('./http');
    await ultimoEnvio;

    const enlaces = vi
      .mocked(console.warn)
      .mock.calls.flat()
      .filter((a): a is string => typeof a === 'string' && a.includes('/bienvenida?empresa='));

    expect(enlaces.length).toBeGreaterThan(0);
    for (const enlace of enlaces) {
      expect(enlace).toContain('empresa=panaderia-lupita');
      expect(enlace).not.toContain('panaderia-lupita-2');
    }
  });

  it('pero un slug de OTRO dueño sí saca al que paga al siguiente sufijo', async () => {
    // La resolución de colisiones no se pierde: sólo deja de dispararse
    // contra uno mismo. Otra empresa ya se llama así.
    tenancy.sembrarEmpresa({ slug: 'panaderia-lupita', ownerEmail: 'otra@ejemplo.mx' });
    doble.sembrarSesion(SESION_PAGADA);

    const r = await mandarWebhook(eventoCheckout());
    const cuerpo = await r.json();

    expect(r.status).toBe(200);
    expect(cuerpo).toMatchObject({ slug: 'panaderia-lupita-2', creado: true });
    expect(db.tabla('tenants')).toHaveLength(2);
    // Y el intento contra el slug ajeno quedó registrado: se probó y la base
    // lo rechazó, que es justo el orden que se quería.
    expect(provisionLlamadas.map((p) => p.slug)).toEqual([
      'panaderia-lupita',
      'panaderia-lupita-2',
    ]);
  });

  it('si TODOS los candidatos son de otros, no se inventa nada: falla y lo ve un humano', async () => {
    tenancy.cuando(async () => {
      throw new PlatformError('CONFLICT', 'El slug ya está tomado por otra empresa.');
    });
    doble.sembrarSesion(SESION_PAGADA);

    const r = await mandarWebhook(eventoCheckout());

    expect(r.status).toBe(409);
    expect(db.tabla('subscriptions')).toHaveLength(0);
    expect(db.tabla('billing_events')[0]!.error).toContain('ningún slug libre');
    expect(db.tabla('billing_events')[0]!.processed_at).toBeFalsy();
  });

  it('un fallo que NO es de slug se relanza tal cual — no manda a crear una empresa con sufijo', async () => {
    // Sin esto, un blip de red disfrazado de colisión llevaría a
    // `panaderia-lupita-2` de todas formas.
    tenancy.cuando(async () => {
      throw new PlatformError('INTERNAL', 'la base no contestó', { retryable: true });
    });
    doble.sembrarSesion(SESION_PAGADA);

    const r = await mandarWebhook(eventoCheckout());

    expect(r.status).toBe(500);
    // UNA sola llamada: no se recorrieron los 100 candidatos.
    expect(provisionLlamadas).toHaveLength(1);
    expect(db.tabla('billing_events')[0]!.error).toContain('la base no contestó');
  });
});

describe('la moneda viaja con la cifra', () => {
  /*
   * ── El defecto (hallazgo B del PR #11) ────────────────────────────────────
   *
   * `normalizarSesion()` leía `currency` de la sesión, la ponía en el objeto
   * … y ahí se moría. El monto se escribía en una columna que se llamaba
   * `amount_usd` pasara lo que pasara. Una sesión de $500 MXN quedaba escrita
   * como `amount_usd = 500`: veinte veces el ingreso real, en la columna de la
   * que sale cualquier reporte de facturación.
   *
   * Nuestro checkout crea los precios en `MONEDA` y sólo en `MONEDA`. Pero el
   * webhook procesa la sesión que Stripe le manda, no la que nosotros creímos
   * crear — es el mismo motivo por el que `validarSesion()` desconfía del
   * `businessName`. Y el día que la landing cobre en pesos (está anotado como
   * decisión de producto pendiente), el bug se activa solo y en silencio.
   *
   * Rechazar la sesión no era opción: el dinero ya entró, y negarle la cuenta
   * a quien pagó es el estado que la regla 1 del handoff prohíbe. Así que se
   * registra lo que de verdad pasó — cifra Y moneda, juntas o ninguna.
   */

  it('la moneda del camino feliz queda ESCRITA, no supuesta', async () => {
    doble.sembrarSesion(SESION_PAGADA);

    await mandarWebhook(eventoCheckout());

    expect(db.tabla('subscriptions')[0]!).toMatchObject({ amount: 25, currency: 'usd' });
  });

  it('una sesión en pesos NO se guarda como si fueran dólares', async () => {
    doble.sembrarSesion({ ...SESION_PAGADA, currency: 'mxn', amountTotalCentavos: 50_000 });

    const r = await mandarWebhook(eventoCheckout());

    expect(r.status).toBe(200);
    const fila = db.tabla('subscriptions')[0]!;
    expect(fila).toMatchObject({ amount: 500, currency: 'mxn' });
    // Y no queda ningún rastro de la columna que mentía.
    expect(fila.amount_usd).toBeUndefined();
  });

  it('deja constancia en los logs de que se cobró fuera de la moneda del catálogo', async () => {
    doble.sembrarSesion({ ...SESION_PAGADA, currency: 'mxn', amountTotalCentavos: 50_000 });

    await mandarWebhook(eventoCheckout());

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("moneda 'mxn'"));
  });

  it('una moneda sin centavos no se divide entre 100', async () => {
    // ¥3000 son 3000 yenes, no ¥30. Stripe manda el entero en la unidad mínima
    // de cada moneda, y en las de cero decimales esa unidad ES la moneda.
    doble.sembrarSesion({ ...SESION_PAGADA, currency: 'jpy', amountTotalCentavos: 3000 });

    await mandarWebhook(eventoCheckout());

    expect(db.tabla('subscriptions')[0]!).toMatchObject({ amount: 3000, currency: 'jpy' });
  });

  it('sin cifra tampoco hay moneda: las dos columnas van juntas o ninguna', async () => {
    doble.sembrarSesion({ ...SESION_PAGADA, amountTotalCentavos: null, currency: null });

    const r = await mandarWebhook(eventoCheckout());

    expect(r.status).toBe(200);
    expect(db.tabla('subscriptions')[0]!).toMatchObject({ amount: null, currency: null });
  });

  it('una moneda con forma rara no revienta el INSERT con el pago ya cobrado', async () => {
    // El CHECK de ISO-4217 de la migración es el que reventaría, y el alta
    // entraría en un bucle de reintentos de Stripe del que no se puede salir.
    // Mejor una fila sin monto: el importe sigue entero en el payload.
    doble.sembrarSesion({ ...SESION_PAGADA, currency: 'dólares' });

    const r = await mandarWebhook(eventoCheckout());

    expect(r.status).toBe(200);
    expect(db.tabla('subscriptions')[0]!).toMatchObject({ amount: null, currency: null });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('ISO-4217'));
  });

  it('una cifra sin moneda tampoco se guarda a medias', async () => {
    // El CHECK de la migración lo impediría; esto es que no lleguemos a él.
    doble.sembrarSesion({ ...SESION_PAGADA, currency: null });

    await mandarWebhook(eventoCheckout());

    expect(db.tabla('subscriptions')[0]!).toMatchObject({ amount: null, currency: null });
  });
});

describe('quien paga NO se queda en el plan de cortesía', () => {
  /*
   * ── El defecto (hallazgo C del PR #11) ────────────────────────────────────
   *
   * `provision()` da de alta con `p_plan DEFAULT 'free'` y el `TenancyPort` no
   * tiene por dónde pedirle otro. El alta la llamaba sin plan, así que quien
   * pagaba quedaba con TRES verdades distintas a la vez:
   *
   *   app.tenants.plan       = 'free'   ← la que consulta `assertQuota()`
   *   app.subscriptions.plan_id = 'pro' ← la que dice el cobro
   *   el recibo de Stripe     = "ABRAXA Pro"
   *
   * La que manda en el producto es la primera: el que pagó por 10 asientos se
   * topa con el límite de 2 del plan gratis y escribe a soporte con el recibo
   * en la mano.
   */

  it('el tenant queda en el plan que PAGÓ', async () => {
    doble.sembrarSesion(SESION_PAGADA);

    const r = await mandarWebhook(eventoCheckout());

    expect(r.status).toBe(200);
    expect(db.tabla('tenants')[0]!.plan).toBe('pro');
    expect(db.tabla('subscriptions')[0]!.plan_id).toBe('pro');
  });

  it('si el plan no se puede escribir, NO hay 200 — Stripe reintenta', async () => {
    // Un 200 aquí dejaría a un cliente pagando `pro` y usando `free` sin que
    // nadie se entere hasta que reclame.
    doble.sembrarSesion(SESION_PAGADA);
    db.fallarEn = { tabla: 'tenants', mensaje: 'no hay conexión' };

    const r = await mandarWebhook(eventoCheckout());

    expect(r.status).not.toBe(200);
    expect(db.tabla('billing_events')[0]!.error).toContain('no hay conexión');
    expect(db.tabla('billing_events')[0]!.processed_at).toBeFalsy();
  });

  it('el reproceso de un alta a medias también deja el plan correcto', async () => {
    doble.sembrarSesion(SESION_PAGADA);

    db.fallarEn = { tabla: 'subscriptions', mensaje: 'se cayó a la mitad' };
    await mandarWebhook(eventoCheckout());
    const segunda = await mandarWebhook(eventoCheckout());

    expect(segunda.status).toBe(200);
    expect(db.tabla('tenants')).toHaveLength(1);
    expect(db.tabla('tenants')[0]!.plan).toBe('pro');
  });
});

describe('criterio 4 — si el alta falla, NO 200', () => {
  it('provision() que truena deja que Stripe reintente', async () => {
    doble.sembrarSesion(SESION_PAGADA);
    tenancy.cuando(async () => {
      throw new PlatformError('INTERNAL', 'la base no contestó', { retryable: true });
    });

    const r = await mandarWebhook(eventoCheckout());

    expect(r.status).not.toBe(200);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(db.tabla('subscriptions')).toHaveLength(0);
    expect(db.tabla('tenants')).toHaveLength(0);
  });

  it('anota el motivo en la bitácora antes de relanzar', async () => {
    doble.sembrarSesion(SESION_PAGADA);
    tenancy.cuando(async () => {
      throw new PlatformError('INTERNAL', 'la conexión con la base se cortó');
    });

    await mandarWebhook(eventoCheckout());

    const evento = db.tabla('billing_events')[0]!;
    expect(evento.error).toContain('la conexión con la base se cortó');
    expect(evento.processed_at).toBeFalsy();
    expect(evento.attempts).toBe(1);
  });

  it('un alta que quedó a MEDIAS se completa en el reintento, no se da por buena', async () => {
    // El agujero por el que se cuela la regla 4 disfrazada de regla 2:
    // el evento se registra ANTES de procesarlo, así que un primer intento
    // que muere a la mitad deja la fila escrita y sin terminar. Si el
    // reintento sólo mirara "¿duplicado?", contestaría 200 y la empresa se
    // quedaría para siempre sin su registro de cobro.
    doble.sembrarSesion(SESION_PAGADA);
    db.fallarEn = { tabla: 'subscriptions', mensaje: 'se cayó a la mitad' };

    const primera = await mandarWebhook(eventoCheckout());
    expect(primera.status).not.toBe(200);
    expect(db.tabla('subscriptions')).toHaveLength(0);

    // Stripe reintenta el MISMO evento.
    const segunda = await mandarWebhook(eventoCheckout());

    expect(segunda.status).toBe(200);
    // Y esta vez sí terminó.
    expect(db.tabla('subscriptions')).toHaveLength(1);
    expect(db.tabla('billing_events')[0]!.processed_at).toBeTruthy();
    // Sigue habiendo UNA sola empresa. Se afirma contra la TABLA, no contra
    // los argumentos de las llamadas: la versión anterior de esta aserción
    // miraba `provisionLlamadas` y por eso pasaba en verde con el bug puesto.
    expect(db.tabla('tenants')).toHaveLength(1);
    expect(db.tabla('tenants')[0]!.slug).toBe('panaderia-lupita');
  });

  it('guardar la suscripción que falla tampoco devuelve 200', async () => {
    // El tenant YA se creó. Si esto devolviera 200, quedaría una empresa sin
    // registro de su cobro y nadie se enteraría.
    doble.sembrarSesion(SESION_PAGADA);
    db.fallarEn = { tabla: 'subscriptions', mensaje: 'se cayó la conexión' };

    const r = await mandarWebhook(eventoCheckout());

    expect(r.status).not.toBe(200);
    expect(db.tabla('billing_events')[0]!.error).toContain('se cayó la conexión');
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
    expect(db.tabla('billing_events')[0]!.error).toContain('no trae correo');
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
