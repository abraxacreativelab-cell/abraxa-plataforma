/**
 * El cliente de Evolution, sin red.
 *
 * Lo que de verdad se prueba aquí es la clasificación de fallos, que es lo que
 * decide si un mensaje se puede reintentar sin duplicarlo en el teléfono de un
 * cliente:
 *
 *   timeout  → la petición SÍ salió, pudo entregarse → NO reintentable
 *   red      → la petición no llegó, seguro no salió → reintentable
 *   4xx      → nos rechazó                            → no reintentable
 *   5xx      → problema suyo                          → reintentable
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlatformError } from '@abraxa/db';
import { createEvolutionClient, type FetchLike } from './evolution';
import { createWhatsAppDriver, esInalcanzableDesdeFuera, urlDelWebhook } from './index';

const OPCIONES = { baseUrl: 'http://evo.local', apiKey: 'llave-de-prueba' };

function respuesta(status: number, body: unknown): Response {
  return {
    status,
    json: async () => body,
  } as unknown as Response;
}

function clienteCon(fetchImpl: FetchLike) {
  return createEvolutionClient({ ...OPCIONES, fetchImpl });
}

describe('enviarTexto', () => {
  it('manda al endpoint de la instancia con el JID y devuelve el id externo', async () => {
    const llamadas: Array<{ url: string; body: unknown }> = [];
    const cliente = clienteCon(async (url, init) => {
      llamadas.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
      return respuesta(200, { key: { id: 'WA-99' } });
    });

    const r = await cliente.enviarTexto('abx-1', '5512345678', 'hola');

    expect(r.externalId).toBe('WA-99');
    expect(llamadas[0]?.url).toBe('http://evo.local/message/sendText/abx-1');
    // El teléfono se convierte a JID DENTRO del driver: el núcleo nunca lo ve.
    expect(llamadas[0]?.body).toEqual({ number: '525512345678@s.whatsapp.net', text: 'hola' });
  });

  it('un 4xx no se reintenta', async () => {
    const cliente = clienteCon(async () => respuesta(400, { message: 'número inválido' }));
    await expect(cliente.enviarTexto('abx-1', '5512345678', 'hola')).rejects.toMatchObject({
      code: 'CHANNEL_ERROR',
      retryable: false,
    });
  });

  it('un 5xx sí se reintenta', async () => {
    const cliente = clienteCon(async () => respuesta(503, { message: 'ocupado' }));
    await expect(cliente.enviarTexto('abx-1', '5512345678', 'hola')).rejects.toMatchObject({
      retryable: true,
    });
  });

  it('un timeout NO se reintenta: el mensaje pudo haber salido', async () => {
    const cliente = clienteCon(async () => {
      const err = new Error('timed out');
      err.name = 'TimeoutError';
      throw err;
    });

    try {
      await cliente.enviarTexto('abx-1', '5512345678', 'hola');
      throw new Error('debió lanzar');
    } catch (err) {
      expect(PlatformError.is(err)).toBe(true);
      expect((err as PlatformError).retryable).toBe(false);
      expect((err as PlatformError).message).toMatch(/ambiguo/);
    }
  });

  it('Evolution inalcanzable SÍ se reintenta: la petición no llegó', async () => {
    const cliente = clienteCon(async () => {
      const err = new Error('connect ECONNREFUSED');
      err.name = 'TypeError';
      throw err;
    });
    await expect(cliente.enviarTexto('abx-1', '5512345678', 'hola')).rejects.toMatchObject({
      retryable: true,
    });
  });

  it('una respuesta sin cuerpo JSON no es un error', async () => {
    const cliente = clienteCon(async () =>
      ({
        status: 200,
        json: async () => {
          throw new Error('cuerpo vacío');
        },
      }) as unknown as Response,
    );
    await expect(cliente.enviarTexto('abx-1', '5512345678', 'hola')).resolves.toEqual({
      externalId: null,
    });
  });
});

describe('crearInstancia', () => {
  it('no recrea una instancia que ya existe, pero sí refija su webhook', async () => {
    const rutas: string[] = [];
    const cliente = clienteCon(async (url) => {
      rutas.push(url);
      if (url.includes('/instance/fetchInstances')) return respuesta(200, [{ name: 'abx-1' }]);
      return respuesta(200, {});
    });

    await cliente.crearInstancia('abx-1', 'https://api/inbox/webhooks/c-1?token=t');

    expect(rutas.some((r) => r.includes('/instance/create'))).toBe(false);
    expect(rutas.some((r) => r.includes('/webhook/set/abx-1'))).toBe(true);
  });

  it('crea la que no existe', async () => {
    const rutas: string[] = [];
    const cliente = clienteCon(async (url) => {
      rutas.push(url);
      if (url.includes('/instance/fetchInstances')) return respuesta(200, []);
      return respuesta(200, {});
    });

    await cliente.crearInstancia('abx-2', 'https://api/webhook');
    expect(rutas.some((r) => r.includes('/instance/create'))).toBe(true);
  });
});

describe('estado y QR', () => {
  it('lee el estado y el número de la línea', async () => {
    const cliente = clienteCon(async (url) => {
      if (url.includes('connectionState')) return respuesta(200, { instance: { state: 'open' } });
      return respuesta(200, [{ name: 'abx-1', number: '5215512345678', profileName: 'Acme' }]);
    });

    await expect(cliente.estado('abx-1')).resolves.toEqual({
      instance: 'abx-1',
      state: 'open',
      number: '5215512345678',
      profileName: 'Acme',
    });
  });

  it('una instancia que no existe no revienta', async () => {
    const cliente = clienteCon(async () => respuesta(404, {}));
    await expect(cliente.estado('abx-1')).resolves.toMatchObject({ state: 'unknown' });
  });
});

describe('el driver de WhatsApp', () => {
  it('declara su tipo y normaliza direcciones a E.164', () => {
    const d = createWhatsAppDriver({ cliente: {} as never });
    expect(d.type).toBe('whatsapp');
    expect(d.normalizeAddress?.('5215512345678')).toBe('+525512345678');
    expect(d.normalizeAddress?.('55 1234 5678')).toBe('+525512345678');
  });

  it('resuelve la instancia del canal antes de mandar', async () => {
    const enviarTexto = vi.fn(async () => ({ externalId: 'WA-1' }));
    const d = createWhatsAppDriver({
      cliente: { enviarTexto } as never,
      cargarCanal: async () => ({ config: { instance: 'abx-7' } }),
    });

    await d.send({ channelId: 'c-1', address: '5512345678', body: 'hola' });
    expect(enviarTexto).toHaveBeenCalledWith('abx-7', '+525512345678', 'hola');
  });

  it('un canal sin instancia da un error que dice qué hacer', async () => {
    const d = createWhatsAppDriver({
      cliente: {} as never,
      cargarCanal: async () => ({ config: {} }),
    });
    await expect(d.send({ channelId: 'c-1', address: '5512345678', body: 'x' })).rejects.toThrow(
      /crearCanal/,
    );
  });

  it('rechaza un teléfono que no lo es antes de tocar la red', async () => {
    const d = createWhatsAppDriver({
      cliente: {} as never,
      cargarCanal: async () => ({ config: { instance: 'abx-1' } }),
    });
    await expect(d.send({ channelId: 'c-1', address: 'hola', body: 'x' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('parseWebhook sólo entiende su propio sobre', async () => {
    const d = createWhatsAppDriver({ cliente: {} as never });
    expect(await d.parseWebhook(null)).toEqual([]);
    expect(await d.parseWebhook({ payload: {} })).toEqual([]);

    const mensajes = await d.parseWebhook({
      channelId: 'c-1',
      payload: {
        event: 'MESSAGES_UPSERT',
        data: {
          key: { id: 'WA-1', remoteJid: '5215512345678@s.whatsapp.net' },
          message: { conversation: 'hola' },
        },
      },
    });
    expect(mensajes[0]?.address).toBe('+525512345678');
    expect(mensajes[0]?.channelId).toBe('c-1');
  });

  it('provisionChannel escribe instancia y token en la config que recibe', async () => {
    const crearInstancia = vi.fn(async () => undefined);
    const d = createWhatsAppDriver({
      cliente: { crearInstancia } as never,
      baseUrlPublica: 'https://api.abraxa.club',
    });

    const config: Record<string, unknown> = { channelId: 'c-1' };
    const r = await d.provisionChannel!({ tenantId: 'tenant-abcdef01', name: 'Línea', config });

    expect(typeof config.instance).toBe('string');
    expect(String(config.webhook_token)).toHaveLength(48);
    expect(r.status).toBe('pending');
    expect(crearInstancia).toHaveBeenCalledWith(
      config.instance,
      `https://api.abraxa.club/inbox/webhooks/c-1?token=${String(config.webhook_token)}`,
    );
  });
});

describe('urlDelWebhook', () => {
  const PUBLICA_ORIGINAL = process.env.PUBLIC_WEBHOOK_BASE_URL;
  const API_ORIGINAL = process.env.API_BASE_URL;

  /**
   * Se restauran las dos variables una por una, no reemplazando `process.env`
   * entero: ese idiom deja un objeto que ya no es el del proceso y en la suite
   * de rutas costó una tarde de fantasmas.
   */
  afterEach(() => {
    if (PUBLICA_ORIGINAL === undefined) delete process.env.PUBLIC_WEBHOOK_BASE_URL;
    else process.env.PUBLIC_WEBHOOK_BASE_URL = PUBLICA_ORIGINAL;
    if (API_ORIGINAL === undefined) delete process.env.API_BASE_URL;
    else process.env.API_BASE_URL = API_ORIGINAL;
    vi.restoreAllMocks();
  });

  it('arma la URL pública con el token escapado', () => {
    expect(urlDelWebhook('https://api.abraxa.club/', 'c-1', 'a+b')).toBe(
      'https://api.abraxa.club/inbox/webhooks/c-1?token=a%2Bb',
    );
  });

  // ══════════════════════════════════════════════════════════════════════════
  // `API_BASE_URL` significaba dos cosas incompatibles: la base INTERNA con la
  // que el BFF llama a la API, y la URL PÚBLICA por la que Evolution alcanza el
  // webhook. Con el valor interno —que es el que trae `.env.example`— la línea
  // se conecta, el QR se escanea, y no entra ni un solo mensaje.
  // ══════════════════════════════════════════════════════════════════════════
  it('la URL pública tiene su propia variable y GANA sobre API_BASE_URL', () => {
    process.env.PUBLIC_WEBHOOK_BASE_URL = 'https://api.abraxa.club';
    process.env.API_BASE_URL = 'http://localhost:3100';

    expect(urlDelWebhook(undefined, 'c-1', 't')).toBe(
      'https://api.abraxa.club/inbox/webhooks/c-1?token=t',
    );
  });

  it('avisa cuando el respaldo da una dirección a la que Evolution no puede llegar', () => {
    const avisos: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((m: unknown) => {
      avisos.push(String(m));
    });

    delete process.env.PUBLIC_WEBHOOK_BASE_URL;
    process.env.API_BASE_URL = 'http://localhost:3100';

    const url = urlDelWebhook(undefined, 'c-1', 't');

    // Se sigue armando: romper el aprovisionamiento sería peor que avisar.
    expect(url).toBe('http://localhost:3100/inbox/webhooks/c-1?token=t');
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain('PUBLIC_WEBHOOK_BASE_URL');
  });

  it('un respaldo PÚBLICO no dice nada: no se rompe a quien ya lo tenía bien', () => {
    const avisos: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((m: unknown) => {
      avisos.push(String(m));
    });

    delete process.env.PUBLIC_WEBHOOK_BASE_URL;
    process.env.API_BASE_URL = 'https://api.abraxa.club';

    expect(urlDelWebhook(undefined, 'c-1', 't')).toBe(
      'https://api.abraxa.club/inbox/webhooks/c-1?token=t',
    );
    expect(avisos).toEqual([]);
  });
});

describe('esInalcanzableDesdeFuera', () => {
  it('caza los defaults de desarrollo que se quedan puestos', () => {
    for (const u of [
      'http://localhost:3100',
      'http://127.0.0.1:3100',
      'http://10.0.0.4:3100',
      'http://192.168.68.50:3100',
      'http://172.17.0.2:3100',
      'http://api.local',
    ]) {
      expect(esInalcanzableDesdeFuera(u), u).toBe(true);
    }
  });

  it('no se mete con direcciones públicas ni con las que no entiende', () => {
    // Conservador a propósito: el objetivo es cazar el default de desarrollo,
    // no adivinar la topología de red de nadie. `172.32.` queda FUERA del rango
    // privado de la RFC 1918 — el rango termina en `172.31.`.
    for (const u of [
      'https://api.abraxa.club',
      'http://172.32.0.1:3100',
      'https://198.51.100.7',
      'no-es-una-url',
    ]) {
      expect(esInalcanzableDesdeFuera(u), u).toBe(false);
    }
  });
});
