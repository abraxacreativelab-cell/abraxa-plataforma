/**
 * Criterio observable #6 del handoff:
 *
 *   `detectGaps()` de un tenant nuevo lista los valores esperados de su giro
 *   que faltan.
 *
 * Es lo que le permite al agente maestro decir «todavía no me has dicho cuánto
 * cobras» en vez de inventarse una cifra.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { archivarDocumento, crearDocumento } from '../documents/service';
import { montar, valor, type Harness } from '../testing/harness';
import { aprobarValor } from '../values/service';
import { taxonomiaDe } from './catalog';
import { contarHuecos, detectGaps, detectGapsDetallado } from './gaps';

let h: Harness;
beforeEach(() => {
  h = montar();
});
afterEach(() => h.restaurar());

describe('criterio #6 · un tenant nuevo', () => {
  it('lista todo lo que su giro espera y él no tiene', async () => {
    // El tenant A es restaurante y está vacío.
    const gaps = await detectGapsDetallado(h.a);
    const porArea = Object.fromEntries(gaps.map((g) => [g.areaSlug, g]));

    expect(porArea.ventas?.missingValues.map((v) => v.key)).toEqual(['ticket_promedio']);
    expect(porArea.ventas?.missingDocs.map((d) => d.title)).toEqual(['Menú con precios']);
    expect(porArea.operaciones?.missingValues.map((v) => v.key)).toEqual(['aforo']);
    expect(porArea.finanzas?.missingValues.map((v) => v.key)).toEqual(['iva_pct']);
  });

  it('la taxonomía sale del giro del tenant, no de una tabla en el código', async () => {
    // En GARDEN esto era un Record hardcodeado con las 8 empresas de Santiago.
    expect((await taxonomiaDe('restaurante')).name).toBe('Restaurante y cafetería');
    expect((await taxonomiaDe('servicios')).name).toBe('Servicios profesionales');
  });

  it('un giro desconocido cae al genérico en vez de quedarse sin taxonomía', async () => {
    const t = await taxonomiaDe('taller-de-submarinos');
    expect(t.id).toBe('general');
    expect(t.areas.map((a) => a.slug)).toContain('direccion');
  });

  it('el formato del port es legible para un agente', async () => {
    const resumen = await detectGaps(h.a);
    const finanzas = resumen.find((g) => g.areaSlug === 'finanzas');
    // La pista viaja con la clave: el agente puede preguntar mejor.
    expect(finanzas?.missing).toContain('iva_pct (16 en México)');
    expect(resumen.find((g) => g.areaSlug === 'ventas')?.missing).toContain(
      'documento: Menú con precios',
    );
  });
});

describe('qué tapa un hueco y qué no', () => {
  it('UN BORRADOR NO CUENTA como definido', async () => {
    // El detalle que GARDEN acertó y hay que conservar: `active=false`
    // significa que un modelo lo propuso y nadie lo aprobó. No se puede citar,
    // no se propaga, no existe para los agentes. Contarlo como "ya lo tienes"
    // haría que el agente dejara de preguntar por un dato que sigue sin estar.
    h.db.sembrar('canonical_values', [
      valor(h.a.tenantId, { id: 'v1', key: 'ticket_promedio', value: 250, active: false }),
    ]);

    const gaps = await detectGapsDetallado(h.a);
    expect(gaps.find((g) => g.areaSlug === 'ventas')?.missingValues.map((v) => v.key)).toContain(
      'ticket_promedio',
    );

    // Y en cuanto se aprueba, el hueco se cierra.
    await aprobarValor(h.a, 'v1');
    const despues = await detectGapsDetallado(h.a);
    expect(
      despues.find((g) => g.areaSlug === 'ventas')?.missingValues.map((v) => v.key) ?? [],
    ).not.toContain('ticket_promedio');
  });

  it('una clave aprobada pero VACÍA tampoco cuenta', async () => {
    h.db.sembrar('canonical_values', [
      valor(h.a.tenantId, { key: 'ticket_promedio', value: null, value_text: null, active: true }),
    ]);
    const gaps = await detectGapsDetallado(h.a);
    expect(gaps.find((g) => g.areaSlug === 'ventas')?.missingValues.map((v) => v.key)).toContain(
      'ticket_promedio',
    );
  });

  it('un documento del tipo esperado en el área esperada cierra el hueco', async () => {
    await crearDocumento(h.a, {
      // A propósito con OTRO título: pedirle al emprendedor que lo nombre
      // igual que la plantilla sería absurdo.
      title: 'Carta de la taquería',
      content: '- taco_pastor: $28',
      docType: 'precios',
      areaSlug: 'ventas',
    });

    const gaps = await detectGapsDetallado(h.a);
    expect(gaps.find((g) => g.areaSlug === 'ventas')?.missingDocs ?? []).toHaveLength(0);
  });

  it('un documento archivado NO cierra el hueco', async () => {
    const doc = await crearDocumento(h.a, {
      title: 'Carta vieja',
      content: '- taco: $20',
      docType: 'precios',
      areaSlug: 'ventas',
    });
    await archivarDocumento(h.a, doc.id);

    const gaps = await detectGapsDetallado(h.a);
    expect(gaps.find((g) => g.areaSlug === 'ventas')?.missingDocs.length).toBe(1);
  });
});

describe('el conteo del panel', () => {
  it('baja conforme el negocio se completa', async () => {
    const antes = await contarHuecos(h.a);
    expect(antes).toBeGreaterThan(0);

    h.db.sembrar('canonical_values', [
      valor(h.a.tenantId, { key: 'ticket_promedio', value: 320, active: true }),
    ]);
    const despues = await contarHuecos(h.a);
    expect(despues).toBe(antes - 1);
  });

  it('un giro con menos áreas tiene menos huecos', async () => {
    // El tenant B es de servicios, cuya plantilla de prueba pide una sola cosa.
    expect(await contarHuecos(h.b)).toBe(1);
  });
});
