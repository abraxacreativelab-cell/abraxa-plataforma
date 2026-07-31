/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Criterio observable #8 — EL QUE MÁS IMPORTA.
 *
 *  «Un tenant NO puede leer documentos ni valores de otro. Test automatizado.»
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Es la única garantía real de aislamiento entre clientes que paga. Todo lo
 *  demás de este paquete puede degradarse; esto no.
 *
 *  Se prueba por todas las superficies, no sólo por una: valores, documentos,
 *  versiones, búsqueda, huecos, la resolución que alimenta a los agentes, la
 *  ingesta y las escrituras. Una fuga por cualquiera de ellas es la misma
 *  fuga.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buscar } from './documents/search';
import {
  crearDocumento,
  editarDocumento,
  listarDocumentos,
  listarVersiones,
  obtenerDocumento,
} from './documents/service';
import { detectGapsDetallado } from './industry/gaps';
import { injectIntoPrompt } from './agent-inject';
import { resolveVault } from './resolver';
import { montar, valor, type Harness } from './testing/harness';
import { vaultService } from './vault-port';
import { aprobarValor, borrarValor, editarValor, listarValores, obtenerValor } from './values/service';

let h: Harness;

const SECRETO = 999_999;

beforeEach(async () => {
  h = montar();

  // El tenant B tiene un precio que el A jamás debe ver.
  h.db.sembrar('canonical_values', [
    valor(h.b.tenantId, { id: 'val-de-b', key: 'precio_confidencial', label: 'Precio confidencial', value: SECRETO }),
  ]);

  // Y un documento con una frase inconfundible.
  await crearDocumento(h.b, {
    title: 'Estrategia confidencial de Despacho Ríos',
    content: 'Nuestro margen real es del 62% y el cliente ancla es Grupo Cortés.',
    docType: 'otro',
    areaSlug: 'direccion',
    status: 'active',
  });
});

afterEach(() => h.restaurar());

