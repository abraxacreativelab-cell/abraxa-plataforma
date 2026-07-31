/**
 * Criterios observables #4 y #5 del handoff:
 *
 *   4. Pegar un documento con precios crea el documento, sus chunks embebidos,
 *      y valores en `active=false`. NINGUNO se activa solo.
 *   5. Aprobar un valor lo pone `active=true` y aparece en la siguiente
 *      resolución del tenant.
 *
 * Todo este archivo corre SIN credenciales de IA, a propósito: es la prueba de
 * que la ingesta funciona con la cuenta de OpenAI vacía y sin llave de
 * Anthropic. Los números salen de un regex, no de un modelo.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { injectIntoPrompt } from '../agent-inject';
import { listarDocumentos, obtenerDocumento } from '../documents/service';
import { resolveVault } from '../resolver';
import { ctxSoloLectura, montar, TENANT_A, type Harness } from '../testing/harness';
import { aprobarValor, listarValores } from '../values/service';
import { noopClassifier, type DocClassifier } from './classifier';
import { ingestDocument } from './pipeline';

const DOC_PRECIOS = `# Lista de precios 2026

## Servicios
- **Consulta inicial** (consulta_inicial): $850 — incluye diagnóstico
- seguimiento: $600
- comision_vendedor_pct: 8%

## Costos fijos
| concepto      | monto    | nota       |
|---------------|----------|------------|
| renta_mensual | $18,000  | local Roma |
`;

let h: Harness;

// `montar()` apaga OPENAI_API_KEY y ANTHROPIC_API_KEY y las devuelve en
// `restaurar()`. Todo este archivo corre, por construccion, sin modelo.
beforeEach(() => {
  h = montar();
});

afterEach(() => h.restaurar());

describe('criterio #4 · pegar un documento con precios', () => {
  it('crea el documento, lo parte en fragmentos y propone los valores', async () => {
    const r = await ingestDocument(h.a, { content: DOC_PRECIOS }, { classifier: noopClassifier });

    // El documento existe.
    const doc = await obtenerDocumento(h.a, r.documentId);
    expect(doc.content).toBe(DOC_PRECIOS.trim());
    expect(doc.status).toBe('draft');

    // Se partió en fragmentos, aunque sin vector (no hay llave de OpenAI).
    expect(r.indexado.total).toBeGreaterThan(0);
    expect(r.indexado.conVector).toBe(0);
    expect(h.db.tabla('knowledge_chunks').length).toBe(r.indexado.total);

    // Y las cifras salieron del regex, no de un modelo.
    const claves = r.valores.map((v) => v.key).sort();
    expect(claves).toEqual([
      'comision_vendedor_pct',
      'consulta_inicial',
      'renta_mensual',
      'seguimiento',
    ]);
    expect(r.valores.every((v) => v.origen === 'deterministico')).toBe(true);
    expect(r.clasificadoPor).toBe('ninguno');
  });

  it('NINGÚN valor se activa solo', async () => {
    // La línea que no se cruza. Sin bandera para saltársela, sin "si la
    // confianza es alta": un número que ningún humano aprobó no puede llegar
    // a un contrato.
    await ingestDocument(h.a, { content: DOC_PRECIOS }, { classifier: noopClassifier });

    const todos = await listarValores(h.a);
    expect(todos.length).toBe(4);
    expect(todos.every((v) => v.active === false)).toBe(true);
    expect(todos.every((v) => v.approved_at == null)).toBe(true);
  });

  it('lo recién ingerido NO llega al prompt de un agente', async () => {
    await ingestDocument(h.a, { content: DOC_PRECIOS }, { classifier: noopClassifier });
    const prompt = await injectIntoPrompt(h.a, 'Eres el asistente.');
    expect(prompt).toBe('Eres el asistente.');
  });

  it('cada valor recuerda de qué documento salió', async () => {
    // Sin esto, la proyección deja de ser una proyección y se vuelve un dato
    // inventado con mejor reputación.
    const r = await ingestDocument(h.a, { content: DOC_PRECIOS }, { classifier: noopClassifier });
    const valores = await listarValores(h.a);
    expect(valores.every((v) => v.source_doc_id === r.documentId)).toBe(true);
  });

  it('avisa con honestidad que no pudo indexar por significado', async () => {
    const r = await ingestDocument(h.a, { content: DOC_PRECIOS }, { classifier: noopClassifier });
    expect(r.avisos.join(' ')).toMatch(/no se pudo indexar por significado/i);
  });

  it('el título sale del primer encabezado si nadie lo da', async () => {
    const r = await ingestDocument(h.a, { content: DOC_PRECIOS }, { classifier: noopClassifier });
    expect(r.title).toBe('Lista de precios 2026');
  });

  it('rechaza un documento vacío en vez de crear basura', async () => {
    await expect(
      ingestDocument(h.a, { content: '   ' }, { classifier: noopClassifier }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('quien no puede editar Dirección no puede ingerir', async () => {
    await expect(
      ingestDocument(ctxSoloLectura(TENANT_A), { content: DOC_PRECIOS }, { classifier: noopClassifier }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('criterio #5 · aprobar propaga', () => {
  it('aprobar pone active=true y el valor aparece en la siguiente resolución', async () => {
    const r = await ingestDocument(h.a, { content: DOC_PRECIOS }, { classifier: noopClassifier });
    const propuesto = r.valores.find((v) => v.key === 'consulta_inicial');
    expect(propuesto).toBeDefined();

    // Antes: no existe para nadie.
    expect((await resolveVault(h.a))?.values['valor.consulta_inicial']).toBeUndefined();

    const { row, propagado } = await aprobarValor(h.a, propuesto!.id);
    expect(row.active).toBe(true);
    expect(row.approved_by).toBe(h.a.userEmail);
    // El toast tiene que decir QUÉ se propagó, no un "guardado".
    expect(propagado).toBe('{valor.consulta_inicial} → $850');

    // Después: ya está vigente, y la caché no lo esconde.
    expect((await resolveVault(h.a))?.values['valor.consulta_inicial']).toBe('$850');

    // Y el agente ya lo puede citar.
    expect(await injectIntoPrompt(h.a, 'Eres el asistente.')).toContain('$850');
  });

  it('aprobar uno no aprueba los demás', async () => {
    const r = await ingestDocument(h.a, { content: DOC_PRECIOS }, { classifier: noopClassifier });
    await aprobarValor(h.a, r.valores[0]!.id);

    const borradores = await listarValores(h.a, { soloBorradores: true });
    expect(borradores).toHaveLength(3);
  });

  it('quien sólo lee no puede aprobar', async () => {
    const r = await ingestDocument(h.a, { content: DOC_PRECIOS }, { classifier: noopClassifier });
    await expect(
      aprobarValor(ctxSoloLectura(TENANT_A), r.valores[0]!.id),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('reingerir el mismo documento', () => {
  it('actualiza la propuesta en vez de duplicarla', async () => {
    await ingestDocument(h.a, { content: DOC_PRECIOS }, { classifier: noopClassifier });
    await ingestDocument(
      h.a,
      { content: DOC_PRECIOS.replace('$850', '$900') },
      { classifier: noopClassifier },
    );

    const consultas = (await listarValores(h.a)).filter((v) => v.key === 'consulta_inicial');
    expect(consultas).toHaveLength(1);
    expect(consultas[0]?.value).toBe(900);
  });
});

describe('con clasificador · el modelo aporta, no manda', () => {
  const clasificadorFalso: DocClassifier = {
    nombre: 'prueba',
    async clasificar() {
      return {
        areaSlug: 'operaciones',
        docType: 'manual',
        title: 'Recetario de la casa',
        confidence: 0.9,
        valores: [
          { key: 'aforo', kind: 'number', value: 40, value_text: null, label: 'Aforo', note: null },
          // El modelo insiste en un monto: se ignora a propósito.
          { key: 'renta_mensual', kind: 'number', value: 1, value_text: null, label: 'Renta', note: null },
        ],
      };
    },
  };

  it('usa área, tipo y título del modelo', async () => {
    const r = await ingestDocument(h.a, { content: DOC_PRECIOS }, { classifier: clasificadorFalso });
    expect(r.areaSlug).toBe('operaciones');
    expect(r.docType).toBe('manual');
    expect(r.title).toBe('Recetario de la casa');
    expect(r.confidence).toBe(0.9);
  });

  it('el valor determinista GANA sobre el del modelo en la misma clave', async () => {
    // El regex leyó $18,000 del texto; el modelo dedujo 1. Gana el que leyó.
    const r = await ingestDocument(h.a, { content: DOC_PRECIOS }, { classifier: clasificadorFalso });
    const renta = r.valores.find((v) => v.key === 'renta_mensual');
    expect(renta?.value).toBe(18000);
    expect(renta?.origen).toBe('deterministico');
  });

  it('los valores nuevos del modelo entran marcados como suyos, y en borrador', async () => {
    const r = await ingestDocument(h.a, { content: DOC_PRECIOS }, { classifier: clasificadorFalso });
    const aforo = r.valores.find((v) => v.key === 'aforo');
    expect(aforo?.origen).toBe('modelo');
    expect((await listarValores(h.a)).every((v) => !v.active)).toBe(true);
  });

  it('lo que el emprendedor escribe gana sobre el modelo', async () => {
    const r = await ingestDocument(
      h.a,
      { content: DOC_PRECIOS, title: 'Mis precios', areaSlug: 'ventas' },
      { classifier: clasificadorFalso },
    );
    expect(r.title).toBe('Mis precios');
    expect(r.areaSlug).toBe('ventas');
  });
});

describe('un documento sin cifras', () => {
  it('se guarda igual y lo dice claro', async () => {
    const r = await ingestDocument(
      h.a,
      { content: '# Nuestra historia\n\nAbrimos en 2019 en la colonia Roma.' },
      { classifier: noopClassifier },
    );
    expect(r.valores).toHaveLength(0);
    expect(r.avisos.join(' ')).toMatch(/No se encontraron cifras/i);
    expect(await listarDocumentos(h.a)).toHaveLength(1);
  });
});
