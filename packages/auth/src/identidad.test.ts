import { describe, expect, it } from 'vitest';
import { decidir, esRutaDeDatos, esRutaPublica, normalizarRuta } from './identidad';
import {
  identidadSellada,
  limpiarIdentidadEntrante,
  sellarIdentidad,
} from '../../../apps/web/app/api/_auth/cabeceras';

const ANA = { correo: 'ana@gmail.com', empresa: 'ana-1a2b3c4d' };

describe('la política de rutas', () => {
  it('abre lo público sin sesión', () => {
    for (const r of ['/', '/bienvenida', '/gracias', '/entrar', '/api/auth/signin']) {
      expect(decidir(r, null).tipo, r).toBe('seguir');
    }
  });

  it('cierra TODO lo demás', () => {
    for (const r of ['/contactos', '/ritual', '/ajustes/plan', '/tareas', '/bandeja', '/admin']) {
      expect(decidir(r, null).tipo, r).toBe('entrar');
    }
  });

  it('una pantalla NUEVA nace cerrada', () => {
    expect(decidir('/lo-que-invente-el-carril-de-mañana', null).tipo).toBe('entrar');
  });

  it('con sesión, pasa todo', () => {
    for (const r of ['/', '/contactos', '/bandeja/api/hilos']) {
      expect(decidir(r, ANA).tipo, r).toBe('seguir');
    }
  });

  it('a las rutas de datos se les niega con 401, no con un redirect', () => {
    expect(decidir('/bandeja/api/hilos', null).tipo).toBe('negar');
    expect(decidir('/ritual/api/turno', null).tipo).toBe('negar');
    expect(decidir('/api/lo-que-sea', null).tipo).toBe('negar');
  });

  it('el redirect conserva a dónde iba', () => {
    const d = decidir('/contactos', null, '?q=ana');
    expect(d.tipo).toBe('entrar');
    if (d.tipo !== 'entrar') return;
    expect(d.destino).toBe(
      `/api/auth/signin?callbackUrl=${encodeURIComponent('/contactos?q=ana')}`,
    );
  });

  /** Una política que se esquiva con una barra de más no es una política. */
  it('no se esquiva con barras', () => {
    expect(normalizarRuta('//contactos//')).toBe('/contactos');
    expect(decidir('//contactos', null).tipo).toBe('entrar');
    expect(decidir('/contactos/', null).tipo).toBe('entrar');
    expect(esRutaPublica('//api/auth//signin/')).toBe(true);
  });

  it('`/entrarse` NO es `/entrar`: el prefijo respeta la frontera', () => {
    expect(esRutaPublica('/entrar')).toBe(true);
    expect(esRutaPublica('/entrar/google')).toBe(true);
    expect(esRutaPublica('/entrarse')).toBe(false);
    expect(esRutaPublica('/api/authx')).toBe(false);
  });

  it('reconoce las rutas de datos anidadas de los otros carriles', () => {
    expect(esRutaDeDatos('/bandeja/api/hilos')).toBe(true);
    expect(esRutaDeDatos('/ritual/api/estado')).toBe(true);
    expect(esRutaDeDatos('/api/auth/session')).toBe(true);
    expect(esRutaDeDatos('/contactos')).toBe(false);
    expect(esRutaDeDatos('/apis-y-cosas')).toBe(false);
  });
});

describe('el sellado de cabeceras', () => {
  const con = (entrantes: Record<string, string>): Headers => new Headers(entrantes);

  it('borra lo forjado y escribe lo verificado', () => {
    const h = con({
      'x-abraxa-session-email': 'victima@otra.com',
      'x-abraxa-session-tenant': 'empresa-de-la-victima',
      'x-user-email': 'victima@otra.com',
      'x-tenant-slug': 'empresa-de-la-victima',
      'x-proxy-secret': 'me-lo-inventé',
      'user-agent': 'curl/8',
    });

    sellarIdentidad(h, ANA);

    expect(h.get('x-abraxa-session-email')).toBe('ana@gmail.com');
    expect(h.get('x-abraxa-session-tenant')).toBe('ana-1a2b3c4d');
    expect(h.get('x-user-email')).toBeNull();
    expect(h.get('x-tenant-slug')).toBeNull();
    expect(h.get('x-proxy-secret')).toBeNull();
    // Y no toca nada más.
    expect(h.get('user-agent')).toBe('curl/8');
  });

  it('SIN sesión, borra igual', () => {
    const h = con({ 'x-abraxa-session-email': 'victima@otra.com' });
    sellarIdentidad(h, null);
    expect(h.get('x-abraxa-session-email')).toBeNull();
  });

  it('sin empresa, no escribe una vacía', () => {
    const h = con({ 'x-abraxa-session-tenant': 'empresa-de-la-victima' });
    sellarIdentidad(h, { correo: 'nuevo@gmail.com', empresa: null });
    expect(h.get('x-abraxa-session-email')).toBe('nuevo@gmail.com');
    expect(h.get('x-abraxa-session-tenant')).toBeNull();
  });

  it('normaliza el correo igual que `app.users`', () => {
    const h = con({});
    sellarIdentidad(h, { correo: '  Ana@Gmail.COM ', empresa: null });
    expect(h.get('x-abraxa-session-email')).toBe('ana@gmail.com');
  });

  it('un correo en blanco no se escribe', () => {
    const h = con({ 'x-abraxa-session-email': 'victima@otra.com' });
    sellarIdentidad(h, { correo: '   ', empresa: 'lo-que-sea' });
    expect(h.get('x-abraxa-session-email')).toBeNull();
    expect(h.get('x-abraxa-session-tenant')).toBeNull();
  });

  it('`limpiarIdentidadEntrante` deja la petición sin una sola', () => {
    const h = con({
      'x-abraxa-session-email': 'a@b.c',
      'x-abraxa-session-tenant': 'x',
      'x-user-email': 'a@b.c',
      'x-tenant-slug': 'x',
      'x-proxy-secret': 's',
    });
    limpiarIdentidadEntrante(h);
    expect([...h.keys()]).toEqual([]);
  });
});

describe('identidadSellada — lo que lee un Server Component', () => {
  it('devuelve lo que el middleware escribió', () => {
    const h = new Headers();
    sellarIdentidad(h, ANA);
    expect(identidadSellada(h)).toEqual(ANA);
  });

  it('sin cabeceras, null', () => {
    expect(identidadSellada(new Headers())).toBeNull();
  });

  it('con correo y sin empresa, empresa en null', () => {
    const h = new Headers();
    sellarIdentidad(h, { correo: 'nuevo@gmail.com', empresa: null });
    expect(identidadSellada(h)).toEqual({ correo: 'nuevo@gmail.com', empresa: null });
  });
});
