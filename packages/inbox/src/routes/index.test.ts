/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El agujero de H0 (#12), reabierto en la bandeja. Y su puerta.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Estas pruebas corren con el port `tenancy` REGISTRADO — es decir, simulan el
 * mundo REAL de hoy, con H2 ya en `main`. Ése es el único mundo en el que la
 * falla es explotable, y por eso es el único que vale la pena probar: si el
 * port no estuviera registrado, todo devolvería 501 y cualquier prueba pasaría
 * por accidente.
 *
 * La aserción que importa no es el código HTTP: es `llamadas.length === 0`.
 * Mide que el header de identidad NUNCA llegó a convertirse en un contexto de
 * empresa. Un 401 que igual consultó la membresía seguiría siendo un oráculo —
 * y en esta superficie, un 200 sería la bandeja completa de otra empresa: cada
 * conversación y cada teléfono de cada uno de sus clientes.
 *
 * El escenario textual del hallazgo:
 *
 *   curl -H 'x-user-email: santiago@abraxa.club' \
 *        -H 'x-tenant-slug: otra-empresa' https://api…/inbox/threads
 *
 * Y es alcanzable desde fuera precisamente por culpa de este carril: para que
 * WhatsApp funcione, Evolution tiene que poder hacer POST a
 * `/inbox/webhooks/:id`, así que `apps/api` no puede vivir en una red privada.
 *
 * El arnés (servidor real, `agent: false`, POST sin cuerpo) está copiado de
 * `packages/agents/src/routes.test.ts`, incluidas sus dos notas de por qué:
 * ahí costaron una tarde de fantasmas.
 *
 * ── Qué se prueba, y qué NO ────────────────────────────────────────────────
 *
 * Aquí NO se re-prueba `proxyVerified` ni `contextoDePeticion` por dentro: eso
 * vive en `packages/db/src/http/*.test.ts`, que es de H0, y duplicarlo sólo
 * garantiza que las dos copias se separen. Lo que se prueba es lo del carril:
 * que TODA ruta de la bandeja que arma contexto pasa por esa pieza, incluidas
 * las que mandan un WhatsApp real, y que las dos superficies que a propósito
 * son públicas —`/_status` y el webhook de Evolution— siguen abiertas.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HEADER } from '@abraxa/config';
import { PlatformError, registerPort, __clearPorts } from '@abraxa/db';
import type { TenancyPort } from '@abraxa/db';
import { router } from './index';

const SECRETO = 'secreto-de-prueba-suficientemente-largo';

/**
 * Se restauran las DOS variables que estas pruebas tocan, una por una.
 *
 * Reemplazar `process.env` entero es el idiom común y es una trampa: deja un
 * objeto que ya no es el del proceso, y en la suite gemela de H3 eso colgaba el
 * único POST hasta el timeout.
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
  app.use('/inbox', router);

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
  drivers?: unknown;
}

/**
 * Una petición contra el router, con `agent: false`.
 *
 * Deliberadamente NO se usa `fetch`. Con el cliente de undici las pruebas
 * gemelas de H3 pasaban en GET y el POST se colgaba ~5 s —hasta el
 * `keepAliveTimeout` del servidor— porque el socket se queda en el pool y un
 * POST no es reintentable. `agent: false` abre y cierra un socket por petición.
 */
