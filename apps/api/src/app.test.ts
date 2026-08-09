import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PACKAGE_META, MOUNTS } from './packages';

/**
 * Criterio #3 de H1 en forma de prueba: si alguien rompe el cableado central,
 * CI lo dice aquí y no en el primer PR de la ola 1.
 */
describe('cableado central', () => {
  it('importa los 13 paquetes', () => {
    expect(PACKAGE_META).toHaveLength(13);
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

  it('monta los 10 routers de backend bajo prefijos únicos', () => {
    expect(MOUNTS).toHaveLength(10);
    expect(new Set(MOUNTS.map(([p]) => p)).size).toBe(10);
  });

  it('crea la app sin necesitar secretos', async () => {
    // Importa perezosamente: si esto explota, es que algún paquete valida el
    // entorno al importarse — y entonces CI y `npm run build` dejan de correr
    // sin llaves de producción.
    const { createApp } = await import('./app');
    expect(typeof createApp().listen).toBe('function');
  });
});

/**
 * El montaje de H15 (docs/handoffs/H15-crm.md §9.2), de punta a punta: la app
 * real sobre un servidor real. Contra el main previo a este cableado, las dos
 * rutas /crm respondían 404 NOT_FOUND y /contactos entraba en 'sin-cablear'.
 */
describe('montaje de /crm', () => {
  let base = '';
  let server: http.Server;

  beforeAll(async () => {
    // Perezoso, como 'crea la app sin necesitar secretos': si un paquete
    // valida entorno al importarse, truena una prueba, no la recolección.
    const { createApp } = await import('./app');
    server = http.createServer(createApp());
    await new Promise<void>((listo) => server.listen(0, '127.0.0.1', listo));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((listo) => server.close(() => listo()));
  });

  it('GET /crm/_status responde 200: el router está montado', async () => {
    const r = await fetch(`${base}/crm/_status`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      ready: true,
      port: 'contacts',
      owner: 'H15 · packages/crm',
    });
  });

  it('GET /crm/contacts sin cabeceras es 401 UNAUTHENTICATED, ya no 404', async () => {
    const r = await fetch(`${base}/crm/contacts`);
    const body = (await r.json()) as { error?: { code?: string } };
    expect(r.status).not.toBe(404);
    expect(body.error?.code).not.toBe('NOT_FOUND');
    expect(r.status).toBe(401);
    expect(body.error?.code).toBe('UNAUTHENTICATED');
  });

  it('GET /_health/packages lista los 13 con @abraxa/crm; ports sigue sin contacts (§9.4, otra Orden)', async () => {
    const r = await fetch(`${base}/_health/packages`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      packages: Array<{ name: string; handoff: string }>;
      ports: Array<{ port: string }>;
    };
    expect(body.packages).toHaveLength(13);
    const crm = body.packages.find((p) => p.name === '@abraxa/crm');
    expect(crm?.handoff).toBe('H15');
    expect(body.ports.map((p) => p.port)).not.toContain('contacts');
  });
});
