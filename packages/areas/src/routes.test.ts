/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Que este carril no sea el sexto
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Entre el 2026-07-30 y el 07-31, CINCO carriles escribieron cada uno su propio
 * resolvedor de contexto a partir de las cabeceras, y cuatro leían
 * `x-user-email` sin comprobar antes el secreto compartido del BFF. Uno llegó a
 * `main` sirviendo la bóveda —precios, márgenes, documentos— a cualquiera con
 * `curl`.
 *
 * Aquí el detonador también está armado: `apps/api/src/packages.ts` monta este
 * router en `/areas` y H2 ya mergeó, así que `registerPort('tenancy')` corre. Un
 * agujero aquí dejaría a cualquiera abrir, cerrar y resembrar el mapa de
 * negocio de cualquier empresa — y leer los guiones con las respuestas que su
 * dueño dio sobre sus precios, sus márgenes y a quién va a contratar.
 *
 * La aserción que importa NO es el código HTTP: es `llamadas.length === 0`.
 * Mide que la cabecera nunca llegó a convertirse en un contexto de empresa. Un
 * 401 que de todos modos consultó la membresía sigue siendo un oráculo: le dice
 * al atacante qué correos existen y a qué empresas pertenecen.
 *
 * El arnés es el de H9 y H3, con sus dos trampas ya pagadas: `agent: false` (el
 * pool de undici cuelga el POST hasta el `keepAliveTimeout`) y restaurar
 * `process.env` variable por variable — reemplazar el objeto entero deja uno
 * que ya no es el del proceso.
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

// ── El arnés ────────────────────────────────────────────────────────────────

let base = '';
let server: http.Server;

beforeAll(async () => {
  const app = express();
  // Sin `express.json()` a propósito, igual que el arnés de H9: el cuerpo lo
  // parsea `apps/api` antes de montar los routers (apps/api/src/app.ts:11), y
  // aquí ninguna petición llega a mirarlo — todas mueren en la primera puerta.
  // Menos piezas en el arnés, menos formas de que el arnés sea el que falle.
  app.use('/areas', router);
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
  handoff?: string;
  limits?: Record<string, number>;
}

/**
 * El cuerpo, si venía en JSON.
 *
 * No todo lo que responde este servidor lo es: el 404 por defecto de Express
 * —el que contesta cuando la ruta ni siquiera existe— manda una página HTML.
 * Un `JSON.parse` a secas revienta ahí con "Unexpected token '<'", y como pasa
 * dentro del callback de la respuesta, se lleva el proceso entero: el archivo
 * de pruebas muere sin reportar NINGUNA, incluidas las diecisiete del candado
 * de identidad, que son la razón de ser de este archivo.
 */
function comoJson(crudo: string): Cuerpo {
  if (!crudo) return {};
  try {
    return JSON.parse(crudo) as Cuerpo;
  } catch {
    return {};
  }
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
        res.on('end', () => resolver({ status: res.statusCode ?? 0, body: comoJson(crudo) }));
      },
    );
    req.on('error', rechazar);
    req.end();
  });
}

/**
 * Una de cada clase. Si UNA sola se cuela, se cuela el tenant entero:
 * lectura del mapa, lectura de la navegación, siembra, apertura, cierre,
 * declaración, roadmap y las respuestas del mini-onboarding.
 */
const RUTAS: Array<[string, string]> = [
  ['GET', '/areas/'],
  ['GET', '/areas/map'],
  ['GET', '/areas/milestones'],
  ['GET', '/areas/ventas'],
  ['GET', '/areas/ventas/onboarding'],
  ['POST', '/areas/seed'],
  ['POST', '/areas/milestones'],
  ['POST', '/areas/milestones/reorder'],
  ['POST', '/areas/milestones/propose'],
  ['POST', '/areas/ventas/unlock'],
  ['POST', '/areas/ventas/lock'],
  ['POST', '/areas/ventas/declare'],
  ['POST', '/areas/ventas/onboarding/start'],
  ['POST', '/areas/ventas/onboarding/answer'],
  ['POST', '/areas/ventas/onboarding/finish'],
  ['PATCH', '/areas/milestones/00000000-0000-0000-0000-000000000001'],
  ['DELETE', '/areas/milestones/00000000-0000-0000-0000-000000000001'],
];

const CABECERAS_FORJADAS = {
  [HEADER.userEmail]: 'atacante@example.com',
  [HEADER.tenantSlug]: 'empresa-de-otro',
};

