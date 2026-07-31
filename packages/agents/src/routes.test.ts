/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El agujero que estaba esperando un merge para abrirse.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Estas pruebas corren con el port `tenancy` REGISTRADO — es decir, simulan el
 * mundo de después de que mergee el PR #6 (H2). Ése es el único mundo en el
 * que la falla es explotable, y por eso es el único mundo que vale la pena
 * probar: hoy las rutas devuelven 501 y cualquier prueba pasaría por accidente.
 *
 * La aserción que importa no es el código HTTP: es `llamadas.length === 0`.
 * Mide que el header de identidad NUNCA llegó a convertirse en un contexto de
 * empresa. Un 401 que igual consultó la membresía seguiría siendo un oráculo.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HEADER } from '@abraxa/config';
import { PlatformError, registerPort, __clearPorts } from '@abraxa/db';
import type { TenancyPort } from '@abraxa/db';
import { router } from './routes';

const SECRETO = 'secreto-de-prueba-suficientemente-largo';
const entornoOriginal = { ...process.env };

/** Llamadas que llegaron a `contextFor`. Vacío = la puerta aguantó. */
let llamadas: Array<{ userEmail: string; tenantSlug: string }> = [];

/**
 * Doble de H2. No devuelve un contexto: LANZA un centinela.
 *
 * Así la prueba no depende de una base de datos y el camino feliz se distingue
 * sin ambigüedad — un 409 con este mensaje significa "la petición atravesó las
 * tres puertas", que es justo lo que se quiere medir.
 */
const CENTINELA = 'centinela: contextFor fue invocado';

const tenancyFalso = {
  contextFor: (i: { userEmail: string; tenantSlug: string }) => {
    llamadas.push(i);
    return Promise.reject(new PlatformError('CONFLICT', CENTINELA));
  },
} as unknown as TenancyPort;

beforeEach(() => {
  llamadas = [];
  __clearPorts();
  registerPort('tenancy', tenancyFalso);
});

afterEach(() => {
  __clearPorts();
  process.env = { ...entornoOriginal };
});

/**
 * UN servidor para todo el archivo, a propósito.
 *
 * La primera versión levantaba uno por prueba y lo cerraba con
 * `closeAllConnections()`. Los GET pasaban y el POST se colgaba hasta el
 * timeout: `fetch` de Node deja el socket en keep-alive, cerrarlo por debajo
 * lo deja podrido en el pool de undici, y undici reintenta los idempotentes
 * pero NO un POST. Levantarlo una vez y cerrarlo al final elimina la clase
 * entera de fallo — y las rutas leen `process.env` en cada petición, así que
 * cambiar el entorno por prueba sigue funcionando igual.
 */
let base = '';
let server: http.Server;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/agents', router);

  server = http.createServer(app);
  await new Promise<void>((listo) => server.listen(0, '127.0.0.1', listo));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((listo) => server.close(() => listo()));
});

/** `GET`/`POST` contra el router, con los headers tal cual los mandaría el mundo. */
const pedir = (
  ruta: string,
  headers: Record<string, string>,
  init: RequestInit = {},
): Promise<Response> => fetch(`${base}${ruta}`, { ...init, headers });

const RUTAS_CON_CONTEXTO = ['/agents/', '/agents/budget'] as const;


// ═════════════════════════════════════════════════════════════════════════════
describe('rutas de agentes · sin PROXY_SECRET en producción', () => {
  beforeEach(() => {
    delete process.env.PROXY_SECRET;
    process.env.NODE_ENV = 'production';
  });

  it.each(RUTAS_CON_CONTEXTO)(
    'GET %s con x-user-email crudo NO produce contexto (fail-closed)',
    async (ruta) => {
      const res = await pedir(ruta, {
        [HEADER.userEmail]: 'atacante@example.com',
        [HEADER.tenantSlug]: 'empresa-de-otro',
      });

      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('UNAUTHENTICATED');

      // Lo que de verdad se está midiendo: tenancy nunca se enteró.
      expect(llamadas).toEqual([]);
    },
  );

  it('POST /agents/seed tampoco: sembrar agentes es escritura', async () => {
    const res = await pedir(
      '/agents/seed',
      {
        'content-type': 'application/json',
        [HEADER.userEmail]: 'atacante@example.com',
        [HEADER.tenantSlug]: 'empresa-de-otro',
      },
      { method: 'POST', body: JSON.stringify({ masterName: 'Suplantador' }) },
    );

    expect(res.status).toBe(401);
    expect(llamadas).toEqual([]);
  });

  it('inventarse un x-proxy-secret no sirve de nada', async () => {
    const res = await pedir('/agents/', {
      [HEADER.userEmail]: 'atacante@example.com',
      [HEADER.tenantSlug]: 'empresa-de-otro',
      [HEADER.proxySecret]: 'lo-que-sea',
    });

    expect(res.status).toBe(401);
    expect(llamadas).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('rutas de agentes · con PROXY_SECRET configurado', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    process.env.PROXY_SECRET = SECRETO;
  });

  it('rechaza sin el secreto, aunque la identidad venga completa', async () => {
    const res = await pedir('/agents/', {
      [HEADER.userEmail]: 'atacante@example.com',
      [HEADER.tenantSlug]: 'empresa-de-otro',
    });

    expect(res.status).toBe(401);
    expect(llamadas).toEqual([]);
  });

  it('rechaza un secreto incorrecto de la misma longitud', async () => {
    const res = await pedir('/agents/', {
      [HEADER.userEmail]: 'atacante@example.com',
      [HEADER.tenantSlug]: 'empresa-de-otro',
      [HEADER.proxySecret]: 'secreto-de-prueba-suficientemente-LARGO',
    });

    expect(res.status).toBe(401);
    expect(llamadas).toEqual([]);
  });

  it('con el secreto correcto SÍ pasa a validar la membresía en H2', async () => {
    const res = await pedir('/agents/', {
      [HEADER.userEmail]: 'duena@example.com',
      [HEADER.tenantSlug]: 'su-empresa',
      [HEADER.proxySecret]: SECRETO,
    });

    // 409 = el centinela del doble de H2. Llegó hasta la última puerta.
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe(CENTINELA);

    // Y llegó con lo que mandó el BFF, sin inventar nada.
    expect(llamadas).toEqual([{ userEmail: 'duena@example.com', tenantSlug: 'su-empresa' }]);
  });

  it('con el secreto pero sin identidad, 401 antes de tocar tenancy', async () => {
    const res = await pedir('/agents/', { [HEADER.proxySecret]: SECRETO });

    expect(res.status).toBe(401);
    expect(llamadas).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('rutas de agentes · lo que NO cambia', () => {
  it('GET /agents/_status sigue siendo público (es el health del motor)', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.PROXY_SECRET;

    const res = await pedir('/agents/_status', {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ready: boolean };
    expect(body.ready).toBe(true);
  });

  it('en desarrollo, sin secreto, se sigue pudiendo trabajar sin BFF', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.PROXY_SECRET;

    const res = await pedir('/agents/', {
      [HEADER.userEmail]: 'yo@example.com',
      [HEADER.tenantSlug]: 'mi-empresa',
    });

    expect(res.status).toBe(409);
    expect(llamadas).toHaveLength(1);
  });

  it('sin el port de tenancy registrado sigue siendo 501, no 200', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.PROXY_SECRET;
    __clearPorts();

    const res = await pedir('/agents/', {
      [HEADER.userEmail]: 'yo@example.com',
      [HEADER.tenantSlug]: 'mi-empresa',
    });

    expect(res.status).toBe(501);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('PORT_NOT_IMPLEMENTED');
  });
});
