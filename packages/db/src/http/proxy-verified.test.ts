/**
 * La tabla de casos del contrato BFF→API. Ésta es la copia CANÓNICA: las de
 * `@abraxa/tenancy` y `@abraxa/agents` corren sobre el re-export y por eso
 * valen como pruebas de contrato, no como una segunda fuente de verdad.
 *
 * Es el caso que uno nunca prueba a mano porque "obviamente" la variable va a
 * estar puesta. Y es exactamente el caso en el que una rotación a medias
 * convierte `x-user-email` en un campo de texto libre.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HEADER } from '@abraxa/config';
import { proxyVerified } from './proxy-verified';

const req = (headers: Record<string, string> = {}) => ({ headers });

// Se restauran las dos variables una por una y no se reemplaza `process.env`
// entero: hacerlo deja un objeto que ya no es el del proceso, y eso rompió una
// prueba vecina de forma dificilísima de diagnosticar (ver agents/routes.test.ts).
const PROXY_ORIGINAL = process.env.PROXY_SECRET;
const NODE_ENV_ORIGINAL = process.env.NODE_ENV;

afterEach(() => {
  if (PROXY_ORIGINAL === undefined) delete process.env.PROXY_SECRET;
  else process.env.PROXY_SECRET = PROXY_ORIGINAL;

  if (NODE_ENV_ORIGINAL === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = NODE_ENV_ORIGINAL;
});

describe('proxyVerified — sin secreto configurado', () => {
  it('en PRODUCCIÓN rechaza (fail-closed)', () => {
    delete process.env.PROXY_SECRET;
    process.env.NODE_ENV = 'production';

    expect(proxyVerified(req())).toBe(false);
    // Ni siquiera mandando algo que parezca un secreto.
    expect(proxyVerified(req({ [HEADER.proxySecret]: 'lo-que-sea' }))).toBe(false);
  });

  it('en desarrollo permite la vía directa (para trabajar sin BFF)', () => {
    delete process.env.PROXY_SECRET;
    process.env.NODE_ENV = 'development';

    expect(proxyVerified(req())).toBe(true);
  });

  it('en pruebas también, que es como corre esta suite', () => {
    delete process.env.PROXY_SECRET;
    process.env.NODE_ENV = 'test';

    expect(proxyVerified(req())).toBe(true);
  });
});

describe('proxyVerified — con secreto configurado', () => {
  const SECRETO = 'secreto-de-prueba-suficientemente-largo';

  it('acepta el secreto correcto', () => {
    process.env.PROXY_SECRET = SECRETO;
    expect(proxyVerified(req({ [HEADER.proxySecret]: SECRETO }))).toBe(true);
  });

  it('rechaza uno incorrecto de la misma longitud', () => {
    process.env.PROXY_SECRET = SECRETO;
    expect(
      proxyVerified(req({ [HEADER.proxySecret]: 'secreto-de-prueba-suficientemente-LARGO' })),
    ).toBe(false);
  });

  it('rechaza uno de longitud distinta sin reventar', () => {
    // `timingSafeEqual` lanza si los buffers difieren en tamaño; por eso la
    // comparación de longitud va antes.
    process.env.PROXY_SECRET = SECRETO;
    expect(() => proxyVerified(req({ [HEADER.proxySecret]: 'corto' }))).not.toThrow();
    expect(proxyVerified(req({ [HEADER.proxySecret]: 'corto' }))).toBe(false);
  });

  it('rechaza si no viene el header', () => {
    process.env.PROXY_SECRET = SECRETO;
    expect(proxyVerified(req())).toBe(false);
  });

  it('en producción, con secreto, sigue exigiéndolo', () => {
    process.env.NODE_ENV = 'production';
    process.env.PROXY_SECRET = SECRETO;

    expect(proxyVerified(req())).toBe(false);
    expect(proxyVerified(req({ [HEADER.proxySecret]: SECRETO }))).toBe(true);
  });
});
