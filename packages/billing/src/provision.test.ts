/**
 * ════════════════════════════════════════════════════════════════════════════
 *  `provisionarEmpresa()` — la función que decide en qué empresa cae un pago.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  El webhook la prueba de punta a punta; esto la prueba en corto, porque el
 *  invariante que sostiene es demasiado caro para verlo sólo a través de HTTP:
 *
 *      Llamarla DOS VECES con el mismo nombre y el mismo dueño tiene que dar
 *      la MISMA empresa. Siempre. Aunque la primera llamada ya haya creado la
 *      fila. Ése es exactamente el caso del reproceso de un pago, y la versión
 *      anterior devolvía `panaderia-lupita-2`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PlatformError, __clearPorts, registerPort } from '@abraxa/db';
import { FakeDb } from './pruebas/fake-db';
import { crearProvisionDoble, type ProvisionDoble } from './pruebas/tenancy-doble';
import { provisionarEmpresa } from './service';
import { MAX_CANDIDATOS } from './slug';

let db: FakeDb;
let tenancy: ProvisionDoble;

const LUPITA = { businessName: 'Panadería Lupita', ownerEmail: 'lupita@ejemplo.mx' };

beforeEach(() => {
  db = new FakeDb();
  tenancy = crearProvisionDoble(db);

  __clearPorts();
  registerPort('tenancy', {
    provision: (i) => tenancy.provision(i),
    contextFor: async () => {
      throw new Error('no se usa');
    },
    canSignIn: async () => false,
    primaryTenantSlugFor: async () => null,
    listMembers: async () => [],
  });
});

afterEach(() => {
  __clearPorts();
});

describe('el alta feliz', () => {
  it('el primer candidato libre es el que se usa', async () => {
    const r = await provisionarEmpresa(LUPITA);

    expect(r).toEqual({
      tenantId: 'tenant-de-panaderia-lupita',
      slug: 'panaderia-lupita',
      created: true,
    });
    expect(tenancy.llamadas).toHaveLength(1);
  });

  it('el nombre del negocio viaja intacto, con acentos y todo', async () => {
    await provisionarEmpresa(LUPITA);
    expect(tenancy.llamadas[0]).toEqual({
      slug: 'panaderia-lupita',
      name: 'Panadería Lupita',
      ownerEmail: 'lupita@ejemplo.mx',
    });
  });
});

describe('idempotencia — el invariante caro', () => {
  it('dos veces el mismo dueño con el mismo nombre = UNA empresa', async () => {
    const primera = await provisionarEmpresa(LUPITA);
    const segunda = await provisionarEmpresa(LUPITA);

    expect(segunda.tenantId).toBe(primera.tenantId);
    expect(segunda.slug).toBe(primera.slug);
    // La segunda no creó nada: es la misma empresa, y quien llama lo sabe.
    expect(primera.created).toBe(true);
    expect(segunda.created).toBe(false);
    expect(db.tabla('tenants')).toHaveLength(1);
  });

  it('diez reprocesos seguidos siguen dando UNA empresa', async () => {
    for (let i = 0; i < 10; i++) await provisionarEmpresa(LUPITA);
    expect(db.tabla('tenants')).toHaveLength(1);
  });

  it('nunca avanza al sufijo por un slug que ya es MÍO', async () => {
    await provisionarEmpresa(LUPITA);
    await provisionarEmpresa(LUPITA);

    expect(tenancy.llamadas.map((l) => l.slug)).toEqual([
      'panaderia-lupita',
      'panaderia-lupita',
    ]);
    expect(db.tabla('tenants').map((t) => t.slug)).toEqual(['panaderia-lupita']);
  });
});

describe('colisiones de verdad — entre personas distintas', () => {
  it('el slug de otro dueño empuja al siguiente sufijo', async () => {
    tenancy.sembrarEmpresa({ slug: 'panaderia-lupita', ownerEmail: 'otra@ejemplo.mx' });

    const r = await provisionarEmpresa(LUPITA);

    expect(r).toMatchObject({ slug: 'panaderia-lupita-2', created: true });
    expect(tenancy.llamadas.map((l) => l.slug)).toEqual([
      'panaderia-lupita',
      'panaderia-lupita-2',
    ]);
  });

  it('salta tantos sufijos como haga falta', async () => {
    for (const slug of ['panaderia-lupita', 'panaderia-lupita-2', 'panaderia-lupita-3']) {
      tenancy.sembrarEmpresa({ slug, ownerEmail: `duena-de-${slug}@ejemplo.mx` });
    }

    const r = await provisionarEmpresa(LUPITA);
    expect(r.slug).toBe('panaderia-lupita-4');
  });

  it('y si uno de los sufijos ya es MÍO, se queda ahí en vez de crear otro', async () => {
    // La combinación de los dos casos: alguien más tiene el slug base y yo ya
    // tengo el -2 de un intento anterior. El reproceso tiene que aterrizar en
    // MI -2, no crear un -3.
    tenancy.sembrarEmpresa({ slug: 'panaderia-lupita', ownerEmail: 'otra@ejemplo.mx' });
    const primera = await provisionarEmpresa(LUPITA);
    const segunda = await provisionarEmpresa(LUPITA);

    expect(primera.slug).toBe('panaderia-lupita-2');
    expect(segunda).toEqual({ ...primera, created: false });
    expect(db.tabla('tenants')).toHaveLength(2);
  });
});

describe('lo que NO puede pasar', () => {
  it('un fallo que no es CONFLICT se relanza sin probar el siguiente candidato', async () => {
    // Si un timeout se tratara como colisión, un blip de red mandaría a la
    // clienta a `panaderia-lupita-2` con el pago ya cobrado.
    tenancy.cuando(async () => {
      throw new PlatformError('INTERNAL', 'la base no contestó', { retryable: true });
    });

    await expect(provisionarEmpresa(LUPITA)).rejects.toMatchObject({
      code: 'INTERNAL',
      retryable: true,
    });
    expect(tenancy.llamadas).toHaveLength(1);
  });

  it('un error que no es PlatformError también se relanza tal cual', async () => {
    tenancy.cuando(async () => {
      throw new TypeError('fetch failed');
    });

    await expect(provisionarEmpresa(LUPITA)).rejects.toThrow(TypeError);
    expect(tenancy.llamadas).toHaveLength(1);
  });

  it('si TODOS los candidatos son de otra gente, lanza CONFLICT en vez de inventar un slug', async () => {
    tenancy.cuando(async () => {
      throw new PlatformError('CONFLICT', 'El slug ya está tomado por otra empresa.');
    });

    await expect(provisionarEmpresa(LUPITA)).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
    });
    // Se agotaron los candidatos, no se colgó: el tope existe porque esto corre
    // dentro de un webhook de pago.
    expect(tenancy.llamadas.length).toBeLessThanOrEqual(MAX_CANDIDATOS);
    expect(tenancy.llamadas.length).toBeGreaterThan(1);
  });

  it('nunca le pasa a la base un slug que sus CHECK rechazarían', async () => {
    // Un slug inválido no es un 422 bonito: es un `provision()` que revienta
    // con Stripe ya cobrado.
    tenancy.cuando(async () => {
      throw new PlatformError('CONFLICT', 'ocupado');
    });

    await expect(
      provisionarEmpresa({ businessName: '☕ API ☕', ownerEmail: 'a@ejemplo.mx' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    for (const { slug } of tenancy.llamadas) {
      expect(slug).toMatch(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/);
      expect(slug).not.toBe('api');
    }
  });
});