// ═════════════════════════════════════════════════════════════════════════════
describe('sin PROXY_SECRET en producción — fail-closed', () => {
  beforeEach(() => {
    delete process.env.PROXY_SECRET;
    process.env.NODE_ENV = 'production';
  });

  it.each(RUTAS)('%s %s con cabeceras forjadas NO produce contexto', async (method, ruta) => {
    const res = await pedir(ruta, CABECERAS_FORJADAS, { method });

    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe('UNAUTHENTICATED');
    // Lo que de verdad se mide: tenancy nunca se enteró.
    expect(llamadas).toEqual([]);
  });

  it('inventarse un x-proxy-secret no sirve de nada', async () => {
    const res = await pedir('/areas/map', {
      ...CABECERAS_FORJADAS,
      [HEADER.proxySecret]: 'lo-que-sea',
    });
    expect(res.status).toBe(401);
    expect(llamadas).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('con PROXY_SECRET configurado', () => {
  beforeEach(() => {
    process.env.PROXY_SECRET = SECRETO;
    process.env.NODE_ENV = 'production';
  });

  it('sin el secreto, la cabecera de identidad no vale nada', async () => {
    const res = await pedir('/areas/map', CABECERAS_FORJADAS);
    expect(res.status).toBe(401);
    expect(llamadas).toEqual([]);
  });

  it('con el secreto equivocado tampoco', async () => {
    const res = await pedir('/areas/map', {
      ...CABECERAS_FORJADAS,
      [HEADER.proxySecret]: `${SECRETO}-casi`,
    });
    expect(res.status).toBe(401);
    expect(llamadas).toEqual([]);
  });

  it('con el secreto correcto SÍ pasa, y el slug se valida contra H2', async () => {
    const res = await pedir('/areas/map', {
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
    const res = await pedir('/areas/map', {
      [HEADER.tenantSlug]: 'una-empresa',
      [HEADER.proxySecret]: SECRETO,
    });
    expect(res.status).toBe(401);
    expect(llamadas).toEqual([]);
  });

  it('con el secreto pero sin empresa, no hay cuál', async () => {
    const res = await pedir('/areas/map', {
      [HEADER.userEmail]: 'lupita@ejemplo.mx',
      [HEADER.proxySecret]: SECRETO,
    });

    // 422 y no 401, y la diferencia es correcta: la identidad SÍ quedó
    // acreditada —proxy verificado y correo presente—, lo que falta es decir de
    // qué empresa se trata. Eso es una petición mal formada, no un fallo de
    // autenticación. Lo dice la pieza canónica en
    // packages/db/src/http/tenant-context.ts:107, y quien manda es ella: este
    // router no interpreta cabeceras ni elige códigos.
    expect(res.status).toBe(422);
    expect(res.body.error?.code).toBe('VALIDATION');

    // Lo que de verdad importa sigue siendo esto: sin empresa, a H2 no se le
    // preguntó nada. Un 422 que de todos modos hubiera consultado la membresía
    // seguiría siendo un oráculo de qué correos existen.
    expect(llamadas).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('lo único que se sirve sin contexto', () => {
  it('`/_status` no toca datos de nadie', async () => {
    delete process.env.PROXY_SECRET;
    process.env.NODE_ENV = 'production';

    const res = await pedir('/areas/_status', {});
    expect(res.status).toBe(200);
    expect(res.body.handoff).toBe('H11');
    expect(res.body.ready).toBe(true);
    expect(res.body.limits?.areas).toBeGreaterThan(0);
    expect(llamadas).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('el orden de las rutas', () => {
  beforeEach(() => {
    delete process.env.PROXY_SECRET;
    process.env.NODE_ENV = 'production';
  });

  it('`/milestones` no se enruta como un slug de área', async () => {
    // Si `/:slug` fuera primero, `GET /areas/milestones` devolvería el área
    // llamada "milestones" — un 404 imposible de entender. Las dos mueren en la
    // misma puerta, así que lo que se compara es que la ruta EXISTE: un 404 de
    // Express (sin cuerpo de error nuestro) delataría el desvío.
    const res = await pedir('/areas/milestones', CABECERAS_FORJADAS);
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe('UNAUTHENTICATED');
  });

  it('una ruta que no existe sí da 404', async () => {
    const res = await pedir('/areas/ventas/inventada', CABECERAS_FORJADAS, { method: 'POST' });
    expect(res.status).toBe(404);
  });
});
