/**
 * ════════════════════════════════════════════════════════════════════════════
 *  EL RESPALDO DE PLATAFORMA — criterios 12, 13 y 14 de §11
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Está APAGADO POR DEFECTO y es IMPOSIBLE de encender para `evolution`,
 *  `twilio` y `meta`. No es una preferencia de configuración: compartir la
 *  instancia de Evolution es compartir el número de WhatsApp, y un token de
 *  página es de UNA página.
 *
 *  El único que lo permite es `resend`, porque mandar desde `mail.abraxa.club`
 *  con el nombre del negocio mientras verifica su dominio es un arreglo real y
 *  reversible. Y aun así: cuando se usa, la pantalla lo dice y la bitácora lo
 *  registra. Un respaldo silencioso es exactamente cómo se llega a producción
 *  con dos clientes en el mismo número sin que nadie lo haya decidido.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { capturarEntorno, limpiarEntorno } from './testing/entorno';
import { PlatformError, __setClientForTests } from '@abraxa/db';
import { createIntegrationsService } from './service';
import { LLAVE_DE_PRUEBA, contextoDePrueba, createFakeDb, type FakeDb } from './testing/fake-db';

const PANADERIA = contextoDePrueba('t-panaderia');
let db: FakeDb;
let restaurarEntorno: () => void;

/**
 * Un proveedor que dice que sí a todo lo que estas pruebas usan: la instancia
 * de Evolution abierta y el dominio de Resend verificado. Lo que se está
 * probando aquí es la PRECEDENCIA, no la comprobación.
 */
