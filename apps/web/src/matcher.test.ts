/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El `matcher`. Si se equivoca, el middleware no corre y NADIE se entera.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Es el fallo más silencioso posible de este carril: todas las pruebas del
 *  middleware siguen verdes —porque lo llaman a mano— y en producción no se
 *  ejecuta nunca sobre la ruta que importa. El agujero vuelve entero y con las
 *  pruebas en verde.
 *
 *  Next compila el `matcher` con `path-to-regexp`; aquí se compila con
 *  `new RegExp` a secas. No es idéntico —Next añade tolerancia a la barra
 *  final y al fragmento— pero sí lo es para lo único que esta prueba vigila:
 *  que una ruta del producto entre y que un estático no.
 *
 *  Vive en `apps/web/src/` porque importa `apps/web/middleware.ts`, que importa
 *  `next/server`: los tipos de Next declaran `readonly NODE_ENV` de forma
 *  GLOBAL y meterlos en el proyecto de TypeScript de Node rompe las pruebas de
 *  otros seis carriles. La explicación completa está en `aislamiento.test.ts` y
 *  en `packages/auth/README.md`.
 */
import { describe, expect, it } from 'vitest';
import { config } from '../middleware';

const patron = config.matcher[0];
const casa = (ruta: string): boolean => new RegExp(`^${patron}$`).test(ruta);

describe('el matcher del middleware', () => {
  it('declara exactamente un patrón', () => {
    expect(config.matcher).toHaveLength(1);
  });

  it('cubre TODAS las pantallas del producto', () => {
    const pantallas = [
      '/',
      '/contactos',
      '/contactos/abc-123',
      '/ajustes',
      '/ajustes/plan',
      '/ajustes/integraciones',
      '/ritual',
      '/ritual/vista-previa',
      '/bandeja',
      '/tareas',
      '/direccion',
      '/direccion/biblioteca/1',
      '/mapa',
      '/automatizaciones',
      '/admin',
      '/bienvenida',
      '/gracias',
      '/entrar',
    ];

    for (const r of pantallas) expect(casa(r), r).toBe(true);
  });

  it('cubre las rutas de datos de los otros carriles', () => {
    for (const r of ['/bandeja/api/hilos', '/ritual/api/turno', '/api/auth/session']) {
      expect(casa(r), r).toBe(true);
    }
  });

  it('deja fuera lo que no renderiza un Server Component', () => {
    for (const r of ['/_next/static/chunks/main.js', '/_next/image', '/favicon.ico']) {
      expect(casa(r), r).toBe(false);
    }
  });

  /**
   * `_next/data` SÍ tiene que entrar: son las peticiones de navegación del
   * router, y sirven el mismo contenido que la página.
   */
  it('pero NO deja fuera las peticiones de datos del router', () => {
    expect(casa('/_next/data/abc/contactos.json')).toBe(true);
  });
});
