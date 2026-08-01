/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Que un token de página no salga al navegador. Medido contra el filtro REAL.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  `sanearCanal()` es de H6 y filtra por **lista de nombres exactos**. Ni
 *  `page_access_token` ni `app_secret` están en esa lista, así que guardarlos
 *  como llaves de primer nivel los publicaría en `GET /inbox/channels`.
 *
 *  Por eso viven anidados bajo `secret`. Esta prueba llama al `sanearCanal` de
 *  verdad —no a una copia— para que el día que alguien cambie ese filtro, la
 *  que se caiga sea ésta y no la confianza de un cliente.
 */
import { describe, expect, it } from 'vitest';
import { sanearCanal } from '../../channels/service';
import type { ChannelRow } from '../../types';
import { exigirToken, guardarSecretos, idDeEnvio, leerConfigMeta, LARGO_MAXIMO } from './ajustes';
import { configDeCanal } from './conexion';

const IG_ID = '17841400000000000';
const PAGE_ID = '102938475600000';

function fila(config: Record<string, unknown>): ChannelRow {
  return {
    id: 'canal-1',
    tenant_id: '11111111-1111-1111-1111-111111111111',
    type: 'instagram',
    driver: 'instagram',
    name: 'Instagram del negocio',
    config,
    external_id: IG_ID,
    status: 'active',
    agent_role: 'sales',
    ai_enabled: true,
    business_hours: {},
    ai_outside_hours: true,
    created_at: '2026-07-31T00:00:00.000Z',
    updated_at: '2026-07-31T00:00:00.000Z',
  };
}

describe('los secretos no cruzan la red', () => {
  const config = configDeCanal({
    canal: 'instagram',
    cuenta: {
      pageId: PAGE_ID,
      pageName: 'Mi negocio',
      igUserId: IG_ID,
      igUsername: 'minegocio',
      pageAccessToken: 'EAAG-token-de-pagina-secretisimo',
      utilizable: true,
    },
    appId: '942016735581534',
    appSecret: 'app-secret-secretisimo',
    previa: {},
  });

  it('`sanearCanal` borra TODOS los secretos de Meta', () => {
    const publico = sanearCanal(fila(config));
    const serializado = JSON.stringify(publico);

    expect(publico.config.secret).toBeUndefined();
    expect(publico.config.webhook_token).toBeUndefined();

    // La prueba que de verdad importa: ni rastro de los valores en lo que sale.
    expect(serializado).not.toContain('EAAG-token-de-pagina-secretisimo');
    expect(serializado).not.toContain('app-secret-secretisimo');
    expect(serializado).not.toContain(String(config.webhook_token));
    expect(serializado).not.toContain(
      String((config.secret as Record<string, unknown>).verify_token),
    );
  });

  it('lo que NO es secreto sí se conserva: la pantalla necesita enseñarlo', () => {
    const publico = sanearCanal(fila(config));
    expect(publico.config.page_id).toBe(PAGE_ID);
    expect(publico.config.ig_user_id).toBe(IG_ID);
    expect(publico.config.ig_username).toBe('minegocio');
    expect(publico.config.page_name).toBe('Mi negocio');
    expect(publico.conectado).toBe(true);
  });

  it('un secreto suelto en la raíz SÍ se filtraría — por eso van anidados', () => {
    // No es una hipótesis: es lo que pasaría con el nombre obvio. La prueba
    // documenta el motivo del anidado para quien venga a "simplificarlo".
    const ingenuo = sanearCanal(fila({ page_access_token: 'EAAG-fuga' }));
    expect(JSON.stringify(ingenuo)).toContain('EAAG-fuga');
  });
});

describe('leerConfigMeta', () => {
  it('lee los secretos de `config.secret`', () => {
    const cfg = leerConfigMeta('instagram', {
      page_id: PAGE_ID,
      ig_user_id: IG_ID,
      secret: { page_access_token: 'tok', app_secret: 'sec', verify_token: 'ver' },
    });
    expect(cfg.pageAccessToken).toBe('tok');
    expect(cfg.appSecret).toBe('sec');
    expect(cfg.verifyToken).toBe('ver');
  });

  it('el canal manda sobre el entorno — es lo que hace posible a H17', () => {
    process.env.META_APP_SECRET = 'del-entorno';
    try {
      const propio = leerConfigMeta('instagram', { secret: { app_secret: 'del-canal' } });
      expect(propio.appSecret).toBe('del-canal');

      // Y sólo cae al entorno si el canal no trae nada. Mientras eso pase, DOS
      // clientes comparten credenciales: es el motivo de la dependencia con H17.
      const sinNada = leerConfigMeta('instagram', {});
      expect(sinNada.appSecret).toBe('del-entorno');
    } finally {
      delete process.env.META_APP_SECRET;
    }
  });

  it('el id de entrada es el de IG en Instagram y el de la página en Messenger', () => {
    const ig = leerConfigMeta('instagram', { page_id: PAGE_ID, ig_user_id: IG_ID });
    const fb = leerConfigMeta('messenger', { page_id: PAGE_ID, ig_user_id: IG_ID });
    expect(ig.idDeEntrada).toBe(IG_ID);
    expect(fb.idDeEntrada).toBe(PAGE_ID);
    expect(ig.objeto).toBe('instagram');
    expect(fb.objeto).toBe('page');
  });

  it('la firma es obligatoria salvo que el canal diga lo contrario', () => {
    expect(leerConfigMeta('instagram', {}).firmaOpcional).toBe(false);
    expect(leerConfigMeta('instagram', { meta_firma_opcional: true }).firmaOpcional).toBe(true);
    // Sólo el booleano exacto. Un "true" de texto en un JSON no abre la puerta.
    expect(leerConfigMeta('instagram', { meta_firma_opcional: 'true' }).firmaOpcional).toBe(false);
  });
});

describe('los errores dicen qué falta', () => {
  it('sin token de página, el error explica de dónde sale', () => {
    expect(() => exigirToken(leerConfigMeta('instagram', {}))).toThrow(/token de página/i);
  });

  it('un canal de Instagram sin `ig_user_id` no intenta enviar con el de la página', () => {
    // Enviar al id de la página devuelve un 400 de Meta que no dice cuál de los
    // dos ids está mal. Se falla antes, y diciéndolo.
    const cfg = leerConfigMeta('instagram', { page_id: PAGE_ID });
    expect(() => idDeEnvio(cfg)).toThrow(/ig_user_id/);
    expect(idDeEnvio(leerConfigMeta('messenger', { page_id: PAGE_ID }))).toBe(PAGE_ID);
  });
});

describe('guardarSecretos', () => {
  it('no pisa los que ya estaban', () => {
    const previo = { secret: { app_secret: 'viejo', verify_token: 'v' } };
    const nuevo = guardarSecretos(previo, { page_access_token: 'tok', app_secret: undefined });
    expect(nuevo.secret).toEqual({ app_secret: 'viejo', verify_token: 'v', page_access_token: 'tok' });
  });
});

describe('los topes de Meta', () => {
  it('no son el mismo en los dos canales', () => {
    // Instagram corta en 1000 y Messenger en 2000. Usar el mismo número para
    // los dos da un 400 genérico que no dice cuál se rompió.
    expect(LARGO_MAXIMO.instagram).toBe(1_000);
    expect(LARGO_MAXIMO.messenger).toBe(2_000);
  });
});
