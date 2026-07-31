/**
 * El checkout, el catálogo público y el alta gratis.
 *
 * El alta gratis es la que merece más atención: no pasa por Stripe, así que no
 * hay un pago que pruebe quién es la persona. Un endpoint que acepte el correo
 * del cuerpo sería una máquina de crear empresas a nombre de cualquiera.
 */
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
// `Response` se deja libre a propósito para el de `fetch`: express también
// exporta uno y, sin el alias, `leerJson(r)` pediría un Response de express.
import express, { type NextFunction, type Request, type Response as ResponseExpress } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformError, __clearPorts, __setClientForTests, registerPort } from '@abraxa/db';
import { HEADER, resetEnvCache } from '@abraxa/config';
import { FakeDb } from './pruebas/fake-db';
import { crearProvisionDoble, type ProvisionDoble } from './pruebas/tenancy-doble';
import { GatewayDoble, __setGatewayForTests } from './gateway';

const PROXY = 'secreto-de-proxy-de-prueba-largo';

let db: FakeDb;
let servidor: Server;
let base: string;
let quitarCliente: () => void;
let quitarGateway: () => void;
let tenancy: ProvisionDoble;
let provisionLlamadas: Array<{ slug: string; name: string; ownerEmail: string }>;

beforeEach(async () => {
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL = 'https://ejemplo.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'llave-de-servicio-de-prueba-suficientemente-larga';
  process.env.APP_BASE_URL = 'https://mi.abraxa.club';
  process.env.PROXY_SECRET = PROXY;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.RESEND_API_KEY;
  resetEnvCache();

  db = new FakeDb();
  quitarCliente = __setClientForTests(db as never);
  quitarGateway = __setGatewayForTests(new GatewayDoble(undefined));

  // El doble escribe de verdad en `db.tabla('tenants')` y aplica la regla del
  // dueño de la migración 011: sin eso, `alta-gratis` parece idempotente
  // cuando no lo es. Ver `pruebas/tenancy-doble.ts`.
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

  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});

  const { router } = await import('./http');
  const app = express();
  app.use(express.json());
  app.use('/billing', router);
  app.use((err: unknown, _req: Request, res: ResponseExpress, _next: NextFunction) => {
    if (PlatformError.is(err)) {
      res.status(err.status).json(err.toResponse());
      return;
    }
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Error interno' } });
  });

  servidor = app.listen(0);
  await new Promise<void>((r) => servidor.once('listening', () => r()));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((r) => servidor.close(() => r()));
  quitarCliente();
  quitarGateway();
  __clearPorts();
  vi.restoreAllMocks();
});

const postJson = (ruta: string, cuerpo: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}${ruta}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(cuerpo),
  });

/** `Response.json()` devuelve `unknown` con los tipos de Node 22. Cada prueba
 *  declara la forma que espera, que además documenta el contrato de la ruta. */
const leerJson = async <T>(r: Response): Promise<T> => (await r.json()) as T;

// ════════════════════════════════════════════════════════════════════════════

describe('GET /billing/plans', () => {
  it('publica el catálogo y los topes del monto libre', async () => {
    const r = await fetch(`${base}/billing/plans`);
    const cuerpo = await leerJson<{
      plans: Array<{ id: string }>;
      monto: { minimoCentavos: number };
      planDePago: string;
    }>(r);

    expect(r.status).toBe(200);
    expect(cuerpo.plans.map((p) => p.id)).toEqual(['free', 'pro']);
    expect(cuerpo.monto.minimoCentavos).toBeGreaterThanOrEqual(50);
    expect(cuerpo.planDePago).toBe('pro');
  });

  it('no filtra nada que no sea del catálogo', async () => {
    const r = await fetch(`${base}/billing/plans`);
    const texto = await r.text();
    expect(texto).not.toContain('secreto');
    expect(texto).not.toContain(PROXY);
  });
});

describe('POST /billing/checkout', () => {
  it('crea la sesión y devuelve a dónde mandar al navegador', async () => {
    const r = await postJson('/billing/checkout', { businessName: 'Panadería Lupita' });
    const cuerpo = await leerJson<{ sessionId: string; url: string; modo: string }>(r);

    expect(r.status).toBe(200);
    expect(cuerpo.sessionId).toBeTruthy();
    expect(cuerpo.url).toContain('/gracias');
    expect(cuerpo.modo).toBe('doble');
  });

  it('el nombre del negocio viaja a Stripe: sin él el webhook no sabe de quién es el pago', async () => {
    const doble = new GatewayDoble(undefined);
    quitarGateway();
    quitarGateway = __setGatewayForTests(doble);

    const r = await postJson('/billing/checkout', { businessName: 'Tacos El Gordo' });
    const { sessionId } = await leerJson<{ sessionId: string }>(r);

    const sesion = await doble.recuperarSesion(sessionId);
    expect(sesion.businessName).toBe('Tacos El Gordo');
    expect(sesion.planId).toBe('pro');
  });

  it('rechaza un nombre vacío antes de molestar a Stripe', async () => {
    const r = await postJson('/billing/checkout', { businessName: ' ' });
    expect(r.status).toBe(422);
  });

  it('rechaza un cuerpo sin nombre', async () => {
    const r = await postJson('/billing/checkout', {});
    expect(r.status).toBe(422);
  });
});

