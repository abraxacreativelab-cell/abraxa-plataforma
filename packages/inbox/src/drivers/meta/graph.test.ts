/**
 * La traducción de los errores de Meta.
 *
 * `retryable` no es cosmético: el motor de H8 lo usa para decidir si pausa una
 * corrida o la mata, y H6 marca el mensaje con este texto. Un token caducado
 * marcado como reintentable pone al sistema a reintentar en bucle algo que no
 * se arregla solo.
 */
import { describe, expect, it } from 'vitest';
import { PlatformError } from '@abraxa/db';
import {
  CODIGO_FUERA_DE_VENTANA,
  SUBCODIGO_FUERA_DE_VENTANA,
  createClienteMeta,
  errorDeMeta,
  pruebaDeSecreto,
} from './graph';
import { leerConfigMeta } from './ajustes';

describe('errorDeMeta', () => {
  it('reconoce el error de la ventana de 24 h y lo explica', () => {
    const e = errorDeMeta(
      { code: CODIGO_FUERA_DE_VENTANA, error_subcode: SUBCODIGO_FUERA_DE_VENTANA, message: 'x' },
      400,
      'Mensaje no enviado',
    );
    expect(e.code).toBe('CHANNEL_ERROR');
    expect(e.retryable).toBe(false);
    expect(e.message).toContain('24 horas');
  });

  it('un token caducado NO es reintentable: reintentar no lo renueva', () => {
    const e = errorDeMeta({ code: 190, message: 'Error validating access token' }, 400, 'x');
    expect(e.retryable).toBe(false);
    expect(e.message).toContain('volver a vincular');
  });

  it('un límite de tasa SÍ es reintentable', () => {
    expect(errorDeMeta({ code: 613 }, 400, 'x').code).toBe('RATE_LIMITED');
    expect(errorDeMeta({ code: 613 }, 400, 'x').retryable).toBe(true);
    expect(errorDeMeta(undefined, 429, 'x').code).toBe('RATE_LIMITED');
  });

  it('una persona que bloqueó la cuenta no es un fallo transitorio', () => {
    const e = errorDeMeta({ code: 551 }, 400, 'x');
    expect(e.retryable).toBe(false);
    expect(e.message).toContain('no está disponible');
  });

  it('un 5xx del proveedor se reintenta; un 4xx no', () => {
    expect(errorDeMeta({ message: 'boom' }, 500, 'x').retryable).toBe(true);
    expect(errorDeMeta({ message: 'boom' }, 400, 'x').retryable).toBe(false);
  });

  it('prefiere el texto que Meta escribió para un humano', () => {
    const e = errorDeMeta(
      { message: 'técnico', error_user_msg: 'La cuenta no acepta mensajes' },
      400,
      'x',
    );
    expect(e.message).toContain('La cuenta no acepta mensajes');
  });
});

describe('el cliente', () => {
  const cfg = leerConfigMeta('instagram', {
    ig_user_id: '17841400000000000',
    page_id: '102938475600000',
    secret: { page_access_token: 'tok', app_secret: 'sec' },
  });

  it('un timeout NO se reintenta: la petición pudo entregarse', async () => {
    const cliente = createClienteMeta({
      fetchImpl: () => Promise.reject(Object.assign(new Error('t'), { name: 'TimeoutError' })),
    });

    try {
      await cliente.enviarTexto(cfg, { destino: '1', texto: 'hola' });
      throw new Error('debió lanzar');
    } catch (err) {
      expect(PlatformError.is(err)).toBe(true);
      // Reintentar a ciegas le manda al cliente el mismo DM dos veces.
      expect((err as PlatformError).retryable).toBe(false);
      expect((err as PlatformError).message).toContain('ambiguo');
    }
  });

  it('una red caída SÍ se reintenta: el mensaje seguro no salió', async () => {
    const cliente = createClienteMeta({
      fetchImpl: () => Promise.reject(Object.assign(new Error('x'), { name: 'TypeError' })),
    });

    await expect(cliente.enviarTexto(cfg, { destino: '1', texto: 'hola' })).rejects.toMatchObject({
      retryable: true,
    });
  });

  it('`perfil` devuelve null en vez de lanzar — un nombre no tumba un webhook', async () => {
    const cliente = createClienteMeta({
      fetchImpl: () =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { code: 10, message: 'sin permiso' } }), {
            status: 403,
          }),
        ),
    });
    expect(await cliente.perfil(cfg, '123')).toBeNull();
  });
});

describe('pruebaDeSecreto', () => {
  it('es el HMAC del token con el App Secret', () => {
    // Meta lo exige cuando la app tiene "Require app secret"; sin él, el
    // síntoma es un 400 genérico.
    expect(pruebaDeSecreto('tok', 'sec')).toMatch(/^[0-9a-f]{64}$/);
    expect(pruebaDeSecreto('tok', 'sec')).toBe(pruebaDeSecreto('tok', 'sec'));
    expect(pruebaDeSecreto('tok', 'sec')).not.toBe(pruebaDeSecreto('tok', 'otro'));
  });
});
