/**
 * La tabla de casos del guardia de autenticación.
 *
 * El caso que importa es el último: producción SIN `PROXY_SECRET`. Un deploy
 * que pierde la variable no puede reabrir la suplantación por header — tiene
 * que caerse cerrado. En un CRM, esa puerta es leer la cartera de clientes de
 * otra empresa.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { HEADER } from '@abraxa/config';
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

describe('proxyVerified', () => {
  it('con secreto configurado, acepta el correcto', () => {
    process.env.PROXY_SECRET = SECRETO;
    expect(proxyVerified(pedir(SECRETO))).toBe(true);
  });

  it('con secreto configurado, rechaza el incorrecto', () => {
    process.env.PROXY_SECRET = SECRETO;
    expect(proxyVerified(pedir('otro-secreto-cualquiera'))).toBe(false);
  });

  it('con secreto configurado, rechaza cuando no viene ninguno', () => {
    process.env.PROXY_SECRET = SECRETO;
    expect(proxyVerified(pedir())).toBe(false);
  });

  it('rechaza un secreto de otra longitud sin que timingSafeEqual lance', () => {
    process.env.PROXY_SECRET = SECRETO;
    expect(proxyVerified(pedir('corto'))).toBe(false);
  });

  it('en desarrollo sin secreto, deja pasar para poder trabajar sin BFF', () => {
    delete process.env.PROXY_SECRET;
    process.env.NODE_ENV = 'development';
    expect(proxyVerified(pedir())).toBe(true);
  });

  /** El caso que justifica el archivo. */
  it('en PRODUCCIÓN sin secreto, CIERRA la vía de headers', () => {
    delete process.env.PROXY_SECRET;
    process.env.NODE_ENV = 'production';
    expect(proxyVerified(pedir())).toBe(false);
    expect(proxyVerified(pedir('lo-que-sea'))).toBe(false);
  });
});