describe('valores canónicos', () => {
  it('A no ve los valores de B al listarlos', async () => {
    const deA = await listarValores(h.a);
    expect(deA).toHaveLength(0);

    const deB = await listarValores(h.b);
    expect(deB).toHaveLength(1);
    expect(deB[0]?.value).toBe(SECRETO);
  });

  it('A no puede leer un valor de B ni sabiendo su id', async () => {
    // El id no es un secreto: puede filtrarse por un log, una URL o un error.
    // Que conocerlo no sirva de nada es justo lo que hace seguro el diseño.
    await expect(obtenerValor(h.a, 'val-de-b')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(obtenerValor(h.b, 'val-de-b')).resolves.toMatchObject({ value: SECRETO });
  });

  it('A no puede editar un valor de B ni sabiendo su id', async () => {
    await expect(editarValor(h.a, 'val-de-b', { value: 1 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    // Y el valor de B sigue intacto.
    await expect(obtenerValor(h.b, 'val-de-b')).resolves.toMatchObject({ value: SECRETO });
  });

  it('A no puede borrar un valor de B', async () => {
    await borrarValor(h.a, 'val-de-b');
    await expect(obtenerValor(h.b, 'val-de-b')).resolves.toMatchObject({ value: SECRETO });
  });

  it('A no puede aprobar un borrador de B', async () => {
    h.db.sembrar('canonical_values', [
      valor(h.b.tenantId, { id: 'borrador-de-b', key: 'otro_precio', active: false }),
    ]);
    await expect(aprobarValor(h.a, 'borrador-de-b')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const deB = await listarValores(h.b, { soloBorradores: true });
    expect(deB.map((v) => v.key)).toContain('otro_precio');
  });
});

describe('la resolución que alimenta a los agentes', () => {
  it('el mapa de A no contiene nada de B', async () => {
    const r = await resolveVault(h.a);
    expect(r?.values['valor.precio_confidencial']).toBeUndefined();
    expect(JSON.stringify(r?.values ?? {})).not.toContain(String(SECRETO));
  });

  it('el prompt del agente de A no menciona el precio de B', async () => {
    // Es la fuga con peor cara: el agente de una empresa citándole a su
    // cliente el precio de otra.
    const prompt = await injectIntoPrompt(h.a, 'Eres el asistente.');
    expect(prompt).not.toContain('999,999');
    expect(prompt).not.toContain('precio_confidencial');
  });

  it('cada tenant ve sus propios metadatos de marca', async () => {
    expect((await resolveVault(h.a))?.values['empresa.nombre']).toBe('Taquería La Nueva');
    expect((await resolveVault(h.b))?.values['empresa.nombre']).toBe('Despacho Ríos');
  });
});

describe('documentos y biblioteca', () => {
  it('A no ve los documentos de B', async () => {
    expect(await listarDocumentos(h.a)).toHaveLength(0);
    expect(await listarDocumentos(h.b)).toHaveLength(1);
  });

  it('A no puede abrir un documento de B ni con su id', async () => {
    const [doc] = await listarDocumentos(h.b);
    expect(doc).toBeDefined();
    await expect(obtenerDocumento(h.a, doc!.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('A no puede editar un documento de B', async () => {
    const [doc] = await listarDocumentos(h.b);
    await expect(editarDocumento(h.a, doc!.id, { content: 'pisado' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const intacto = await obtenerDocumento(h.b, doc!.id);
    expect(intacto.content).toContain('Grupo Cortés');
  });

  it('A no ve las versiones de un documento de B', async () => {
    const [doc] = await listarDocumentos(h.b);
    await editarDocumento(h.b, doc!.id, { content: 'Versión dos del secreto.' });
    expect(await listarVersiones(h.b, doc!.id)).toHaveLength(1);
    expect(await listarVersiones(h.a, doc!.id)).toHaveLength(0);
  });
});

describe('búsqueda', () => {
  it('A no encuentra el documento de B ni buscando sus palabras exactas', async () => {
    const r = await buscar(h.a, 'Grupo Cortés margen');
    expect(r.hits).toHaveLength(0);

    // Y B sí lo encuentra: la prueba no pasa por estar rota.
    const propio = await buscar(h.b, 'Grupo Cortés margen');
    expect(propio.hits.length).toBeGreaterThan(0);
  });
});

describe('huecos e ingesta', () => {
  it('los huecos de A se calculan sólo con lo de A', async () => {
    // A es restaurante y no tiene nada: le falta todo lo de su giro.
    const gapsA = await detectGapsDetallado(h.a);
    expect(gapsA.length).toBeGreaterThan(0);

    // El documento de B no puede tapar un hueco de A.
    const direccionA = gapsA.find((g) => g.areaSlug === 'direccion');
    const totalA = gapsA.reduce((n, g) => n + g.missingDocs.length + g.missingValues.length, 0);
    expect(totalA).toBeGreaterThan(0);
    expect(direccionA?.missingDocs.some((d) => d.title.includes('Ríos'))).toBeFalsy();
  });

  it('lo que A ingiere queda en A', async () => {
    const r = await vaultService.ingestDocument(h.a, {
      content: '# Menú\n- ticket_promedio: $250',
      title: 'Menú',
    });
    expect(r.valueIds.length).toBeGreaterThan(0);

    expect((await listarValores(h.b)).map((v) => v.key)).not.toContain('ticket_promedio');
    expect((await listarDocumentos(h.b))).toHaveLength(1);
  });
});

describe('el port cruzado respeta el mismo límite', () => {
  it('vaultService.resolve() de A no filtra nada de B', async () => {
    const mapa = await vaultService.resolve(h.a);
    expect(JSON.stringify(mapa)).not.toContain(String(SECRETO));
  });

  it('vaultService.detectGaps() de A no menciona documentos de B', async () => {
    const gaps = await vaultService.detectGaps(h.a);
    expect(JSON.stringify(gaps)).not.toContain('Ríos');
  });
});
