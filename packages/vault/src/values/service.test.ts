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
  obtenerValor,
  propuestaSinCifra,
  resolverConflicto,
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

/**
 * Aceptar una contradicción que no trae con qué reemplazar la cifra.
 *
 * Se siembra la fila YA MARCADA en vez de producirla con la ingesta a
 * propósito: así es exactamente como están hoy en producción las filas que la
 * ingesta marcó antes de este arreglo. Que el pipeline ya no las cree (la otra
 * capa) no hace nada por las que ya existen — y el botón «Aceptar» sigue
 * enfrente de ellas.
 */
describe('aceptar una contradicción SIN cifra', () => {
  const CONFLICTO_VACIO = {
    id: 'v-rango',
    key: 'consulta_inicial',
    label: 'Consulta inicial',
    kind: 'money',
    value: 850,
    currency: 'MXN',
    active: true,
    approved_at: '2026-01-15T10:00:00.000Z',
    approved_by: 'ana@empresa-a.mx',
    // Lo que escribió `marcarConflicto` con una cifra que era un rango.
    conflict_value: null,
    conflict_value_text: null,
    conflict_currency: 'MXN',
    conflict_note: 'de $800 a $900 — según el caso',
    conflict_doc_id: null,
    conflict_at: '2026-07-31T10:00:00.000Z',
  };

  beforeEach(() => {
    h.db.sembrar('canonical_values', [valor(h.a.tenantId, CONFLICTO_VACIO)]);
  });

  it('se rechaza en vez de dejar el valor VIGENTE Y VACÍO', async () => {
    await expect(resolverConflicto(h.a, 'v-rango', 'aceptar')).rejects.toMatchObject({
      code: 'VALIDATION',
    });

    const v = await obtenerValor(h.a, 'v-rango');
    expect(v.value).toBe(850);
    expect(v.active).toBe(true);
    // Y nada se decidió, así que la contradicción sigue esperando.
    expect(v.conflict_at).toBeTruthy();
  });

  it('el error cita el texto que el documento SÍ trajo y dice qué hacer', async () => {
    // Un «no se puede» sin el texto del documento deja al emprendedor sin
    // manera de saber qué número escribir.
    await expect(resolverConflicto(h.a, 'v-rango', 'aceptar')).rejects.toThrow(
      /de \$800 a \$900/,
    );
    await expect(resolverConflicto(h.a, 'v-rango', 'aceptar')).rejects.toThrow(
      /rango, no un precio/i,
    );
    await expect(resolverConflicto(h.a, 'v-rango', 'aceptar')).rejects.toThrow(/descarta/i);
  });

  it('DESCARTAR sí funciona: la salida honesta existe y no se cerró', async () => {
    const { row } = await resolverConflicto(h.a, 'v-rango', 'descartar');
    expect(row.value).toBe(850);
    expect(row.active).toBe(true);
    expect(row.conflict_at).toBeNull();
  });

  it('escribir el número a mano también la resuelve', async () => {
    // La otra salida que el mensaje de error ofrece. Si ésta no funcionara, el
    // error sería un callejón sin salida.
    const row = await editarValor(h.a, 'v-rango', { value: 875 });
    expect(row.value).toBe(875);
    expect(row.conflict_at).toBeNull();
  });

  it('el mismo predicado que apaga el botón es el que rechaza la escritura', async () => {
    // La UI espeja esta regla para deshabilitar «Aceptar». Que sea UNA regla y
    // no dos parecidas es lo que evita que se separen con el tiempo.
    expect(propuestaSinCifra(await obtenerValor(h.a, 'v-rango'))).toBe(true);
  });

  it('una propuesta CON cifra no se toca: el arreglo no cerró de más', async () => {
    h.db.sembrar('canonical_values', [
      valor(h.a.tenantId, { ...CONFLICTO_VACIO, id: 'v-cifra', key: 'seguimiento', conflict_value: 900 }),
    ]);
    expect(propuestaSinCifra(await obtenerValor(h.a, 'v-cifra'))).toBe(false);

    const { row } = await resolverConflicto(h.a, 'v-cifra', 'aceptar');
    expect(row.value).toBe(900);
    expect(row.active).toBe(true);
  });

  it('una propuesta con TEXTO pero sin número sigue siendo aceptable', async () => {
    // `value_text` es con qué reemplazar. Un `date` o un `text` viven ahí.
    h.db.sembrar('canonical_values', [
      valor(h.a.tenantId, {
        ...CONFLICTO_VACIO,
        id: 'v-texto',
        key: 'horario',
        kind: 'text',
        value: null,
        value_text: 'Lunes a viernes',
        conflict_value_text: 'Lunes a sábado',
      }),
    ]);
    expect(propuestaSinCifra(await obtenerValor(h.a, 'v-texto'))).toBe(false);

    const { row } = await resolverConflicto(h.a, 'v-texto', 'aceptar');
    expect(row.value_text).toBe('Lunes a sábado');
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
