/**
 * Criterios observables del handoff #1 y #2:
 *   1. Un valor `money` referenciado como {valor.x} se renderiza en pesos.
 *   2. Un valor con alcance `area` GANA sobre uno con la misma clave y
 *      alcance `tenant`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bumpVaultCache } from './cache';
import { renderTemplate } from './render';
import { getVaultValue, resolveVault } from './resolver';
import { montar, valor, type Harness } from './testing/harness';

let h: Harness;
beforeEach(() => {
  h = montar();
});
afterEach(() => h.restaurar());

describe('criterio #1 · un monto se renderiza en pesos mexicanos', () => {
  it('{valor.mi_precio} se convierte en $1,500', async () => {
    h.db.sembrar('canonical_values', [
      valor(h.a.tenantId, { key: 'mi_precio', label: 'Mi precio', value: 1500 }),
    ]);

    const { text, missing } = await renderTemplate(h.a, 'El costo es {valor.mi_precio} más IVA.');
    expect(text).toBe('El costo es $1,500 más IVA.');
    expect(missing).toEqual([]);
  });

  it('conserva los centavos en vez de redondearlos en silencio', async () => {
    // GARDEN usaba maximumFractionDigits:0, así que 1500.50 salía como $1,501
    // en el contrato del cliente. Redondear un número que va a un contrato no
    // es una decisión de presentación.
    h.db.sembrar('canonical_values', [
      valor(h.a.tenantId, { key: 'con_centavos', value: 1500.5 }),
    ]);
    const { text } = await renderTemplate(h.a, '{valor.con_centavos}');
    expect(text).toBe('$1,500.50');
  });

  it('{precio.*} existe sólo para montos, no para textos', async () => {
    h.db.sembrar('canonical_values', [
      valor(h.a.tenantId, { key: 'tarifa', value: 900 }),
      valor(h.a.tenantId, { key: 'horario', kind: 'text', value: null, value_text: '9 a 6' }),
    ]);
    const r = await resolveVault(h.a);
    expect(r?.values['precio.tarifa']).toBe('$900');
    expect(r?.values['precio.horario']).toBeUndefined();
    expect(r?.values['valor.horario']).toBe('9 a 6');
  });
});

describe('criterio #2 · el alcance más específico gana', () => {
  beforeEach(() => {
    h.db.sembrar('canonical_values', [
      valor(h.a.tenantId, { key: 'comision_pct', kind: 'percent', value: 10, scope_type: 'tenant', scope_id: '' }),
      valor(h.a.tenantId, { key: 'comision_pct', kind: 'percent', value: 25, scope_type: 'area', scope_id: 'ventas' }),
    ]);
  });

  it('dentro del área gana el valor del área', async () => {
    const r = await resolveVault(h.a, { area: 'ventas' });
    expect(r?.values['valor.comision_pct']).toBe('25%');
    expect(r?.rows.comision_pct?.scope_type).toBe('area');
  });

  it('fuera del área gana el general', async () => {
    const r = await resolveVault(h.a, { area: 'finanzas' });
    expect(r?.values['valor.comision_pct']).toBe('10%');
  });

  it('sin contexto de área gana el general', async () => {
    const r = await resolveVault(h.a);
    expect(r?.values['valor.comision_pct']).toBe('10%');
  });

  it('un valor que sólo existe por área no se filtra a otra área', async () => {
    // Es la mitad del punto de tener alcances: "la comisión de Ventas" no
    // puede aparecer en un contrato de Finanzas.
    h.db.sembrar('canonical_values', [
      valor(h.a.tenantId, { key: 'meta_mensual', value: 90000, scope_type: 'area', scope_id: 'ventas' }),
    ]);
    bumpVaultCache();
    expect((await resolveVault(h.a, { area: 'ventas' }))?.values['valor.meta_mensual']).toBe('$90,000');
    expect((await resolveVault(h.a, { area: 'finanzas' }))?.values['valor.meta_mensual']).toBeUndefined();
  });
});

describe('sólo se resuelve lo aprobado', () => {
  it('un borrador no aparece en la resolución', async () => {
    h.db.sembrar('canonical_values', [
      valor(h.a.tenantId, { key: 'propuesto', value: 999, active: false }),
    ]);
    const r = await resolveVault(h.a);
    expect(r?.values['valor.propuesto']).toBeUndefined();
  });
});

describe('namespaces de empresa y marca', () => {
  it('{empresa.*} y {marca.*} salen de tenants.settings', async () => {
    const r = await resolveVault(h.a);
    expect(r?.values['marca.color']).toBe('#A85A3A');
    expect(r?.values['empresa.rfc']).toBe('XAXX010101000');
    expect(r?.values['empresa.nombre']).toBe('Taquería La Nueva');
  });

  it('{empresa.nombre} existe aunque el emprendedor no configure nada', async () => {
    const r = await resolveVault(h.b);
    expect(r?.values['empresa.nombre']).toBe('Despacho Ríos');
  });

  it('los alias amigables apuntan al valor real', async () => {
    h.db.sembrar('canonical_values', [
      valor(h.a.tenantId, { key: 'comision_pct', kind: 'percent', value: 12 }),
    ]);
    const r = await resolveVault(h.a);
    expect(r?.values['comision']).toBe('12%');
  });
});

describe('getVaultValue · lo que consume la tool del agente', () => {
  it('devuelve el número crudo además del formateado', async () => {
    h.db.sembrar('canonical_values', [
      valor(h.a.tenantId, { key: 'ticket_promedio', value: 320, note: 'sin bebida' }),
    ]);
    const r = await getVaultValue(h.a, 'ticket_promedio');
    expect(r).toMatchObject({ found: true, formatted: '$320', raw: 320, note: 'sin bebida' });
  });

  it('found:false le da al agente una forma honesta de decir que no sabe', async () => {
    const r = await getVaultValue(h.a, 'clave_que_no_existe');
    expect(r.found).toBe(false);
  });
});
