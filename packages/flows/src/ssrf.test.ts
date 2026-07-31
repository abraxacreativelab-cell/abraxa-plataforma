/**
 * El guard del único nodo donde el cliente escribe una dirección.
 *
 * Se prueba entero sin red — por eso no se pospone aunque no haya `.env`, y
 * por eso las evasiones clásicas (decimal, octal, IPv4 mapeado a IPv6) están
 * aquí y no en una lista de pendientes.
 */
import { describe, expect, it } from 'vitest';
import { esBloqueadaPorSsrf } from './ssrf';

describe('esBloqueadaPorSsrf — lo que NO puede salir del worker', () => {
  const bloqueadas = [
    ['loopback por nombre', 'http://localhost:3000/x'],
    ['loopback por ip', 'http://127.0.0.1/x'],
    ['otro loopback del /8', 'http://127.9.9.9/x'],
    ['metadata de la nube', 'http://169.254.169.254/latest/meta-data/'],
    ['link-local', 'http://169.254.1.1/'],
    ['privada 10/8', 'http://10.0.0.5/'],
    ['privada 172.16/12', 'http://172.20.10.1/'],
    ['privada 192.168/16', 'http://192.168.68.50/'],
    ['CGNAT', 'http://100.64.0.1/'],
    ['esta red', 'http://0.0.0.0/'],
    ['multicast', 'http://239.1.1.1/'],
    ['sufijo .internal', 'https://api.internal/x'],
    ['sufijo .local', 'https://impresora.local/'],
    ['sufijo .localhost', 'https://algo.localhost/'],
    ['IPv6 loopback', 'http://[::1]/x'],
    ['IPv6 único local', 'http://[fd00::1]/'],
    ['IPv6 link-local', 'http://[fe80::1]/'],
    ['esquema file', 'file:///etc/passwd'],
    ['esquema gopher', 'gopher://127.0.0.1/'],
    ['URL rota', 'no soy una url'],
    ['sin host', 'http:///x'],
  ] as const;

  for (const [que, url] of bloqueadas) {
    it(`bloquea ${que}`, () => {
      expect(esBloqueadaPorSsrf(url)).toBe(true);
    });
  }

  // ── Las evasiones que en GARDEN pasaban ──────────────────────────────────
  const evasiones = [
    ['decimal', 'http://2130706433/'], // 127.0.0.1
    ['octal', 'http://0177.0.0.1/'],
    ['hexadecimal', 'http://0x7f.0.0.1/'],
    ['forma corta a.b', 'http://127.1/'],
    ['IPv4 mapeado en IPv6, con puntos', 'http://[::ffff:127.0.0.1]/'],
    ['IPv4 mapeado en IPv6, en hex', 'http://[::ffff:7f00:1]/'],
  ] as const;

  for (const [que, url] of evasiones) {
    it(`bloquea la evasión ${que} (${url})`, () => {
      expect(esBloqueadaPorSsrf(url)).toBe(true);
    });
  }
});

describe('esBloqueadaPorSsrf — lo que SÍ puede salir', () => {
  const permitidas = [
    'https://hooks.zapier.com/hooks/catch/123/abc',
    'https://api.abraxa.club/webhook',
    'http://ejemplo.mx/x?a=1',
    'https://8.8.8.8/x',
    'https://mi-empresa.com.mx/aviso',
  ];

  for (const url of permitidas) {
    it(`deja pasar ${url}`, () => {
      expect(esBloqueadaPorSsrf(url)).toBe(false);
    });
  }
});
