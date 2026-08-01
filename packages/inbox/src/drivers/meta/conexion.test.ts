/**
 * El flujo de vinculación: autorizar, canjear, elegir página, suscribir.
 *
 * El paso que más se olvida —y el que deja un canal que se ve conectado y no
 * recibe nada— es el cuarto. Aquí se mide que ocurre.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __setClientForTests, PlatformError } from '@abraxa/db';
import { createFakeDb, type FakeDb } from '../../testing/fake-db';
import { createClienteMeta } from './graph';
import {
  EVENTOS,
  PERMISOS,
  REDIRECT_URI,
  conectarCuenta,
  configDeCanal,
  cuentasVinculables,
  redirectUriPorDefecto,
  urlDeAutorizacion,
  type CuentaVinculable,
} from './conexion';

const APP_ID = '942016735581534';
const APP_SECRET = 'app-secret';
const PAGE_ID = '102938475600000';
const IG_ID = '17841400000000000';

let db: FakeDb;
let restaurar: () => void;

beforeEach(() => {
  db = createFakeDb();
  restaurar = __setClientForTests(db.client);
});

afterEach(() => restaurar());

function fetchFalso(respuestas: unknown[]): {
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;
  urls: string[];
} {
  const urls: string[] = [];
  let n = 0;
  return {
    urls,
    fetchImpl: (url: string) => {
      urls.push(url);
      const cuerpo = respuestas[n] ?? {};
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

describe('urlDeAutorizacion', () => {
  it('pide los permisos mínimos de cada canal', () => {
    const ig = new URL(
      urlDeAutorizacion({
        canal: 'instagram',
        appId: APP_ID,
        redirectUri: 'https://mi.abraxa.club/ajustes/integraciones/meta',
        state: 'estado-1',
      }),
    );
    expect(ig.searchParams.get('scope')).toBe(PERMISOS.instagram.join(','));
    expect(ig.searchParams.get('client_id')).toBe(APP_ID);
    expect(ig.searchParams.get('state')).toBe('estado-1');

    const fb = new URL(
      urlDeAutorizacion({
        canal: 'messenger',
        appId: APP_ID,
        redirectUri: 'https://mi.abraxa.club/x',
        state: 's',
      }),
    );
    expect(fb.searchParams.get('scope')).toBe(PERMISOS.messenger.join(','));
    // Instagram necesita `instagram_manage_messages`; Messenger no.
    expect(PERMISOS.instagram).toContain('instagram_manage_messages');
    expect(PERMISOS.messenger).not.toContain('instagram_manage_messages');
  });

  it('exige `state`: sin él, un tercero puede montar la vinculación', () => {
    expect(() =>
      urlDeAutorizacion({ canal: 'instagram', appId: APP_ID, redirectUri: 'https://x', state: '' }),
    ).toThrow(PlatformError);
  });

  it('sin App ID lo dice, en vez de armar una URL rota', () => {
    const previo = process.env.META_APP_ID;
    delete process.env.META_APP_ID;
    try {
      expect(() => urlDeAutorizacion({ canal: 'instagram', state: 's' })).toThrow(/App ID/);
    } finally {
      if (previo !== undefined) process.env.META_APP_ID = previo;
    }
  });

  it('toma el App ID del entorno cuando no se lo pasan — es lo que puso H0', () => {
    const previo = process.env.META_APP_ID;
    process.env.META_APP_ID = APP_ID;
    try {
      const url = new URL(urlDeAutorizacion({ canal: 'instagram', state: 's' }));
      expect(url.searchParams.get('client_id')).toBe(APP_ID);
    } finally {
      if (previo === undefined) delete process.env.META_APP_ID;
      else process.env.META_APP_ID = previo;
    }
  });
});

describe('el redirect_uri', () => {
  it('es el que H0 registró en Meta', () => {
    expect(REDIRECT_URI).toBe('https://mi.abraxa.club/ajustes/integraciones/meta/callback');
    expect(redirectUriPorDefecto()).toBe(REDIRECT_URI);
  });

  it('`META_REDIRECT_URI` lo pisa, para desarrollo', () => {
    const previo = process.env.META_REDIRECT_URI;
    process.env.META_REDIRECT_URI = 'https://localhost:3000/cb';
    try {
      expect(redirectUriPorDefecto()).toBe('https://localhost:3000/cb');
    } finally {
      if (previo === undefined) delete process.env.META_REDIRECT_URI;
      else process.env.META_REDIRECT_URI = previo;
    }
  });

  /**
   * LA prueba de este bloque. Meta compara el `redirect_uri` del diálogo con el
   * del canje **carácter por carácter**, y cuando no coinciden el error no lo
   * menciona: dice «Invalid verification code format». Media tarde.
   */
  it('el del diálogo y el del canje son EL MISMO, sin pasarlo por ningún lado', async () => {
    const previo = process.env.META_APP_ID;
    const previoS = process.env.META_APP_SECRET;
    process.env.META_APP_ID = APP_ID;
    process.env.META_APP_SECRET = APP_SECRET;

    try {
      const enElDialogo = new URL(
        urlDeAutorizacion({ canal: 'instagram', state: 's' }),
      ).searchParams.get('redirect_uri');

      const { fetchImpl, urls } = fetchFalso([
        { access_token: 'corto' },
        { access_token: 'largo' },
        { data: [] },
      ]);
      await cuentasVinculables(createClienteMeta({ fetchImpl }), {
        canal: 'instagram',
        code: 'codigo',
      });
      const enElCanje = new URL(urls[0] ?? '').searchParams.get('redirect_uri');

      expect(enElCanje).toBe(enElDialogo);
      expect(enElCanje).toBe(REDIRECT_URI);
    } finally {
      if (previo === undefined) delete process.env.META_APP_ID;
      else process.env.META_APP_ID = previo;
      if (previoS === undefined) delete process.env.META_APP_SECRET;
      else process.env.META_APP_SECRET = previoS;
    }
  });

  it('sin credenciales en el entorno, el canje lo dice en vez de fallar en Meta', async () => {
    const previo = process.env.META_APP_ID;
    const previoS = process.env.META_APP_SECRET;
    delete process.env.META_APP_ID;
    delete process.env.META_APP_SECRET;

    try {
      const { fetchImpl } = fetchFalso([{}]);
      await expect(
        cuentasVinculables(createClienteMeta({ fetchImpl }), { canal: 'instagram', code: 'c' }),
      ).rejects.toThrow(/META_APP_ID/);
    } finally {
      if (previo !== undefined) process.env.META_APP_ID = previo;
      if (previoS !== undefined) process.env.META_APP_SECRET = previoS;
    }
  });
});

