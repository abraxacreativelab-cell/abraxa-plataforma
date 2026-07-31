/**
 * Alta, edición y aprobación de valores: validación, conflictos y permisos.
 *
 * La validación de la clave es más estricta de lo que parece necesario, y a
 * propósito: la clave se escribe en las plantillas como `{valor.mi_clave}`, así
 * que una clave con espacio o acento produce un token que jamás resuelve — y
 * el síntoma aparece semanas después, en un contrato, con un hueco donde iba
 * el precio.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveVault } from '../resolver';
import { ctxSoloLectura, montar, TENANT_A, valor, type Harness } from '../testing/harness';
import {
  aprobarValor,
  borrarValor,
  contarBorradores,
  crearValor,
  desactivarValor,
  editarValor,
  listarValores,
} from './service';

let h: Harness;
beforeEach(() => {
  h = montar();
});
afterEach(() => h.restaurar());

const BASE = { key: 'precio_hora', label: 'Precio por hora', kind: 'money', value: 900 };

describe('crear', () => {
  it('crea un valor activo cuando lo escribe una persona', async () => {
    // A diferencia de la ingesta: aquí el dueño del negocio tiene el número
    // enfrente. Lo que nunca nace activo es lo que EXTRAE un modelo.
    const v = await crearValor(h.a, BASE);
    expect(v).toMatchObject({ key: 'precio_hora', active: true, currency: 'MXN' });
    expect(v.approved_by).toBe(h.a.userEmail);
  });

  it('se puede crear directamente en borrador', async () => {
    const v = await crearValor(h.a, { ...BASE, active: false });
    expect(v.active).toBe(false);
    expect(v.approved_at).toBeNull();
  });

  it.each([
    ['Precio Hora', 'mayúsculas y espacios'],
    ['precio-hora', 'guiones'],
    ['comisión_pct', 'acentos'],
    ['1_precio', 'empezar con número'],
  ])('rechaza la clave %s (%s)', async (key) => {
    await expect(crearValor(h.a, { ...BASE, key })).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('el mensaje de error explica cómo se escribe una clave', async () => {
    await expect(crearValor(h.a, { ...BASE, key: 'Precio Hora' })).rejects.toThrow(/snake_case/i);
  });

  it('rechaza un monto sin número', async () => {
    await expect(crearValor(h.a, { key: 'x_precio', label: 'X', kind: 'money' })).rejects.toThrow(
      /necesita un número/i,
    );
  });

  it('rechaza un campo desconocido en vez de ignorarlo en silencio', async () => {
    // Un typo como `activo` en vez de `active` haría creer al emprendedor que
    // guardó algo que no guardó.
    await expect(crearValor(h.a, { ...BASE, activo: true })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('rechaza un alcance por área sin área', async () => {
    await expect(crearValor(h.a, { ...BASE, scope_type: 'area' })).rejects.toThrow(/de qué área/i);
  });

  it('la misma clave dos veces en el mismo alcance da CONFLICT con instrucción', async () => {
    await crearValor(h.a, BASE);
    await expect(crearValor(h.a, BASE)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(crearValor(h.a, BASE)).rejects.toThrow(/Edítalo en vez de crear otro/i);
  });

  it('la misma clave en OTRO alcance sí se permite: es el override por área', async () => {
    await crearValor(h.a, BASE);
    const porArea = await crearValor(h.a, {
      ...BASE,
      value: 1200,
      scope_type: 'area',
      scope_id: 'ventas',
    });
    expect(porArea.scope_id).toBe('ventas');
    expect((await listarValores(h.a)).filter((v) => v.key === 'precio_hora')).toHaveLength(2);
  });
});

describe('editar', () => {
  it('un cambio se propaga de inmediato, sin esperar a que expire la caché', async () => {
    // Si no, el emprendedor cambia un precio, prueba su agente, le contesta
    // con el precio viejo y pierde la confianza en el producto entero.
    const v = await crearValor(h.a, BASE);
    expect((await resolveVault(h.a))?.values['valor.precio_hora']).toBe('$900');

    await editarValor(h.a, v.id, { value: 1100 });
    expect((await resolveVault(h.a))?.values['valor.precio_hora']).toBe('$1,100');
  });

  it('la clave NO se puede cambiar: rompería las plantillas que ya la usan', async () => {
    const v = await crearValor(h.a, BASE);
    await expect(editarValor(h.a, v.id, { key: 'otra_clave' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('bajar el alcance a general limpia el scope_id solo', async () => {
    const v = await crearValor(h.a, { ...BASE, scope_type: 'area', scope_id: 'ventas' });
    const editado = await editarValor(h.a, v.id, { scope_type: 'tenant' });
    expect(editado.scope_id).toBe('');
  });

  it('editar algo que no existe es NOT_FOUND', async () => {
    await expect(editarValor(h.a, 'no-existe', { value: 1 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('aprobar y desactivar', () => {
  beforeEach(() => {
    h.db.sembrar('canonical_values', [
      valor(h.a.tenantId, { id: 'draft-1', key: 'iva_pct', kind: 'percent', value: 16, active: false }),
    ]);
  });

  it('aprobar deja constancia de quién respondió por la cifra', async () => {
    const { row } = await aprobarValor(h.a, 'draft-1');
    expect(row.active).toBe(true);
    expect(row.approved_by).toBe(h.a.userEmail);
    expect(row.approved_at).toBeTruthy();
  });

  it('el mensaje dice qué se propagó, no un "guardado"', async () => {
    const { propagado } = await aprobarValor(h.a, 'draft-1');
    expect(propagado).toBe('{valor.iva_pct} → 16%');
  });

  it('desactivar lo saca de circulación sin perder el dato', async () => {
    await aprobarValor(h.a, 'draft-1');
    const v = await desactivarValor(h.a, 'draft-1');
    expect(v.active).toBe(false);
    expect(v.value).toBe(16);
    expect(v.approved_by).toBeNull();
    expect((await resolveVault(h.a))?.values['valor.iva_pct']).toBeUndefined();
  });

  it('el contador de borradores alimenta el badge del panel', async () => {
    expect(await contarBorradores(h.a)).toBe(1);
    await aprobarValor(h.a, 'draft-1');
    expect(await contarBorradores(h.a)).toBe(0);
  });
});

describe('permisos', () => {
  const soloLee = () => ctxSoloLectura(TENANT_A);

  it('quien sólo lee PUEDE ver los valores', async () => {
    // Necesita saber a qué precio vende. Leer es flojo a propósito.
    await crearValor(h.a, BASE);
    expect(await listarValores(soloLee())).toHaveLength(1);
  });

  it.each([
    ['crear', () => crearValor(soloLee(), BASE)],
    ['editar', () => editarValor(soloLee(), 'x', { value: 1 })],
    ['aprobar', () => aprobarValor(soloLee(), 'x')],
    ['borrar', () => borrarValor(soloLee(), 'x')],
  ])('quien sólo lee NO puede %s', async (_nombre, accion) => {
    await expect(accion()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('el error explica por qué la bóveda es de Dirección', async () => {
    await expect(crearValor(soloLee(), BASE)).rejects.toThrow(/todas las áreas/i);
  });

  it('un grant con un valor que no reconocemos NO concede nada', async () => {
    // En GARDEN esta línea evitó que una fila malformada en la base se leyera
    // como acceso total.
    const raro = { ...h.a, areas: { direccion: 'superadmin' as unknown as 'admin' } };
    await expect(crearValor(raro, BASE)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('listar', () => {
  beforeEach(async () => {
    await crearValor(h.a, BASE);
    await crearValor(h.a, {
      key: 'iva_pct',
      label: 'IVA',
      kind: 'percent',
      value: 16,
      area_slug: 'finanzas',
      active: false,
    });
  });

  it('filtra por área', async () => {
    expect(await listarValores(h.a, { areaSlug: 'finanzas' })).toHaveLength(1);
  });

  it('filtra sólo borradores', async () => {
    const b = await listarValores(h.a, { soloBorradores: true });
    expect(b.map((v) => v.key)).toEqual(['iva_pct']);
  });

  it('busca por clave, etiqueta y nota', async () => {
    expect((await listarValores(h.a, { busqueda: 'IVA' })).map((v) => v.key)).toEqual(['iva_pct']);
    expect((await listarValores(h.a, { busqueda: 'hora' })).map((v) => v.key)).toEqual(['precio_hora']);
  });
});
