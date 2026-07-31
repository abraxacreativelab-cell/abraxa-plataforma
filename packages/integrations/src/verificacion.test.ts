/**
 * ════════════════════════════════════════════════════════════════════════════
 *  verify() — la diferencia entre CAPTURADO y CONECTADO
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Criterios 8, 9 y 15 de §11.
 *
 *  El emprendedor pega un token, ve una palomita verde, se va tranquilo, y
 *  tres días después nadie le contestó a nadie. Una credencial capturada no es
 *  una credencial que sirve, y la única forma de saber la diferencia es
 *  preguntarle al proveedor.
 *
 *  Cada proveedor tiene su comprobación real, barata y de SÓLO LECTURA:
 *
 *    evolution  GET /instance/connectionState   la instancia existe y está abierta
 *    meta       GET /me                          el token vive y es de esa página
 *    twilio     GET /Accounts/{sid}.json         el SID y el token casan
 *    resend     GET /domains/{id}                el dominio existe y está VERIFICADO
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { capturarEntorno, limpiarEntorno } from './testing/entorno';
import { __setClientForTests } from '@abraxa/db';
import { createIntegrationsService } from './service';
import { repasar } from './sweep';
import { LLAVE_DE_PRUEBA, contextoDePrueba, createFakeDb, type FakeDb } from './testing/fake-db';

const PANADERIA = contextoDePrueba('t-panaderia', { email: 'ana@panaderia.mx' });
let db: FakeDb;
let restaurarEntorno: () => void;

/** Cada llamada devuelve lo que diga `respuestas`, en orden; la última se repite. */
function fetchDe(...respuestas: Array<{ status: number; body: unknown }>): {
  impl: typeof fetch;
  urls: string[];
} {
  const urls: string[] = [];
  let i = 0;
  const impl: typeof fetch = async (url) => {
    urls.push(String(url));
    const r = respuestas[Math.min(i, respuestas.length - 1)]!;
    i += 1;
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { impl, urls };
}

beforeEach(() => {
  restaurarEntorno = capturarEntorno();
  limpiarEntorno();
  db = createFakeDb();
  __setClientForTests(db.client);
  process.env.INTEGRATIONS_KEY = LLAVE_DE_PRUEBA;
});

afterEach(() => {
  __setClientForTests(null);
  restaurarEntorno();
});

describe('cada proveedor pregunta de verdad', () => {
  it('evolution consulta el estado de la instancia', async () => {
    const { impl, urls } = fetchDe({ status: 200, body: { instance: { state: 'open' } } });
    const svc = createIntegrationsService({ fetchImpl: impl });

    const { status, verify } = await svc.save(PANADERIA, {
      provider: 'evolution',
      secret: 'llave-de-evolution',
      config: { baseUrl: 'https://evo.panaderia.mx/', instance: 'panaderia' },
    });

    expect(urls[0]).toBe('https://evo.panaderia.mx/instance/connectionState/panaderia');
    expect(verify?.ok).toBe(true);
    expect(status).toBe('connected');
  });

  it('evolution con la instancia cerrada NO queda conectada', async () => {
    const { impl } = fetchDe({ status: 200, body: { instance: { state: 'close' } } });
    const svc = createIntegrationsService({ fetchImpl: impl });
    const { status, verify } = await svc.save(PANADERIA, {
      provider: 'evolution',
      secret: 'llave-de-evolution',
      config: { baseUrl: 'https://evo.panaderia.mx', instance: 'panaderia' },
    });
    expect(verify?.ok).toBe(false);
    expect(status).toBe('error');
    expect(verify?.reason).toMatch(/close/);
  });

  it('meta lee /me y se queda con el id de la página que reportó', async () => {
    const { impl, urls } = fetchDe({ status: 200, body: { id: 'pagina-99', name: 'La Panadería' } });
    const svc = createIntegrationsService({ fetchImpl: impl });
    const { verify } = await svc.save(PANADERIA, {
      provider: 'meta',
      secret: 'token-de-pagina',
    });
    expect(urls[0]).toContain('/me');
    expect(verify?.externalAccountId).toBe('pagina-99');
  });

  it('meta con un token de OTRA página que la declarada falla', async () => {
    const { impl } = fetchDe({ status: 200, body: { id: 'pagina-otra' } });
    const svc = createIntegrationsService({ fetchImpl: impl });
    const { verify, status } = await svc.save(PANADERIA, {
      provider: 'meta',
      secret: 'token-de-pagina',
      externalAccountId: 'pagina-99',
    });
    expect(verify?.ok).toBe(false);
    expect(status).toBe('error');
  });

  it('twilio comprueba que el SID y el token casen', async () => {
    const { impl, urls } = fetchDe({ status: 200, body: { sid: 'AC-de-la-panaderia', status: 'active' } });
    const svc = createIntegrationsService({ fetchImpl: impl });
    const { verify } = await svc.save(PANADERIA, {
      provider: 'twilio',
      secret: 'token-de-twilio',
      config: { accountSid: 'AC-de-la-panaderia', fromNumber: '+528146811675' },
    });
    expect(urls[0]).toContain('/Accounts/AC-de-la-panaderia.json');
    expect(verify?.ok).toBe(true);
  });

  it('resend exige que el dominio esté VERIFICADO, no sólo que exista', async () => {
    const { impl } = fetchDe({ status: 200, body: { id: 'dom-1', name: 'panaderia.mx', status: 'pending' } });
    const svc = createIntegrationsService({ fetchImpl: impl });
    const { verify, status } = await svc.save(PANADERIA, {
      provider: 'resend',
      secret: 'llave-de-resend',
      config: { domainId: 'dom-1', domain: 'panaderia.mx' },
    });
    expect(verify?.ok).toBe(false);
    expect(status).toBe('error');
    expect(verify?.reason).toMatch(/verificad/i);
  });

  it('un proveedor desconocido se rechaza al guardar, no al usar', async () => {
    const { impl } = fetchDe({ status: 200, body: {} });
    const svc = createIntegrationsService({ fetchImpl: impl });
    await expect(
      svc.save(PANADERIA, { provider: 'inventado', secret: 'x' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

describe('cuando falla, se ve y no se borra', () => {
  it('deja status=error con motivo y conserva la fila', async () => {
    const { impl } = fetchDe(
      { status: 200, body: { instance: { state: 'open' } } },
      { status: 401, body: { message: 'unauthorized', request_id: 'req-01' } },
    );
    const svc = createIntegrationsService({ fetchImpl: impl });

    const { integrationId } = await svc.save(PANADERIA, {
      provider: 'evolution',
      secret: 'llave-de-evolution',
      config: { baseUrl: 'https://evo.panaderia.mx', instance: 'panaderia' },
    });
    expect((await svc.get(PANADERIA, integrationId))?.status).toBe('connected');

    const segunda = await svc.verify(PANADERIA, integrationId);
    expect(segunda.ok).toBe(false);

    const fila = await svc.get(PANADERIA, integrationId);
    expect(fila).not.toBeNull();
    expect(fila?.status).toBe('error');
    expect(fila?.lastError).toBeTruthy();
    // Lo verificado ANTES no se borra: dice cuándo fue la última vez que sirvió.
    expect(fila?.verifiedAt).toBeTruthy();
  });

  it('una credencial en error deja de resolver — no se manda con lo que no sirve', async () => {
    const { impl } = fetchDe({ status: 401, body: { message: 'unauthorized' } });
    const svc = createIntegrationsService({ fetchImpl: impl });
    await svc.save(PANADERIA, {
      provider: 'evolution',
      secret: 'llave-de-evolution',
      config: { baseUrl: 'https://evo.panaderia.mx', instance: 'panaderia' },
    });
    await expect(svc.resolveFor(PANADERIA, 'evolution')).rejects.toMatchObject({
      code: 'CHANNEL_ERROR',
    });
  });

  it('la red caída no borra nada y queda como reintentable', async () => {
    const impl: typeof fetch = async () => {
      throw new TypeError('fetch failed');
    };
    const svc = createIntegrationsService({ fetchImpl: impl });
    const { integrationId, status } = await svc.save(PANADERIA, {
      provider: 'evolution',
      secret: 'llave-de-evolution',
      config: { baseUrl: 'https://evo.panaderia.mx', instance: 'panaderia' },
    });
    expect(status).toBe('error');
    expect(await svc.get(PANADERIA, integrationId)).not.toBeNull();
  });

  it('revocar deja la fila en revoked y no la borra', async () => {
    const { impl } = fetchDe({ status: 200, body: { instance: { state: 'open' } } });
    const svc = createIntegrationsService({ fetchImpl: impl });
    const { integrationId } = await svc.save(PANADERIA, {
      provider: 'evolution',
      secret: 'llave-de-evolution',
      config: { baseUrl: 'https://evo.panaderia.mx', instance: 'panaderia' },
      externalAccountId: 'panaderia',
    });

    await svc.revoke(PANADERIA, integrationId, { actor: 'ana@panaderia.mx' });

    const fila = db.tabla('tenant_integrations').find((f) => f.id === integrationId);
    expect(fila).toBeTruthy();
    expect(fila?.status).toBe('revoked');
    // El secreto ya no sirve de nada: se borra el ciphertext al revocar.
    expect(fila?.secret_ct ?? null).toBeNull();
    expect(db.tabla('integration_events').some((e) => e.type === 'revoke')).toBe(true);
  });
});

describe('el repaso periódico', () => {
  it('detecta un token caducado y cambia el estado sin borrar la fila', async () => {
    const { impl } = fetchDe({ status: 200, body: { instance: { state: 'open' } } });
    const svc = createIntegrationsService({ fetchImpl: impl });
    const { integrationId } = await svc.save(PANADERIA, {
      provider: 'evolution',
      secret: 'llave-de-evolution',
      config: { baseUrl: 'https://evo.panaderia.mx', instance: 'panaderia' },
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const resumen = await repasar({ fetchImpl: impl });
    expect(resumen.revisadas).toBeGreaterThan(0);
    expect(resumen.caducadas).toBe(1);

    const fila = db.tabla('tenant_integrations').find((f) => f.id === integrationId);
    expect(fila).toBeTruthy();
    expect(fila?.status).toBe('error');
    expect(String(fila?.last_error)).toMatch(/caduc/i);
  });

  it('vuelve a comprobar las vivas y las deja en error si el proveedor ya no las quiere', async () => {
    const { impl: ok } = fetchDe({ status: 200, body: { instance: { state: 'open' } } });
    const svc = createIntegrationsService({ fetchImpl: ok });
    const { integrationId } = await svc.save(PANADERIA, {
      provider: 'evolution',
      secret: 'llave-de-evolution',
      config: { baseUrl: 'https://evo.panaderia.mx', instance: 'panaderia' },
    });

    const { impl: yaNo } = fetchDe({ status: 401, body: { message: 'unauthorized' } });
    const resumen = await repasar({ fetchImpl: yaNo });

    expect(resumen.fallidas).toBe(1);
    const fila = db.tabla('tenant_integrations').find((f) => f.id === integrationId);
    expect(fila?.status).toBe('error');
  });

  it('no toca las revocadas: ya no son de nadie', async () => {
    const { impl } = fetchDe({ status: 200, body: { instance: { state: 'open' } } });
    const svc = createIntegrationsService({ fetchImpl: impl });
    const { integrationId } = await svc.save(PANADERIA, {
      provider: 'evolution',
      secret: 'llave-de-evolution',
      config: { baseUrl: 'https://evo.panaderia.mx', instance: 'panaderia' },
    });
    await svc.revoke(PANADERIA, integrationId);

    const resumen = await repasar({ fetchImpl: impl });
    expect(resumen.revisadas).toBe(0);
  });
});