function pedir(
  ruta: string,
  headers: Record<string, string>,
  opciones: { method?: string; body?: string } = {},
): Promise<{ status: number; body: Cuerpo }> {
  return new Promise((resolver, rechazar) => {
    const req = http.request(
      `${base}${ruta}`,
      {
        method: opciones.method ?? 'GET',
        headers: { connection: 'close', ...headers },
        agent: false,
      },
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

/** Toda ruta de la bandeja que arma contexto. Ninguna puede quedarse fuera. */
const RUTAS_CON_CONTEXTO = [
  '/inbox/channels',
  '/inbox/threads',
  '/inbox/threads/hilo-de-otro',
  '/inbox/channels/canal-de-otro/status',
] as const;

const IDENTIDAD_ROBADA = {
  [HEADER.userEmail]: 'santiago@abraxa.club',
  [HEADER.tenantSlug]: 'otra-empresa',
};

// ═════════════════════════════════════════════════════════════════════════════
describe('rutas de la bandeja · sin PROXY_SECRET en producción', () => {
  beforeEach(() => {
    delete process.env.PROXY_SECRET;
    process.env.NODE_ENV = 'production';
  });

  it.each(RUTAS_CON_CONTEXTO)(
    'GET %s con x-user-email crudo NO produce contexto (fail-closed)',
    async (ruta) => {
      const res = await pedir(ruta, IDENTIDAD_ROBADA);

      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe('UNAUTHENTICATED');

      // Lo que de verdad se está midiendo: tenancy nunca se enteró.
      expect(llamadas).toEqual([]);
    },
  );

  /**
   * El POST es el que de verdad duele: manda un WhatsApp REAL desde la línea de
   * la empresa a su cliente, queda registrado como escrito por un humano, y de
   * paso toma el hilo — con lo que además calla a su agente.
   *
   * A propósito SIN cuerpo, que es además como lo probaría alguien con `curl`.
   * Con un cuerpo JSON, `express.json()` carga `raw-body`/`iconv-lite` de forma
   * perezosa en la PRIMERA petición con cuerpo, y ese require en frío se come
   * el presupuesto de tiempo. La afirmación de seguridad es idéntica: el 401
   * ocurre antes de que nadie mire `req.body`.
   */
  it('POST /inbox/threads/:id/messages tampoco: es mandar un WhatsApp real', async () => {
    const res = await pedir('/inbox/threads/hilo-de-otro/messages', IDENTIDAD_ROBADA, {
      method: 'POST',
    });

    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe('UNAUTHENTICATED');
    expect(llamadas).toEqual([]);
  });

  it('DELETE /inbox/channels/:id tampoco: es desconectar la línea de otro', async () => {
    const res = await pedir('/inbox/channels/canal-de-otro', IDENTIDAD_ROBADA, {
      method: 'DELETE',
    });

    expect(res.status).toBe(401);
    expect(llamadas).toEqual([]);
  });

  it('inventarse un x-proxy-secret no sirve de nada', async () => {
    const res = await pedir('/inbox/threads', {
      ...IDENTIDAD_ROBADA,
      [HEADER.proxySecret]: 'lo-que-sea',
    });

    expect(res.status).toBe(401);
    expect(llamadas).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('rutas de la bandeja · con PROXY_SECRET configurado', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    process.env.PROXY_SECRET = SECRETO;
  });

  it('rechaza sin el secreto, aunque la identidad venga completa', async () => {
    const res = await pedir('/inbox/threads', IDENTIDAD_ROBADA);

    expect(res.status).toBe(401);
    expect(llamadas).toEqual([]);
  });

  it('rechaza un secreto incorrecto de la misma longitud', async () => {
    const res = await pedir('/inbox/threads', {
      ...IDENTIDAD_ROBADA,
      [HEADER.proxySecret]: 'secreto-de-prueba-suficientemente-LARGO',
    });

    expect(res.status).toBe(401);
    expect(llamadas).toEqual([]);
  });

  it('CON el secreto correcto sí pasa a validar la membresía (la puerta no rompe el camino feliz)', async () => {
    const res = await pedir('/inbox/threads', {
      ...IDENTIDAD_ROBADA,
      [HEADER.proxySecret]: SECRETO,
    });

    // 409 = el centinela del doble de H2: `contextFor` fue invocado.
    expect(res.status).toBe(409);
    expect(res.body.error?.message).toBe(CENTINELA);
    expect(llamadas).toEqual([
      { userEmail: 'santiago@abraxa.club', tenantSlug: 'otra-empresa' },
    ]);
  });

  it('con el secreto pero sin identidad: 401 y tenancy tampoco se entera', async () => {
    const res = await pedir('/inbox/threads', { [HEADER.proxySecret]: SECRETO });

    expect(res.status).toBe(401);
    expect(llamadas).toEqual([]);
  });

  /**
   * Con correo pero sin slug NO es 401: es 400.
   *
   * La distinción es del contrato de la pieza canónica y no es cosmética. 401
   * significa «no sé quién eres» y el BFF reacciona mandando a iniciar sesión;
   * aquí sí sabemos quién eres, lo que falta es de qué empresa hablas. Un 401
   * en este caso echaría de la aplicación a un usuario perfectamente autenticado
   * cada vez que el selector de empresa se quedara sin valor.
   */
  it('con identidad pero sin empresa: 422 VALIDATION, no 401', async () => {
    const res = await pedir('/inbox/threads', {
      [HEADER.proxySecret]: SECRETO,
      [HEADER.userEmail]: 'santiago@abraxa.club',
    });

    // 422 y no 400: es el mapeo de `VALIDATION` en el catálogo de
    // `packages/db/src/errors.ts`, que es de H0. Lo que importa aquí es que NO
    // sea 401.
    expect(res.status).toBe(422);
    expect(res.body.error?.code).toBe('VALIDATION');
    expect(llamadas).toEqual([]);
  });

  /**
   * ── Por qué esta prueba existe: es lo que se GANA al importar la canónica ──
   *
   * El `contextoDe` casero de este archivo pasaba `req.header(...)` tal cual a
   * `contextFor()`. `contextoDePeticion` normaliza: recorta y baja a minúsculas,
   * igual que `app.users` guarda los correos.
   *
   * Sin normalizar, un BFF que entregue el correo como lo escribió el proveedor
   * de identidad —`Santiago@Abraxa.Club`— no cuadra con la fila de la membresía
   * y H2 responde 403: el dueño de la empresa se queda fuera de su propia
   * bandeja. Y en el sentido contrario es peor: cualquier comparación de
   * identidad sensible a mayúsculas trata `A@x.com` y `a@x.com` como dos
   * personas distintas.
   *
   * Esta prueba falla contra el resolvedor casero. Es la razón concreta por la
   * que el hallazgo A se cierra importando y no copiando.
   */
  it('normaliza el correo antes de preguntar por la membresía (recorta y baja a minúsculas)', async () => {
    const res = await pedir('/inbox/threads', {
      [HEADER.proxySecret]: SECRETO,
      [HEADER.userEmail]: '  Santiago@Abraxa.Club  ',
      [HEADER.tenantSlug]: 'abraxa',
    });

    expect(res.status).toBe(409);
    expect(llamadas).toEqual([{ userEmail: 'santiago@abraxa.club', tenantSlug: 'abraxa' }]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('lo que sigue siendo público a propósito', () => {
  beforeEach(() => {
    delete process.env.PROXY_SECRET;
    process.env.NODE_ENV = 'production';
  });

  it('GET /inbox/_status no lleva sesión: es la salud del carril', async () => {
    const res = await pedir('/inbox/_status', {});
    expect(res.status).toBe(200);
    expect(res.body.ready).toBe(true);
  });

  /**
   * El webhook NO puede llevar el secreto del BFF: lo llama Evolution, no el
   * proxy. Su autenticación es otra —el token del canal, comparado en tiempo
   * constante contra `config.webhook_token`— y esa vía está probada en
   * `channels/lookup` y en `ingest.test.ts`. Lo que se verifica aquí es que la
   * puerta nueva NO se la comió: un 401 de `UNAUTHENTICATED` aquí significaría
   * que ningún WhatsApp vuelve a entrar nunca.
   */
  it('GET /inbox/webhooks/:id sigue respondiendo el ping del proveedor', async () => {
    const res = await pedir('/inbox/webhooks/canal-cualquiera', {});
    expect(res.status).toBe(200);
    expect(llamadas).toEqual([]);
  });
});
