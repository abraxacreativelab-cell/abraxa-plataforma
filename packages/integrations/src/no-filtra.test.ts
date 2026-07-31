/**
 * ════════════════════════════════════════════════════════════════════════════
 *  EL SECRETO NO SALE — criterios 3 y 4 de H17-integraciones.md §11
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Ni por HTTP, ni al staff, ni al panel de agencia, ni a un log, ni a
 *  `last_error`, ni a `integration_events.detail`.
 *
 *  ── El caso adversarial que hace que esta prueba valga ─────────────────────
 *
 *  El proveedor de mentira de aquí abajo DEVUELVE EL TOKEN EN EL ECO DE ERROR.
 *  No es una hipótesis pesimista: Meta y Twilio lo hacen con más frecuencia de
 *  la que uno esperaría, y es exactamente así como una bitácora bien
 *  intencionada acaba siendo un almacén de secretos en claro —con RLS, pero
 *  sin cifrado—.
 *
 *  Un `verify()` que guardara `await r.text()` en `last_error` pasaría todas
 *  las demás pruebas de este paquete y fallaría ésta.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { capturarEntorno, limpiarEntorno } from './testing/entorno';
import { HEADER } from '@abraxa/config';
import { __clearPorts, __setClientForTests, registerPort } from '@abraxa/db';
import type { TenancyPort } from '@abraxa/db';
import { registerIntegrationsPort } from './port-registration';
import { router } from './routes';
import { createIntegrationsService } from './service';
import { LLAVE_DE_PRUEBA, contextoDePrueba, createFakeDb, type FakeDb } from './testing/fake-db';

const EL_SECRETO = 'evolution-token-de-la-panaderia-8146';
const PANADERIA = contextoDePrueba('t-panaderia', { email: 'ana@panaderia.mx' });
const SECRETO_PROXY = 'proxy-de-prueba-suficientemente-largo'; // abraxa-allow-secret

let db: FakeDb;
let restaurarEntorno: () => void;

/**
 * El proveedor hostil: rebota el token que le mandaron dentro del cuerpo del
 * error, junto con un `request_id` que sí es legítimo guardar.
 */
const fetchQueRebotaElToken: typeof fetch = async (_url, init) => {
  const apikey = new Headers(init?.headers).get('apikey') ?? '';
  return new Response(
    JSON.stringify({
      error: 'unauthorized',
      message: `The API key '${apikey}' is not valid for this instance`,
      request_id: 'req-88f1',
    }),
    { status: 401, headers: { 'content-type': 'application/json' } },
  );
};

beforeEach(() => {
  restaurarEntorno = capturarEntorno();
  limpiarEntorno();
  db = createFakeDb();
  __setClientForTests(db.client);
  process.env.INTEGRATIONS_KEY = LLAVE_DE_PRUEBA;
  delete process.env.INTEGRATIONS_PLATFORM_FALLBACK;
});

afterEach(() => {
  __setClientForTests(null);
  __clearPorts();
  restaurarEntorno();
  vi.restoreAllMocks();
});

/** Todo lo que el proceso escribió por consola durante la prueba. */
function capturarConsola(): { texto: () => string } {
  const lineas: string[] = [];
  const meter = (...args: unknown[]) => {
    lineas.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a) ?? '')).join(' '));
  };
  vi.spyOn(console, 'warn').mockImplementation(meter);
  vi.spyOn(console, 'error').mockImplementation(meter);
  vi.spyOn(console, 'log').mockImplementation(meter);
  return { texto: () => lineas.join('\n') };
}

describe('el servicio no devuelve el secreto ni por accidente', () => {
  it('list() y get() traen huella, y el objeto serializado no contiene el valor', async () => {
    const svc = createIntegrationsService({ fetchImpl: fetchQueRebotaElToken });
    const { integrationId } = await svc.save(PANADERIA, {
      provider: 'evolution',
      secret: EL_SECRETO,
      config: { baseUrl: 'https://evo.panaderia.mx', instance: 'panaderia' },
      externalAccountId: 'panaderia',
      verify: false,
    });

    const lista = await svc.list(PANADERIA);
    const una = await svc.get(PANADERIA, integrationId);

    // Se serializa el objeto COMPLETO y se busca el texto claro. No se
    // inspecciona campo por campo a propósito: un campo nuevo que alguien
    // agregue mañana entra solo en esta aserción.
    expect(JSON.stringify(lista)).not.toContain(EL_SECRETO);
    expect(JSON.stringify(una)).not.toContain(EL_SECRETO);

    // Y sí trae con qué distinguir una credencial de otra.
    expect(una?.fingerprint).toMatch(/^••••.+ · [0-9a-f]{8}$/);
  });

  it('la huella cambia al reconectar con otra credencial', async () => {
    const svc = createIntegrationsService({ fetchImpl: fetchQueRebotaElToken });
    const primera = await svc.save(PANADERIA, {
      provider: 'evolution',
      secret: EL_SECRETO,
      externalAccountId: 'panaderia',
      verify: false,
    });
    const antes = (await svc.get(PANADERIA, primera.integrationId))?.fingerprint;

    const segunda = await svc.save(PANADERIA, {
      provider: 'evolution',
      secret: 'evolution-token-nuevo-9922',
      externalAccountId: 'panaderia',
      verify: false,
    });
    const despues = (await svc.get(PANADERIA, segunda.integrationId))?.fingerprint;

    expect(despues).not.toBe(antes);
  });
});

