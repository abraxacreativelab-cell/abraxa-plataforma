/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El guardia de SSRF, probado como se ataca.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Este endpoint recibe una URL de un desconocido autenticado y la pide desde
 *  DENTRO de la red del servidor. Eso es, literalmente, la definición de SSRF:
 *  el atacante no puede hablar con `169.254.169.254` ni con Postgres, pero
 *  nosotros sí, y le estamos ofreciendo hacerlo por él.
 *
 *  Cada caso de aquí es una evasión conocida, no una hipótesis:
 *
 *   · `http://2130706433/`   127.0.0.1 en decimal — el clásico de los WAF
 *   · `http://0x7f.1/`       el mismo en hexadecimal
 *   · `http://[::1]/`        loopback de IPv6
 *   · `http://[::ffff:127.0.0.1]/`  IPv4 disfrazada de IPv6
 *   · `http://169.254.169.254/`     metadatos de la nube
 *   · `file:///etc/passwd`   otro esquema
 *   · `http://localhost:5432/`      la base de al lado
 *
 *  La evasión que NO se ve aquí —un dominio público cuyo DNS apunta a
 *  127.0.0.1, y la redirección a una IP privada— no se puede cerrar mirando el
 *  texto: se cierra resolviendo el nombre y revisando cada salto. Eso vive en
 *  `leer.ts` y se prueba en `leer.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { clasificarEnlace, esHostPrivado, normalizarUrl, revisarUrl } from './url';

describe('normalizar lo que la gente de verdad pega', () => {
  it('le pone https a quien escribió sólo el dominio', () => {
    expect(normalizarUrl('lataqueria.mx')?.href).toBe('https://lataqueria.mx/');
    expect(normalizarUrl('www.lataqueria.mx')?.href).toBe('https://www.lataqueria.mx/');
  });

  it('respeta el http de quien lo escribió', () => {
    expect(normalizarUrl('http://lataqueria.mx')?.protocol).toBe('http:');
  });

  it('aguanta espacios, mayúsculas y la coma de más al final', () => {
    expect(normalizarUrl('  HTTPS://LaTaqueria.MX/menu  ')?.host).toBe('lataqueria.mx');
    expect(normalizarUrl('lataqueria.mx,')?.href).toBe('https://lataqueria.mx/');
    expect(normalizarUrl('lataqueria.mx.')?.host).toBe('lataqueria.mx');
  });

  it('lo que no puede ser una URL devuelve null en vez de reventar', () => {
    expect(normalizarUrl('')).toBeNull();
    expect(normalizarUrl('   ')).toBeNull();
    expect(normalizarUrl('no tengo página')).toBeNull();
    expect(normalizarUrl('http://')).toBeNull();
  });
});

describe('hosts que jamás se piden', () => {
  const prohibidos = [
    'localhost',
    'LOCALHOST',
    'algo.localhost',
    'mi-mac.local',
    'servicio.internal',
    '127.0.0.1',
    '127.1.2.3',
    '0.0.0.0',
    '10.0.0.5',
    '172.16.4.4',
    '172.31.255.254',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '198.18.0.1',
    '224.0.0.1',
    '[::1]',
    '[::]',
    '[fc00::1]',
    '[fd12:3456::1]',
    '[fe80::1]',
    '[::ffff:127.0.0.1]',
    '[::ffff:10.0.0.1]',
  ];

  for (const host of prohibidos) {
    it(`bloquea ${host}`, () => {
      expect(esHostPrivado(host)).toBe(true);
    });
  }

  const permitidos = ['lataqueria.mx', 'instagram.com', '8.8.8.8', '172.32.0.1', '[2606:4700::1]'];
  for (const host of permitidos) {
    it(`deja pasar ${host}`, () => {
      expect(esHostPrivado(host)).toBe(false);
    });
  }
});

describe('revisarUrl: la puerta completa', () => {
  it('acepta una página normal', () => {
    const r = revisarUrl('lataqueria.mx');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.url.href).toBe('https://lataqueria.mx/');
  });

  it('sólo http y https', () => {
    for (const malo of ['file:///etc/passwd', 'ftp://a.mx', 'gopher://a.mx', 'data:text/html,x']) {
      const r = revisarUrl(malo);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.motivo).toBe('esquema');
    }
  });

  it('javascript: no se cuela por la puerta de "sin esquema"', () => {
    // Sin `://`, la normalización le pegaría `https://` delante y quedaría
    // `https://javascript:alert(1)`. Se rechaza antes.
    const r = revisarUrl('javascript:alert(1)');
    expect(r.ok).toBe(false);
  });

  it('las IP en decimal y hexadecimal son la misma 127.0.0.1', () => {
    for (const disfraz of ['http://2130706433/', 'http://0x7f.1/', 'http://0177.0.0.1/']) {
      const r = revisarUrl(disfraz);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.motivo).toBe('privada');
    }
  });

  it('bloquea la red de adentro y lo dice sin filtrar nada', () => {
    const r = revisarUrl('http://192.168.68.50:8123/');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).toBe('privada');
      // El mensaje se pinta tal cual: ni rutas, ni IPs, ni la palabra SSRF.
      expect(r.mensaje).not.toMatch(/192\.168|SSRF|interna/i);
      expect(r.mensaje.length).toBeGreaterThan(20);
    }
  });

  it('un texto que no es una URL no es un error de seguridad, es "cuéntame tú"', () => {
    const r = revisarUrl('no tengo página, apenas voy a hacerla');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe('ilegible');
  });
});

describe('redes sociales: se detectan, no se fallan', () => {
  it('saca el handle de Instagram', () => {
    const c = clasificarEnlace(new URL('https://www.instagram.com/lataqueriadelbarrio/'));
    expect(c.tipo).toBe('red-social');
    expect(c.red).toBe('instagram');
    expect(c.handle).toBe('@lataqueriadelbarrio');
  });

  it('saca el handle de TikTok, que ya viene con arroba', () => {
    const c = clasificarEnlace(new URL('https://www.tiktok.com/@lataqueria?lang=es'));
    expect(c.red).toBe('tiktok');
    expect(c.handle).toBe('@lataqueria');
  });

  it('Facebook con /pages y con nombre directo', () => {
    expect(clasificarEnlace(new URL('https://facebook.com/LaTaqueriaMX')).handle).toBe(
      '@LaTaqueriaMX',
    );
    expect(clasificarEnlace(new URL('https://m.facebook.com/profile.php?id=123')).red).toBe(
      'facebook',
    );
  });

  it('un perfil sin handle sigue siendo red social, no un fallo', () => {
    const c = clasificarEnlace(new URL('https://instagram.com/'));
    expect(c.tipo).toBe('red-social');
    expect(c.handle).toBeNull();
  });

  it('una página normal es una página normal', () => {
    const c = clasificarEnlace(new URL('https://lataqueria.mx/menu'));
    expect(c.tipo).toBe('sitio');
    expect(c.red).toBeNull();
  });

  it('un @handle suelto se entiende sin que haya URL', () => {
    const r = revisarUrl('@lataqueriadelbarrio');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tipo).toBe('red-social');
      expect(r.handle).toBe('@lataqueriadelbarrio');
      expect(r.url.host).toContain('instagram');
    }
  });
});
