/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El driver completo, con Meta al otro lado sustituido por un `fetch` falso.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Se prueba contra el cliente HTTP DE VERDAD (`createClienteMeta`) y no contra
 *  un doble del cliente: así se verifica también lo que sólo se ve en la URL y
 *  en el cuerpo —a qué id se le cuelga `/messages`, si va `messaging_type:
 *  RESPONSE` o `MESSAGE_TAG`, si viaja el `appsecret_proof`—, que es justo
 *  donde están los errores que Meta contesta con un 400 sin explicación.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __setClientForTests, PlatformError } from '@abraxa/db';
import { hasDriver, driverFor } from '../registry';
import { createFakeDb, type FakeDb } from '../../testing/fake-db';
import type { ChannelRow } from '../../types';
import { createMetaDriver, crearDriversMeta, partirTexto } from './index';
import { createClienteMeta } from './graph';
import { firmaDe } from './firma';
import { registrarEntrante } from './ventana';

const TENANT = '11111111-1111-1111-1111-111111111111';
const IG_ID = '17841400000000000';
const PAGE_ID = '102938475600000';
const CLIENTE = '6072012345678901';
const SECRETO = 'app-secret-de-prueba';
const TOKEN = 'EAAG-token-de-pagina';

const T0 = new Date('2026-07-31T10:00:00.000Z');

// ── Un `fetch` que anota lo que le piden ─────────────────────────────────────

interface Llamada {
  url: string;
  body: Record<string, unknown>;
}

