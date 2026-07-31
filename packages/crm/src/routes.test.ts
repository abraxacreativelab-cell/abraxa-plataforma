/**
 * ════════════════════════════════════════════════════════════════════════════
 *  La quinta copia de `contextoDe`, y lo que se le había escapado
 * ════════════════════════════════════════════════════════════════════════════
 *
 * El `contextoDe` que vivía en `routes.ts` estaba BIEN en lo que costó caro a
 * otros tres carriles: comprobaba `proxyVerified()` antes de mirar un solo
 * header. **Aquí no había agujero, y decirlo importa.** El hallazgo es otro:
 * era la QUINTA copia, y una copia correcta hoy es una copia que mañana
 * diverge — que es exactamente lo que pasó con H3, H6, H7 y H4.
 *
 * Ya había divergido en algo medible, aunque no explotable: la copia entregaba
 * el correo TAL CUAL a `TenancyPort.contextFor()` —`'Ana@Panaderia.MX'`—
 * mientras la pieza canónica lo recorta y lo pasa a minúsculas antes. Hoy no
 * cambia el resultado porque `contextFor` vuelve a normalizar por su cuenta;
 * mañana, con otra implementación del port o con un doble en la prueba de otro
 * carril, sí. Está fijado abajo («el correo llega normalizado»), y es el caso
 * que se pone rojo si alguien reintroduce la copia.
 *
 * La evidencia dura del hallazgo, sin embargo, no es una prueba de vitest sino
 * `npm run lint`: con el `main` del PR #16, `eslint.config.mjs` marca leer
 * `x-user-email` / `x-tenant-slug` / `x-proxy-secret` fuera de la pieza
 * canónica. La versión anterior de estos dos archivos daba **6 errores**.
 *
 * En lo demás, estas pruebas son guardia de regresión: fijan que el borde
 * aguanta. La aserción que importa no es el código HTTP: es
 * `llamadas.length === 0`. Un 401 que de todos modos consultó la membresía
 * sigue siendo un oráculo.
 *
 * Estas pruebas corren con el port `tenancy` REGISTRADO, que es el mundo de
 * hoy —H2 mergeó en el PR #6— y el único en el que la falla sería explotable.
 * Sin registrarlo, todo respondería 501 y cualquier prueba pasaría de casualidad.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HEADER } from '@abraxa/config';
import { PlatformError, registerPort, __clearPorts } from '@abraxa/db';
import type { TenancyPort } from '@abraxa/db';
import { router } from './routes';

const SECRETO = 'secreto-de-prueba-suficientemente-largo'; // abraxa-allow-secret

// Se restauran las dos variables una por una: reemplazar `process.env` entero
// deja un objeto que ya no es el del proceso y cuelga los POST (la trampa que
// documenta `packages/agents/src/routes.test.ts`).
const PROXY_ORIGINAL = process.env.PROXY_SECRET;
const NODE_ENV_ORIGINAL = process.env.NODE_ENV;

/** Llamadas que llegaron a `contextFor`. Vacío = la puerta aguantó. */
let llamadas: Array<{ userEmail: string; tenantSlug: string }> = [];

/**
 * Doble de H2. No devuelve contexto: LANZA un centinela, así el camino
 * "atravesó las tres puertas" se distingue sin ambigüedad y sin base viva.
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
  if (PROXY_ORIGINAL === undefined) delete process.env.PROXY_SECRET;
  else process.env.PROXY_SECRET = PROXY_ORIGINAL;
  if (NODE_ENV_ORIGINAL === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = NODE_ENV_ORIGINAL;
});

// ─────────────────────────────────────────────────────────────────────────────
// El arnés: un servidor real y un cliente sin keep-alive.
// ─────────────────────────────────────────────────────────────────────────────
let base = '';
let server: http.Server;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/crm', router);

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
 * No se usa `fetch`: con el pool de undici los POST se quedan esperando el
 * `keepAliveTimeout` del servidor y la prueba parece un fantasma. Un socket
 * por petición no tiene ese problema.
 */
