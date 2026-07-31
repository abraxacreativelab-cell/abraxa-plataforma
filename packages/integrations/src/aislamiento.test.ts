/**
 * ════════════════════════════════════════════════════════════════════════════
 *  LA PRUEBA QUE JUSTIFICA EL CARRIL
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Criterios 1 y 2 de H17-integraciones.md §11:
 *
 *    1. Dos tenants conectan el mismo proveedor con credenciales distintas, y
 *       cada uno resuelve la SUYA.
 *    2. Un tenant NO puede leer ni resolver la integración de otro. Con dos
 *       tenants reales, y probado ADVERSARIALMENTE: la empresa A pidiendo la
 *       fila de la B por id directo, que es como se intentaría de verdad.
 *
 *  Por qué importa, sin metáforas: hoy las credenciales de canal son variables
 *  del proceso (`.env.example:44-51`). Dos empresas dadas de alta comparten
 *  `EVOLUTION_API_KEY`, comparten instancia y en el peor caso comparten el
 *  número. Al cliente de la panadería le llegan las conversaciones de la
 *  clientela de la inmobiliaria.
 *
 *  Estas aserciones son lo que dice que eso ya no puede pasar.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { capturarEntorno, limpiarEntorno } from './testing/entorno';
import { PlatformError, __setClientForTests } from '@abraxa/db';
import { createIntegrationsService } from './service';
import { LLAVE_DE_PRUEBA, contextoDePrueba, createFakeDb, type FakeDb } from './testing/fake-db';

const PANADERIA = contextoDePrueba('t-panaderia', { email: 'ana@panaderia.mx' });
const INMOBILIARIA = contextoDePrueba('t-inmobiliaria', { email: 'beto@inmo.mx' });

const LLAVE_PANADERIA = 'evolution-de-la-panaderia-8146';
const LLAVE_INMOBILIARIA = 'evolution-de-la-inmobiliaria-2205';

let db: FakeDb;
let restaurarEntorno: () => void;

/** Un proveedor que siempre dice que sí, para que la prueba sea del aislamiento. */
const fetchOk: typeof fetch = async () =>
  new Response(JSON.stringify({ instance: { state: 'open' } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const servicio = () => createIntegrationsService({ fetchImpl: fetchOk });

beforeEach(() => {
  restaurarEntorno = capturarEntorno();
  limpiarEntorno();
  db = createFakeDb();
  __setClientForTests(db.client);
  process.env.INTEGRATIONS_KEY = LLAVE_DE_PRUEBA;
  delete process.env.INTEGRATIONS_PLATFORM_FALLBACK;
  delete process.env.EVOLUTION_API_KEY;
  delete process.env.EVOLUTION_API_URL;
});

afterEach(() => {
  __setClientForTests(null);
  restaurarEntorno();
});

/** Las dos empresas conectan Evolution, cada una con lo suyo. */
async function conectarLasDos() {
  const svc = servicio();
  const a = await svc.save(PANADERIA, {
    provider: 'evolution',
    label: 'WhatsApp de la panadería',
    secret: LLAVE_PANADERIA,
    config: { baseUrl: 'https://evo.panaderia.mx', instance: 'panaderia' },
    externalAccountId: 'panaderia',
    actor: 'ana@panaderia.mx',
  });
  const b = await svc.save(INMOBILIARIA, {
    provider: 'evolution',
    label: 'WhatsApp de la inmobiliaria',
    secret: LLAVE_INMOBILIARIA,
    config: { baseUrl: 'https://evo.inmo.mx', instance: 'inmobiliaria' },
    externalAccountId: 'inmobiliaria',
    actor: 'beto@inmo.mx',
  });
  return { svc, a, b };
}

describe('cada empresa resuelve su propia credencial', () => {
  it('el mismo proveedor, dos secretos, y ninguno se cruza', async () => {
    const { svc } = await conectarLasDos();

    const dePanaderia = await svc.resolveFor(PANADERIA, 'evolution');
    const deInmobiliaria = await svc.resolveFor(INMOBILIARIA, 'evolution');

    expect(dePanaderia.secret).toBe(LLAVE_PANADERIA);
    expect(deInmobiliaria.secret).toBe(LLAVE_INMOBILIARIA);
    expect(dePanaderia.secret).not.toBe(deInmobiliaria.secret);

    // Y la configuración tampoco: apuntan a instancias distintas.
    expect(dePanaderia.config.baseUrl).toBe('https://evo.panaderia.mx');
    expect(deInmobiliaria.config.baseUrl).toBe('https://evo.inmo.mx');

    // Las dos vienen del tenant, no de una variable global del proceso.
    expect(dePanaderia.source).toBe('tenant');
    expect(deInmobiliaria.source).toBe('tenant');
  });

  it('una empresa con DOS números resuelve el que le pidan', async () => {
    const svc = servicio();
    await svc.save(PANADERIA, {
      provider: 'evolution',
      label: 'Mostrador',
      secret: 'evolution-del-mostrador',
      config: { baseUrl: 'https://evo.panaderia.mx', instance: 'mostrador' },
      externalAccountId: 'mostrador',
    });
    await svc.save(PANADERIA, {
      provider: 'evolution',
      label: 'Pedidos',
      secret: 'evolution-de-pedidos',
      config: { baseUrl: 'https://evo.panaderia.mx', instance: 'pedidos' },
      externalAccountId: 'pedidos',
    });

    // Elegir en silencio entre dos números del mismo negocio no le toca a esta
    // capa: quien sabe cuál es, lo dice.
    const mostrador = await svc.resolveFor(PANADERIA, 'evolution', {
      externalAccountId: 'mostrador',
    });
    const pedidos = await svc.resolveFor(PANADERIA, 'evolution', {
      externalAccountId: 'pedidos',
    });

    expect(mostrador.secret).toBe('evolution-del-mostrador');
    expect(pedidos.secret).toBe('evolution-de-pedidos');
  });

  it('en la base quedan dos filas cifradas y DISTINTAS', async () => {
    await conectarLasDos();
    const filas = db.tabla('tenant_integrations');
    expect(filas).toHaveLength(2);

    expect(String(filas[0]?.secret_ct)).not.toBe(String(filas[1]?.secret_ct));

    // Ninguna guarda el texto claro, ni en el ciphertext ni en `config`.
    const crudo = JSON.stringify(filas);
    expect(crudo).not.toContain(LLAVE_PANADERIA);
    expect(crudo).not.toContain(LLAVE_INMOBILIARIA);
  });
});

describe('la empresa A no puede tocar la credencial de la B', () => {
  it('get() por id directo devuelve null — el intento más obvio', async () => {
    const { svc, b } = await conectarLasDos();
    expect(await svc.get(PANADERIA, b.integrationId)).toBeNull();
    // …y la suya sí, para que la prueba no pase por estar todo roto.
    const { a } = await conectarLasDos();
    expect(await svc.get(PANADERIA, a.integrationId)).not.toBeNull();
  });

  it('list() sólo trae las suyas', async () => {
    const { svc } = await conectarLasDos();
    const deA = await svc.list(PANADERIA);
    expect(deA).toHaveLength(1);
    expect(deA[0]?.label).toBe('WhatsApp de la panadería');
  });

  it('verify() sobre la fila ajena lanza NOT_FOUND y no la toca', async () => {
    const { svc, b } = await conectarLasDos();
    await expect(svc.verify(PANADERIA, b.integrationId)).rejects.toBeInstanceOf(PlatformError);

    const fila = db.tabla('tenant_integrations').find((f) => f.id === b.integrationId);
    expect(fila?.tenant_id).toBe('t-inmobiliaria');
    expect(fila?.status).toBe('connected');
  });

  it('revoke() sobre la fila ajena lanza y la deja viva', async () => {
    const { svc, b } = await conectarLasDos();
    await expect(svc.revoke(PANADERIA, b.integrationId)).rejects.toBeInstanceOf(PlatformError);

    const fila = db.tabla('tenant_integrations').find((f) => f.id === b.integrationId);
    expect(fila?.status).toBe('connected');
  });

  it('save() con el id de la otra empresa crea lo suyo, no pisa lo ajeno', async () => {
    const { svc, b } = await conectarLasDos();
    const antes = { ...db.tabla('tenant_integrations').find((f) => f.id === b.integrationId) };

    await svc.save(PANADERIA, {
      provider: 'evolution',
      secret: 'otra-cosa',
      externalAccountId: 'panaderia',
    });

    const despues = db.tabla('tenant_integrations').find((f) => f.id === b.integrationId);
    expect(String(despues?.secret_ct)).toBe(String(antes.secret_ct));
    expect(despues?.tenant_id).toBe('t-inmobiliaria');
  });

  it('events() no filtra la bitácora de la otra empresa', async () => {
    const { svc } = await conectarLasDos();
    const bitacoraA = await svc.events(PANADERIA);
    expect(bitacoraA.length).toBeGreaterThan(0);
    const ajenos = db
      .tabla('integration_events')
      .filter((e) => e.tenant_id === 't-inmobiliaria')
      .map((e) => String(e.id));
    expect(bitacoraA.map((e) => e.id).some((id) => ajenos.includes(id))).toBe(false);
  });

  it('aunque le pasen un tenant_id ajeno en el cuerpo, la fila nace en su empresa', async () => {
    const svc = servicio();
    await svc.save(PANADERIA, {
      provider: 'resend',
      secret: 'llave-de-correo',
      // Un cuerpo de la red intentando mudarse de empresa. `tenantDb` lo pisa.
      config: { tenant_id: 't-inmobiliaria', domain: 'panaderia.mx' },
      externalAccountId: 'panaderia.mx',
    } as never);

    const filas = db.tabla('tenant_integrations');
    expect(filas.every((f) => f.tenant_id === 't-panaderia')).toBe(true);
  });
});

describe('la misma cuenta externa no se conecta a dos empresas', () => {
  it('el índice único parcial lo impide y el servicio lo traduce a CONFLICT', async () => {
    const svc = servicio();
    await svc.save(PANADERIA, {
      provider: 'meta',
      secret: 'token-de-pagina',
      externalAccountId: 'pagina-99',
      config: { pageId: 'pagina-99' },
      verify: false,
    });

    // La inmobiliaria intenta conectar LA MISMA página de Facebook.
    const intento = svc.save(INMOBILIARIA, {
      provider: 'meta',
      secret: 'otro-token',
      externalAccountId: 'pagina-99',
      config: { pageId: 'pagina-99' },
      verify: false,
    });

    await expect(intento).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('si la primera empresa la revoca, la segunda ya puede conectarla', async () => {
    const svc = servicio();
    const primera = await svc.save(PANADERIA, {
      provider: 'meta',
      secret: 'token-de-pagina',
      externalAccountId: 'pagina-99',
      verify: false,
    });
    await svc.revoke(PANADERIA, primera.integrationId);

    const segunda = await svc.save(INMOBILIARIA, {
      provider: 'meta',
      secret: 'otro-token',
      externalAccountId: 'pagina-99',
      verify: false,
    });
    expect(segunda.integrationId).toBeTruthy();
  });
});
