/**
 * El contrato cruzado, verificado.
 *
 * H3 (agents) y H7 (ritual) programan contra `VaultPort` sin ver este código.
 * Si la implementación se desvía de la interfaz —o deja de degradar cuando
 * debe— se enteran ellos en su merge, no yo en mi PR. Estas pruebas mueven ese
 * descubrimiento a donde cuesta barato.
 */
import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from 'vitest';
import { isPortReady, usePort, type VaultPort } from '@abraxa/db';
// Import ESTÁTICO del barril, a propósito: es lo que dispara el
// `registerPort('vault', …)` de src/index.ts, y es exactamente lo que hace
// `apps/api` al arrancar. Hacerlo con un `await import()` dentro del test
// mete la resolución del grafo entero —Express incluido— dentro del
// presupuesto de tiempo de la prueba, y se pasa del timeout en un disco lento.
import './index';
import { bumpVaultCache } from './cache';
import { listarValores } from './values/service';
import { ctxDe, montar, montarCaido, TENANT_A, valor, type Harness } from './testing/harness';
import { vaultService } from './vault-port';

describe('conformidad de tipos', () => {
  it('vaultService satisface VaultPort', () => {
    expectTypeOf(vaultService).toMatchTypeOf<VaultPort>();
  });

  it('el port queda registrado al importar el paquete', () => {
    expect(isPortReady('vault')).toBe(true);
    expect(usePort('vault')).toBe(vaultService);
  });
});

describe('los cinco métodos', () => {
  let h: Harness;
  beforeEach(() => {
    h = montar();
    h.db.sembrar('canonical_values', [
      valor(h.a.tenantId, { key: 'ticket_promedio', label: 'Ticket promedio', value: 320 }),
    ]);
  });
  afterEach(() => h.restaurar());

  it('resolve devuelve el mapa con namespace', async () => {
    const mapa = await vaultService.resolve(h.a);
    expect(mapa['valor.ticket_promedio']).toBe('$320');
    expect(mapa['precio.ticket_promedio']).toBe('$320');
  });

  it('resolve respeta el alcance por área del contrato', async () => {
    h.db.sembrar('canonical_values', [
      valor(h.a.tenantId, { key: 'ticket_promedio', value: 500, scope_type: 'area', scope_id: 'ventas' }),
    ]);
    bumpVaultCache();

    expect((await vaultService.resolve(h.a, { type: 'area', id: 'ventas' }))['valor.ticket_promedio']).toBe('$500');
    expect((await vaultService.resolve(h.a, { type: 'tenant' }))['valor.ticket_promedio']).toBe('$320');
  });

  it('injectIntoPrompt anexa el bloque', async () => {
    expect(await vaultService.injectIntoPrompt(h.a, 'Hola')).toContain('DATOS VIGENTES');
  });

  it('render sustituye tokens', async () => {
    expect(await vaultService.render(h.a, 'Son {valor.ticket_promedio}')).toBe('Son $320');
  });

  it('ingestDocument devuelve el id del documento y de los valores propuestos', async () => {
    const r = await vaultService.ingestDocument(h.a, {
      content: '- costo_envio: $180',
      title: 'Envíos',
    });
    expect(r.documentId).toBeTruthy();
    expect(r.valueIds).toHaveLength(1);

    // Y lo que entra por el port tampoco se activa solo.
    const envio = (await listarValores(h.a)).find((v) => v.key === 'costo_envio');
    expect(envio?.active).toBe(false);
  });

  it('detectGaps devuelve la forma del contrato', async () => {
    const gaps = await vaultService.detectGaps(h.a);
    expect(Array.isArray(gaps)).toBe(true);
    for (const g of gaps) {
      expect(typeof g.areaSlug).toBe('string');
      expect(Array.isArray(g.missing)).toBe(true);
    }
  });
});

describe('los tres métodos de lectura degradan, no explotan', () => {
  // Los llama un agente en medio de una conversación con el cliente final de
  // alguien. Si la bóveda tose, el agente contesta con menos datos.
  let caida: { restaurar(): void };
  beforeEach(() => {
    caida = montarCaido('lanza');
  });
  afterEach(() => caida.restaurar());

  const ctx = () => ctxDe(TENANT_A);

  it('resolve devuelve {} en vez de lanzar', async () => {
    await expect(vaultService.resolve(ctx())).resolves.toEqual({});
  });

  it('injectIntoPrompt devuelve el prompt intacto', async () => {
    await expect(vaultService.injectIntoPrompt(ctx(), 'Hola')).resolves.toBe('Hola');
  });

  it('render vacía los tokens en vez de dejarlos crudos', async () => {
    await expect(vaultService.render(ctx(), 'Son {valor.x} pesos')).resolves.toBe('Son  pesos');
  });

  it('detectGaps devuelve [] en vez de lanzar', async () => {
    await expect(vaultService.detectGaps(ctx())).resolves.toEqual([]);
  });
});

describe('ingestDocument SÍ puede lanzar', () => {
  // La llama una persona que pegó un texto y está esperando ver qué pasó. Un
  // error silencioso ahí sería peor que uno visible.
  let h: Harness;
  beforeEach(() => {
    h = montar();
  });
  afterEach(() => h.restaurar());

  it('un documento vacío es un error explícito', async () => {
    await expect(vaultService.ingestDocument(h.a, { content: '' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });
});
