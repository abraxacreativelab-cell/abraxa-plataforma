/**
 * Criterio #5 — un eco propio NO dispara respuesta.
 *
 * El caso de una sola llamada ya lo cubre el índice único de H6. Lo que se
 * prueba aquí es el que NO cubre: el segundo `mid` de un envío partido en
 * varias llamadas, que sin esta tabla entraría como «un humano escribió» y
 * pausaría al agente una hora.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __setClientForTests } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import { createFakeDb, type FakeDb } from '../../testing/fake-db';
import { barrerViejos, midsPropios, recordarMids } from './ecos';

const TENANT = '11111111-1111-1111-1111-111111111111';
const ctx: TenantContext = {
  tenantId: TENANT,
  tenantSlug: 'demo',
  userEmail: null,
  role: null,
  areas: {},
};

let db: FakeDb;
let restaurar: () => void;

beforeEach(() => {
  db = createFakeDb();
  restaurar = __setClientForTests(db.client);
});

afterEach(() => restaurar());

describe('recordarMids', () => {
  it('anota todos los mids de un envío, no sólo el primero', async () => {
    await recordarMids(ctx, { channelId: 'c1', mids: ['m1', 'm2', 'm3'] });
    expect(db.tabla('meta_outbound_mids').map((f) => f.mid)).toEqual(['m1', 'm2', 'm3']);
  });

  it('descarta los nulos que devuelve Meta cuando no da id', async () => {
    await recordarMids(ctx, { channelId: 'c1', mids: [null, 'm1', undefined, ''] });
    expect(db.tabla('meta_outbound_mids').map((f) => f.mid)).toEqual(['m1']);
  });

  it('sin mids no escribe nada', async () => {
    await recordarMids(ctx, { channelId: 'c1', mids: [] });
    expect(db.tabla('meta_outbound_mids')).toHaveLength(0);
  });

  it('si la base falla, el envío NO se deshace', async () => {
    restaurar();
    restaurar = __setClientForTests({
      from: () => {
        throw new Error('base caída');
      },
    } as never);
    // El mensaje ya salió al cliente: lanzar aquí haría que se reintentara y
    // llegara dos veces.
    await expect(recordarMids(ctx, { channelId: 'c1', mids: ['m1'] })).resolves.toBeUndefined();
  });
});

describe('midsPropios', () => {
  it('reconoce los nuestros y ninguno más', async () => {
    await recordarMids(ctx, { channelId: 'c1', mids: ['m1', 'm2'] });

    const encontrados = await midsPropios(ctx, { channelId: 'c1', mids: ['m1', 'ajeno'] });
    expect([...encontrados]).toEqual(['m1']);
  });

  it('los consume: la tabla es del tamaño de lo que está en vuelo', async () => {
    await recordarMids(ctx, { channelId: 'c1', mids: ['m1', 'm2'] });
    await midsPropios(ctx, { channelId: 'c1', mids: ['m1'] });

    expect(db.tabla('meta_outbound_mids').map((f) => f.mid)).toEqual(['m2']);
  });

  it('no cruza canales', async () => {
    await recordarMids(ctx, { channelId: 'c1', mids: ['m1'] });
    expect([...(await midsPropios(ctx, { channelId: 'c2', mids: ['m1'] }))]).toEqual([]);
  });

  it('no cruza empresas — el aislamiento lo pone `tenantDb`', async () => {
    await recordarMids(ctx, { channelId: 'c1', mids: ['m1'] });
    const otro: TenantContext = { ...ctx, tenantId: '22222222-2222-2222-2222-222222222222' };
    expect([...(await midsPropios(otro, { channelId: 'c1', mids: ['m1'] }))]).toEqual([]);
  });

  it('ante un fallo devuelve vacío: es el error barato', async () => {
    restaurar();
    restaurar = __setClientForTests({
      from: () => {
        throw new Error('base caída');
      },
    } as never);

    // Vacío = el eco se trata como "lo escribió un humano" y la IA se pausa una
    // hora. Molesto y reversible. Lo contrario dejaría al agente contestando
    // encima de su dueño, que es el fallo caro.
    expect([...(await midsPropios(ctx, { channelId: 'c1', mids: ['m1'] }))]).toEqual([]);
  });

  it('sin mids no consulta', async () => {
    expect([...(await midsPropios(ctx, { channelId: 'c1', mids: [] }))]).toEqual([]);
  });
});

describe('barrerViejos', () => {
  it('borra los que llevan más de los días de gracia y respeta los nuevos', async () => {
    const viejo = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
    db.sembrar('meta_outbound_mids', [
      { id: 'a', tenant_id: TENANT, channel_id: 'c1', mid: 'viejo', created_at: viejo },
      { id: 'b', tenant_id: TENANT, channel_id: 'c1', mid: 'nuevo', created_at: new Date().toISOString() },
    ]);

    const borrados = await barrerViejos(ctx);

    expect(borrados).toBe(1);
    expect(db.tabla('meta_outbound_mids').map((f) => f.mid)).toEqual(['nuevo']);
  });
});
