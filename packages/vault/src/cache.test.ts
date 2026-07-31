/**
 * La caché de la bóveda: una lectura por tenant cada ventana, no una por
 * mensaje.
 *
 * Lo que aquí se prueba, sobre todo, es que la invalidación LOCAL sea
 * inmediata. La propagación entre procesos es por TTL y está documentada como
 * tal en cache.ts — GARDEN decía tener un `pg_notify` que en realidad nunca
 * funcionó, y ese tipo de mentira es peor que no tener nada.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __setClockForTests,
  bumpVaultCache,
  notifyVaultChanged,
  setVaultCacheBroadcaster,
  VAULT_CACHE_TTL_MS,
} from './cache';
import { resolveVault } from './resolver';
import { montar, valor, type Harness } from './testing/harness';

let h: Harness;
beforeEach(() => {
  h = montar();
  h.db.sembrar('canonical_values', [valor(h.a.tenantId, { key: 'precio', value: 100 })]);
});
afterEach(() => {
  __setClockForTests(null);
  setVaultCacheBroadcaster(null);
  h.restaurar();
});

describe('caché', () => {
  it('la segunda lectura no vuelve a pegarle a la base', async () => {
    await resolveVault(h.a);
    // Se cambia el dato POR DEBAJO de la caché: si la segunda lectura lo ve,
    // es que no hay caché.
    h.db.tabla('canonical_values')[0]!.value = 777;
    expect((await resolveVault(h.a))?.values['valor.precio']).toBe('$100');
  });

  it('invalidar hace que la siguiente lectura sea fresca', async () => {
    await resolveVault(h.a);
    h.db.tabla('canonical_values')[0]!.value = 777;
    bumpVaultCache(h.a.tenantId);
    expect((await resolveVault(h.a))?.values['valor.precio']).toBe('$777');
  });

  it('la caché es por tenant: invalidar A no invalida B', async () => {
    h.db.sembrar('canonical_values', [valor(h.b.tenantId, { key: 'precio', value: 200 })]);
    await resolveVault(h.a);
    await resolveVault(h.b);

    h.db.tabla('canonical_values')[1]!.value = 999;
    bumpVaultCache(h.a.tenantId);

    expect((await resolveVault(h.b))?.values['valor.precio']).toBe('$200');
  });

  it('expira sola al pasar el TTL', async () => {
    let ahora = 1_000_000;
    __setClockForTests(() => ahora);

    await resolveVault(h.a);
    h.db.tabla('canonical_values')[0]!.value = 777;

    ahora += VAULT_CACHE_TTL_MS - 1;
    expect((await resolveVault(h.a))?.values['valor.precio']).toBe('$100');

    ahora += 2;
    expect((await resolveVault(h.a))?.values['valor.precio']).toBe('$777');
  });
});

describe('notifyVaultChanged', () => {
  it('invalida local aunque no haya broadcaster', async () => {
    await resolveVault(h.a);
    h.db.tabla('canonical_values')[0]!.value = 777;
    await notifyVaultChanged(h.a.tenantId);
    expect((await resolveVault(h.a))?.values['valor.precio']).toBe('$777');
  });

  it('avisa al broadcaster cuando hay uno enchufado', async () => {
    const espia = vi.fn();
    setVaultCacheBroadcaster(espia);
    await notifyVaultChanged(h.a.tenantId);
    expect(espia).toHaveBeenCalledWith(h.a.tenantId);
  });

  it('un broadcaster que falla NO tumba la escritura', async () => {
    // Invalidar la caché es lo último que pasa tras guardar un valor. Si eso
    // pudiera lanzar, un bus caído haría fallar una escritura que ya ocurrió.
    setVaultCacheBroadcaster(() => {
      throw new Error('el bus no responde');
    });
    await expect(notifyVaultChanged(h.a.tenantId)).resolves.toBeUndefined();
  });
});
