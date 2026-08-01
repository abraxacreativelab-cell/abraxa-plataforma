import { describe, expect, it } from 'vitest';
import { destinoDeRedireccion, origenPublico } from './redireccion';

const BASE = 'https://mi.abraxa.club';

describe('destinoDeRedireccion', () => {
  it('sin destino, al Ritual', () => {
    expect(destinoDeRedireccion('', BASE)).toBe(`${BASE}/ritual`);
    expect(destinoDeRedireccion('/', BASE)).toBe(`${BASE}/ritual`);
    expect(destinoDeRedireccion(BASE, BASE)).toBe(`${BASE}/ritual`);
    expect(destinoDeRedireccion(`${BASE}/`, BASE)).toBe(`${BASE}/ritual`);
  });

  it('conserva a dónde iba', () => {
    expect(destinoDeRedireccion('/contactos', BASE)).toBe(`${BASE}/contactos`);
    expect(destinoDeRedireccion('/contactos?q=ana', BASE)).toBe(`${BASE}/contactos?q=ana`);
    expect(destinoDeRedireccion(`${BASE}/tareas`, BASE)).toBe(`${BASE}/tareas`);
  });

  /**
   * El redirector abierto. Es el peor momento posible para mandar a alguien a
   * una pantalla falsa: acaba de teclear su contraseña de Google.
   */
  it('nunca sale del origen', () => {
    const ajenas = [
      'https://mi-abraxa.club/robo',
      'https://mi.abraxa.club.evil.com/robo',
      'http://evil.com',
      '//evil.com/robo',
      '//mi.abraxa.club@evil.com',
      'javascript:alert(1)',
      'data:text/html,<script>',
    ];

    for (const u of ajenas) {
      expect(destinoDeRedireccion(u, BASE), u).toBe(`${BASE}/ritual`);
    }
  });

  it('una base mal escrita no abre la puerta', () => {
    expect(destinoDeRedireccion('https://evil.com/x', 'no-es-una-url')).toBe(
      'no-es-una-url/ritual',
    );
  });

  it('respeta un destino por defecto distinto', () => {
    expect(destinoDeRedireccion('/', BASE, '/bienvenida')).toBe(`${BASE}/bienvenida`);
  });

  it('la barra final de la base no duplica la barra', () => {
    expect(destinoDeRedireccion('/contactos', `${BASE}/`)).toBe(`${BASE}/contactos`);
  });
});

describe('origenPublico', () => {
  const sinCabeceras = { get: (): string | null => null };

  it('manda `NEXTAUTH_URL` por encima de todo', () => {
    const cabeceras = {
      get: (n: string) => (n === 'x-forwarded-host' ? 'evil.com' : null),
    };
    expect(origenPublico('http://127.0.0.1:3041/x', cabeceras, { NEXTAUTH_URL: BASE })).toBe(BASE);
  });

  it('sin ella, usa lo que puso nginx', () => {
    const cabeceras = {
      get: (n: string) =>
        n === 'x-forwarded-proto' ? 'https' : n === 'x-forwarded-host' ? 'mi.abraxa.club' : null,
    };
    expect(origenPublico('http://127.0.0.1:3041/x', cabeceras, {})).toBe(BASE);
  });

  it('toma el primer valor de una lista de proxies', () => {
    const cabeceras = {
      get: (n: string) =>
        n === 'x-forwarded-proto'
          ? 'https, http'
          : n === 'x-forwarded-host'
            ? 'a.com, b.com'
            : null,
    };
    expect(origenPublico('http://127.0.0.1:3041/x', cabeceras, {})).toBe('https://a.com');
  });

  it('sin nada, lo que diga la petición', () => {
    expect(origenPublico('http://localhost:3000/x', sinCabeceras, {})).toBe(
      'http://localhost:3000',
    );
  });

  it('una `NEXTAUTH_URL` mal escrita no tumba la petición', () => {
    expect(origenPublico('http://localhost:3000/x', sinCabeceras, { NEXTAUTH_URL: 'no-url' })).toBe(
      'http://localhost:3000',
    );
  });

  it('una URL de petición imposible devuelve cadena vacía y no lanza', () => {
    expect(origenPublico('esto-no-es-una-url', sinCabeceras, {})).toBe('');
  });
});
