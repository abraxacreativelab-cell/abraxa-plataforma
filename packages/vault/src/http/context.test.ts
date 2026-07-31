/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El mismo agujero, en `main`, sin detonador: ya está armado.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * El PR #12 cerró `x-user-email` sin verificar en `packages/agents`. La
 * auditoría lo volvió a encontrar en el PR #10 y en el PR #8. Buscándolo por
 * cuarta vez apareció aquí — y éste no está esperando ningún merge:
 *
 *   · `packages/vault/src/http/context.ts` NUNCA llama a `proxyVerified()`.
 *   · `apps/api/src/packages.ts:71` monta el router en `/vault`.
 *   · H2 YA mergeó (PR #6), así que `registerPort('tenancy')` ya corre.
 *
 * Es decir: en `main`, hoy, un `curl` con dos headers inventados atraviesa las
 * 40 rutas de la bóveda. Y la bóveda es justo donde vive lo que el negocio no
 * quiere que se vea: precios, márgenes, documentos.
 *
 * La aserción que importa no es el código HTTP: es `llamadas.length === 0`.
 * Un 401 que de todos modos consultó la membresía sigue siendo un oráculo.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HEADER } from '@abraxa/config';
import { PlatformError, registerPort, __clearPorts } from '@abraxa/db';
import type { TenancyPort } from '@abraxa/db';
import { contextoDe } from './context';

const SECRETO = 'secreto-de-prueba-suficientemente-largo';
const CENTINELA = 'centinela: contextFor fue invocado';

let llamadas: Array<{ userEmail: string; tenantSlug: string }> = [];

const tenancyFalso = {
  contextFor: (i: { userEmail: string; tenantSlug: string }) => {
    llamadas.push(i);
    return Promise.reject(new PlatformError('CONFLICT', CENTINELA));
  },
} as unknown as TenancyPort;

/**
 * Una petición con las dos formas de leer cabeceras que usa Express, porque el
 * arreglo cambia cuál se usa y la prueba no debe depender de eso.
 */
const peticion = (headers: Record<string, string>) => ({
  headers,
  header: (n: string) => headers[n.toLowerCase()],
});

// Se restauran las dos variables una por una: reemplazar `process.env` entero
// deja un objeto que ya no es el del proceso (ver agents/routes.test.ts).
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

// ═════════════════════════════════════════════════════════════════════════════
describe('bóveda · sin PROXY_SECRET en producción', () => {
  beforeEach(() => {
    delete process.env.PROXY_SECRET;
    process.env.NODE_ENV = 'production';
  });

  it('un x-user-email crudo NO produce contexto (fail-closed)', async () => {
    await expect(
      contextoDe(
        peticion({
          [HEADER.userEmail]: 'atacante@example.com',
          [HEADER.tenantSlug]: 'empresa-de-otro',
        }),
      ),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    // Lo que de verdad se mide: tenancy nunca se enteró.
    expect(llamadas).toEqual([]);
  });

  it('inventarse un x-proxy-secret tampoco sirve', async () => {
    await expect(
      contextoDe(
        peticion({
          [HEADER.userEmail]: 'atacante@example.com',
          [HEADER.tenantSlug]: 'empresa-de-otro',
          [HEADER.proxySecret]: 'lo-que-sea',
        }),
      ),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    expect(llamadas).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('bóveda · con PROXY_SECRET configurado', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    process.env.PROXY_SECRET = SECRETO;
  });

  it('rechaza sin el secreto, aunque la identidad venga completa', async () => {
    await expect(
      contextoDe(
        peticion({
          [HEADER.userEmail]: 'atacante@example.com',
          [HEADER.tenantSlug]: 'empresa-de-otro',
        }),
      ),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    expect(llamadas).toEqual([]);
  });

  it('rechaza un secreto incorrecto de la misma longitud', async () => {
    await expect(
      contextoDe(
        peticion({
          [HEADER.userEmail]: 'atacante@example.com',
          [HEADER.tenantSlug]: 'empresa-de-otro',
          [HEADER.proxySecret]: 'secreto-de-prueba-suficientemente-LARGO',
        }),
      ),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    expect(llamadas).toEqual([]);
  });

  it('con el secreto correcto SÍ pasa a validar la membresía en H2', async () => {
    await expect(
      contextoDe(
        peticion({
          [HEADER.userEmail]: 'duena@example.com',
          [HEADER.tenantSlug]: 'su-empresa',
          [HEADER.proxySecret]: SECRETO,
        }),
      ),
    ).rejects.toMatchObject({ message: CENTINELA });

    expect(llamadas).toEqual([{ userEmail: 'duena@example.com', tenantSlug: 'su-empresa' }]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('bóveda · lo que NO cambia', () => {
  it('en desarrollo, sin secreto, se sigue pudiendo trabajar sin BFF', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.PROXY_SECRET;

    await expect(
      contextoDe(peticion({ [HEADER.userEmail]: 'yo@example.com', [HEADER.tenantSlug]: 'mia' })),
    ).rejects.toMatchObject({ message: CENTINELA });

    expect(llamadas).toHaveLength(1);
  });

  it('sin el port de tenancy sigue siendo 501, no un contexto inventado', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.PROXY_SECRET;
    __clearPorts();

    await expect(
      contextoDe(peticion({ [HEADER.userEmail]: 'yo@example.com', [HEADER.tenantSlug]: 'mia' })),
    ).rejects.toMatchObject({ code: 'PORT_NOT_IMPLEMENTED' });
  });
});
