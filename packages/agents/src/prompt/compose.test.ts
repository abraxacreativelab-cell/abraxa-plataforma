/**
 * La composición del prompt, y sobre todo la regla que se hereda de GARDEN:
 * **la bóveda es best-effort y jamás rompe al agente.**
 *
 * `src/vault/agent-inject.ts` de GARDEN son 33 líneas envueltas en un
 * `try/catch` que devuelve el prompt intacto. Es lo que se copia aquí —la
 * forma, no el código, porque hablamos con `VaultPort` en vez de con su
 * resolver.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __clearPorts, __setClientForTests, registerPort } from '@abraxa/db';
import type { TenantContext, VaultPort } from '@abraxa/db';
import { componerPrompt } from './compose';
import { createFakeDb, type FakeDb } from '../testing/fake-db';

const T = '11111111-1111-1111-1111-111111111111';
const ctx: TenantContext = {
  tenantId: T,
  tenantSlug: 'panaderia-lupita',
  userEmail: 'lupita@ejemplo.mx',
  role: 'owner',
  areas: {},
};

let db: FakeDb;
let restaurar: () => void;

function vaultQue(impl: Partial<VaultPort>): void {
  registerPort('vault', {
    resolve: () => Promise.resolve({}),
    injectIntoPrompt: (_c, p) => Promise.resolve(p),
    render: (_c, t) => Promise.resolve(t),
    ingestDocument: () => Promise.resolve({ documentId: '', valueIds: [] }),
    detectGaps: () => Promise.resolve([]),
    ...impl,
  } as VaultPort);
}

beforeEach(() => {
  db = createFakeDb({
    tenants: [
      {
        id: T,
        slug: 'panaderia-lupita',
        name: 'Panadería Lupita',
        industry_type: 'restaurante',
        stage: 'operando',
      },
    ],
  });
  restaurar = __setClientForTests(db.client);
  __clearPorts();
});

afterEach(() => {
  restaurar();
  __clearPorts();
});

describe('sin H4 todavía', () => {
  it('el agente corre SIN bóveda en vez de reventar — regla 5 en la práctica', async () => {
    // VaultPort no registrado. `tryPort` devuelve null y el prompt sigue.
    const p = await componerPrompt(ctx, { base: 'Eres el agente de ventas.' });

    expect(p).toContain('Eres el agente de ventas.');
    expect(p).toContain('Panadería Lupita');
  });
});

describe('con H4 registrado', () => {
  it('anexa el bloque de datos vigentes del negocio', async () => {
    vaultQue({
      injectIntoPrompt: (_c, p) =>
        Promise.resolve(`${p}\n\n--- DATOS VIGENTES ---\n- Concha: $18.00 MXN`),
    });

    const p = await componerPrompt(ctx, { base: 'Eres el agente de ventas.' });

    expect(p).toContain('$18.00 MXN');
    // Los números reales del negocio son lo que evita que el agente invente
    // un precio y el emprendedor se entere por un cliente reclamando.
  });

  it('si la bóveda LANZA, devuelve el prompt intacto — el patrón oro de GARDEN', async () => {
    vaultQue({
      injectIntoPrompt: () => Promise.reject(new Error('la bóveda se cayó')),
    });

    const p = await componerPrompt(ctx, { base: 'Eres el agente de ventas.' });

    expect(p).toContain('Eres el agente de ventas.');
    // Entre que el agente conteste sin las cifras y que no conteste, lo primero
    // es mucho menos malo.
  });

  it('si la bóveda devuelve vacío, tampoco se pierde el prompt', async () => {
    vaultQue({ injectIntoPrompt: () => Promise.resolve('') });

    const p = await componerPrompt(ctx, { base: 'Eres el agente de ventas.' });
    expect(p).toContain('Eres el agente de ventas.');
  });
});

describe('orden de composición', () => {
  it('base → bóveda → contexto del tenant: de lo más estable a lo más volátil', async () => {
    vaultQue({ injectIntoPrompt: (_c, p) => Promise.resolve(`${p}\n\nBLOQUE-BOVEDA`) });

    const p = await componerPrompt(ctx, { base: 'BASE' });

    // El caché de prompt es coincidencia de PREFIJO: lo estable va primero.
    expect(p.indexOf('BASE')).toBeLessThan(p.indexOf('BLOQUE-BOVEDA'));
    expect(p.indexOf('BLOQUE-BOVEDA')).toBeLessThan(p.indexOf('LA EMPRESA'));
  });

  it('el systemSuffix de H7 se antepone a la bóveda', async () => {
    vaultQue({ injectIntoPrompt: (_c, p) => Promise.resolve(`${p}\n\nBLOQUE-BOVEDA`) });

    const p = await componerPrompt(ctx, { base: 'BASE', systemSuffix: 'FASE-3-DEL-RITUAL' });

    expect(p.indexOf('FASE-3-DEL-RITUAL')).toBeGreaterThan(p.indexOf('BASE'));
    expect(p.indexOf('FASE-3-DEL-RITUAL')).toBeLessThan(p.indexOf('BLOQUE-BOVEDA'));
  });

  it('NO mete fecha ni hora: reventaría el caché en cada llamada', async () => {
    const p = await componerPrompt(ctx, { base: 'BASE' });

    const anio = String(new Date().getFullYear());
    expect(p).not.toContain(anio);
    // Un timestamp en el prefijo invalida el caché en cada llamada sin que
    // nadie lo note, hasta que la factura no cuadra.
  });

  it('el contexto del tenant trae giro y etapa', async () => {
    const p = await componerPrompt(ctx, { base: 'BASE' });

    expect(p).toContain('Panadería Lupita');
    expect(p).toContain('restaurante');
    expect(p).toContain('operando');
  });
});