function fetchFalso(respuestas: unknown[] = []): {
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;
  llamadas: Llamada[];
} {
  const llamadas: Llamada[] = [];
  let n = 0;

  return {
    llamadas,
    fetchImpl: (url: string, init?: RequestInit) => {
      llamadas.push({
        url,
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
      });
      const cuerpo = respuestas[n] ?? { message_id: `mid-meta-${n + 1}` };
      n += 1;
      return Promise.resolve(
        new Response(JSON.stringify(cuerpo), {
          status: (cuerpo as { error?: unknown }).error ? 400 : 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    },
  };
}

function canal(over: Partial<ChannelRow> = {}, config: Record<string, unknown> = {}): ChannelRow {
  return {
    id: 'canal-ig',
    tenant_id: TENANT,
    type: 'instagram',
    driver: 'instagram',
    name: 'Instagram del negocio',
    config: {
      page_id: PAGE_ID,
      ig_user_id: IG_ID,
      webhook_token: 'token-de-la-url',
      secret: { page_access_token: TOKEN, app_secret: SECRETO, verify_token: 'verifica-me' },
      meta_perfil: false,
      ...config,
    },
    external_id: IG_ID,
    status: 'active',
    agent_role: 'sales',
    ai_enabled: true,
    business_hours: {},
    ai_outside_hours: true,
    created_at: T0.toISOString(),
    updated_at: T0.toISOString(),
    ...over,
  };
}

function driver(fila: ChannelRow, fetchImpl: ReturnType<typeof fetchFalso>['fetchImpl']) {
  return createMetaDriver(fila.type as 'instagram' | 'messenger', {
    cliente: createClienteMeta({ fetchImpl }),
    cargarCanal: () => Promise.resolve(fila),
  });
}

// ── El webhook ───────────────────────────────────────────────────────────────

function sobreFirmado(payload: unknown, over: Record<string, unknown> = {}): unknown {
  const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
  return {
    channelId: 'canal-ig',
    payload,
    rawBody,
    headers: { 'x-hub-signature-256': firmaDe(rawBody, SECRETO) },
    ...over,
  };
}

function dmDe(entryId = IG_ID): unknown {
  return {
    object: 'instagram',
    entry: [
      {
        id: entryId,
        messaging: [
          {
            sender: { id: CLIENTE },
            recipient: { id: IG_ID },
            timestamp: T0.getTime(),
            message: { mid: 'mid-cliente', text: '¿cuánto cuesta?' },
          },
        ],
      },
    ],
  };
}

const dmDeCliente = dmDe();

let db: FakeDb;
let restaurar: () => void;

beforeEach(() => {
  db = createFakeDb();
  restaurar = __setClientForTests(db.client);
});

afterEach(() => restaurar());

// ════════════════════════════════════════════════════════════════════════════

describe('el enchufe', () => {
  it('importar la carpeta deja los dos canales registrados', () => {
    // Es lo que promete el registro de H6: «cada driver se auto-registra al
    // importarse». Falta la línea en `packages/inbox/src/index.ts` que importe
    // esta carpeta — está en el README.
    expect(hasDriver('instagram')).toBe(true);
    expect(hasDriver('messenger')).toBe(true);
    expect(driverFor('instagram').type).toBe('instagram');
  });

  it('son dos drivers, uno por canal', () => {
    expect(crearDriversMeta().map((d) => d.type)).toEqual(['instagram', 'messenger']);
  });
});

describe('parseWebhook', () => {
  it('con firma válida, entra el mensaje', async () => {
    const { fetchImpl } = fetchFalso();
    const d = driver(canal(), fetchImpl);

    const mensajes = await d.parseWebhook(sobreFirmado(dmDeCliente));

    expect(mensajes).toHaveLength(1);
    expect(mensajes[0]).toMatchObject({
      channelType: 'instagram',
      address: CLIENTE,
      body: '¿cuánto cuesta?',
      externalId: 'mid-cliente',
    });
  });

  it('y ABRE la ventana de 24 h del cliente', async () => {
    const { fetchImpl } = fetchFalso();
    await driver(canal(), fetchImpl).parseWebhook(sobreFirmado(dmDeCliente));

    const filas = db.tabla('meta_message_windows');
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      tenant_id: TENANT,
      channel_id: 'canal-ig',
      address: CLIENTE,
      last_inbound_at: T0.toISOString(),
    });
  });

  /** Criterio #8. */
  it('con firma INVÁLIDA, se rechaza entero', async () => {
    const { fetchImpl } = fetchFalso();
    const sobre = sobreFirmado(dmDeCliente, {
      headers: { 'x-hub-signature-256': firmaDe('{}', 'otro-secreto') },
    });

    expect(await driver(canal(), fetchImpl).parseWebhook(sobre)).toEqual([]);
    // Y no deja rastro: ni mensaje, ni ventana abierta.
    expect(db.tabla('meta_message_windows')).toHaveLength(0);
  });

  it('sin firma, se rechaza — salvo que el canal lo permita a propósito', async () => {
    const { fetchImpl } = fetchFalso();
    const sinFirma = { channelId: 'canal-ig', payload: dmDeCliente, headers: {} };

    expect(await driver(canal(), fetchImpl).parseWebhook(sinFirma)).toEqual([]);

    // El escape de desarrollo, explícito y por canal.
    const dev = driver(canal({}, { meta_firma_opcional: true }), fetchImpl);
    expect(await dev.parseWebhook(sinFirma)).toHaveLength(1);
  });

  /**
   * El estado de HOY: la ruta de H6 no pasa el cuerpo crudo en el sobre. Se
   * rechaza en vez de re-serializar `payload` para comprobar el HMAC — eso
   * calcularía la firma sobre bytes distintos y tumbaría TODOS los eventos
   * legítimos, con un síntoma que parece de secretos mal puestos.
   */
  it('firmado pero SIN cuerpo crudo: se rechaza, no se adivina', async () => {
    const { fetchImpl } = fetchFalso();
    const sobre = sobreFirmado(dmDeCliente, { rawBody: undefined });
    expect(await driver(canal(), fetchImpl).parseWebhook(sobre)).toEqual([]);
  });

  it('un canal sin App Secret no acepta nada firmado', async () => {
    const { fetchImpl } = fetchFalso();
    const sinSecreto = canal({}, { secret: { page_access_token: TOKEN, verify_token: 'v' } });
    expect(await driver(sinSecreto, fetchImpl).parseWebhook(sobreFirmado(dmDeCliente))).toEqual([]);
  });

  it('el eco de un envío nuestro no vuelve a entrar', async () => {
    const { fetchImpl } = fetchFalso();
    const d = driver(canal(), fetchImpl);

    // Se manda algo, y Meta devuelve su eco. La ventana se abre con una fecha
    // RELATIVA a ahora: una fija haría que la prueba dependiera del día en que
    // se corre, y empezaría a fallar sola pasadas 24 h del valor escrito.
    await registrarEntrante(
      { tenantId: TENANT, tenantSlug: '', userEmail: null, role: null, areas: {} },
      {
        channelId: 'canal-ig',
        address: CLIENTE,
        cuando: new Date(Date.now() - 60_000).toISOString(),
      },
    );
    await d.send({ channelId: 'canal-ig', address: CLIENTE, body: 'son $500' });

    const eco = {
      object: 'instagram',
      entry: [
        {
          id: IG_ID,
          messaging: [
            {
              sender: { id: IG_ID },
              recipient: { id: CLIENTE },
              message: { mid: 'mid-meta-1', text: 'son $500', is_echo: true },
            },
          ],
        },
      ],
    };

    expect(await d.parseWebhook(sobreFirmado(eco))).toEqual([]);
  });

  it('una entrada de OTRA cuenta se descarta: no se mete en esta bandeja', async () => {
    const { fetchImpl } = fetchFalso();
    const ajeno = dmDe('99999999999999');
    expect(await driver(canal(), fetchImpl).parseWebhook(sobreFirmado(ajeno))).toEqual([]);
    expect(db.tabla('meta_message_windows')).toHaveLength(0);
  });
});

describe('parseEvents', () => {
  it('traduce los acuses, y sólo con firma válida', async () => {
    const { fetchImpl } = fetchFalso();
    const payload = {
      object: 'instagram',
      entry: [{ id: IG_ID, messaging: [{ delivery: { mids: ['m1'] } }] }],
    };
    const d = driver(canal(), fetchImpl);

    expect(await d.parseEvents(sobreFirmado(payload))).toEqual([
      { kind: 'acuse', externalId: 'm1', status: 'delivered' },
    ]);

    const malFirmado = sobreFirmado(payload, {
      headers: { 'x-hub-signature-256': firmaDe('{}', 'otro') },
    });
    expect(await d.parseEvents(malFirmado)).toEqual([]);
  });
});

describe('send · la ventana de 24 horas', () => {
  const ctx = { tenantId: TENANT, tenantSlug: '', userEmail: null, role: null, areas: {} };

  it('dentro de la ventana, sale como RESPONSE', async () => {
    await registrarEntrante(ctx, {
      channelId: 'canal-ig',
      address: CLIENTE,
      cuando: new Date(Date.now() - 3600_000).toISOString(),
    });

    const { fetchImpl, llamadas } = fetchFalso();
    const r = await driver(canal(), fetchImpl).send({
      channelId: 'canal-ig',
      address: CLIENTE,
      body: 'son $500',
    });

    expect(r.externalId).toBe('mid-meta-1');
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]?.body).toMatchObject({
      recipient: { id: CLIENTE },
      message: { text: 'son $500' },
      messaging_type: 'RESPONSE',
    });
    expect(llamadas[0]?.body.tag).toBeUndefined();
  });

  /**
   * LA prueba del handoff. Fuera de la ventana no se manda, y —esto es lo que
   * de verdad se mide— **no se llama a Meta siquiera**: cada intento fallido
   * cuenta contra el límite de la app y su error no le explica nada a nadie.
   */
  it('FUERA de la ventana: se rechaza sin gastar una sola llamada a Meta', async () => {
    await registrarEntrante(ctx, {
      channelId: 'canal-ig',
      address: CLIENTE,
      // Hace 25 horas.
      cuando: new Date(Date.now() - 25 * 3600_000).toISOString(),
    });

    const { fetchImpl, llamadas } = fetchFalso();
    const d = driver(canal(), fetchImpl);

    await expect(
      d.send({ channelId: 'canal-ig', address: CLIENTE, body: 'hola otra vez' }),
    ).rejects.toThrow(/24 horas/);

    expect(llamadas).toHaveLength(0);
  });

  it('sin que el cliente haya escrito nunca, tampoco se puede escribir primero', async () => {
    const { fetchImpl, llamadas } = fetchFalso();
    await expect(
      driver(canal(), fetchImpl).send({ channelId: 'canal-ig', address: CLIENTE, body: 'hola' }),
    ).rejects.toThrow(PlatformError);
    expect(llamadas).toHaveLength(0);
  });

  it('fuera de la ventana CON etiqueta configurada, sale como MESSAGE_TAG', async () => {
    await registrarEntrante(ctx, {
      channelId: 'canal-ig',
      address: CLIENTE,
      cuando: new Date(Date.now() - 25 * 3600_000).toISOString(),
    });

    const { fetchImpl, llamadas } = fetchFalso();
    const conEtiqueta = canal({}, { meta_etiqueta_fuera_de_ventana: 'HUMAN_AGENT' });
    await driver(conEtiqueta, fetchImpl).send({
      channelId: 'canal-ig',
      address: CLIENTE,
      body: 'seguimiento',
    });

    expect(llamadas[0]?.body).toMatchObject({ messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' });
  });
});

describe('send · a dónde y cómo', () => {
  const ctx = { tenantId: TENANT, tenantSlug: '', userEmail: null, role: null, areas: {} };

  beforeEach(async () => {
    await registrarEntrante(ctx, {
      channelId: 'canal-ig',
      address: CLIENTE,
      cuando: new Date().toISOString(),
    });
  });

  it('Instagram le cuelga `/messages` a la CUENTA DE IG, no a la página', async () => {
    const { fetchImpl, llamadas } = fetchFalso();
    await driver(canal(), fetchImpl).send({ channelId: 'canal-ig', address: CLIENTE, body: 'hey' });

    expect(llamadas[0]?.url).toContain(`/${IG_ID}/messages`);
    expect(llamadas[0]?.url).not.toContain(`/${PAGE_ID}/messages`);
    // Y viaja el `appsecret_proof`, que Meta exige con "Require app secret".
    expect(llamadas[0]?.url).toContain('appsecret_proof=');
  });

  it('Messenger se la cuelga a la PÁGINA', async () => {
    const fb = canal({ id: 'canal-ig', type: 'messenger', driver: 'messenger' });
    const { fetchImpl, llamadas } = fetchFalso();
    await driver(fb, fetchImpl).send({ channelId: 'canal-ig', address: CLIENTE, body: 'hey' });

    expect(llamadas[0]?.url).toContain(`/${PAGE_ID}/messages`);
  });

  it('texto + adjunto son DOS llamadas, y los dos mids quedan anotados', async () => {
    const { fetchImpl, llamadas } = fetchFalso();
    const r = await driver(canal(), fetchImpl).send({
      channelId: 'canal-ig',
      address: CLIENTE,
      body: 'mira esto',
      media: ['https://cdn.abraxa/foto.jpg'],
    });

    expect(llamadas).toHaveLength(2);
    expect(llamadas[1]?.body).toMatchObject({
      message: { attachment: { type: 'image', payload: { url: 'https://cdn.abraxa/foto.jpg' } } },
    });

    // El que devuelve `send()` es el primero — el que H6 guarda en
    // `external_id`. Pero se anotan los DOS: si el segundo no se recordara, su
    // eco entraría como "un humano escribió" y pausaría al agente una hora.
    expect(r.externalId).toBe('mid-meta-1');
    expect(db.tabla('meta_outbound_mids').map((f) => f.mid)).toEqual(['mid-meta-1', 'mid-meta-2']);
  });

  it('un texto largo se parte, y cada trozo queda anotado', async () => {
    const { fetchImpl, llamadas } = fetchFalso();
    const largo = `${'palabra '.repeat(200)}fin`; // ~1600 caracteres, tope IG 1000

    await driver(canal(), fetchImpl).send({
      channelId: 'canal-ig',
      address: CLIENTE,
      body: largo,
    });

    expect(llamadas.length).toBeGreaterThan(1);
    for (const l of llamadas) {
      expect(String((l.body.message as { text: string }).text).length).toBeLessThanOrEqual(1_000);
    }
    expect(db.tabla('meta_outbound_mids')).toHaveLength(llamadas.length);
  });

  it('una dirección vacía se rechaza antes de tocar la red', async () => {
    const { fetchImpl, llamadas } = fetchFalso();
    await expect(
      driver(canal(), fetchImpl).send({ channelId: 'canal-ig', address: '   ', body: 'hola' }),
    ).rejects.toThrow(PlatformError);
    expect(llamadas).toHaveLength(0);
  });

  it('un error de Meta se traduce a algo que se puede leer', async () => {
    const { fetchImpl } = fetchFalso([
      { error: { code: 190, message: 'Error validating access token' } },
    ]);

    await expect(
      driver(canal(), fetchImpl).send({ channelId: 'canal-ig', address: CLIENTE, body: 'hola' }),
    ).rejects.toThrow(/token de página de Meta caducó/);
  });
});

describe('verificarWebhook · el GET de alta', () => {
  it('devuelve el challenge crudo cuando el verify_token coincide', () => {
    const { fetchImpl } = fetchFalso();
    const d = driver(canal(), fetchImpl);

    const r = d.verificarWebhook({
      query: {
        'hub.mode': 'subscribe',
        'hub.verify_token': 'verifica-me',
        'hub.challenge': '1158201444',
      },
      config: canal().config,
    });

    expect(r).toBe('1158201444');
  });

  it('con el token equivocado devuelve null — 403, no 200', () => {
    const { fetchImpl } = fetchFalso();
    const r = driver(canal(), fetchImpl).verificarWebhook({
      query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'otro', 'hub.challenge': '1' },
      config: canal().config,
    });
    expect(r).toBeNull();
  });
});

