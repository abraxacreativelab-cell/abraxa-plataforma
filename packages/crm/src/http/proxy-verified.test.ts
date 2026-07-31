/**
 * Prueba de CONTRATO, no una segunda fuente de verdad.
 *
 * La tabla de casos completa vive donde vive la implementación:
 * `packages/db/src/http/proxy-verified.test.ts`. Aquí se afirma que lo que
 * `@abraxa/crm` re-exporta es EXACTAMENTE esa función y no una copia — que es
 * lo que había hasta el cierre de la auditoría del PR #9. La primera prueba es
 * la que falla en cuanto alguien vuelve a pegar el cuerpo aquí.
 *
 * Se conservan los dos casos que de verdad le importan a este carril, porque
 * son la razón por la que el archivo existió: el fail-closed en producción y
 * que un secreto inventado no sirve. En un CRM esa puerta es leer la cartera de
 * clientes de otra empresa.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { HEADER } from '@abraxa/config';
import { proxyVerified as canonico } from '@abraxa/db';
import { proxyVerified } from './proxy-verified';

const pedir = (secreto?: string): Pick<Request, 'headers'> => ({
  headers: secreto === undefined ? {} : { [HEADER.proxySecret]: secreto },
});

const SECRETO = 'un-secreto-de-prueba-largo'; // abraxa-allow-secret

let entornoPrevio: { node: string | undefined; proxy: string | undefined };

beforeEach(() => {
  entornoPrevio = { node: process.env.NODE_ENV, proxy: process.env.PROXY_SECRET };
});

afterEach(() => {
  if (entornoPrevio.node === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = entornoPrevio.node;
  if (entornoPrevio.proxy === undefined) delete process.env.PROXY_SECRET;
  else process.env.PROXY_SECRET = entornoPrevio.proxy;
});

describe('proxyVerified — el re-export de @abraxa/crm', () => {
  /** ★ La prueba del hallazgo: una copia correcta hoy es una copia que diverge. */
  it('es la MISMA función que la canónica de @abraxa/db, no una copia', () => {
    expect(proxyVerified).toBe(canonico);
  });

  it('con secreto configurado, acepta el correcto', () => {
    process.env.PROXY_SECRET = SECRETO;
    expect(proxyVerified(pedir(SECRETO))).toBe(true);
  });

  it('con secreto configurado, rechaza el incorrecto', () => {
    process.env.PROXY_SECRET = SECRETO;
    expect(proxyVerified(pedir('otro-secreto-cualquiera'))).toBe(false);
  });

  it('rechaza un secreto de otra longitud sin que timingSafeEqual lance', () => {
    process.env.PROXY_SECRET = SECRETO;
    expect(proxyVerified(pedir('corto'))).toBe(false);
  });

  /** El caso que justificó el archivo. */
  it('en PRODUCCIÓN sin secreto, CIERRA la vía de headers', () => {
    delete process.env.PROXY_SECRET;
    process.env.NODE_ENV = 'production';
    expect(proxyVerified(pedir())).toBe(false);
    expect(proxyVerified(pedir('lo-que-sea'))).toBe(false);
  });
});
