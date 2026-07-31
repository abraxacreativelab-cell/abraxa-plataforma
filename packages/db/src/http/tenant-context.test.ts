/**
 * ════════════════════════════════════════════════════════════════════════════
 *  La tabla de casos de la pieza canónica.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Estas pruebas son el contrato que heredan los catorce carriles. Si un día
 * alguien "simplifica" el orden de las puertas, aquí se entera.
 *
 * La aserción que importa nunca es el código HTTP: es `llamadas.length === 0`.
 * Mide que la cabecera de identidad NUNCA llegó a convertirse en un contexto de
 * empresa. Un 401 que igual consultó la membresía seguiría siendo un oráculo:
 * dice si un correo pertenece o no a una empresa sin haber probado ser nadie.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HEADER } from '@abraxa/config';
import type { TenancyPort } from '../../ports';
import { PlatformError } from '../errors';
import { registerPort, __clearPorts } from '../port-registry';
import { contextoDePeticion, correoVerificadoDe, responderError } from './tenant-context';

const SECRETO = 'secreto-de-prueba-suficientemente-largo';
const CENTINELA = 'centinela: contextFor fue invocado';

let llamadas: Array<{ userEmail: string; tenantSlug: string }> = [];

/** Doble de H2. No devuelve contexto: LANZA un centinela, para que el camino
 *  feliz se distinga sin ambigüedad y sin base de datos. */
const tenancyFalso = {
  contextFor: (i: { userEmail: string; tenantSlug: string }) => {
    llamadas.push(i);
    return Promise.reject(new PlatformError('CONFLICT', CENTINELA));
  },
} as unknown as TenancyPort;

const req = (headers: Record<string, string | string[]> = {}) => ({ headers });

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

const IDENTIDAD_COMPLETA = {
  [HEADER.userEmail]: 'atacante@example.com',
  [HEADER.tenantSlug]: 'empresa-de-otro',
};

