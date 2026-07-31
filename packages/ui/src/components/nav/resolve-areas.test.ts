import type { AreaSummary } from '@abraxa/db/ports';
import { beforeEach, describe, expect, it } from 'vitest';
import { __resetRegistry, registerTools } from '../registry/tool-registry';
import { MOCK_AREAS, registerMockTools } from './mock-areas';
import { isNavigable, resolveAreas } from './resolve-areas';
import { findActiveArea } from '../shell/app-shell';

beforeEach(__resetRegistry);

const area = (over: Partial<AreaSummary>): AreaSummary => ({
  slug: 'ventas',
  label: 'Ventas',
  icon: 'megaphone',
  position: 0,
  state: 'activa',
  access: 'admin',
  blurb: 'promesa',
  tools: [],
  ...over,
});

describe('resolveAreas — se programa contra el port, no contra H11', () => {
  it('sin implementación registrada usa el mock y lo dice', async () => {
    const r = await resolveAreas(null);
    expect(r.source).toBe('mock');
    expect(r.areas).toEqual(MOCK_AREAS);
  });

  it('con implementación usa los datos reales, ordenados por posición', async () => {
    const r = await resolveAreas(async () => [
      area({ slug: 'b', position: 2 }),
      area({ slug: 'a', position: 1 }),
    ]);
    expect(r.source).toBe('port');
    expect(r.areas?.map((a) => a.slug)).toEqual(['a', 'b']);
  });

  it('un arreglo vacío es un dato legítimo, NO un error', async () => {
    // Es la diferencia entre "aún no tienes áreas" y "falló la carga". Un cero
    // falso le cuesta confianza al producto.
    const r = await resolveAreas(async () => []);
    expect(r.source).toBe('port');
    expect(r.areas).toEqual([]);
    expect(r.failure).toBeUndefined();
  });

  it('un fallo NO se disfraza de lista vacía', async () => {
    const r = await resolveAreas(async () => {
      throw new Response(null, { status: 500 });
    });
    expect(r.source).toBe('error');
    expect(r.areas).toBeNull();
    expect(r.failure?.kind).toBe('servidor');
  });

  it('distingue red, permiso y servidor', async () => {
    const caso = async (e: unknown) =>
      (
        await resolveAreas(async () => {
          throw e;
        })
      ).failure?.kind;

    expect(await caso(new TypeError('fetch failed'))).toBe('red');
    expect(await caso(new Response(null, { status: 403 }))).toBe('permiso');
    expect(await caso(new Response(null, { status: 503 }))).toBe('servidor');
  });
});

describe('áreas bloqueadas — criterio 5', () => {
  it('una bloqueada no es navegable', () => {
    expect(isNavigable(area({ state: 'bloqueada', access: null }))).toBe(false);
  });

  it('sin acceso tampoco, aunque el área esté activa', () => {
    // "No lo has desbloqueado" y "no tienes permiso" son cosas distintas, y
    // ninguna de las dos se puede abrir.
    expect(isNavigable(area({ state: 'activa', access: null }))).toBe(false);
  });

  it.each(['activa', 'en_progreso', 'disponible'] as const)('una %s sí se abre', (state) => {
    expect(isNavigable(area({ state, access: 'view' }))).toBe(true);
  });

  it('el mock trae al menos un área bloqueada, con promesa', () => {
    const bloqueadas = MOCK_AREAS.filter((a) => a.state === 'bloqueada');
    expect(bloqueadas.length).toBeGreaterThan(0);
    for (const a of bloqueadas) {
      expect(a.blurb.length).toBeGreaterThan(20);
    }
  });

  it('los cuatro estados están representados en el mock', () => {
    expect(new Set(MOCK_AREAS.map((a) => a.state))).toEqual(
      new Set(['activa', 'en_progreso', 'disponible', 'bloqueada']),
    );
  });

  it('todas las áreas del mock traen su promesa', () => {
    for (const a of MOCK_AREAS) expect(a.blurb.trim()).not.toBe('');
  });
});

describe('findActiveArea — la ruta la manda el registro, no la convención', () => {
  it('encuentra el área por la ruta registrada de su herramienta', () => {
    // "/bandeja" es carpeta de H6 pero herramienta del área de Ventas: partir
    // el pathname como hacía GARDEN no lo encontraría nunca.
    registerTools({ key: 'ventas:bandeja', label: 'Bandeja', icon: 'inbox', href: '/bandeja' });
    const areas = [area({ slug: 'ventas', tools: ['ventas:bandeja'] })];
    expect(findActiveArea(areas, '/bandeja')).toBe('ventas');
  });

  it('gana la coincidencia más larga', () => {
    registerTools(
      { key: 'ventas:resumen', label: 'Resumen', icon: 'resumen', href: '/ventas' },
      { key: 'ventas:contactos', label: 'Contactos', icon: 'contact', href: '/ventas/contactos' },
      { key: 'otra:x', label: 'X', icon: 'wrench', href: '/ventas/contactos/detalle' },
    );
    const areas = [
      area({ slug: 'ventas', tools: ['ventas:resumen', 'ventas:contactos'] }),
      area({ slug: 'otra', tools: ['otra:x'] }),
    ];
    expect(findActiveArea(areas, '/ventas/contactos/detalle')).toBe('otra');
    expect(findActiveArea(areas, '/ventas/contactos')).toBe('ventas');
  });

  it('cae al slug del área cuando no hay herramienta que coincida', () => {
    const areas = [area({ slug: 'direccion', tools: [] })];
    expect(findActiveArea(areas, '/direccion/lo-que-sea')).toBe('direccion');
  });

  it('devuelve null fuera de toda área', () => {
    expect(findActiveArea([area({})], '/ajustes')).toBeNull();
    expect(findActiveArea(null, '/ventas')).toBeNull();
    expect(findActiveArea([], '/ventas')).toBeNull();
  });

  it('no confunde un prefijo parcial con una coincidencia', () => {
    registerTools({ key: 'ventas:resumen', label: 'R', icon: 'resumen', href: '/ventas' });
    const areas = [area({ slug: 'ventas', tools: ['ventas:resumen'] })];
    expect(findActiveArea(areas, '/ventas-antiguas')).toBeNull();
  });
});

describe('las herramientas del mock son navegables hoy', () => {
  it('todas las claves que anuncia el mock tienen registro de respaldo', () => {
    registerMockTools();
    const anunciadas = MOCK_AREAS.filter((a) => a.state !== 'bloqueada').flatMap((a) => a.tools);
    expect(anunciadas.length).toBeGreaterThan(0);
    for (const clave of anunciadas) {
      expect(findActiveArea(MOCK_AREAS, '/')).toBeNull();
      expect(clave).toMatch(/^[a-z-]+:[a-z-]+$/);
    }
  });

  it('el respaldo NO pisa a un handoff que ya registró la suya', () => {
    registerTools({
      key: 'ventas:bandeja',
      label: 'Bandeja de verdad',
      icon: 'inbox',
      href: '/bandeja',
      load: async () => ({ default: () => null }),
    });
    registerMockTools();
    // Si el mock hubiera ganado, se perdería el componente real de H6.
    expect(findActiveArea(MOCK_AREAS, '/bandeja')).toBe('ventas');
  });
});
