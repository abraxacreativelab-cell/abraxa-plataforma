/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El agujero del PR #8: dos cabeceras inventadas y el Ritual entero es tuyo.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * `packages/onboarding/src/routes.ts:30-42` leía `x-user-email` y
 * `x-tenant-slug` con `req.header()` y se los pasaba directo a
 * `usePort('tenancy').contextFor()`. Nunca llamaba a `proxyVerified()`.
 *
 * Un header no acredita nada: lo pone cualquiera con un `curl`. Lo único que
 * hacía que "no pasara nada" era que el port de H2 no estaba registrado — y H2
 * mergeó en el PR #6. La defensa no era el código: era el calendario, y venció.
 *
 * ── Qué se prueba, y por qué así ──────────────────────────────────────────
 *
 * No se llama a una función interna: se levanta la app de Express de verdad,
 * con el router montado como lo monta `apps/api`, y se le manda una petición
 * HTTP real por un socket real. Es la única forma de demostrar que la petición
 * forjada NO atraviesa el borde.
 *
 * Y la aserción que importa no es el código de estado: es
 * `llamadas.length === 0`. Un 401 que de todos modos preguntó por la membresía
 * sigue siendo un oráculo — le dice al atacante qué correos y qué empresas
 * existen. La puerta del proxy va ANTES de mirar un solo header de identidad.
 *
 * El cuarto caso (`con el secreto correcto`) es el que impide que este archivo
 * se convierta en "niega todo": comprueba que la petición legítima SÍ llega a
 * H2 con la identidad intacta.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { HEADER } from '@abraxa/config';
import { PlatformError, registerPort, __clearPorts } from '@abraxa/db';
import type { TenancyPort } from '@abraxa/db';
import { router } from './routes';

const SECRETO = 'secreto-de-prueba-suficientemente-largo';
const CENTINELA = 'centinela: contextFor fue invocado';

/** Cada vez que alguien preguntó por una membresía. Vacío = nadie tocó a H2. */
let llamadas: Array<{ userEmail: string; tenantSlug: string }> = [];

const tenancyFalso = {
  contextFor: (i: { userEmail: string; tenantSlug: string }) => {
    llamadas.push(i);
    // Se rechaza a propósito: lo que se mide aquí es si la petición LLEGÓ hasta
    // H2, no qué hace el Ritual después. Así ninguna prueba toca la base.
    return Promise.reject(new PlatformError('CONFLICT', CENTINELA));
  },
} as unknown as TenancyPort;

// ── La app real, como la monta apps/api ────────────────────────────────────
let servidor: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/onboarding', router);

  servidor = await new Promise<Server>((listo) => {
    const s = app.listen(0, '127.0.0.1', () => listo(s));
  });
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((listo) => servidor.close(() => listo()));
});

// Se restauran una por una: reemplazar `process.env` entero deja un objeto que
// ya no es el del proceso.
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

interface Respuesta {
  status: number;
  cuerpo: { error?: { code?: string; message?: string } };
}

async function pedir(
  ruta: string,
  cabeceras: Record<string, string>,
  metodo: 'GET' | 'POST' = 'GET',
): Promise<Respuesta> {
  const r = await fetch(`${base}${ruta}`, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...cabeceras },
    ...(metodo === 'POST' ? { body: '{}' } : {}),
  });
  return { status: r.status, cuerpo: (await r.json()) as Respuesta['cuerpo'] };
}

/** Las seis rutas del Ritual que resuelven contexto. `_status` no cuenta: es salud. */
const RUTAS: Array<[string, 'GET' | 'POST']> = [
  ['/onboarding/ritual', 'GET'],
  ['/onboarding/ritual/iniciar', 'POST'],
  ['/onboarding/ritual/turno', 'POST'],
  ['/onboarding/ritual/pausa', 'POST'],
  ['/onboarding/ritual/mapa', 'GET'],
  ['/onboarding/ritual/proyectar-pendientes', 'POST'],
];

const FORJADAS = {
  [HEADER.userEmail]: 'atacante@example.com',
  [HEADER.tenantSlug]: 'empresa-de-otro',
};

