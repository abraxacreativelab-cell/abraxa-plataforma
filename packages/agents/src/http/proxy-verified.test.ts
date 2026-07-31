/**
 * Prueba de CONTRATO, no una segunda fuente de verdad.
 *
 * La tabla de casos completa vive donde vive la implementación:
 * `packages/db/src/http/proxy-verified.test.ts`. Aquí sólo se afirma que lo
 * que `@abraxa/agents` re-exporta es exactamente esa función y no una copia
 * que un día divergió — que es justo lo que había hasta hoy.
 *
 * Se conservan los dos casos que de verdad le importan a un carril: el
 * fail-closed en producción y que un secreto inventado no sirve. Si este
 * archivo empieza a crecer otra vez, es la señal de que alguien está
 * reimplementando la pieza.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HEADER } from '@abraxa/config';
import { proxyVerified as canonico } from '@abraxa/db';
import { proxyVerified } from './proxy-verified';

const req = (headers: Record<string, string> = {}) => ({ headers });

const PROXY_ORIGINAL = process.env.PROXY_SECRET;
const NODE_ENV_ORIGINAL = process.env.NODE_ENV;

afterEach(() => {
  if (PROXY_ORIGINAL === undefined) delete process.env.PROXY_SECRET;
  else process.env.PROXY_SECRET = PROXY_ORIGINAL;

  if (NODE_ENV_ORIGINAL === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = NODE_ENV_ORIGINAL;
});

describe('proxyVerified — el re-export de @abraxa/agents', () => {
  it('es la MISMA función que la canónica de @abraxa/db', () => {
    expect(proxyVerified).toBe(canonico);
  });

  it('en producción sin PROXY_SECRET rechaza (fail-closed)', () => {
    delete process.env.PROXY_SECRET;
    process.env.NODE_ENV = 'production';

    expect(proxyVerified(req())).toBe(false);
    expect(proxyVerified(req({ [HEADER.proxySecret]: 'lo-que-sea' }))).toBe(false);
  });

  it('con secreto configurado exige el correcto', () => {
    const SECRETO = 'secreto-de-prueba-suficientemente-largo';
    process.env.NODE_ENV = 'production';
    process.env.PROXY_SECRET = SECRETO;

    expect(proxyVerified(req({ [HEADER.proxySecret]: SECRETO }))).toBe(true);
    expect(
      proxyVerified(req({ [HEADER.proxySecret]: 'secreto-de-prueba-suficientemente-LARGO' })),
    ).toBe(false);
  });
});