describe('provisionChannel', () => {
  it('genera los dos secretos que la pantalla va a necesitar', async () => {
    const { fetchImpl } = fetchFalso();
    const config: Record<string, unknown> = {};

    const r = await driver(canal(), fetchImpl).provisionChannel({
      tenantId: TENANT,
      name: 'Instagram',
      config,
    });

    expect(typeof config.webhook_token).toBe('string');
    expect((config.secret as Record<string, string>).verify_token).toMatch(/^[0-9a-f]{48}$/);
    // Sin cuenta vinculada todavía: `pending` y sin dirección propia.
    expect(r).toEqual({ externalId: '', status: 'pending' });
  });

  it('reaprovisionar NO rota los secretos: la URL ya está en el panel de Meta', async () => {
    const { fetchImpl } = fetchFalso();
    const config: Record<string, unknown> = {
      webhook_token: 'el-de-siempre',
      secret: { verify_token: 'v-de-siempre', page_access_token: TOKEN },
    };

    await driver(canal(), fetchImpl).provisionChannel({
      tenantId: TENANT,
      name: 'Instagram',
      config,
    });

    expect(config.webhook_token).toBe('el-de-siempre');
    expect(config.secret).toMatchObject({
      verify_token: 'v-de-siempre',
      page_access_token: TOKEN,
    });
  });
});

describe('partirTexto', () => {
  it('no parte lo que cabe', () => {
    expect(partirTexto('hola', 100)).toEqual(['hola']);
    expect(partirTexto('', 100)).toEqual([]);
  });

  it('corta por el espacio, no a mitad de palabra', () => {
    const trozos = partirTexto('el precio es de 1250 pesos con IVA incluido', 20);
    expect(trozos.every((t) => t.length <= 20)).toBe(true);
    expect(trozos.join(' ')).toBe('el precio es de 1250 pesos con IVA incluido');
  });

  it('con una cadena sin espacios corta a lo bruto, que es lo único posible', () => {
    const trozos = partirTexto('x'.repeat(50), 20);
    expect(trozos).toEqual(['x'.repeat(20), 'x'.repeat(20), 'x'.repeat(10)]);
  });
});
