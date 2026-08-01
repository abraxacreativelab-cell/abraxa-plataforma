import { describe, expect, it } from 'vitest';
import {
  baseDeLaApi,
  credencialesDeGoogle,
  diagnosticoDeIdentidad,
  origenAutorizado,
  secretoDeProxy,
  secretoDeSesion,
  uriDeRedireccion,
} from './entorno';

const COMPLETO = {
  GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'secreto',
  NEXTAUTH_URL: 'https://mi.abraxa.club',
  NEXTAUTH_SECRET: 'x'.repeat(43),
  PROXY_SECRET: 'compartido',
};

describe('las variables, leídas en un solo lugar', () => {
  it('la base de la API tiene un valor de desarrollo y se le quita la barra', () => {
    expect(baseDeLaApi({})).toBe('http://localhost:3100');
    expect(baseDeLaApi({ API_BASE_URL: 'http://api:3100/' })).toBe('http://api:3100');
  });

  it('una variable en blanco cuenta como ausente', () => {
    expect(secretoDeProxy({ PROXY_SECRET: '   ' })).toBeUndefined();
    expect(credencialesDeGoogle({ GOOGLE_CLIENT_ID: ' ', GOOGLE_CLIENT_SECRET: 'x' })).toBeNull();
  });

  it('el secreto de sesión acepta el nombre de v4 y el de v5', () => {
    expect(secretoDeSesion({ NEXTAUTH_SECRET: 'a' })).toBe('a');
    expect(secretoDeSesion({ AUTH_SECRET: 'b' })).toBe('b');
    expect(secretoDeSesion({ NEXTAUTH_SECRET: 'a', AUTH_SECRET: 'b' })).toBe('a');
    expect(secretoDeSesion({})).toBeUndefined();
  });
});

describe('la URI de redirección — la que hay que registrar en Google', () => {
  /**
   * Está registrada en Google Cloud Console tal cual. Si se derivara mal, el
   * login falla con `redirect_uri_mismatch` en la pantalla de Google, que no
   * se puede diagnosticar desde aquí.
   */
  it('es exactamente la que está registrada en producción', () => {
    expect(uriDeRedireccion({ NEXTAUTH_URL: 'https://mi.abraxa.club' })).toBe(
      'https://mi.abraxa.club/api/auth/callback/google',
    );
  });

  it('no duplica la barra', () => {
    expect(uriDeRedireccion({ NEXTAUTH_URL: 'https://mi.abraxa.club/' })).toBe(
      'https://mi.abraxa.club/api/auth/callback/google',
    );
  });

  it('sin NEXTAUTH_URL, null en vez de una URI inventada', () => {
    expect(uriDeRedireccion({})).toBeNull();
    expect(origenAutorizado({})).toBeNull();
    expect(origenAutorizado({ NEXTAUTH_URL: 'no-es-una-url' })).toBeNull();
  });
});

describe('diagnosticoDeIdentidad', () => {
  it('con todo puesto, listo', () => {
    const d = diagnosticoDeIdentidad(COMPLETO);
    expect(d.listo).toBe(true);
    expect(d.faltantes).toEqual([]);
    expect(d.uriDeRedireccion).toBe('https://mi.abraxa.club/api/auth/callback/google');
  });

  it('sin nada, dice las tres cosas que faltan', () => {
    const d = diagnosticoDeIdentidad({});
    expect(d.listo).toBe(false);
    expect(d.faltantes).toHaveLength(3);
    expect(d.faltantes.join(' ')).toContain('GOOGLE_CLIENT_ID');
    expect(d.faltantes.join(' ')).toContain('NEXTAUTH_SECRET');
    expect(d.faltantes.join(' ')).toContain('NEXTAUTH_URL');
  });

  /**
   * Sin `PROXY_SECRET`, `proxyVerified()` de la API rechaza al BFF en
   * producción. El invitado entraría con Google y no vería un solo dato: es
   * peor que no dejarlo entrar, porque parece que el producto está vacío.
   */
  it('en producción, sin PROXY_SECRET NO está listo', () => {
    const sinSecreto = { ...COMPLETO, PROXY_SECRET: '', NODE_ENV: 'production' };
    const d = diagnosticoDeIdentidad(sinSecreto);
    expect(d.listo).toBe(false);
    expect(d.faltantes.join(' ')).toContain('PROXY_SECRET');
  });

  it('en desarrollo, sin PROXY_SECRET es sólo una advertencia', () => {
    const d = diagnosticoDeIdentidad({ ...COMPLETO, PROXY_SECRET: '' });
    expect(d.listo).toBe(true);
    expect(d.advertencias.join(' ')).toContain('PROXY_SECRET');
  });

  it('avisa si en producción la URL no es https', () => {
    const d = diagnosticoDeIdentidad({
      ...COMPLETO,
      NEXTAUTH_URL: 'http://mi.abraxa.club',
      NODE_ENV: 'production',
    });
    expect(d.advertencias.join(' ')).toContain('https');
  });
});
