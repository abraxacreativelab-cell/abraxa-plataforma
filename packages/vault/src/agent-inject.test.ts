/**
 * Criterio observable #3 del handoff:
 *
 *   `injectIntoPrompt()` devuelve el prompt con el bloque de datos vigentes
 *   anexado; si la bóveda falla, devuelve el prompt INTACTO (best effort,
 *   nunca rompe al agente).
 *
 * La segunda mitad es la que de verdad importa: un agente sin bóveda contesta
 * peor, pero un agente caído deja al emprendedor sin atender a su cliente.
 *
 * Los fallos se prueban con una base REALMENTE caída, no con un mock del
 * módulo: así se ejercita el camino que va a correr un martes a las 3.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { injectIntoPrompt } from './agent-inject';
import { ctxDe, montar, montarCaido, TENANT_A, valor, type Harness } from './testing/harness';

const PROMPT = 'Eres el asistente de ventas. Sé breve y amable.';

describe('el bloque de datos vigentes', () => {
  let h: Harness;

  beforeEach(() => {
    h = montar();
    h.db.sembrar('canonical_values', [
      valor(h.a.tenantId, { key: 'ticket_promedio', label: 'Ticket promedio', value: 320 }),
      valor(h.a.tenantId, {
        key: 'iva_pct',
        label: 'IVA',
        kind: 'percent',
        value: 16,
        note: 'ya incluido en el menú',
      }),
    ]);
  });
  afterEach(() => h.restaurar());

  it('anexa las cifras con la instrucción de citarlas exactas', async () => {
    const salida = await injectIntoPrompt(h.a, PROMPT);

    expect(salida).toContain(PROMPT);
    expect(salida).toContain('DATOS VIGENTES DE LA BÓVEDA');
    expect(salida).toContain('Cítalas EXACTAS');
    expect(salida).toContain('- Ticket promedio (ticket_promedio): $320');
    expect(salida).toContain('- IVA (iva_pct): 16% — ya incluido en el menú');
  });

  it('le dice al agente que diga que no sabe en vez de estimar', async () => {
    // Es la mitad del valor de este bloque: sin esta frase, un modelo bien
    // intencionado rellena el hueco con algo plausible.
    expect(await injectIntoPrompt(h.a, PROMPT)).toMatch(/dilo con claridad/i);
  });

  it('resuelve los tokens que el prompt ya use', async () => {
    const salida = await injectIntoPrompt(h.a, 'El ticket promedio es {valor.ticket_promedio}.');
    expect(salida).toContain('El ticket promedio es $320.');
    expect(salida).not.toContain('{valor.ticket_promedio}');
  });

  it('marca los valores que sólo aplican a un área', async () => {
    h.db.sembrar('canonical_values', [
      valor(h.a.tenantId, {
        key: 'descuento_max_pct',
        label: 'Descuento máximo',
        kind: 'percent',
        value: 15,
        scope_type: 'area',
        scope_id: 'ventas',
      }),
    ]);
    const salida = await injectIntoPrompt(h.a, PROMPT, { type: 'area', id: 'ventas' });
    expect(salida).toContain('[sólo en ventas]');
  });

  it('un valor en borrador NO llega al prompt del agente', async () => {
    // Es la razón de ser de active=false: un número que nadie aprobó no puede
    // salir por la boca de un agente.
    h.db.sembrar('canonical_values', [
      valor(h.a.tenantId, { key: 'precio_secreto', value: 99999, active: false }),
    ]);
    const salida = await injectIntoPrompt(h.a, PROMPT);
    expect(salida).not.toContain('99,999');
    expect(salida).not.toContain('precio_secreto');
  });
});

describe('sin valores aprobados', () => {
  let h: Harness;
  beforeEach(() => {
    h = montar();
  });
  afterEach(() => h.restaurar());

  it('no anexa un bloque vacío', async () => {
    // Un encabezado "DATOS VIGENTES" seguido de nada le diría al modelo que el
    // negocio no tiene datos — que es distinto de no mandarle el bloque.
    expect(await injectIntoPrompt(h.a, PROMPT)).toBe(PROMPT);
  });
});

describe('best effort · nunca rompe al agente', () => {
  it('con la base LANZANDO, devuelve el prompt intacto', async () => {
    const caida = montarCaido('lanza');
    try {
      await expect(injectIntoPrompt(ctxDe(TENANT_A), PROMPT)).resolves.toBe(PROMPT);
    } finally {
      caida.restaurar();
    }
  });

  it('con la base devolviendo error, devuelve el prompt intacto', async () => {
    const caida = montarCaido('error');
    try {
      await expect(injectIntoPrompt(ctxDe(TENANT_A), PROMPT)).resolves.toBe(PROMPT);
    } finally {
      caida.restaurar();
    }
  });

  it('un contexto sin tenantId no explota: devuelve el prompt', async () => {
    const h = montar();
    try {
      await expect(injectIntoPrompt({ ...h.a, tenantId: '' }, PROMPT)).resolves.toBe(PROMPT);
    } finally {
      h.restaurar();
    }
  });
});
