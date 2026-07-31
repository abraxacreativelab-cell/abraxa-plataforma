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

/**
 * Se restauran las DOS variables que estas pruebas tocan, una por una.
 *
 * La primera versión hacía `process.env = { ...entornoOriginal }` en el
 * `afterEach`, que es el idiom común y aquí resultó ser una trampa: reemplazar
 * el objeto entero deja un `process.env` que ya no es el del proceso, y el
 * tercer caso —el único POST— se colgaba hasta el timeout. Aislado pasaba en
 * 843 ms; con los dos GET antes, nunca. Un `delete` y una asignación no tienen
 * ese efecto de borde.
 */
const PROXY_ORIGINAL = process.env.PROXY_SECRET;
const NODE_ENV_ORIGINAL = process.env.NODE_ENV;

function restaurarEntorno(): void {
  if (PROXY_ORIGINAL === undefined) delete process.env.PROXY_SECRET;
  else process.env.PROXY_SECRET = PROXY_ORIGINAL;

  if (NODE_ENV_ORIGINAL === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = NODE_ENV_ORIGINAL;
}

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
  restaurarEntorno();
});

// ─────────────────────────────────────────────────────────────────────────────
// El arnés: un servidor real y un cliente sin keep-alive.
// ─────────────────────────────────────────────────────────────────────────────
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

interface Cuerpo {
  error?: { code: string; message: string };
  ready?: boolean;
}

/**
 * Una petición contra el router, con `agent: false`.
 *
 * Deliberadamente NO se usa `fetch`. Con el cliente de undici estas mismas
 * pruebas pasaban en GET y el POST se colgaba ~5 s —hasta el `keepAliveTimeout`
 * del servidor— porque el socket se queda en el pool y un POST no es
 * reintentable. `agent: false` abre y cierra un socket por petición: sin pool
 * no hay carrera. Una prueba de seguridad que falla por el transporte no sirve
 * para nada, y una que falla sólo bajo carga es peor: parece un fantasma.
 */
function pedir(
  ruta: string,
  headers: Record<string, string>,
  opciones: { method?: string; body?: string } = {},
): Promise<{ status: number; body: Cuerpo }> {
  return new Promise((resolver, rechazar) => {
    const req = http.request(
      `${base}${ruta}`,
      // `connection: close` además de `agent: false`: ni el cliente reusa el
      // socket ni el servidor lo guarda esperando su `keepAliveTimeout`.
      { method: opciones.method ?? 'GET', headers: { connection: 'close', ...headers }, agent: false },
      (res) => {
        let crudo = '';
        res.setEncoding('utf8');
        res.on('data', (trozo: string) => (crudo += trozo));
        res.on('end', () =>
          resolver({
            status: res.statusCode ?? 0,
            body: crudo ? (JSON.parse(crudo) as Cuerpo) : {},
          }),
        );
      },
    );
    req.on('error', rechazar);
    if (opciones.body !== undefined) req.write(opciones.body);
    req.end();
  });
}

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
      expect(res.body.error?.code).toBe('UNAUTHENTICATED');

      // Lo que de verdad se está midiendo: tenancy nunca se enteró.
      expect(llamadas).toEqual([]);
    },
  );

  /**
   * A propósito SIN cuerpo, que es además como lo probaría alguien con `curl`.
   *
   * Con un cuerpo JSON esta prueba tardaba 843 ms aislada y >5 s cuando corría
   * detrás de las otras: `express.json()` carga `raw-body`/`iconv-lite` de
   * forma perezosa en la PRIMERA petición con cuerpo, y ese require en frío a
   * través del transform de vite, con el disco saturado, se come el
   * presupuesto entero. Sin `content-type` ni cuerpo, body-parser ni se
   * asoma —y la afirmación de seguridad es idéntica, porque el 401 ocurre
   * antes de que nadie mire `req.body`.
   */
  it('POST /agents/seed tampoco: sembrar agentes es escritura', async () => {
    const res = await pedir(
      '/agents/seed',
      {
        [HEADER.userEmail]: 'atacante@example.com',
        [HEADER.tenantSlug]: 'empresa-de-otro',
      },
      { method: 'POST' },
    );

    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe('UNAUTHENTICATED');
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
    expect(res.body.error?.message).toBe(CENTINELA);

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
    expect(res.body.ready).toBe(true);
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
    expect(res.body.error?.code).toBe('PORT_NOT_IMPLEMENTED');
  });
});
