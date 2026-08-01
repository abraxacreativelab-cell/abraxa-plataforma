/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Criterio #6 — la ventana de 24 horas, medida.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Es el requisito que un driver ingenuo pasa en verde y falla en producción:
 *  en desarrollo siempre se contesta a los diez segundos. Aquí el tiempo se
 *  controla, así que las 24 horas se pueden cruzar de verdad.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __setClientForTests, PlatformError } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import { createFakeDb, type FakeDb } from '../../testing/fake-db';
import {
  AVISO_MS,
  VENTANA_MS,
  calcularVentana,
  decidirEnvio,
  estadoDeVentana,
  etiquetaValida,
  explicarCierre,
  registrarEntrante,
  ultimoEntranteDe,
} from './ventana';

const TENANT = '11111111-1111-1111-1111-111111111111';
const CANAL = 'canal-ig';
const CLIENTE = '17841400000000000';

const ctx: TenantContext = {
  tenantId: TENANT,
  tenantSlug: 'demo',
  userEmail: null,
  role: null,
  areas: {},
};

let db: FakeDb;
let restaurar: () => void;

beforeEach(() => {
  db = createFakeDb();
  restaurar = __setClientForTests(db.client);
});

afterEach(() => restaurar());

const T0 = new Date('2026-07-31T10:00:00.000Z');
const mas = (ms: number): Date => new Date(T0.getTime() + ms);

describe('calcularVentana', () => {
  it('abierta dentro de las 24 h', () => {
    const v = calcularVentana(T0.toISOString(), mas(23 * 3600_000));
    expect(v.abierta).toBe(true);
    expect(v.minutosRestantes).toBe(60);
    expect(v.cierraEn).toBe(mas(VENTANA_MS).toISOString());
  });

  it('cerrada al pasar las 24 h — el minuto exacto importa', () => {
    expect(calcularVentana(T0.toISOString(), mas(VENTANA_MS - 1)).abierta).toBe(true);
    expect(calcularVentana(T0.toISOString(), mas(VENTANA_MS)).abierta).toBe(false);
    expect(calcularVentana(T0.toISOString(), mas(VENTANA_MS + 1)).minutosRestantes).toBe(0);
  });

  it('avisa cuando se está cerrando, que es lo que la bandeja tiene que enseñar', () => {
    // Justo antes del margen de aviso: abierta y en silencio.
    expect(calcularVentana(T0.toISOString(), mas(VENTANA_MS - AVISO_MS - 1)).porCerrar).toBe(false);
    // Dentro del margen: abierta y avisando.
    const avisando = calcularVentana(T0.toISOString(), mas(VENTANA_MS - AVISO_MS + 1));
    expect(avisando.abierta).toBe(true);
    expect(avisando.porCerrar).toBe(true);
    // Ya cerrada: no "por cerrar", cerrada.
    expect(calcularVentana(T0.toISOString(), mas(VENTANA_MS + 1)).porCerrar).toBe(false);
  });

  it('sin mensaje del cliente, la ventana está CERRADA', () => {
    // No es un detalle: Meta no deja escribir primero. Tratar "nunca escribió"
    // como ventana abierta haría que el primer envío fallara del lado de Meta
    // con un error que no explica nada.
    const v = calcularVentana(null, T0);
    expect(v.abierta).toBe(false);
    expect(v.cierraEn).toBeNull();
    expect(v.ultimoEntrante).toBeNull();
  });

  it('una fecha corrupta no abre la ventana', () => {
    expect(calcularVentana('no es una fecha', T0).abierta).toBe(false);
  });
});

