/**
 * La frontera con Stripe, contra payloads con la forma REAL.
 *
 * Los payloads de abajo están copiados de la forma que documenta Stripe para
 * `checkout.session.completed`, con los campos que de verdad llegan —incluidos
 * los que no usamos—. Probar contra un objeto de tres campos inventado por
 * nosotros mismos sólo demuestra que sabemos leer nuestro propio objeto.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCache } from '@abraxa/config';
import { GatewayDoble, firmarComoStripe } from './gateway';

const SECRETO = 'whsec_prueba_local_no_es_un_secreto_real'; // abraxa-allow-secret

/** Un `checkout.session.completed` con la forma que manda Stripe de verdad. */
const EVENTO_REAL = {
  id: 'evt_1PxYzAbCdEfGhIjK',
  object: 'event',
  api_version: '2024-12-18.acacia',
  created: 1_735_689_600,
  livemode: false,
  pending_webhooks: 1,
  request: { id: null, idempotency_key: null },
  type: 'checkout.session.completed',
  data: {
    object: {
      id: 'cs_test_a1B2c3D4e5F6g7H8',
      object: 'checkout.session',
      amount_subtotal: 2500,
      amount_total: 2500,
      currency: 'usd',
      customer: 'cus_RabCdEfGhIjKlM',
      customer_email: null,
      customer_details: {
        address: { country: 'MX', city: null, line1: null, line2: null, postal_code: null, state: null },
        email: 'lupita@ejemplo.mx',
        name: 'Lupita Hernández',
        phone: null,
        tax_exempt: 'none',
        tax_ids: [],
      },
      metadata: { businessName: 'Panadería Lupita', planId: 'pro' },
      mode: 'payment',
      payment_intent: 'pi_3PxYzAbCdEfGhIjK',
      payment_status: 'paid',
      status: 'complete',
      subscription: null,
      success_url: 'https://mi.abraxa.club/gracias?session_id={CHECKOUT_SESSION_ID}',
      url: null,
    },
  },
};

beforeEach(() => {
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL = 'https://ejemplo.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'llave-de-servicio-de-prueba-suficientemente-larga';
  process.env.APP_BASE_URL = 'https://mi.abraxa.club';
  resetEnvCache();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('verificación de firma', () => {
  const g = () => new GatewayDoble(SECRETO);

  it('acepta un payload firmado con el secreto correcto', () => {
    const cuerpo = JSON.stringify(EVENTO_REAL);
    const evento = g().verificarEvento(cuerpo, firmarComoStripe(cuerpo, SECRETO));

    expect(evento.id).toBe('evt_1PxYzAbCdEfGhIjK');
    expect(evento.type).toBe('checkout.session.completed');
    expect(evento.sessionId).toBe('cs_test_a1B2c3D4e5F6g7H8');
  });

  it('el doble NO finge la criptografía: rechaza otro secreto', () => {
    const cuerpo = JSON.stringify(EVENTO_REAL);
    expect(() =>
      g().verificarEvento(cuerpo, firmarComoStripe(cuerpo, 'whsec_otro')), // abraxa-allow-secret
    ).toThrow(/inválida/i);
  });

  it('rechaza una firma vencida — Stripe pone tolerancia de 5 minutos', () => {
    const cuerpo = JSON.stringify(EVENTO_REAL);
    const haceUnaHora = Math.floor(Date.now() / 1000) - 3600;
    expect(() => g().verificarEvento(cuerpo, firmarComoStripe(cuerpo, SECRETO, haceUnaHora))).toThrow(
      /inválida/i,
    );
  });

  it('sin signing secret se rechaza TODO — fail-closed', () => {
    const cuerpo = JSON.stringify(EVENTO_REAL);
    const sinSecreto = new GatewayDoble(undefined);

    // Un webhook sin verificar es un endpoint público que crea empresas.
    expect(() => sinSecreto.verificarEvento(cuerpo, firmarComoStripe(cuerpo, SECRETO))).toThrow(
      /STRIPE_WEBHOOK_SECRET/,
    );
  });

  it('acepta el cuerpo como Buffer, que es como llega de express', () => {
    const cuerpo = JSON.stringify(EVENTO_REAL);
    const evento = g().verificarEvento(Buffer.from(cuerpo), firmarComoStripe(cuerpo, SECRETO));
    expect(evento.id).toBe(EVENTO_REAL.id);
  });
});

describe('normalización de la sesión', () => {
  it('un evento que no es de checkout no reporta sessionId', () => {
    const otro = {
      id: 'evt_otro',
      object: 'event',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_123', object: 'payment_intent' } },
    };
    const cuerpo = JSON.stringify(otro);
    const evento = new GatewayDoble(SECRETO).verificarEvento(cuerpo, firmarComoStripe(cuerpo, SECRETO));

    expect(evento.sessionId).toBeNull();
  });
});

describe('el doble del checkout', () => {
  it('devuelve una URL usable en vez de null', async () => {
    // Un `null` aquí rompería el redirect del front por una razón que no tiene
    // nada que ver con el front.
    const doble = new GatewayDoble(SECRETO);
    const s = await doble.crearCheckout({
      businessName: 'Panadería Lupita',
      planId: 'pro',
      successUrl: 'https://mi.abraxa.club/gracias',
      cancelUrl: 'https://mi.abraxa.club/',
    });

    expect(s.url).toContain('https://mi.abraxa.club/gracias');
    expect(s.id).toMatch(/^cs_test_doble_/);
  });

  it('conserva el nombre del negocio y el plan en la sesión', async () => {
    const doble = new GatewayDoble(SECRETO);
    const { id } = await doble.crearCheckout({
      businessName: 'Tacos El Gordo',
      planId: 'pro',
      successUrl: 'https://mi.abraxa.club/gracias',
      cancelUrl: 'https://mi.abraxa.club/',
    });

    const sesion = await doble.recuperarSesion(id);
    expect(sesion).toMatchObject({
      businessName: 'Tacos El Gordo',
      planId: 'pro',
      paymentStatus: 'paid',
    });
  });

  it('rechaza un plan que no está en el catálogo', async () => {
    await expect(
      new GatewayDoble(SECRETO).crearCheckout({
        businessName: 'X',
        planId: 'agency' as never,
        successUrl: 'https://mi.abraxa.club/gracias',
        cancelUrl: 'https://mi.abraxa.club/',
      }),
    ).rejects.toThrow(/catálogo/);
  });

  it('dos sesiones no comparten id', async () => {
    const doble = new GatewayDoble(SECRETO);
    const entrada = {
      businessName: 'X',
      planId: 'pro' as const,
      successUrl: 'https://mi.abraxa.club/gracias',
      cancelUrl: 'https://mi.abraxa.club/',
    };
    const a = await doble.crearCheckout(entrada);
    const b = await doble.crearCheckout(entrada);
    expect(a.id).not.toBe(b.id);
  });
});
