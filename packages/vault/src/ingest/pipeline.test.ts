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
import { ctxSoloLectura, montar, TENANT_A, valor, type Harness } from '../testing/harness';
import {
  aprobarValor,
  contarConflictos,
  desactivarValor,
  editarValor,
  listarValores,
  obtenerValor,
  resolverConflicto,
} from '../values/service';
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

describe('la moneda viaja con la cifra', () => {
  const DOC_USD = `# Tabulador para clientes en EE. UU.

- setup_internacional: $1,200 USD — pago único
- iguala_internacional: USD 800
- iva_pct: 16%
`;

  it('un monto en dólares se guarda en dólares, no en pesos', async () => {
    // El defecto que esto cierra: el pipeline escribía currency:'MXN' fijo, así
    // que $1,200 USD entraba a la bóveda como $1,200 MXN. A ~18 pesos por
    // dólar, el contrato salía con veinte mil pesos de menos y nadie lo veía.
    await ingestDocument(h.a, { content: DOC_USD }, { classifier: noopClassifier });

    const porClave = Object.fromEntries((await listarValores(h.a)).map((v) => [v.key, v]));
    expect(porClave.setup_internacional?.currency).toBe('USD');
    expect(porClave.iguala_internacional?.currency).toBe('USD');
  });

  it('lo que se propaga al aprobar dice la moneda correcta', async () => {
    const r = await ingestDocument(h.a, { content: DOC_USD }, { classifier: noopClassifier });
    const setup = r.valores.find((v) => v.key === 'setup_internacional');
    expect(setup?.currency).toBe('USD');

    const { propagado } = await aprobarValor(h.a, setup!.id);
    // El marcador exacto lo pone el ICU de Node y varía entre versiones ("US$"
    // o "USD"). Lo que no puede variar es que NO diga "$1,200" a secas, que es
    // lo que el cliente leería como pesos.
    expect(propagado).toMatch(/US\$|USD/);
    expect(propagado).not.toMatch(/→ \$1,200$/);

    expect((await resolveVault(h.a))?.values['valor.setup_internacional']).toMatch(/US\$|USD/);
  });

  it('un documento sin señal de moneda sigue siendo en pesos', async () => {
    await ingestDocument(h.a, { content: DOC_PRECIOS }, { classifier: noopClassifier });
    const valores = await listarValores(h.a);
    expect(valores.every((v) => v.currency === 'MXN')).toBe(true);
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

/**
 * El corolario de «nada se activa solo»: lo que una persona aprobó tampoco se
 * apaga ni se pisa solo.
 *
 * El caso real: el emprendedor aprueba su lista de precios en enero. En junio
 * pega la lista nueva. Antes de este arreglo, el upsert de la ingesta escribía
 * el precio nuevo Y ponía active=false — así que el precio aprobado cambiaba y
 * además dejaba de propagarse, sin que nadie lo decidiera ni se enterara.
 */
describe('un documento nuevo NO pisa lo que ya se aprobó', () => {
  /** Aprueba `consulta_inicial` a $850 y devuelve su id. */
  async function aprobarConsultaInicial(): Promise<string> {
    const r = await ingestDocument(h.a, { content: DOC_PRECIOS }, { classifier: noopClassifier });
    const propuesto = r.valores.find((v) => v.key === 'consulta_inicial')!;
    await aprobarValor(h.a, propuesto.id);
    return propuesto.id;
  }

  it('el valor aprobado sigue vigente, con su cifra, y lo nuevo queda en conflicto', async () => {
    const id = await aprobarConsultaInicial();

    const r = await ingestDocument(
      h.a,
      { content: DOC_PRECIOS.replace('$850', '$900') },
      { classifier: noopClassifier },
    );

    const vigente = await obtenerValor(h.a, id);
    expect(vigente.value).toBe(850);
    expect(vigente.active).toBe(true);
    expect(vigente.approved_by).toBe(h.a.userEmail);

    // Y la contradicción quedó anotada, no aplicada.
    expect(vigente.conflict_value).toBe(900);
    expect(vigente.conflict_at).toBeTruthy();
    expect(vigente.conflict_doc_id).toBe(r.documentId);

    expect(r.conflictos).toHaveLength(1);
    expect(r.conflictos[0]).toMatchObject({
      key: 'consulta_inicial',
      vigente: { value: 850 },
      propuesto: { value: 900 },
    });
  });

  it('el agente sigue citando el precio aprobado mientras nadie decida', async () => {
    // Lo que de verdad se está protegiendo. Sin esto, un agente empieza a
    // cotizar $900 porque alguien pegó un PDF.
    await aprobarConsultaInicial();
    await ingestDocument(
      h.a,
      { content: DOC_PRECIOS.replace('$850', '$900') },
      { classifier: noopClassifier },
    );

    expect((await resolveVault(h.a))?.values['valor.consulta_inicial']).toBe('$850');
    expect(await injectIntoPrompt(h.a, 'Eres el asistente.')).toContain('$850');
  });

  it('lo dice en los avisos en vez de callárselo', async () => {
    await aprobarConsultaInicial();
    const r = await ingestDocument(
      h.a,
      { content: DOC_PRECIOS.replace('$850', '$900') },
      { classifier: noopClassifier },
    );
    expect(r.avisos.join(' ')).toMatch(/contradice/i);
    expect(r.avisos.join(' ')).toContain('{valor.consulta_inicial}');
  });

  it('cambiar SÓLO la moneda también es una contradicción', async () => {
    // $850 y US$850 no son el mismo número aunque el dígito coincida.
    const id = await aprobarConsultaInicial();
    const r = await ingestDocument(
      h.a,
      { content: DOC_PRECIOS.replace('$850', '$850 USD') },
      { classifier: noopClassifier },
    );

    expect(r.conflictos.map((c) => c.key)).toContain('consulta_inicial');
    const vigente = await obtenerValor(h.a, id);
    expect(vigente.currency).toBe('MXN');
    expect(vigente.conflict_currency).toBe('USD');
  });

  it('un documento que CONFIRMA lo aprobado no genera conflicto', async () => {
    const id = await aprobarConsultaInicial();
    const r = await ingestDocument(h.a, { content: DOC_PRECIOS }, { classifier: noopClassifier });

    expect(r.conflictos).toHaveLength(0);
    const vigente = await obtenerValor(h.a, id);
    expect(vigente.active).toBe(true);
    expect(vigente.conflict_at).toBeNull();
  });

  it('reingerir el original después de una contradicción la retira', async () => {
    const id = await aprobarConsultaInicial();
    await ingestDocument(
      h.a,
      { content: DOC_PRECIOS.replace('$850', '$900') },
      { classifier: noopClassifier },
    );
    expect((await obtenerValor(h.a, id)).conflict_at).toBeTruthy();

    await ingestDocument(h.a, { content: DOC_PRECIOS }, { classifier: noopClassifier });
    expect((await obtenerValor(h.a, id)).conflict_at).toBeNull();
  });

  it('los BORRADORES sí se sobrescriben: nadie respondió por ellos todavía', async () => {
    // La regla protege lo aprobado, no lo propuesto. Si un borrador también se
    // volviera conflicto, reingerir un documento en el que se trabaja dejaría
    // una fila que resolver por cada guardado.
    const r1 = await ingestDocument(h.a, { content: DOC_PRECIOS }, { classifier: noopClassifier });
    const id = r1.valores.find((v) => v.key === 'consulta_inicial')!.id;

    const r2 = await ingestDocument(
      h.a,
      { content: DOC_PRECIOS.replace('$850', '$900') },
      { classifier: noopClassifier },
    );

    expect(r2.conflictos).toHaveLength(0);
    const fila = await obtenerValor(h.a, id);
    expect(fila.value).toBe(900);
    expect(fila.active).toBe(false);
  });

  it('un valor devuelto a borrador vuelve a comportarse como borrador', async () => {
    const id = await aprobarConsultaInicial();
    await desactivarValor(h.a, id);

    const r = await ingestDocument(
      h.a,
      { content: DOC_PRECIOS.replace('$850', '$900') },
      { classifier: noopClassifier },
    );

    expect(r.conflictos).toHaveLength(0);
    expect((await obtenerValor(h.a, id)).value).toBe(900);
  });
});

describe('resolver la contradicción · la decide una persona', () => {
  async function conConflicto(): Promise<string> {
    const r1 = await ingestDocument(h.a, { content: DOC_PRECIOS }, { classifier: noopClassifier });
    const id = r1.valores.find((v) => v.key === 'consulta_inicial')!.id;
    await aprobarValor(h.a, id);
    await ingestDocument(
      h.a,
      { content: DOC_PRECIOS.replace('$850', '$900') },
      { classifier: noopClassifier },
    );
    return id;
  }

  it('aceptar aplica la cifra nueva, la aprueba y apaga el conflicto', async () => {
    const id = await conConflicto();
    const { row, propagado } = await resolverConflicto(h.a, id, 'aceptar');

    expect(row.value).toBe(900);
    expect(row.active).toBe(true);
    expect(row.approved_by).toBe(h.a.userEmail);
    expect(row.conflict_at).toBeNull();
    expect(propagado).toBe('{valor.consulta_inicial} → $900');

    expect((await resolveVault(h.a))?.values['valor.consulta_inicial']).toBe('$900');
  });

  it('aceptar mueve la trazabilidad al documento que trajo la cifra', async () => {
    const id = await conConflicto();
    const previo = await obtenerValor(h.a, id);
    const { row } = await resolverConflicto(h.a, id, 'aceptar');
    expect(row.source_doc_id).toBe(previo.conflict_doc_id);
  });

  it('descartar deja todo como estaba y apaga el conflicto', async () => {
    const id = await conConflicto();
    const { row } = await resolverConflicto(h.a, id, 'descartar');

    expect(row.value).toBe(850);
    expect(row.active).toBe(true);
    expect(row.conflict_at).toBeNull();
    expect((await resolveVault(h.a))?.values['valor.consulta_inicial']).toBe('$850');
  });

  it('editar la cifra a mano también retira la contradicción', async () => {
    // Ya decidió: escribió el número él mismo. Volver a preguntarle sería
    // enseñarle a ignorar el aviso.
    const id = await conConflicto();
    const row = await editarValor(h.a, id, { value: 875 });
    expect(row.value).toBe(875);
    expect(row.conflict_at).toBeNull();
  });

  it('resolver algo que ya no está en conflicto lo dice, no finge', async () => {
    const id = await conConflicto();
    await resolverConflicto(h.a, id, 'descartar');
    await expect(resolverConflicto(h.a, id, 'aceptar')).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('quien sólo lee no puede resolver una contradicción', async () => {
    const id = await conConflicto();
    await expect(
      resolverConflicto(ctxSoloLectura(TENANT_A), id, 'aceptar'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('se pueden listar y contar los que esperan decisión', async () => {
    await conConflicto();
    expect(await contarConflictos(h.a)).toBe(1);
    const enConflicto = await listarValores(h.a, { soloConflictos: true });
    expect(enConflicto.map((v) => v.key)).toEqual(['consulta_inicial']);
  });
});

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Una propuesta SIN cifra no puede vaciar un precio aprobado.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * El defecto que esto cierra, entero:
 *
 *   `consulta_inicial` está aprobado en $850 y lo citan los agentes. Llega un
 *   documento que dice «de $800 a $900 — según el caso». `money.ts` hace lo
 *   correcto (regla 2: un rango no tiene valor único) y devuelve `value: null`.
 *   Pero `mismoValor(850, null)` es `false`, así que el pipeline lo marcaba
 *   como CONTRADICCIÓN con `conflict_value = NULL`.
 *
 *   La UI entonces decía «Un documento nuevo dice —» y ofrecía los dos botones
 *   de siempre. El emprendedor pulsaba ACEPTAR —acababa de leer «decide tú cuál
 *   se queda» y tenía el documento enfrente— y `resolverConflicto` escribía
 *   `value: null` MÁS `active: true`. El $850 desaparecía sin historial (los
 *   valores no tienen versiones), `formatVault` devolvía '', el agente dejaba
 *   de saber el precio y la siguiente cotización salía diciendo
 *   «El costo de la consulta inicial es de .» — con un ok verde y un
 *   «Actualizado y propagado» de por medio.
 *
 * La asimetría que lo delataba: `crearValorSchema` prohíbe expresamente guardar
 * un `money` sin número a mano, y esta ruta escribía exactamente eso.
 */
describe('un documento MENOS PRECISO no vacía lo que ya se aprobó', () => {
  /** El mismo documento, pero con la consulta expresada como rango. */
  const DOC_RANGO = DOC_PRECIOS.replace(
    '$850 — incluye diagnóstico',
    'de $800 a $900 — según el caso',
  );

  /** El mismo documento, pero con la consulta declarada pendiente. */
  const DOC_PENDIENTE = DOC_PRECIOS.replace('$850 — incluye diagnóstico', 'por definir');

  /** Aprueba `consulta_inicial` a $850 y devuelve su id. */
  async function aprobada(): Promise<string> {
    const r = await ingestDocument(h.a, { content: DOC_PRECIOS }, { classifier: noopClassifier });
    const id = r.valores.find((v) => v.key === 'consulta_inicial')!.id;
    await aprobarValor(h.a, id);
    return id;
  }

  it('EL ESCENARIO DEL HALLAZGO: un rango jamás deja el precio vigente y VACÍO', async () => {
    const id = await aprobada();
    await ingestDocument(h.a, { content: DOC_RANGO }, { classifier: noopClassifier });

    // Pulsar «Aceptar» tiene que fallar, diga lo que diga la pantalla: no hay
    // ninguna cifra que aplicar. Da igual por cuál de las dos capas se caiga
    // —no se marcó conflicto, o el conflicto no trae número—: las dos son
    // VALIDATION y las dos dejan el $850 intacto.
    await expect(resolverConflicto(h.a, id, 'aceptar')).rejects.toMatchObject({
      code: 'VALIDATION',
    });

    // Y lo único que de verdad importa: el precio sigue ahí.
    const vigente = await obtenerValor(h.a, id);
    expect(vigente.value).toBe(850);
    expect(vigente.active).toBe(true);

    // El agente y las plantillas siguen sabiéndolo. Sin esto, la cotización
    // sale con «El costo de la consulta inicial es de .».
    expect((await resolveVault(h.a))?.values['valor.consulta_inicial']).toBe('$850');
    expect(await injectIntoPrompt(h.a, 'Eres el asistente.')).toContain('$850');
  });

  it('un rango NO se marca como contradicción: no contradice, sólo es más vago', async () => {
    const id = await aprobada();
    const r = await ingestDocument(h.a, { content: DOC_RANGO }, { classifier: noopClassifier });

    expect(r.conflictos).toHaveLength(0);
    expect(await contarConflictos(h.a)).toBe(0);
    expect((await obtenerValor(h.a, id)).conflict_at).toBeNull();
  });

  it('pero se dice en los avisos, con lo que el documento traía', async () => {
    // Callárselo sería peor que el defecto: el emprendedor creería que su
    // documento no decía nada de la consulta inicial.
    await aprobada();
    const r = await ingestDocument(h.a, { content: DOC_RANGO }, { classifier: noopClassifier });

    const texto = r.avisos.join(' ');
    expect(texto).toContain('{valor.consulta_inicial}');
    expect(texto).toMatch(/sin una cifra única/i);
    expect(texto).toContain('$800');
  });

  it('un «por definir» tampoco borra un precio aprobado', async () => {
    const id = await aprobada();
    const r = await ingestDocument(h.a, { content: DOC_PENDIENTE }, { classifier: noopClassifier });

    expect(r.conflictos).toHaveLength(0);
    expect((await obtenerValor(h.a, id)).value).toBe(850);
    expect((await resolveVault(h.a))?.values['valor.consulta_inicial']).toBe('$850');
  });

  it('una contradicción DE VERDAD sigue marcándose: esto no apagó la función', async () => {
    // El riesgo de este arreglo es cerrar de más. $900 contra $850 sí es una
    // contradicción y tiene que seguir pidiendo decisión.
    const id = await aprobada();
    const r = await ingestDocument(
      h.a,
      { content: DOC_PRECIOS.replace('$850', '$900') },
      { classifier: noopClassifier },
    );

    expect(r.conflictos).toHaveLength(1);
    const { row } = await resolverConflicto(h.a, id, 'aceptar');
    expect(row.value).toBe(900);
    expect(row.active).toBe(true);
  });

  it('LA INVARIANTE: toda contradicción marcada trae con qué reemplazar', async () => {
    // De esto depende la pantalla: si un conflicto puede no traer cifra,
    // «Aceptar» puede significar «bórralo».
    //
    // El documento mezcla los tres casos a propósito — un rango, un pendiente
    // y una cifra de verdad — para que el barrido no pase por vacío: tiene que
    // quedar EXACTAMENTE una contradicción, la que sí trae número.
    h.db.sembrar('canonical_values', [
      valor(h.a.tenantId, {
        id: 'v-texto',
        key: 'horario',
        label: 'Horario',
        kind: 'text',
        value: null,
        value_text: 'Lunes a viernes',
        active: true,
        approved_at: '2026-01-15T10:00:00.000Z',
        approved_by: h.a.userEmail,
        // `sembrar` escribe la fila cruda, sin los defaults del DDL: hay que
        // poner el `null` a mano o quedaría `undefined`, que no es lo que
        // devuelve Postgres.
        conflict_at: null,
      }),
    ]);

    // `consulta_inicial` a $850 y `seguimiento` a $600, los dos aprobados.
    const r0 = await ingestDocument(h.a, { content: DOC_PRECIOS }, { classifier: noopClassifier });
    for (const clave of ['consulta_inicial', 'seguimiento']) {
      await aprobarValor(h.a, r0.valores.find((v) => v.key === clave)!.id);
    }

    const r = await ingestDocument(
      h.a,
      {
        content: [
          '- **Consulta inicial** (consulta_inicial): de $800 a $900 — según el caso',
          '- seguimiento: $700',
          '- horario: por definir',
        ].join('\n'),
      },
      { classifier: noopClassifier },
    );

    // Sólo la cifra de verdad pide decisión.
    expect(r.conflictos.map((c) => c.key)).toEqual(['seguimiento']);

    const marcados = (await listarValores(h.a)).filter((v) => v.conflict_at != null);
    expect(marcados).toHaveLength(1);
    for (const v of marcados) {
      expect(
        v.conflict_value != null || v.conflict_value_text != null,
        `«${v.key}» quedó marcado en conflicto sin nada que aplicar`,
      ).toBe(true);
    }

    // Y el de texto, que vive fuera de la columna `value`, tampoco se marcó.
    expect((await obtenerValor(h.a, 'v-texto')).conflict_at).toBeNull();
  });

  it('un rango sobre un BORRADOR sigue sobrescribiendo: nadie respondió por él', async () => {
    // La regla protege lo aprobado, no lo propuesto.
    const r1 = await ingestDocument(h.a, { content: DOC_PRECIOS }, { classifier: noopClassifier });
    const id = r1.valores.find((v) => v.key === 'consulta_inicial')!.id;

    await ingestDocument(h.a, { content: DOC_RANGO }, { classifier: noopClassifier });

    const fila = await obtenerValor(h.a, id);
    expect(fila.value).toBeNull();
    expect(fila.active).toBe(false);
    // Y el texto del documento queda a la vista, que es la única pista que hay.
    expect(fila.note).toContain('$800');
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