describe('POST /billing/alta-gratis', () => {
  const cabeceras = (correo: string) => ({
    [HEADER.userEmail]: correo,
    [HEADER.proxySecret]: PROXY,
  });

  it('da de alta con el plan free contra una sesión verificada', async () => {
    const r = await postJson(
      '/billing/alta-gratis',
      { businessName: 'Panadería Lupita' },
      cabeceras('lupita@ejemplo.mx'),
    );
    const cuerpo = await r.json();

    expect(r.status).toBe(200);
    expect(cuerpo).toMatchObject({ slug: 'panaderia-lupita', plan: 'free' });
    expect(provisionLlamadas).toEqual([
      { slug: 'panaderia-lupita', name: 'Panadería Lupita', ownerEmail: 'lupita@ejemplo.mx' },
    ]);
  });

  it('dos envíos del MISMO formulario dan la misma empresa, no dos', async () => {
    // El mismo defecto que el del webhook, con menos dinero de por medio: si el
    // slug se derivara preguntando "¿está ocupado?", el segundo envío —un doble
    // clic, un reintento del navegador— vería ocupado el slug que él mismo creó
    // y crearía `panaderia-lupita-2`. Con `provision()` de árbitro, cae en la
    // misma empresa.
    const enviar = () =>
      postJson(
        '/billing/alta-gratis',
        { businessName: 'Panadería Lupita' },
        cabeceras('lupita@ejemplo.mx'),
      );

    const primera = await leerJson<{ tenantId: string; slug: string; creado: boolean }>(
      await enviar(),
    );
    const segunda = await leerJson<{ tenantId: string; slug: string; creado: boolean }>(
      await enviar(),
    );

    expect(primera).toMatchObject({ slug: 'panaderia-lupita', creado: true });
    expect(segunda).toMatchObject({ slug: 'panaderia-lupita', creado: false });
    expect(segunda.tenantId).toBe(primera.tenantId);
    expect(db.tabla('tenants')).toHaveLength(1);
  });

  it('pero OTRA persona con el mismo nombre de negocio sí obtiene su propia empresa', async () => {
    await postJson(
      '/billing/alta-gratis',
      { businessName: 'Panadería Lupita' },
      cabeceras('lupita@ejemplo.mx'),
    );
    const r = await postJson(
      '/billing/alta-gratis',
      { businessName: 'Panadería Lupita' },
      cabeceras('otra@ejemplo.mx'),
    );
    const cuerpo = await leerJson<{ slug: string; creado: boolean }>(r);

    expect(cuerpo).toMatchObject({ slug: 'panaderia-lupita-2', creado: true });
    expect(db.tabla('tenants')).toHaveLength(2);
  });

  it('no cobra: no deja fila en subscriptions', async () => {
    await postJson(
      '/billing/alta-gratis',
      { businessName: 'Panadería Lupita' },
      cabeceras('lupita@ejemplo.mx'),
    );
    expect(db.tabla('subscriptions')).toHaveLength(0);
  });

  it('SIN el secreto de proxy no crea nada', async () => {
    const r = await postJson(
      '/billing/alta-gratis',
      { businessName: 'La Empresa De Otro' },
      { [HEADER.userEmail]: 'victima@ejemplo.mx' },
    );

    expect(r.status).toBe(401);
    expect(provisionLlamadas).toHaveLength(0);
  });

  it('con un secreto equivocado tampoco', async () => {
    const r = await postJson(
      '/billing/alta-gratis',
      { businessName: 'La Empresa De Otro' },
      { [HEADER.userEmail]: 'victima@ejemplo.mx', [HEADER.proxySecret]: 'otro-secreto-distinto' },
    );

    expect(r.status).toBe(401);
    expect(provisionLlamadas).toHaveLength(0);
  });

  it('sin correo de sesión no hay alta, aunque el secreto sea correcto', async () => {
    const r = await postJson(
      '/billing/alta-gratis',
      { businessName: 'Sin Dueño' },
      { [HEADER.proxySecret]: PROXY },
    );

    expect(r.status).toBe(401);
    expect(provisionLlamadas).toHaveLength(0);
  });

  it('el correo del CUERPO se ignora: sólo manda la sesión', async () => {
    await postJson(
      '/billing/alta-gratis',
      { businessName: 'Panadería Lupita', ownerEmail: 'atacante@ejemplo.mx' },
      cabeceras('lupita@ejemplo.mx'),
    );

    expect(provisionLlamadas[0]!.ownerEmail).toBe('lupita@ejemplo.mx');
  });

  it('en producción sin PROXY_SECRET se rechaza todo — fail-closed', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.PROXY_SECRET;
    resetEnvCache();

    const r = await postJson(
      '/billing/alta-gratis',
      { businessName: 'Cualquiera' },
      { [HEADER.userEmail]: 'cualquiera@ejemplo.mx' },
    );

    expect(r.status).toBe(401);
    expect(provisionLlamadas).toHaveLength(0);

    process.env.NODE_ENV = 'test';
    process.env.PROXY_SECRET = PROXY;
    resetEnvCache();
  });
});