describe('cuentasVinculables', () => {
  it('canjea el código, lo cambia por uno LARGO y lista las páginas', async () => {
    const { fetchImpl, urls } = fetchFalso([
      { access_token: 'token-corto' },
      { access_token: 'token-largo', expires_in: 5_184_000 },
      {
        data: [
          {
            id: PAGE_ID,
            name: 'Mi negocio',
            access_token: 'token-de-pagina',
            instagram_business_account: { id: IG_ID, username: 'minegocio' },
          },
        ],
      },
    ]);

    const cuentas = await cuentasVinculables(createClienteMeta({ fetchImpl }), {
      canal: 'instagram',
      appId: APP_ID,
      appSecret: APP_SECRET,
      code: 'codigo-de-oauth',
      redirectUri: 'https://mi.abraxa.club/x',
    });

    // El canje del token corto por el largo ocurre AQUÍ y no "luego": el corto
    // dura una hora y la integración se moriría sola esa misma tarde.
    expect(urls[1]).toContain('grant_type=fb_exchange_token');
    expect(cuentas).toEqual([
      {
        pageId: PAGE_ID,
        pageName: 'Mi negocio',
        igUserId: IG_ID,
        igUsername: 'minegocio',
        pageAccessToken: 'token-de-pagina',
        utilizable: true,
      },
    ]);
  });

  it('devuelve también las que NO sirven, con el motivo escrito', async () => {
    const { fetchImpl } = fetchFalso([
      { access_token: 'corto' },
      { access_token: 'largo' },
      { data: [{ id: PAGE_ID, name: 'Sin IG', access_token: 'tok' }] },
    ]);

    const [cuenta] = await cuentasVinculables(createClienteMeta({ fetchImpl }), {
      canal: 'instagram',
      appId: APP_ID,
      appSecret: APP_SECRET,
      code: 'c',
      redirectUri: 'https://x',
    });

    // Esconderla dejaría al emprendedor mirando una lista vacía sin saber que
    // le falta vincular su Instagram a la página. Es el caso más común.
    expect(cuenta?.utilizable).toBe(false);
    expect(cuenta?.motivo).toContain('Instagram profesional');
  });

  it('un código rechazado por Meta se traduce a un error legible', async () => {
    const { fetchImpl } = fetchFalso([{ error: { code: 100, message: 'Invalid verification code' } }]);
    await expect(
      cuentasVinculables(createClienteMeta({ fetchImpl }), {
        canal: 'instagram',
        appId: APP_ID,
        appSecret: APP_SECRET,
        code: 'malo',
        redirectUri: 'https://x',
      }),
    ).rejects.toThrow(/código de autorización/);
  });
});

