/**
 * `provision()` — la capa de TypeScript.
 *
 * Lo que se prueba aquí es lo que hace TypeScript: validar la entrada,
 * normalizarla, llamar a la función con los argumentos correctos y traducir
 * sus errores.
 *
 * Lo que NO se prueba aquí es la atomicidad ni la idempotencia: eso vive en
 * `app.provision_tenant()` y se verifica contra Postgres de verdad en
 * `pg.test.ts`. El doble en memoria no ejecuta plpgsql, y fingir que sí
 * — reimplementando la función en JavaScript — haría que estas pruebas
 * verificaran la reimplementación en vez del SQL que corre en producción.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AlmacenFake } from '../testing/fake-postgrest';
import { instalarDoble } from '../testing/seed';
import { provision } from './provision';

let almacen: AlmacenFake;
let restaurar: () => void;

/** Un doble de la función de base de datos, para ver con qué la llaman. */
const rpcQueDevuelve = (tenantId = 'T-1', created = true) => {
  almacen.registrarRpc('provision_tenant', () => [{ tenant_id: tenantId, created }]);
};

const rpcQueFalla = (code: string, message: string) => {
  almacen.registrarRpc('provision_tenant', () => {
    throw Object.assign(new Error(message), { code });
  });
};

beforeEach(() => {
  ({ almacen, restaurar } = instalarDoble());
});

afterEach(() => {
  restaurar();
  almacen.limpiar();
});

describe('validación de la entrada', () => {
  beforeEach(() => rpcQueDevuelve());

  it.each([
    ['slug reservado', { slug: 'api', name: 'Panadería Lupita', ownerEmail: 'a@b.mx' }],
    ['slug con mayúsculas y espacios', { slug: 'Mi Empresa', name: 'Panadería Lupita', ownerEmail: 'a@b.mx' }],
    ['slug muy corto', { slug: 'ab', name: 'Panadería Lupita', ownerEmail: 'a@b.mx' }],
    ['nombre vacío', { slug: 'panaderia-lupita', name: '', ownerEmail: 'a@b.mx' }],
    ['correo inválido', { slug: 'panaderia-lupita', name: 'Panadería Lupita', ownerEmail: 'no-es-correo' }],
  ])('rechaza con 422: %s', async (_caso, entrada) => {
    await expect(provision(entrada)).rejects.toMatchObject({ code: 'VALIDATION', status: 422 });
  });

  it('el mensaje dice qué campo está mal', async () => {
    await expect(
      provision({ slug: 'api', name: 'Mi empresa', ownerEmail: 'a@b.mx' }),
    ).rejects.toThrow(/reservado/i);
  });

  it('y nunca llega a la base si la entrada es inválida', async () => {
    await provision({ slug: 'api', name: 'Panadería Lupita', ownerEmail: 'a@b.mx' }).catch(() => null);
    expect(almacen.llamadasRpc).toHaveLength(0);
  });
});

describe('normalización antes de llegar a la base', () => {
  beforeEach(() => rpcQueDevuelve());

  it('baja el correo y el slug a minúsculas y les quita espacios', async () => {
    await provision({
      slug: '  Panaderia-Lupita  ',
      name: '  Panadería Lupita  ',
      ownerEmail: '  ANA@Panaderia.MX ',
    });

    expect(almacen.llamadasRpc[0]?.args).toMatchObject({
      p_slug: 'panaderia-lupita',
      p_owner_email: 'ana@panaderia.mx',
      p_name: 'Panadería Lupita',
    });
  });

  it('manda el plan free por defecto', async () => {
    await provision({ slug: 'panaderia-lupita', name: 'Panadería Lupita', ownerEmail: 'a@b.mx' });
    expect(almacen.llamadasRpc[0]?.args).toMatchObject({ p_plan: 'free' });
  });

  it('sin giro, manda null y no la cadena "undefined"', async () => {
    await provision({ slug: 'panaderia-lupita', name: 'Panadería Lupita', ownerEmail: 'a@b.mx' });
    expect(almacen.llamadasRpc[0]?.args).toMatchObject({ p_industry_type: null });
  });
});

describe('el resultado', () => {
  it('devuelve tenantId y created:true en el alta', async () => {
    rpcQueDevuelve('T-99', true);
    expect(await provision({ slug: 'panaderia-lupita', name: 'Panadería Lupita', ownerEmail: 'a@b.mx' })).toEqual({
      tenantId: 'T-99',
      created: true,
    });
  });

  it('devuelve created:false cuando el slug ya existía (idempotencia)', async () => {
    rpcQueDevuelve('T-99', false);
    expect(await provision({ slug: 'panaderia-lupita', name: 'Panadería Lupita', ownerEmail: 'a@b.mx' })).toEqual({
      tenantId: 'T-99',
      created: false,
    });
  });
});

describe('traducción de errores de la base', () => {
  it('ABX01 (slug de otro dueño) → CONFLICT 409, no 500', async () => {
    // H10 necesita distinguirlo: un 409 es "no reintentes, avísale al usuario";
    // un 500 haría que Stripe reintentara el webhook para siempre.
    rpcQueFalla('ABX01', 'El slug "panaderia" ya está tomado por otra empresa.');

    await expect(
      provision({ slug: 'panaderia-lupita', name: 'Panadería Lupita', ownerEmail: 'a@b.mx' }),
    ).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
  });

  it('ABX02 → VALIDATION 422', async () => {
    rpcQueFalla('ABX02', 'El plan "oro" no existe en el catálogo.');
    await expect(
      provision({ slug: 'panaderia-lupita', name: 'Panadería Lupita', ownerEmail: 'a@b.mx' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('23505 (choque de restricción única) → CONFLICT', async () => {
    rpcQueFalla('23505', 'duplicate key value violates unique constraint');
    await expect(
      provision({ slug: 'panaderia-lupita', name: 'Panadería Lupita', ownerEmail: 'a@b.mx' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('la función sin aplicar → mensaje que dice qué hacer', async () => {
    rpcQueFalla('PGRST202', 'Could not find the function');
    await expect(
      provision({ slug: 'panaderia-lupita', name: 'Panadería Lupita', ownerEmail: 'a@b.mx' }),
    ).rejects.toThrow(/migraciones 011 y 012/);
  });

  it('una respuesta vacía no se confunde con un alta exitosa', async () => {
    almacen.registrarRpc('provision_tenant', () => []);
    await expect(
      provision({ slug: 'panaderia-lupita', name: 'Panadería Lupita', ownerEmail: 'a@b.mx' }),
    ).rejects.toBeTruthy();
  });
});
