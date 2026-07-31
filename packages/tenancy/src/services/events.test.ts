/**
 * El outbox — el enganche que espera H11.
 *
 * Lo que se prueba aquí es la propiedad que hace que valga la pena: un evento
 * que nadie procesó NO se pierde. Ni porque no hubiera suscriptor, ni porque
 * el suscriptor reventara.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlmacenFake } from '../testing/fake-postgrest';
import { instalarDoble, sembrarTenant } from '../testing/seed';
import { contextFor } from './context';
import {
  TENANT_PROVISIONED,
  __clearTenantEventHandlers,
  drainTenantEvents,
  emitTenantEvent,
  onTenantEvent,
  onTenantProvisioned,
} from './events';
import type { FullTenantContext } from '../types';

let almacen: AlmacenFake;
let restaurar: () => void;
let ctx: FullTenantContext;
let tenantId: string;

beforeEach(async () => {
  ({ almacen, restaurar } = instalarDoble());
  ({ tenantId } = sembrarTenant(almacen, { slug: 'panaderia-lupita', ownerEmail: 'ana@x.mx' }));
  ctx = await contextFor({ userEmail: 'ana@x.mx', tenantSlug: 'panaderia-lupita' });
  __clearTenantEventHandlers();
});

afterEach(() => {
  __clearTenantEventHandlers();
  restaurar();
  almacen.limpiar();
});

const sembrarEvento = (tipo = TENANT_PROVISIONED, payload: Record<string, unknown> = {}) =>
  almacen.sembrar('tenant_events', { tenant_id: tenantId, type: tipo, payload });

describe('emitir', () => {
  it('escribe la fila con el tenant del contexto', async () => {
    await emitTenantEvent(ctx, 'algo_paso', { detalle: 1 });

    const filas = almacen.tabla('tenant_events');
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      tenant_id: tenantId,
      type: 'algo_paso',
      payload: { detalle: 1 },
      delivered_at: null,
    });
  });
});

describe('drenar', () => {
  it('entrega a quien escucha y marca la fila', async () => {
    sembrarEvento();
    const visto = vi.fn();
    onTenantProvisioned(visto);

    const r = await drainTenantEvents();

    expect(r).toEqual({ entregados: 1, fallidos: 0 });
    expect(visto).toHaveBeenCalledOnce();
    expect(almacen.tabla('tenant_events')[0]?.delivered_at).not.toBeNull();
  });

  it('no vuelve a entregar lo ya entregado', async () => {
    sembrarEvento();
    const visto = vi.fn();
    onTenantProvisioned(visto);

    await drainTenantEvents();
    await drainTenantEvents();

    expect(visto).toHaveBeenCalledOnce();
  });

  it('★ sin suscriptor, el evento se QUEDA pendiente', async () => {
    // H11 todavía no aterriza. Marcarlo entregado ahora sería perder la
    // siembra de áreas del primer cliente.
    sembrarEvento();

    const r = await drainTenantEvents();

    expect(r.entregados).toBe(0);
    expect(almacen.tabla('tenant_events')[0]?.delivered_at).toBeNull();
  });

  it('★ y cuando H11 aparece, lo encuentra esperando', async () => {
    sembrarEvento(TENANT_PROVISIONED, { slug: 'panaderia-lupita' });
    await drainTenantEvents(); // nadie escucha

    const h11 = vi.fn();
    onTenantProvisioned(h11);
    await drainTenantEvents();

    expect(h11).toHaveBeenCalledOnce();
    expect(h11.mock.calls[0]?.[0]).toMatchObject({
      type: TENANT_PROVISIONED,
      payload: { slug: 'panaderia-lupita' },
    });
  });

  it('★ si el suscriptor revienta, el evento NO se marca y se reintenta', async () => {
    sembrarEvento();
    let intentos = 0;
    onTenantProvisioned(() => {
      intentos++;
      if (intentos === 1) throw new Error('la siembra falló');
    });

    const primera = await drainTenantEvents();
    expect(primera).toEqual({ entregados: 0, fallidos: 1 });
    expect(almacen.tabla('tenant_events')[0]?.delivered_at).toBeNull();

    const segunda = await drainTenantEvents();
    expect(segunda.entregados).toBe(1);
    expect(intentos).toBe(2);
  });

  it('con varios suscriptores, todos reciben', async () => {
    sembrarEvento();
    const a = vi.fn();
    const b = vi.fn();
    onTenantProvisioned(a);
    onTenantProvisioned(b);

    await drainTenantEvents();

    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it('si uno de varios falla, no se marca (el otro tiene que ser idempotente)', async () => {
    sembrarEvento();
    const bueno = vi.fn();
    onTenantProvisioned(bueno);
    onTenantProvisioned(() => {
      throw new Error('no');
    });

    const r = await drainTenantEvents();

    expect(r.fallidos).toBe(1);
    expect(almacen.tabla('tenant_events')[0]?.delivered_at).toBeNull();
  });

  it('darse de baja deja de recibir', async () => {
    const visto = vi.fn();
    const baja = onTenantEvent('algo', visto);
    baja();

    almacen.sembrar('tenant_events', { tenant_id: tenantId, type: 'algo', payload: {} });
    await drainTenantEvents();

    expect(visto).not.toHaveBeenCalled();
  });

  it('respeta el límite por pasada', async () => {
    for (let i = 0; i < 5; i++) sembrarEvento();
    onTenantProvisioned(vi.fn());

    expect((await drainTenantEvents(2)).entregados).toBe(2);
    expect((await drainTenantEvents(2)).entregados).toBe(2);
    expect((await drainTenantEvents(2)).entregados).toBe(1);
  });
});