describe('conectarCuenta', () => {
  const cuenta: CuentaVinculable = {
    pageId: PAGE_ID,
    pageName: 'Mi negocio',
    igUserId: IG_ID,
    igUsername: 'minegocio',
    pageAccessToken: 'token-de-pagina',
    utilizable: true,
  };

  it('SUSCRIBE la página — el paso sin el cual no llega ni un mensaje', async () => {
    const { fetchImpl, urls } = fetchFalso([{ success: true }]);

    const r = await conectarCuenta(createClienteMeta({ fetchImpl }), {
      canal: 'instagram',
      cuenta,
      appId: APP_ID,
      appSecret: APP_SECRET,
    });

    expect(urls[0]).toContain(`/${PAGE_ID}/subscribed_apps`);
    for (const evento of EVENTOS.instagram) {
      expect(decodeURIComponent(urls[0] ?? '')).toContain(evento);
    }
    expect(r.status).toBe('active');
    expect(r.externalId).toBe(IG_ID);
  });

  it('en Messenger se suscribe a los ecos: es lo que avisa de que el dueño contestó', async () => {
    expect(EVENTOS.messenger).toContain('message_echoes');
  });

  it('la config queda con los secretos anidados y los datos públicos fuera', async () => {
    const { fetchImpl } = fetchFalso([{ success: true }]);
    const { config } = await conectarCuenta(createClienteMeta({ fetchImpl }), {
      canal: 'instagram',
      cuenta,
      appId: APP_ID,
      appSecret: APP_SECRET,
    });

    expect(config.page_id).toBe(PAGE_ID);
    expect(config.ig_user_id).toBe(IG_ID);
    expect(config.secret).toMatchObject({
      page_access_token: 'token-de-pagina',
      app_secret: APP_SECRET,
      app_id: APP_ID,
    });
    expect(config.page_access_token).toBeUndefined();
  });

  it('una cuenta inutilizable no se conecta', async () => {
    const { fetchImpl, urls } = fetchFalso([{ success: true }]);
    await expect(
      conectarCuenta(createClienteMeta({ fetchImpl }), {
        canal: 'instagram',
        cuenta: { ...cuenta, utilizable: false, motivo: 'sin IG vinculado' },
        appId: APP_ID,
        appSecret: APP_SECRET,
      }),
    ).rejects.toThrow(/sin IG vinculado/);
    expect(urls).toHaveLength(0);
  });

  it('una cuenta que ya usa otra empresa se rechaza, sin decir de quién es', async () => {
    // El doble en memoria de H6 no entiende los operadores JSON de PostgREST
    // (`config->>page_id`), así que se siembra la columna con ese nombre
    // literal para poder ejercitar la rama. El operador de verdad se verifica
    // contra Postgres al aplicar la migración — queda anotado en el PR.
    db.sembrar('channels', [
      { id: 'otro-canal', tenant_id: 'otra-empresa', type: 'instagram', 'config->>ig_user_id': IG_ID },
    ]);

    const { fetchImpl, urls } = fetchFalso([{ success: true }]);
    try {
      await conectarCuenta(createClienteMeta({ fetchImpl }), {
        canal: 'instagram',
        cuenta,
        appId: APP_ID,
        appSecret: APP_SECRET,
      });
      throw new Error('debió lanzar');
    } catch (err) {
      expect(PlatformError.is(err)).toBe(true);
      expect((err as PlatformError).code).toBe('CONFLICT');
      // Ni el nombre ni el id de la otra empresa aparecen en el mensaje.
      expect((err as PlatformError).message).not.toContain('otra-empresa');
    }
    expect(urls).toHaveLength(0);
  });
});

describe('configDeCanal', () => {
  it('conserva el `webhook_token` al reconectar — la URL ya está en el panel de Meta', () => {
    const previa = { webhook_token: 'el-de-siempre', secret: { verify_token: 'v-de-siempre' } };
    const config = configDeCanal({
      canal: 'instagram',
      cuenta: {
        pageId: PAGE_ID,
        pageName: 'x',
        igUserId: IG_ID,
        igUsername: null,
        pageAccessToken: 'tok',
        utilizable: true,
      },
      appId: APP_ID,
      appSecret: APP_SECRET,
      previa,
    });

    // Regenerarlos invalidaría la URL que el emprendedor ya pegó en Meta.
    expect(config.webhook_token).toBe('el-de-siempre');
    expect((config.secret as Record<string, string>).verify_token).toBe('v-de-siempre');
  });

  it('los genera la primera vez', () => {
    const config = configDeCanal({
      canal: 'messenger',
      cuenta: {
        pageId: PAGE_ID,
        pageName: 'x',
        igUserId: null,
        igUsername: null,
        pageAccessToken: 'tok',
        utilizable: true,
      },
      appId: APP_ID,
      appSecret: APP_SECRET,
      previa: {},
    });

    expect(String(config.webhook_token)).toMatch(/^[0-9a-f]{48}$/);
    expect(String((config.secret as Record<string, string>).verify_token)).toMatch(/^[0-9a-f]{48}$/);
  });
});