describe('el proveedor rebota el token y aun así no se guarda en ningún lado', () => {
  it('last_error, la bitácora y la consola quedan limpios', async () => {
    const consola = capturarConsola();
    const svc = createIntegrationsService({ fetchImpl: fetchQueRebotaElToken });

    const { integrationId } = await svc.save(PANADERIA, {
      provider: 'evolution',
      secret: EL_SECRETO,
      config: { baseUrl: 'https://evo.panaderia.mx', instance: 'panaderia' },
      externalAccountId: 'panaderia',
      actor: 'ana@panaderia.mx',
    });

    const resultado = await svc.verify(PANADERIA, integrationId);
    expect(resultado.ok).toBe(false);

    // 1. La columna de la fila.
    const fila = db.tabla('tenant_integrations').find((f) => f.id === integrationId);
    expect(fila?.status).toBe('error');
    expect(String(fila?.last_error ?? '')).not.toContain(EL_SECRETO);
    expect(String(fila?.last_error ?? '')).toBeTruthy();

    // 2. La bitácora entera, con todo su `detail`.
    expect(JSON.stringify(db.tabla('integration_events'))).not.toContain(EL_SECRETO);

    // 3. La consola del proceso.
    expect(consola.texto()).not.toContain(EL_SECRETO);

    // 4. Y la base COMPLETA, por si alguien lo dejó caer en otra columna.
    expect(JSON.stringify(db.tabla('tenant_integrations'))).not.toContain(EL_SECRETO);

    // Lo que sí se guarda, porque sirve para depurar y no compromete nada.
    expect(String(fila?.last_error)).toContain('401');
    expect(JSON.stringify(db.tabla('integration_events'))).toContain('req-88f1');
  });

  it('el motivo saneado es corto: no es el cuerpo del proveedor recortado a la mitad', async () => {
    const svc = createIntegrationsService({ fetchImpl: fetchQueRebotaElToken });
    const { integrationId } = await svc.save(PANADERIA, {
      provider: 'evolution',
      secret: EL_SECRETO,
      config: { baseUrl: 'https://evo.panaderia.mx', instance: 'panaderia' },
      externalAccountId: 'panaderia',
      verify: false,
    });
    await svc.verify(PANADERIA, integrationId);

    const fila = db.tabla('tenant_integrations').find((f) => f.id === integrationId);
    expect(String(fila?.last_error).length).toBeLessThanOrEqual(240);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Por HTTP, que es por donde de verdad se escaparía.
// ═════════════════════════════════════════════════════════════════════════════

let base = '';
let server: http.Server;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/integrations', router);
  server = http.createServer(app);
  await new Promise<void>((listo) => server.listen(0, '127.0.0.1', listo));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((listo) => server.close(() => listo()));
});

function pedir(ruta: string, headers: Record<string, string>): Promise<{ status: number; crudo: string }> {
  return new Promise((resolver, rechazar) => {
    const req = http.request(
      `${base}${ruta}`,
      { method: 'GET', headers: { connection: 'close', ...headers }, agent: false },
      (res) => {
        let crudo = '';
        res.setEncoding('utf8');
        res.on('data', (t: string) => (crudo += t));
        res.on('end', () => resolver({ status: res.statusCode ?? 0, crudo }));
      },
    );
    req.on('error', rechazar);
    req.end();
  });
}

describe('por HTTP tampoco', () => {
  it('GET /integrations devuelve la lista sin un solo secreto', async () => {
    process.env.PROXY_SECRET = SECRETO_PROXY;
    process.env.NODE_ENV = 'test';

    const svc = createIntegrationsService({ fetchImpl: fetchQueRebotaElToken });
    registerIntegrationsPort(svc);
    registerPort('tenancy', {
      contextFor: () => Promise.resolve(PANADERIA),
    } as unknown as TenancyPort);

    await svc.save(PANADERIA, {
      provider: 'evolution',
      secret: EL_SECRETO,
      config: { baseUrl: 'https://evo.panaderia.mx', instance: 'panaderia' },
      externalAccountId: 'panaderia',
      verify: false,
    });

    const res = await pedir('/integrations', {
      [HEADER.proxySecret]: SECRETO_PROXY,
      [HEADER.userEmail]: 'ana@panaderia.mx',
      [HEADER.tenantSlug]: 't-panaderia',
    });

    expect(res.status).toBe(200);
    expect(res.crudo).not.toContain(EL_SECRETO);
    expect(res.crudo).toContain('••••');
  });
});
