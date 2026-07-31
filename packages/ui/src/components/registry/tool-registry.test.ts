import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetRegistry,
  assertToolsRegistered,
  lookupTool,
  missingKeys,
  registerTools,
  registeredKeys,
  toolsForArea,
} from './tool-registry';

beforeEach(__resetRegistry);

const bandeja = {
  key: 'ventas:bandeja',
  label: 'Bandeja',
  icon: 'inbox',
  href: '/bandeja',
  position: 1,
};
const contactos = {
  key: 'ventas:contactos',
  label: 'Contactos',
  icon: 'contact',
  href: '/ventas/contactos',
  position: 0,
};

describe('registro descentralizado', () => {
  it('cada handoff registra desde su propio archivo, sin tocar nada central', () => {
    registerTools(bandeja); // como si fuera H6
    registerTools(contactos); // como si fuera H11
    expect(registeredKeys()).toEqual(['ventas:bandeja', 'ventas:contactos']);
  });

  it('volver a registrar una clave la reemplaza', () => {
    registerTools(bandeja);
    registerTools({ ...bandeja, label: 'Conversaciones' });
    expect(lookupTool('ventas:bandeja')?.label).toBe('Conversaciones');
    expect(registeredKeys()).toHaveLength(1);
  });

  it.each(['sin-dos-puntos', 'Ventas:Contactos', 'ventas:', ':contactos', 'ventas:con tactos'])(
    'rechaza la clave mal formada %j',
    (key) => {
      expect(() => registerTools({ ...bandeja, key })).toThrow(/formato es "area:herramienta"/);
    },
  );
});

describe('la ruta la manda el handoff dueño, no la convención', () => {
  it('una herramienta de Ventas puede vivir en la carpeta de otro handoff', () => {
    // Éste es el arreglo al choque entre las áreas del negocio y los route
    // groups: "ventas:bandeja" vive en /bandeja, que es carpeta de H6.
    registerTools(bandeja);
    expect(lookupTool('ventas:bandeja')?.href).toBe('/bandeja');
  });
});

describe('herramientas de un área', () => {
  it('respeta la posición', () => {
    registerTools(bandeja, contactos);
    expect(toolsForArea(['ventas:bandeja', 'ventas:contactos'], 'admin').map((t) => t.label)).toEqual(
      ['Contactos', 'Bandeja'],
    );
  });

  it('omite en silencio las claves sin registrar — el sidebar no se rompe', () => {
    registerTools(bandeja);
    expect(toolsForArea(['ventas:bandeja', 'ventas:fantasma'], 'admin')).toHaveLength(1);
  });

  it('esconde lo que el usuario no puede ver', () => {
    registerTools(bandeja, { ...contactos, minAccess: 'admin' as const });
    expect(toolsForArea(['ventas:bandeja', 'ventas:contactos'], 'view')).toHaveLength(1);
    expect(toolsForArea(['ventas:bandeja', 'ventas:contactos'], 'admin')).toHaveLength(2);
  });

  it('sin acceso no se ve nada que exija acceso', () => {
    registerTools({ ...bandeja, minAccess: 'view' as const });
    expect(toolsForArea(['ventas:bandeja'], null)).toHaveLength(0);
  });
});

describe('el guard de desarrollo', () => {
  it('junta TODAS las claves huérfanas en vez de morir en la primera', () => {
    registerTools(bandeja);
    try {
      assertToolsRegistered(['ventas:bandeja', 'ventas:fantasma', 'rh:otra', 'rh:masotra']);
      expect.unreachable('debió lanzar');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('ventas:fantasma');
      expect(msg).toContain('rh:otra');
      expect(msg).toContain('rh:masotra');
      // Y dice a qué área pertenece cada una, para saber a quién le toca.
      expect(msg).toContain('área "rh"');
      // Y qué sí está registrado, para poder comparar.
      expect(msg).toContain('ventas:bandeja');
    }
  });

  it('no dice nada si está todo', () => {
    registerTools(bandeja, contactos);
    expect(() => assertToolsRegistered(['ventas:bandeja', 'ventas:contactos'])).not.toThrow();
  });

  it('missingKeys reporta sin lanzar, para el aviso del sidebar', () => {
    registerTools(bandeja);
    expect(missingKeys(['ventas:bandeja', 'ventas:fantasma'])).toEqual(['ventas:fantasma']);
  });
});