const fetchOk: typeof fetch = async () =>
  new Response(
    JSON.stringify({
      instance: { state: 'open' },
      id: 'dom-1',
      name: 'panaderia.mx',
      status: 'verified',
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

const servicio = () => createIntegrationsService({ fetchImpl: fetchOk });

beforeEach(() => {
  restaurarEntorno = capturarEntorno();
  limpiarEntorno();
  db = createFakeDb();
  __setClientForTests(db.client);
  process.env.INTEGRATIONS_KEY = LLAVE_DE_PRUEBA;
  delete process.env.INTEGRATIONS_PLATFORM_FALLBACK;
  delete process.env.RESEND_API_KEY;
  delete process.env.EVOLUTION_API_KEY;
  delete process.env.EVOLUTION_API_URL;
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.META_APP_SECRET;
});

afterEach(() => {
  __setClientForTests(null);
  restaurarEntorno();
});

describe('apagado por defecto', () => {
  it('con RESEND_API_KEY en el entorno pero sin encender el respaldo, NO cae a él', async () => {
    process.env.RESEND_API_KEY = 'llave-de-la-plataforma';
    await expect(servicio().resolveFor(PANADERIA, 'resend')).rejects.toBeInstanceOf(PlatformError);
  });

  it('el error dice QUÉ conectar y DÓNDE, no "algo falló"', async () => {
    try {
      await servicio().resolveFor(PANADERIA, 'evolution');
      throw new Error('debió lanzar');
    } catch (e) {
      const err = e as PlatformError;
      expect(err.code).toBe('CHANNEL_ERROR');
      expect(err.message).toContain('WhatsApp');
      expect(err.message).toContain('Ajustes');
      expect(err.message).toContain('integraciones');
    }
  });

  it('tryResolveFor() devuelve null en vez de lanzar, para caminos best-effort', async () => {
    expect(await servicio().tryResolveFor(PANADERIA, 'evolution')).toBeNull();
  });
});

describe('imposible de encender donde compartir es inaceptable', () => {
  const PROHIBIDOS = ['evolution', 'twilio', 'meta'] as const;

  it.each(PROHIBIDOS)(
    'con INTEGRATIONS_PLATFORM_FALLBACK=true, %s sigue sin caer al respaldo',
    async (proveedor) => {
      process.env.INTEGRATIONS_PLATFORM_FALLBACK = 'true';
      process.env.EVOLUTION_API_KEY = 'llave-compartida';
      process.env.EVOLUTION_API_URL = 'https://evo.plataforma.mx';
      process.env.TWILIO_ACCOUNT_SID = 'sid-de-la-plataforma';
      process.env.TWILIO_AUTH_TOKEN = 'token-de-la-plataforma';
      process.env.META_APP_SECRET = 'secreto-de-la-app';

      await expect(servicio().resolveFor(PANADERIA, proveedor)).rejects.toBeInstanceOf(
        PlatformError,
      );
    },
  );

  it('el catálogo declara por qué, con la razón escrita en el código', () => {
    const porNombre = Object.fromEntries(servicio().providers().map((p) => [p.name, p]));
    expect(porNombre.evolution?.fallbackAllowed).toBe(false);
    expect(porNombre.evolution?.fallbackReason).toMatch(/número/i);
    expect(porNombre.twilio?.fallbackAllowed).toBe(false);
    expect(porNombre.meta?.fallbackAllowed).toBe(false);
    expect(porNombre.resend?.fallbackAllowed).toBe(true);
  });
});

describe('resend sí, encendido a mano y siempre visible', () => {
  beforeEach(() => {
    process.env.INTEGRATIONS_PLATFORM_FALLBACK = 'true';
    process.env.RESEND_API_KEY = 'llave-de-correo-de-la-plataforma';
  });

  it('resuelve con source platform', async () => {
    const r = await servicio().resolveFor(PANADERIA, 'resend');
    expect(r.source).toBe('platform');
    expect(r.integrationId).toBeNull();
    expect(r.secret).toBe('llave-de-correo-de-la-plataforma');
  });

  it('lo registra en la bitácora: nada de respaldos silenciosos', async () => {
    await servicio().resolveFor(PANADERIA, 'resend');
    const eventos = db.tabla('integration_events');
    expect(eventos.some((e) => e.type === 'platform_fallback')).toBe(true);
    expect(eventos.every((e) => e.tenant_id === 't-panaderia')).toBe(true);
  });

  it('lo anota una vez, no en cada mensaje que sale', async () => {
    const svc = servicio();
    // `resolveFor` corre en CADA mensaje. Sin freno, la bitácora se volvería un
    // log de tráfico y enterraría justo lo que hay que poder leer ahí.
    await svc.resolveFor(PANADERIA, 'resend');
    await svc.resolveFor(PANADERIA, 'resend');
    await svc.resolveFor(PANADERIA, 'resend');

    const anotaciones = db.tabla('integration_events').filter((e) => e.type === 'platform_fallback');
    expect(anotaciones).toHaveLength(1);
  });

  it('la pantalla puede saberlo: providers() marca fallbackActive', () => {
    const resend = servicio().providers().find((p) => p.name === 'resend');
    expect(resend?.fallbackActive).toBe(true);
  });

  it('sin la variable del proveedor no inventa una credencial vacía', async () => {
    delete process.env.RESEND_API_KEY;
    await expect(servicio().resolveFor(PANADERIA, 'resend')).rejects.toBeInstanceOf(PlatformError);
  });

  it('la credencial del tenant SIEMPRE gana sobre el respaldo', async () => {
    const svc = servicio();
    const guardada = await svc.save(PANADERIA, {
      provider: 'resend',
      secret: 'llave-propia-de-la-panaderia',
      config: { domain: 'panaderia.mx', domainId: 'dom-1' },
      externalAccountId: 'panaderia.mx',
      verify: false,
    });
    // `save` sin verificar deja `pending`; sólo `connected` resuelve. Que haya
    // que verificar para que gane no es un detalle: una credencial capturada y
    // sin comprobar NO debe desplazar a un respaldo que sí funciona.
    expect(guardada.status).toBe('pending');
    await svc.verify(PANADERIA, guardada.integrationId);

    const r = await svc.resolveFor(PANADERIA, 'resend');
    expect(r.source).toBe('tenant');
    expect(r.secret).toBe('llave-propia-de-la-panaderia');
  });
});

describe('una credencial que no está conectada no resuelve', () => {
  it('pending no resuelve: capturado no es conectado', async () => {
    const svc = servicio();
    await svc.save(PANADERIA, {
      provider: 'evolution',
      secret: 'a-medias',
      externalAccountId: 'panaderia',
      verify: false,
    });
    await expect(svc.resolveFor(PANADERIA, 'evolution')).rejects.toBeInstanceOf(PlatformError);
  });

  it('revocada tampoco', async () => {
    const svc = servicio();
    const { integrationId } = await svc.save(PANADERIA, {
      provider: 'evolution',
      secret: 'la-que-era',
      config: { baseUrl: 'https://evo.panaderia.mx', instance: 'panaderia' },
      externalAccountId: 'panaderia',
    });
    await svc.revoke(PANADERIA, integrationId);
    await expect(svc.resolveFor(PANADERIA, 'evolution')).rejects.toBeInstanceOf(PlatformError);
  });
});