// ═════════════════════════════════════════════════════════════════════════════
describe('el Ritual · sin PROXY_SECRET en producción', () => {
  beforeEach(() => {
    delete process.env.PROXY_SECRET;
    process.env.NODE_ENV = 'production';
  });

  it.each(RUTAS)('%s no se abre con cabeceras forjadas (fail-closed)', async (ruta, metodo) => {
    const r = await pedir(ruta, FORJADAS, metodo);

    expect(r.status).toBe(401);
    expect(r.cuerpo.error?.code).toBe('UNAUTHENTICATED');
    // Lo que de verdad se mide: H2 nunca se enteró de esta petición.
    expect(llamadas).toEqual([]);
  });

  it('inventarse un x-proxy-secret tampoco sirve', async () => {
    const r = await pedir('/onboarding/ritual', {
      ...FORJADAS,
      [HEADER.proxySecret]: 'lo-que-sea',
    });

    expect(r.status).toBe(401);
    expect(llamadas).toEqual([]);
  });

  it('la respuesta no le dice al atacante nada que no supiera', async () => {
    const r = await pedir('/onboarding/ritual', FORJADAS);
    const mensaje = r.cuerpo.error?.message ?? '';

    // Ni el correo que mandó ni la empresa que pidió aparecen de vuelta: nada
    // que sirva para enumerar cuentas o confirmar que una empresa existe.
    expect(mensaje).not.toContain('atacante@example.com');
    expect(mensaje).not.toContain('empresa-de-otro');
  });

  it('la salud del carril sigue siendo pública: no expone datos de nadie', async () => {
    const r = await fetch(`${base}/onboarding/_status`);
    expect(r.status).toBe(200);
    expect(llamadas).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('el Ritual · con PROXY_SECRET configurado', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    process.env.PROXY_SECRET = SECRETO;
  });

  it('rechaza sin el secreto, aunque la identidad venga completa', async () => {
    const r = await pedir('/onboarding/ritual/turno', FORJADAS, 'POST');

    expect(r.status).toBe(401);
    expect(llamadas).toEqual([]);
  });

  it('rechaza un secreto incorrecto de la misma longitud', async () => {
    const r = await pedir('/onboarding/ritual', {
      ...FORJADAS,
      [HEADER.proxySecret]: 'secreto-de-prueba-suficientemente-LARGO',
    });

    expect(r.status).toBe(401);
    expect(llamadas).toEqual([]);
  });

  it('con el secreto correcto SÍ pasa a validar la membresía en H2', async () => {
    const r = await pedir('/onboarding/ritual', {
      [HEADER.userEmail]: 'Duena@Example.com',
      [HEADER.tenantSlug]: 'su-empresa',
      [HEADER.proxySecret]: SECRETO,
    });

    expect(r.cuerpo.error?.message).toBe(CENTINELA);
    // El correo llega normalizado, como se guarda en `app.users`.
    expect(llamadas).toEqual([{ userEmail: 'duena@example.com', tenantSlug: 'su-empresa' }]);
  });

  it('con el proxy verificado pero sin empresa, es VALIDATION y no 401', async () => {
    // La diferencia importa: 401 dice "no sé quién eres" y 422 dice "sé quién
    // eres, falta decirme de qué empresa". Confundirlas manda al usuario a
    // volver a iniciar sesión por un dato que él no puso.
    const r = await pedir('/onboarding/ritual', {
      [HEADER.userEmail]: 'duena@example.com',
      [HEADER.proxySecret]: SECRETO,
    });

    expect(r.status).toBe(422);
    expect(r.cuerpo.error?.code).toBe('VALIDATION');
    expect(llamadas).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('el Ritual · lo que NO cambia', () => {
  it('en desarrollo, sin secreto, se sigue pudiendo trabajar sin BFF', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.PROXY_SECRET;

    const r = await pedir('/onboarding/ritual', {
      [HEADER.userEmail]: 'yo@example.com',
      [HEADER.tenantSlug]: 'mia',
    });

    expect(r.cuerpo.error?.message).toBe(CENTINELA);
    expect(llamadas).toHaveLength(1);
  });

  it('sin el port de tenancy sigue siendo 501, no un contexto inventado', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.PROXY_SECRET;
    __clearPorts();

    const r = await pedir('/onboarding/ritual', {
      [HEADER.userEmail]: 'yo@example.com',
      [HEADER.tenantSlug]: 'mia',
    });

    expect(r.status).toBe(501);
    expect(r.cuerpo.error?.code).toBe('PORT_NOT_IMPLEMENTED');
  });
});