function pedir(
  ruta: string,
  headers: Record<string, string>,
  opciones: { method?: string } = {},
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
    req.end();
  });
}

/** Lectura, escritura y la ruta destructiva. Una de cada clase. */
const RUTAS_CON_CONTEXTO = [
  ['GET', '/crm/contacts'],
  ['GET', '/crm/pipelines'],
  ['POST', '/crm/merge'],
] as const;

// ═════════════════════════════════════════════════════════════════════════════
describe('rutas del CRM · sin PROXY_SECRET en producción', () => {
  beforeEach(() => {
    delete process.env.PROXY_SECRET;
    process.env.NODE_ENV = 'production';
  });

  it.each(RUTAS_CON_CONTEXTO)(
    '%s %s con x-user-email crudo NO produce contexto (fail-closed)',
    async (method, ruta) => {
      const res = await pedir(
        ruta,
        {
          [HEADER.userEmail]: 'atacante@example.com',
          [HEADER.tenantSlug]: 'empresa-de-otro',
        },
        { method },
      );

      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe('UNAUTHENTICATED');
      // Lo que de verdad se mide: tenancy nunca se enteró.
      expect(llamadas).toEqual([]);
    },
  );

  it('inventarse un x-proxy-secret no sirve de nada', async () => {
    const res = await pedir('/crm/contacts', {
      [HEADER.userEmail]: 'atacante@example.com',
      [HEADER.tenantSlug]: 'empresa-de-otro',
      [HEADER.proxySecret]: 'lo-que-sea',
    });

    expect(res.status).toBe(401);
    expect(llamadas).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('rutas del CRM · con PROXY_SECRET configurado', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    process.env.PROXY_SECRET = SECRETO;
  });

  it('sin el secreto compartido, la identidad completa no vale', async () => {
    const res = await pedir('/crm/contacts', {
      [HEADER.userEmail]: 'atacante@example.com',
      [HEADER.tenantSlug]: 'empresa-de-otro',
    });

    expect(res.status).toBe(401);
    expect(llamadas).toEqual([]);
  });

  /**
   * Guardia de regresión, no hallazgo: la copia también aguantaba este caso,
   * porque el parser de HTTP de node ya recorta el OWS del valor y `''` es
   * falso. Se deja fijado porque la próxima implementación podría no hacerlo.
   */
  it('un x-user-email en BLANCO no llega a la capa de membresías', async () => {
    const res = await pedir('/crm/contacts', {
      [HEADER.proxySecret]: SECRETO,
      [HEADER.userEmail]: '   ',
      [HEADER.tenantSlug]: 'empresa-de-otro',
    });

    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe('UNAUTHENTICATED');
    expect(llamadas).toEqual([]);
  });

  it('sin empresa indicada es VALIDATION (422), no 401 ni una consulta', async () => {
    const res = await pedir('/crm/contacts', {
      [HEADER.proxySecret]: SECRETO,
      [HEADER.userEmail]: 'ana@panaderia.mx',
    });

    expect(res.status).toBe(422);
    expect(res.body.error?.code).toBe('VALIDATION');
    expect(llamadas).toEqual([]);
  });

  /** ★ El caso que distingue la pieza canónica de la copia que había. */
  it('con el secreto correcto SÍ atraviesa, y el correo llega normalizado', async () => {
    const res = await pedir('/crm/contacts', {
      [HEADER.proxySecret]: SECRETO,
      [HEADER.userEmail]: '  Ana@Panaderia.MX ',
      [HEADER.tenantSlug]: 'panaderia',
    });

    expect(res.status).toBe(409);
    expect(res.body.error?.message).toBe(CENTINELA);
    expect(llamadas).toEqual([{ userEmail: 'ana@panaderia.mx', tenantSlug: 'panaderia' }]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('la ruta de salud', () => {
  it('no pide contexto: dice si el paquete vive, no datos de nadie', async () => {
    const res = await pedir('/crm/_status', {});
    expect(res.status).toBe(200);
    expect(res.body.ready).toBe(true);
    expect(llamadas).toEqual([]);
  });
});