describe('la ventana persistida', () => {
  it('el mensaje del cliente la abre, y el estado se lee de vuelta', async () => {
    await registrarEntrante(ctx, { channelId: CANAL, address: CLIENTE, cuando: T0.toISOString() });

    expect(await ultimoEntranteDe(ctx, { channelId: CANAL, address: CLIENTE })).toBe(
      T0.toISOString(),
    );

    const dentro = await estadoDeVentana(ctx, {
      channelId: CANAL,
      address: CLIENTE,
      ahora: mas(3600_000),
    });
    expect(dentro.abierta).toBe(true);

    const fuera = await estadoDeVentana(ctx, {
      channelId: CANAL,
      address: CLIENTE,
      ahora: mas(VENTANA_MS + 1000),
    });
    expect(fuera.abierta).toBe(false);
  });

  it('un segundo mensaje la renueva, y no duplica la fila', async () => {
    await registrarEntrante(ctx, { channelId: CANAL, address: CLIENTE, cuando: T0.toISOString() });
    await registrarEntrante(ctx, {
      channelId: CANAL,
      address: CLIENTE,
      cuando: mas(12 * 3600_000).toISOString(),
    });

    expect(db.tabla('meta_message_windows')).toHaveLength(1);
    expect(await ultimoEntranteDe(ctx, { channelId: CANAL, address: CLIENTE })).toBe(
      mas(12 * 3600_000).toISOString(),
    );
  });

  it('cada persona tiene su ventana, y cada canal la suya', async () => {
    await registrarEntrante(ctx, { channelId: CANAL, address: CLIENTE, cuando: T0.toISOString() });
    await registrarEntrante(ctx, { channelId: CANAL, address: 'otra-persona', cuando: T0.toISOString() });
    await registrarEntrante(ctx, { channelId: 'canal-fb', address: CLIENTE, cuando: T0.toISOString() });

    expect(db.tabla('meta_message_windows')).toHaveLength(3);
    expect(await ultimoEntranteDe(ctx, { channelId: CANAL, address: 'nadie' })).toBeNull();
  });

  it('el aislamiento lo pone `tenantDb`, y aquí se comprueba', async () => {
    await registrarEntrante(ctx, { channelId: CANAL, address: CLIENTE, cuando: T0.toISOString() });

    const otroTenant: TenantContext = { ...ctx, tenantId: '22222222-2222-2222-2222-222222222222' };
    expect(await ultimoEntranteDe(otroTenant, { channelId: CANAL, address: CLIENTE })).toBeNull();
  });

  it('si la escritura falla, NO tumba la ingesta', async () => {
    restaurar();
    // Un cliente que revienta en cualquier llamada.
    restaurar = __setClientForTests({
      from: () => {
        throw new Error('base caída');
      },
    } as never);

    await expect(
      registrarEntrante(ctx, { channelId: CANAL, address: CLIENTE, cuando: T0.toISOString() }),
    ).resolves.toBeUndefined();
  });
});

describe('decidirEnvio', () => {
  it('dentro de la ventana: sin etiqueta, como RESPONSE', () => {
    const estado = calcularVentana(T0.toISOString(), mas(3600_000));
    expect(decidirEnvio({ estado, canal: 'instagram' }).etiqueta).toBeUndefined();
  });

  it('FUERA de la ventana y sin etiqueta: se rechaza AQUÍ, sin llamar a Meta', () => {
    const estado = calcularVentana(T0.toISOString(), mas(VENTANA_MS + 1000));
    try {
      decidirEnvio({ estado, canal: 'instagram' });
      throw new Error('debió lanzar');
    } catch (err) {
      expect(PlatformError.is(err)).toBe(true);
      const e = err as PlatformError;
      expect(e.code).toBe('CHANNEL_ERROR');
      // No reintentable: esperar y volver a intentar no reabre la ventana.
      expect(e.retryable).toBe(false);
      // El texto tiene que servirle a un humano, con las fechas.
      expect(e.message).toContain('24 horas');
      expect(e.message).toContain(T0.toISOString());
    }
  });

  it('fuera de la ventana CON etiqueta configurada: se manda con esa etiqueta', () => {
    const estado = calcularVentana(T0.toISOString(), mas(VENTANA_MS + 1000));
    const d = decidirEnvio({ estado, etiquetaConfigurada: 'HUMAN_AGENT', canal: 'instagram' });
    expect(d.etiqueta).toBe('HUMAN_AGENT');
  });

  it('una etiqueta inventada NO sirve de escape', () => {
    const estado = calcularVentana(T0.toISOString(), mas(VENTANA_MS + 1000));
    expect(() =>
      decidirEnvio({ estado, etiquetaConfigurada: 'LO_QUE_SEA', canal: 'instagram' }),
    ).toThrow();
  });

  it('nunca escribió: el mensaje lo dice sin hablar de una ventana que no existió', () => {
    const estado = calcularVentana(null, T0);
    expect(explicarCierre(estado, 'instagram')).toContain('tiene que abrirla el cliente');
  });
});

describe('etiquetaValida', () => {
  it('acepta las cuatro de Meta, sin importar mayúsculas', () => {
    expect(etiquetaValida('human_agent')).toBe('HUMAN_AGENT');
    expect(etiquetaValida('ACCOUNT_UPDATE')).toBe('ACCOUNT_UPDATE');
    expect(etiquetaValida('POST_PURCHASE_UPDATE')).toBe('POST_PURCHASE_UPDATE');
    expect(etiquetaValida('CONFIRMED_EVENT_UPDATE')).toBe('CONFIRMED_EVENT_UPDATE');
  });

  it('rechaza cualquier otra cosa', () => {
    expect(etiquetaValida('PROMO')).toBeUndefined();
    expect(etiquetaValida(undefined)).toBeUndefined();
    expect(etiquetaValida('')).toBeUndefined();
  });
});
