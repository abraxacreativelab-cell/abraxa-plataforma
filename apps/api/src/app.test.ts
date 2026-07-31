import { describe, expect, it } from 'vitest';
import { PACKAGE_META, MOUNTS } from './packages';

/**
 * Criterio #3 de H1 en forma de prueba: si alguien rompe el cableado central,
 * CI lo dice aquí y no en el primer PR de la ola 1.
 */
describe('cableado central', () => {
  it('importa los 12 paquetes', () => {
    expect(PACKAGE_META).toHaveLength(12);
  });

  it('cada paquete se identifica con su handoff', () => {
    for (const m of PACKAGE_META) {
      expect(m.name).toMatch(/^@abraxa\//);
      expect(m.handoff).toMatch(/^H\d+$/);
      expect(typeof m.ready).toBe('boolean');
    }
  });

  it('no hay paquetes duplicados', () => {
    expect(new Set(PACKAGE_META.map((m) => m.name)).size).toBe(PACKAGE_META.length);
  });

  it('monta los 9 routers de backend bajo prefijos únicos', () => {
    expect(MOUNTS).toHaveLength(9);
    expect(new Set(MOUNTS.map(([p]) => p)).size).toBe(9);
  });

  it('crea la app sin necesitar secretos', async () => {
    // Importa perezosamente: si esto explota, es que algún paquete valida el
    // entorno al importarse — y entonces CI y `npm run build` dejan de correr
    // sin llaves de producción.
    const { createApp } = await import('./app');
    expect(typeof createApp().listen).toBe('function');
  });
});
