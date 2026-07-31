/**
 * `canSignIn` — la doble puerta de entrada a la plataforma.
 *
 * Portada de GARDEN (garden-os/lib/auth.ts:42-56) con su inyección de
 * dependencias, que es lo que permite probar el fail-closed sin red.
 *
 * Lo que importa aquí: que NINGÚN camino de error abra la puerta. Un timeout,
 * una base caída o una respuesta rara tienen que devolver `false`. La única
 * forma de entrar es que algo diga explícitamente que sí.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { canSignIn, primaryTenantSlugFor, tenantsFor } from './context';
import { instalarDoble, sembrarMiembro, sembrarTenant } from '../testing/seed';

const nunca = async () => false;
const siempre = async () => true;

const entornoOriginal = { ...process.env };
afterEach(() => {
  process.env = { ...entornoOriginal };
});

describe('canSignIn — la allowlist del equipo', () => {
  it('deja entrar a quien está en la lista', async () => {
    expect(
      await canSignIn('santi@abraxa.club', {
        allowed: ['santi@abraxa.club'],
        membership: nunca,
        env: 'production',
      }),
    ).toBe(true);
  });

  it('normaliza antes de comparar', async () => {
    expect(
      await canSignIn('  SANTI@Abraxa.Club ', {
        allowed: ['santi@abraxa.club'],
        membership: nunca,
        env: 'production',
      }),
    ).toBe(true);
  });
});

describe('canSignIn — la membresía', () => {
  it('deja entrar a quien pertenece a alguna empresa', async () => {
    expect(await canSignIn('cliente@x.mx', { allowed: [], membership: siempre, env: 'production' })).toBe(
      true,
    );
  });

  it('no deja entrar a quien no pertenece a ninguna', async () => {
    expect(
      await canSignIn('nadie@x.mx', {
        allowed: ['otro@abraxa.club'],
        membership: nunca,
        env: 'production',
      }),
    ).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('★ fail-closed — ningún error abre la puerta', () => {
  const revienta = async () => {
    throw new Error('la base no responde');
  };

  it('un error consultando la membresía devuelve false, no true', async () => {
    expect(
      await canSignIn('cliente@x.mx', {
        allowed: ['otro@abraxa.club'],
        membership: revienta,
        env: 'production',
      }),
    ).toBe(false);
  });

  it('un timeout tampoco abre', async () => {
    const seCuelga = async () => {
      throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    };
    expect(
      await canSignIn('cliente@x.mx', {
        allowed: ['otro@abraxa.club'],
        membership: seCuelga,
        env: 'production',
      }),
    ).toBe(false);
  });

  it('un correo vacío o nulo nunca entra', async () => {
    for (const valor of ['', '   ', null, undefined]) {
      expect(await canSignIn(valor, { allowed: [], membership: siempre, env: 'development' })).toBe(
        false,
      );
    }
  });

  it('en PRODUCCIÓN, sin allowlist y sin membresía, no entra nadie', async () => {
    // Es el caso de un deploy que perdió AUTH_ALLOWED_EMAILS. La escotilla de
    // desarrollo NO puede aplicar aquí.
    expect(await canSignIn('quien@sea.mx', { allowed: [], membership: nunca, env: 'production' })).toBe(
      false,
    );
  });

  it('en desarrollo, sin allowlist configurada, sí entra (la escotilla local)', async () => {
    expect(
      await canSignIn('quien@sea.mx', { allowed: [], membership: nunca, env: 'development' }),
    ).toBe(true);
  });

  it('pero con allowlist configurada, ni en desarrollo entra quien no está', async () => {
    expect(
      await canSignIn('intruso@x.mx', {
        allowed: ['santi@abraxa.club'],
        membership: nunca,
        env: 'development',
      }),
    ).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('a dónde mandar a alguien después de entrar', () => {
  it('con una sola empresa, a esa', async () => {
    const { almacen, restaurar } = instalarDoble();
    sembrarTenant(almacen, { slug: 'panaderia-lupita', ownerEmail: 'ana@x.mx' });

    expect(await primaryTenantSlugFor('ana@x.mx')).toBe('panaderia-lupita');
    restaurar();
  });

  it('con dos, a ninguna: elegir por él sería adivinar', async () => {
    const { almacen, restaurar } = instalarDoble();
    const a = sembrarTenant(almacen, { slug: 'panaderia-lupita', ownerEmail: 'ana@x.mx' });
    const b = sembrarTenant(almacen, { slug: 'taqueria-primo', ownerEmail: 'otro@x.mx' });
    sembrarMiembro(almacen, b.tenantId, 'ana@x.mx', 'member');

    expect(a.tenantId).not.toBe(b.tenantId);
    expect(await primaryTenantSlugFor('ana@x.mx')).toBeNull();
    expect(await tenantsFor('ana@x.mx')).toHaveLength(2);
    restaurar();
  });

  it('sin ninguna, null (va al Ritual de Fundación de H7)', async () => {
    const { almacen, restaurar } = instalarDoble();
    expect(await primaryTenantSlugFor('nadie@x.mx')).toBeNull();
    expect(await tenantsFor('nadie@x.mx')).toEqual([]);
    almacen.limpiar();
    restaurar();
  });

  it('una empresa suspendida no cuenta como destino', async () => {
    const { almacen, restaurar } = instalarDoble();
    sembrarTenant(almacen, { slug: 'panaderia-lupita', ownerEmail: 'ana@x.mx', status: 'suspended' });

    expect(await primaryTenantSlugFor('ana@x.mx')).toBeNull();
    restaurar();
  });
});
