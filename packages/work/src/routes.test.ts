/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El quinto carril con el mismo agujero — y éste sí estaba armado.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * H0 encontró el 2026-07-31 que cuatro carriles habían escrito cada uno su
 * propio resolvedor de contexto y que tres leían `x-user-email` sin comprobar
 * antes el secreto compartido del BFF. H9 era el quinto: `routes.ts` tenía su
 * `contextoDe` y hacía exactamente lo mismo.
 *
 * La diferencia con los otros es que aquí no faltaba ningún detonador:
 *
 *   · `apps/api/src/packages.ts` monta este router en `/work`.
 *   · H2 (PR #6) ya mergeó, así que `registerPort('tenancy')` ya corre.
 *
 * Es decir, en cuanto mergeara este PR, dos cabeceras puestas con `curl` leían,
 * movían, reasignaban y borraban las tareas de cualquier empresa de la
 * plataforma. Un tablero de tareas es donde se escriben los pendientes del
 * negocio, con nombres de clientes y de personas adentro.
 *
 * La aserción que importa no es el código HTTP: es `llamadas.length === 0`.
 * Mide que la cabecera NUNCA llegó a convertirse en un contexto de empresa. Un
 * 401 que de todos modos consultó la membresía sigue siendo un oráculo — le
 * dice al atacante qué correos existen y a qué empresas pertenecen.
 *
 * El arnés es el de `packages/agents/src/routes.test.ts`, con sus dos trampas
 * ya pagadas: `agent: false` (el pool de undici cuelga el POST hasta el
 * `keepAliveTimeout`) y restaurar `process.env` variable por variable.
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
const CENTINELA = 'centinela: contextFor fue invocado';

/** Llamadas que llegaron a `contextFor`. Vacío = la puerta aguantó. */
let llamadas: Array<{ userEmail: string; tenantSlug: string }> = [];

const tenancyFalso = {
  contextFor: (i: { userEmail: string; tenantSlug: string }) => {
    llamadas.push(i);
    return Promise.reject(new PlatformError('CONFLICT', CENTINELA));
  },
} as unknown as TenancyPort;

// Una por una: reemplazar `process.env` entero deja un objeto que ya no es el
// del proceso, y entonces el POST se cuelga (ver agents/routes.test.ts).
const PROXY_ORIGINAL = process.env.PROXY_SECRET;
const NODE_ENV_ORIGINAL = process.env.NODE_ENV;

beforeEach(() => {
  llamadas = [];
  __clearPorts();
  registerPort('tenancy', tenancyFalso);
});

afterEach(() => {
  __clearPorts();
  if (PROXY_ORIGINAL === undefined) delete process.env.PROXY_SECRET;
  else process.env.PROXY_SECRET = PROXY_ORIGINAL;
  if (NODE_ENV_ORIGINAL === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = NODE_ENV_ORIGINAL;
});

// ── El arnés: un servidor real y un cliente sin keep-alive ──────────────────

let base = '';
let server: http.Server;

beforeAll(async () => {
  const app = express();
  app.use('/work', router);
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

function pedir(
  ruta: string,
  headers: Record<string, string>,
  opciones: { method?: string } = {},
): Promise<{ status: number; body: Cuerpo }> {
  return new Promise((resolver, rechazar) => {
    const req = http.request(
      `${base}${ruta}`,
      { method: opciones.method ?? 'GET', headers: { connection: 'close', ...headers }, agent: false },
      (res) => {
        let crudo = '';
        res.setEncoding('utf8');
        res.on('data', (t: string) => (crudo += t));
        res.on('end', () =>
          resolver({ status: res.statusCode ?? 0, body: crudo ? (JSON.parse(crudo) as Cuerpo) : {} }),
        );
      },
    );
    req.on('error', rechazar);
    req.end();
  });
}

/** Una de cada clase: lectura del tablero completo, lectura de la lista,
 *  escritura y borrado. Si una sola se cuela, se cuela el tenant entero. */
const RUTAS: Array<[string, string]> = [
  ['GET', '/work/workspace'],
  ['GET', '/work/tasks'],
  ['GET', '/work/members'],
  ['GET', '/work/projects'],
  ['GET', '/work/views'],
  ['POST', '/work/tasks'],
  ['POST', '/work/tasks/reorder'],
  ['PATCH', '/work/tasks/00000000-0000-0000-0000-000000000001'],
  ['DELETE', '/work/tasks/00000000-0000-0000-0000-000000000001'],
];

const CABECERAS_FORJADAS = {
  [HEADER.userEmail]: 'atacante@example.com',
  [HEADER.tenantSlug]: 'empresa-de-otro',
};

// ═════════════════════════════════════════════════════════════════════════════
describe('rutas de tareas · sin PROXY_SECRET en producción', () => {
  beforeEach(() => {
    delete process.env.PROXY_SECRET;
    process.env.NODE_ENV = 'production';
  });

  it.each(RUTAS)('%s %s con cabeceras forjadas NO produce contexto (fail-closed)', async (method, ruta) => {
    const res = await pedir(ruta, CABECERAS_FORJADAS, { method });

    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe('UNAUTHENTICATED');
    // Lo que de verdad se mide: tenancy nunca se enteró.
    expect(llamadas).toEqual([]);
  });

  it('inventarse un x-proxy-secret no sirve de nada', async () => {
    const res = await pedir('/work/tasks', {
      ...CABECERAS_FORJADAS,
      [HEADER.proxySecret]: 'lo-que-sea',
    });

    expect(res.status).toBe(401);
    expect(llamadas).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('rutas de tareas · con PROXY_SECRET configurado', () => {
  beforeEach(() => {
    process.env.PROXY_SECRET = SECRETO;
    process.env.NODE_ENV = 'production';
  });

  it('sin el secreto, la cabecera de identidad no vale nada', async () => {
    const res = await pedir('/work/tasks', CABECERAS_FORJADAS);
    expect(res.status).toBe(401);
    expect(llamadas).toEqual([]);
  });

  it('con el secreto equivocado tampoco', async () => {
    const res = await pedir('/work/tasks', {
      ...CABECERAS_FORJADAS,
      [HEADER.proxySecret]: `${SECRETO}-casi`,
    });
    expect(res.status).toBe(401);
    expect(llamadas).toEqual([]);
  });

  it('con el secreto correcto SÍ pasa, y el slug se valida contra H2', async () => {
    const res = await pedir('/work/tasks', {
      ...CABECERAS_FORJADAS,
      [HEADER.proxySecret]: SECRETO,
    });

    // El centinela: atravesó las dos primeras puertas y llegó a la tercera.
    expect(res.body.error?.message).toBe(CENTINELA);
    // Y el slug llegó SIN creerse: quien decide si esa persona pertenece a esa
    // empresa es H2, no este router.
    expect(llamadas).toEqual([{ userEmail: 'atacante@example.com', tenantSlug: 'empresa-de-otro' }]);
  });

  it('con el secreto pero sin correo, no hay quién', async () => {
    const res = await pedir('/work/tasks', {
      [HEADER.tenantSlug]: 'una-empresa',
      [HEADER.proxySecret]: SECRETO,
    });
    expect(res.status).toBe(401);
    expect(llamadas).toEqual([]);
  });

  it('con el secreto y correo pero sin empresa, no hay cuál', async () => {
    const res = await pedir('/work/tasks', {
      [HEADER.userEmail]: 'lupita@ejemplo.mx',
      [HEADER.proxySecret]: SECRETO,
    });
    // 422: la petición está autenticada, lo que falta es un dato. El catálogo
    // de `packages/db/src/errors.ts` mapea VALIDATION a 422, no a 400.
    expect(res.status).toBe(422);
    expect(res.body.error?.code).toBe('VALIDATION');
    expect(llamadas).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('/_status', () => {
  it('sigue siendo público: no toca datos de nadie', async () => {
    const res = await pedir('/work/_status', {});
    expect(res.status).toBe(200);
    expect(res.body.ready).toBe(true);
    expect(llamadas).toEqual([]);
  });
});