// ═════════════════════════════════════════════════════════════════════════════
describe('contextoDePeticion · la puerta del proxy va PRIMERO', () => {
  it('en producción sin PROXY_SECRET no hay contexto, y tenancy ni se entera', async () => {
    delete process.env.PROXY_SECRET;
    process.env.NODE_ENV = 'production';

    await expect(contextoDePeticion(req(IDENTIDAD_COMPLETA))).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      status: 401,
    });
    expect(llamadas).toEqual([]);
  });

  it('inventarse un x-proxy-secret no sirve de nada', async () => {
    delete process.env.PROXY_SECRET;
    process.env.NODE_ENV = 'production';

    await expect(
      contextoDePeticion(req({ ...IDENTIDAD_COMPLETA, [HEADER.proxySecret]: 'lo-que-sea' })),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(llamadas).toEqual([]);
  });

  it('con secreto configurado, rechaza si no viene', async () => {
    process.env.NODE_ENV = 'production';
    process.env.PROXY_SECRET = SECRETO;

    await expect(contextoDePeticion(req(IDENTIDAD_COMPLETA))).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    expect(llamadas).toEqual([]);
  });

  it('rechaza un secreto incorrecto de la misma longitud', async () => {
    process.env.NODE_ENV = 'production';
    process.env.PROXY_SECRET = SECRETO;

    await expect(
      contextoDePeticion(
        req({
          ...IDENTIDAD_COMPLETA,
          [HEADER.proxySecret]: 'secreto-de-prueba-suficientemente-LARGO',
        }),
      ),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(llamadas).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('contextoDePeticion · con el proxy verificado', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    process.env.PROXY_SECRET = SECRETO;
  });

  const conSecreto = (extra: Record<string, string | string[]>) =>
    req({ [HEADER.proxySecret]: SECRETO, ...extra });

  it('llega a la membresía con lo que mandó el BFF, sin inventar nada', async () => {
    await expect(
      contextoDePeticion(
        conSecreto({ [HEADER.userEmail]: 'duena@example.com', [HEADER.tenantSlug]: 'su-empresa' }),
      ),
    ).rejects.toMatchObject({ message: CENTINELA });

    expect(llamadas).toEqual([{ userEmail: 'duena@example.com', tenantSlug: 'su-empresa' }]);
  });

  it('sin correo, 401 antes de tocar tenancy', async () => {
    await expect(
      contextoDePeticion(conSecreto({ [HEADER.tenantSlug]: 'su-empresa' })),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(llamadas).toEqual([]);
  });

  it('sin slug, 422 antes de tocar tenancy', async () => {
    await expect(
      contextoDePeticion(conSecreto({ [HEADER.userEmail]: 'duena@example.com' })),
    ).rejects.toMatchObject({ code: 'VALIDATION', status: 422 });
    expect(llamadas).toEqual([]);
  });

  it('un correo con espacios y mayúsculas se normaliza como en app.users', async () => {
    await expect(
      contextoDePeticion(
        conSecreto({ [HEADER.userEmail]: '  Duena@Example.COM ', [HEADER.tenantSlug]: '  s-e  ' }),
      ),
    ).rejects.toMatchObject({ message: CENTINELA });

    expect(llamadas).toEqual([{ userEmail: 'duena@example.com', tenantSlug: 's-e' }]);
  });

  it('una cabecera repetida no deja elegir: gana la primera', async () => {
    // Node entrega un arreglo cuando el header llega dos veces. Sin este caso,
    // `String(['a','b'])` daba «a,b» y el correo resultante no era ninguno.
    await expect(
      contextoDePeticion(
        conSecreto({
          [HEADER.userEmail]: ['primera@example.com', 'segunda@example.com'],
          [HEADER.tenantSlug]: 'su-empresa',
        }),
      ),
    ).rejects.toMatchObject({ message: CENTINELA });

    expect(llamadas).toEqual([{ userEmail: 'primera@example.com', tenantSlug: 'su-empresa' }]);
  });

  it('el slug sólo se valida en H2: aquí no se cree, se pasa', async () => {
    await expect(
      contextoDePeticion(
        conSecreto({ [HEADER.userEmail]: 'yo@example.com', [HEADER.tenantSlug]: 'empresa-ajena' }),
      ),
    ).rejects.toMatchObject({ message: CENTINELA });

    // Que llegue a `contextFor` es correcto: el 403 lo emite la membresía.
    expect(llamadas).toEqual([{ userEmail: 'yo@example.com', tenantSlug: 'empresa-ajena' }]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('contextoDePeticion · lo que no debe cambiar', () => {
  it('en desarrollo, sin secreto, se puede trabajar sin levantar el BFF', async () => {
    delete process.env.PROXY_SECRET;
    process.env.NODE_ENV = 'development';

    await expect(
      contextoDePeticion(
        req({ [HEADER.userEmail]: 'yo@example.com', [HEADER.tenantSlug]: 'mi-empresa' }),
      ),
    ).rejects.toMatchObject({ message: CENTINELA });
    expect(llamadas).toHaveLength(1);
  });

  it('sin el port de tenancy es 501 con el nombre del handoff, no un contexto inventado', async () => {
    delete process.env.PROXY_SECRET;
    process.env.NODE_ENV = 'development';
    __clearPorts();

    await expect(
      contextoDePeticion(
        req({ [HEADER.userEmail]: 'yo@example.com', [HEADER.tenantSlug]: 'mi-empresa' }),
      ),
    ).rejects.toMatchObject({ code: 'PORT_NOT_IMPLEMENTED', status: 501 });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('correoVerificadoDe · identidad sin empresa (alta, invitaciones, ritual)', () => {
  it('exige el proxy igual que la ruta con empresa', () => {
    delete process.env.PROXY_SECRET;
    process.env.NODE_ENV = 'production';

    expect(() => correoVerificadoDe(req({ [HEADER.userEmail]: 'x@example.com' }))).toThrow(
      PlatformError,
    );
  });

  it('con el proxy verificado devuelve el correo normalizado', () => {
    process.env.NODE_ENV = 'production';
    process.env.PROXY_SECRET = SECRETO;

    expect(
      correoVerificadoDe(
        req({ [HEADER.proxySecret]: SECRETO, [HEADER.userEmail]: ' Yo@Example.com ' }),
      ),
    ).toBe('yo@example.com');
  });

  it('no exige slug: es justo el caso de quien todavía no tiene empresa', () => {
    process.env.NODE_ENV = 'production';
    process.env.PROXY_SECRET = SECRETO;

    expect(
      correoVerificadoDe(
        req({ [HEADER.proxySecret]: SECRETO, [HEADER.userEmail]: 'yo@example.com' }),
      ),
    ).toBe('yo@example.com');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('responderError', () => {
  const espia = () => {
    const visto: { status?: number; body?: unknown } = {};
    const res = {
      status(c: number) {
        visto.status = c;
        return res;
      },
      json(b: unknown) {
        visto.body = b;
        return res;
      },
    };
    return { res, visto };
  };

  it('traduce el código del catálogo a HTTP', () => {
    const { res, visto } = espia();
    responderError(res, new PlatformError('FORBIDDEN', 'no'));
    expect(visto.status).toBe(403);
    expect(visto.body).toEqual({ error: { code: 'FORBIDDEN', message: 'no' } });
  });

  it('un error desconocido es 500 y NO filtra nada', () => {
    const { res, visto } = espia();
    responderError(res, new Error('SELECT * FROM app.users -- con la contraseña'));
    expect(visto.status).toBe(500);
    expect(visto.body).toEqual({ error: { code: 'INTERNAL', message: 'Error interno' } });
  });

  it('nunca deja salir los `details` internos de un PlatformError', () => {
    const { res, visto } = espia();
    responderError(
      res,
      new PlatformError('BUDGET_EXCEEDED', 'te pasaste', { details: { tenantId: 'secreto' } }),
    );
    expect(JSON.stringify(visto.body)).not.toContain('secreto');
  });
});
