/**
 * ════════════════════════════════════════════════════════════════════════════
 *  INGESTA · El emprendedor pega un documento y su bóveda crece.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *      pega un documento
 *        → se clasifica: área × tipo × título × confianza     (best effort)
 *        → se guarda como documento (borrador)                 ← obligatorio
 *        → se parte en trozos y se embebe                      (best effort)
 *        → se extraen cifras de forma DETERMINISTA (regex)     ← obligatorio
 *        → se crean valores con active = false
 *        → se recalculan los huecos
 *
 *  Portado de GARDEN `abraxa/extensions/abraxa-bookkeeper/ingest.ts` (159
 *  líneas). El comentario de gobernanza de allá vale la pena repetirlo entero
 *  porque es la regla que sostiene todo el producto:
 *
 *      «El documento madre ES la fuente de verdad; los valores son una
 *       proyección. Nada se activa solo.»
 *
 *  ── Qué es obligatorio y qué es best effort ─────────────────────────────────
 *
 *  Guardar el documento y extraer sus cifras NO pueden fallar en silencio: son
 *  el trabajo. Clasificar y embeber SÍ pueden degradarse, porque dependen de
 *  proveedores externos y el emprendedor no tiene por qué perder su documento
 *  porque OpenAI se quedó sin cuota un martes.
 *
 *  Por eso `ingestDocument` funciona SIN ninguna credencial de IA: los números
 *  —lo único que de verdad no se puede alucinar— salen de `money.ts`, que es
 *  un regex.
 *
 *  ── Y la línea que no se cruza ──────────────────────────────────────────────
 *
 *  TODO VALOR EXTRAÍDO NACE CON `active = false`. Sin excepción, sin bandera
 *  para saltárselo, sin "si la confianza es alta". Un número que ningún humano
 *  aprobó no puede llegar a un contrato.
 *
 *  ── Su corolario: lo aprobado tampoco se pisa ───────────────────────────────
 *
 *  La misma regla, leída al revés. Si el emprendedor ya aprobó
 *  `consulta_inicial = $850` y meses después pega un documento que dice $900,
 *  la ingesta NO decide. Ni pisa el $850 (el agente empezaría a cotizar $900
 *  sin que nadie lo autorizara) ni lo apaga (el agente dejaría de saber su
 *  precio de un día para otro, y tampoco lo decidió nadie).
 *
 *  Lo que hace es dejar el $850 exactamente como está, guardar el $900 al lado
 *  en las columnas `conflict_*` de la 031, y devolverlo en `conflictos` para
 *  que la UI lo enseñe. La cifra vigente sigue siendo la que una persona
 *  aprobó, hasta que esa persona diga otra cosa.
 */
import { PlatformError, tenantDb } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import { notifyVaultChanged } from '../cache';
import { crearDocumento, indexarDocumento } from '../documents/service';
import { loadTenantMeta } from '../global-tables';
import { taxonomiaDe } from '../industry/catalog';
import { detectGapsDetallado } from '../industry/gaps';
import { requireVaultEdit } from '../rbac';
import type { DocType, VaultKind } from '../types';
import { clasificadorPorDefecto, type DocClassifier } from './classifier';
import { etiquetaDesdeClave, MONEDA_POR_DEFECTO, parsePricingDoc } from './money';

export interface IngestInput {
  content: string;
  /** Si el emprendedor ya lo tituló, se respeta y no se le pregunta al modelo. */
  title?: string;
  areaSlug?: string;
  docType?: DocType;
  sourceKind?: 'paste' | 'upload' | 'agent' | 'connector';
}

export interface ValorPropuesto {
  id: string;
  key: string;
  label: string;
  kind: VaultKind;
  value: number | null;
  value_text: string | null;
  /** Código ISO. Se DETECTA del documento; asumirla es cómo se envenena todo. */
  currency: string;
  note: string | null;
  /** De dónde salió. La UI lo muestra: el emprendedor decide mejor sabiéndolo. */
  origen: 'deterministico' | 'modelo';
}

/** Una cifra del documento nuevo que contradice a una que ya estaba aprobada. */
export interface ConflictoValor {
  /** El valor VIGENTE. Sigue activo y sin tocar; sólo quedó marcado. */
  id: string;
  key: string;
  label: string;
  kind: VaultKind;
  /** Lo que sigue propagándose a contratos, mensajes y agentes. */
  vigente: { value: number | null; value_text: string | null; currency: string };
  /** Lo que dice este documento. Espera una decisión humana. */
  propuesto: { value: number | null; value_text: string | null; currency: string };
}

export interface IngestResult {
  documentId: string;
  title: string;
  areaSlug: string;
  docType: DocType;
  confidence: number;
  /** Cómo se clasificó: qué modelo, o `ninguno`. Sin misterio. */
  clasificadoPor: string;
  valores: ValorPropuesto[];
  /**
   * Cifras que contradicen a un valor YA APROBADO. Ninguna se aplicó: la
   * vigente sigue vigente. Vacío es el caso normal.
   */
  conflictos: ConflictoValor[];
  indexado: { total: number; conVector: number };
  huecos: Array<{ areaSlug: string; areaLabel: string; faltanDocs: number; faltanValores: number }>;
  /** Avisos honestos: "no se indexó", "no se clasificó". La UI los enseña. */
  avisos: string[];
}

export interface IngestOpts {
  /** Inyectable para pruebas y para el día que H3 exponga un rol utilitario. */
  classifier?: DocClassifier;
}

export async function ingestDocument(
  ctx: TenantContext,
  input: IngestInput,
  opts: IngestOpts = {},
): Promise<IngestResult> {
  requireVaultEdit(ctx);

  const contenido = String(input.content ?? '').trim();
  if (!contenido) {
    throw new PlatformError('VALIDATION', 'No hay nada que ingerir: el documento está vacío.');
  }

  const avisos: string[] = [];

  // ── 1. Clasificar. Best effort ────────────────────────────────────────────
  const meta = await loadTenantMeta(ctx);
  const taxonomia = await taxonomiaDe(meta?.industryType);
  const areasValidas = taxonomia.areas.map((a) => a.slug);

  const classifier = opts.classifier ?? clasificadorPorDefecto();
  const clasificacion = await classifier.clasificar({
    content: contenido,
    areasValidas,
    descripcionNegocio: describirNegocio(meta?.name, taxonomia.name, taxonomia.blurb),
  });

  if (!clasificacion) {
    avisos.push(
      'No se pudo clasificar el documento automáticamente. Se guardó en Dirección; ' +
        'puedes moverlo de área desde la biblioteca.',
    );
  }

  const areaSlug = input.areaSlug ?? clasificacion?.areaSlug ?? areaPorDefecto(areasValidas);
  const docType = input.docType ?? clasificacion?.docType ?? 'otro';
  const title = input.title?.trim() || clasificacion?.title || tituloDesdeContenido(contenido);
  const confidence = input.title || input.areaSlug ? 1 : (clasificacion?.confidence ?? 0);

  // ── 2. Guardar el documento. Obligatorio ──────────────────────────────────
  const doc = await crearDocumento(
    ctx,
    {
      title,
      content: contenido,
      docType,
      areaSlug,
      status: 'draft',
      sourceKind: input.sourceKind ?? 'paste',
      confidence: clasificacion ? confidence : null,
    },
    // La ingesta indexa aparte, para poder decirle al emprendedor cuántos
    // fragmentos quedaron buscables y cuántos esperan al proveedor.
    { indexar: false },
  );

  // ── 3. Indexar. Best effort ───────────────────────────────────────────────
  const indexado = await indexarDocumento(ctx, doc.id, contenido);
  if (indexado.total > 0 && indexado.conVector === 0) {
    avisos.push(
      'El documento se guardó pero todavía no se pudo indexar por significado. ' +
        'Se puede buscar por palabras mientras tanto.',
    );
  } else if (indexado.conVector > 0 && indexado.conVector < indexado.total) {
    avisos.push(
      `Se indexaron ${indexado.conVector} de ${indexado.total} fragmentos. ` +
        'El resto se completa solo cuando el servicio de búsqueda se restablezca.',
    );
  }

  // ── 4. Extraer cifras. DETERMINISTA. Obligatorio ──────────────────────────
  const cifras = parsePricingDoc(contenido);

  // El determinista gana sobre el modelo cuando chocan en la misma clave: uno
  // leyó el número del texto, el otro lo dedujo.
  const porClave = new Map<string, Extraido>();

  for (const c of cifras) {
    porClave.set(c.key, {
      kind: c.kind,
      value: c.value,
      value_text: null,
      // La moneda la detectó `money.ts` leyendo el documento. Escribir 'MXN'
      // aquí a secas —como se hacía— convierte un precio en dólares en un
      // precio en pesos, y el error viaja a cada contrato que lo cite.
      currency: c.currency,
      label: c.label || etiquetaDesdeClave(c.key),
      note: c.note,
      origen: 'deterministico',
    });
  }

  for (const v of clasificacion?.valores ?? []) {
    if (porClave.has(v.key)) continue;
    porClave.set(v.key, {
      kind: v.kind,
      value: v.value,
      value_text: v.value_text,
      // El clasificador tiene prohibido devolver `money` y `percent` (ver
      // `normalizarClasificacion`), así que sus valores nunca llevan moneda.
      currency: MONEDA_POR_DEFECTO,
      label: v.label || etiquetaDesdeClave(v.key),
      note: v.note,
      origen: 'modelo',
    });
  }

  // ── 5. Crear los valores. TODOS en borrador ───────────────────────────────
  const valores: ValorPropuesto[] = [];
  const conflictos: ConflictoValor[] = [];
  /** Claves que el documento menciona sin cifra, contra un número ya aprobado. */
  const imprecisos: Array<{ key: string; dice: string | null }> = [];
  const db = tenantDb(ctx);
  let posicion = 0;

  // Qué hay ya en la bóveda para estas claves. Se lee ANTES de escribir nada:
  // sin esto no se puede saber si el upsert pisaría algo que alguien aprobó.
  const { vigentes, legible } = await leerVigentes(ctx, [...porClave.keys()]);

  if (!legible) {
    // No se pudo leer el estado previo. Escribir a ciegas podría pisar un valor
    // aprobado, que es justo lo que no se vale. El documento ya está guardado
    // —lo importante— y las cifras se vuelven a proponer al reingerir.
    avisos.push(
      'El documento se guardó, pero no se pudieron proponer sus cifras porque no ' +
        'se pudo consultar la bóveda. Vuelve a ingerirlo en un momento; no se ' +
        'perdió nada.',
    );
  }

  const aEscribir = legible ? porClave : new Map<string, Extraido>();

  for (const [key, v] of aEscribir) {
    const previo = vigentes.get(key);

    // ── El corolario de la línea que no se cruza ──
    // Un valor que una persona aprobó no lo pisa una reingesta.
    if (previo && estaAprobado(previo)) {
      if (mismoValor(previo, v)) {
        // El documento nuevo CONFIRMA lo aprobado. No hay nada que decidir, y
        // si venía marcado en conflicto, ese conflicto ya no existe.
        if (previo.conflict_at != null) await limpiarConflicto(ctx, previo.id);
        continue;
      }

      // ── Un documento MENOS PRECISO no contradice a uno más preciso ──
      //
      // El documento trae la clave pero sin nada que aplicar: era un rango
      // («de $800 a $900») o un pendiente («por definir»). Contra un valor
      // aprobado que SÍ dice algo, eso no es una contradicción — es un
      // documento que dice menos.
      //
      // Marcarlo como conflicto ponía al emprendedor a decidir entre $850 y
      // nada, con un botón «Aceptar» que vaciaba el precio. No hay nada que
      // decidir aquí: se deja lo aprobado y se avisa.
      //
      // La invariante que esto establece, y de la que depende la pantalla:
      // TODA contradicción marcada trae con qué reemplazar la cifra. Sin ella,
      // «Aceptar» puede significar «bórralo», que es justo lo que no puede
      // significar. (`propuestaSinCifra` en values/service.ts sigue defendiendo
      // las filas que la ingesta marcó ANTES de este arreglo.)
      if (
        (previo.value != null || previo.value_text != null) &&
        v.value == null &&
        !v.value_text
      ) {
        imprecisos.push({ key, dice: v.note?.trim() || null });
        continue;
      }

      const marcado = await marcarConflicto(ctx, previo.id, doc.id, v);
      if (!marcado) continue;

      conflictos.push({
        id: previo.id,
        key,
        label: previo.label,
        kind: previo.kind,
        vigente: {
          value: previo.value,
          value_text: previo.value_text,
          currency: previo.currency,
        },
        propuesto: { value: v.value, value_text: v.value_text, currency: v.currency },
      });
      continue;
    }

    const { data, error } = await db
      .from('canonical_values')
      .upsert(
        {
          key,
          label: v.label,
          kind: v.kind,
          value: v.value,
          value_text: v.value_text,
          value_json: null,
          currency: v.currency,
          note: v.note,
          area_slug: areaSlug,
          scope_type: 'tenant',
          scope_id: '',
          source_doc_id: doc.id,
          // ── LA LÍNEA QUE NO SE CRUZA ──
          // Nada que salga de un documento se activa solo. Ni con confianza
          // alta, ni con origen determinista. Lo aprueba una persona.
          active: false,
          approved_at: null,
          approved_by: null,
          position: posicion++,
          // Un borrador que se reescribe no arrastra el conflicto de antes:
          // la propuesta que lo causaba acaba de ser reemplazada.
          ...CONFLICTO_LIMPIO,
        },
        { onConflict: 'tenant_id,key,scope_type,scope_id' },
      )
      .select('id, key, label, kind, value, value_text, currency, note')
      .maybeSingle();

    if (error) {
      console.warn(`[vault] no se pudo proponer '${key}': ${error.message}`);
      continue;
    }
    if (!data) continue;

    const fila = data as Omit<ValorPropuesto, 'origen'>;
    valores.push({ ...fila, origen: v.origen });
  }

  if (conflictos.length > 0) {
    const claves = conflictos.map((c) => `{valor.${c.key}}`).join(', ');
    avisos.push(
      `Este documento contradice ${conflictos.length} número que ya habías aprobado ` +
        `(${claves}). No se cambió ninguno: lo que está vigente sigue vigente hasta ` +
        'que tú decidas. Revísalos en tus valores.',
    );
  }

  // Callarse esto sería peor que el defecto que cierra: el emprendedor vería
  // que su documento habla de la consulta inicial y que en la bóveda no pasó
  // nada, y no tendría manera de saber por qué.
  if (imprecisos.length > 0) {
    const detalle = imprecisos
      .map((i) => (i.dice ? `{valor.${i.key}} («${i.dice}»)` : `{valor.${i.key}}`))
      .join(', ');
    const n = imprecisos.length;
    avisos.push(
      `Este documento menciona ${n} número${n === 1 ? '' : 's'} que ya habías aprobado, ` +
        `pero sin una cifra única: ${detalle}. No se cambió nada —un texto más vago no ` +
        'desmiente un número que tú aprobaste—. Si quieres cambiarlo, edítalo tú.',
    );
  }

  if (
    cifras.length === 0 &&
    valores.length === 0 &&
    conflictos.length === 0 &&
    imprecisos.length === 0 &&
    legible
  ) {
    avisos.push(
      'No se encontraron cifras en el documento. Si trae precios, revisa que estén ' +
        'escritos como "- concepto: $1,500" o en una tabla.',
    );
  }

  await notifyVaultChanged(ctx.tenantId);

  // ── 6. Recalcular huecos ──────────────────────────────────────────────────
  const detalle = await detectGapsDetallado(ctx);
  const huecos = detalle.map((g) => ({
    areaSlug: g.areaSlug,
    areaLabel: g.areaLabel,
    faltanDocs: g.missingDocs.length,
    faltanValores: g.missingValues.length,
  }));

  return {
    documentId: doc.id,
    title: doc.title,
    areaSlug,
    docType,
    confidence,
    clasificadoPor: clasificacion ? classifier.nombre : 'ninguno',
    valores,
    conflictos,
    indexado,
    huecos,
    avisos,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Lo que hace falta para no pisar un valor aprobado.
// ─────────────────────────────────────────────────────────────────────────────

/** Una cifra ya lista para escribirse, venga del regex o del modelo. */
interface Extraido {
  kind: VaultKind;
  value: number | null;
  value_text: string | null;
  currency: string;
  label: string;
  note: string | null;
  origen: 'deterministico' | 'modelo';
}

/** El estado previo de una clave en la bóveda. */
interface Vigente {
  id: string;
  key: string;
  label: string;
  kind: VaultKind;
  value: number | null;
  value_text: string | null;
  currency: string;
  active: boolean;
  approved_at: string | null;
  conflict_at: string | null;
}

const COLUMNAS_VIGENTE =
  'id, key, label, kind, value, value_text, currency, active, approved_at, conflict_at';

/** Las seis columnas de conflicto, apagadas. Se escriben juntas o no se escriben. */
const CONFLICTO_LIMPIO = {
  conflict_value: null,
  conflict_value_text: null,
  conflict_currency: null,
  conflict_note: null,
  conflict_doc_id: null,
  conflict_at: null,
} as const;

/**
 * Qué hay ya en la bóveda para estas claves, en el alcance donde escribe la
 * ingesta (`tenant`/`''`).
 *
 * `legible: false` NO es lo mismo que "no hay nada": distinguirlo es el punto.
 * Si la consulta falla y se asume que la bóveda está vacía, el upsert siguiente
 * pisa valores aprobados sin que nadie lo note.
 */
async function leerVigentes(
  ctx: TenantContext,
  claves: string[],
): Promise<{ vigentes: Map<string, Vigente>; legible: boolean }> {
  const vigentes = new Map<string, Vigente>();
  if (claves.length === 0) return { vigentes, legible: true };

  const { data, error } = await tenantDb(ctx)
    .from('canonical_values')
    .select(COLUMNAS_VIGENTE)
    .eq('scope_type', 'tenant')
    .eq('scope_id', '')
    .in('key', claves);

  if (error) {
    console.warn(`[vault] no se pudo leer el estado previo de la bóveda: ${error.message}`);
    return { vigentes, legible: false };
  }

  for (const fila of (data ?? []) as Vigente[]) vigentes.set(fila.key, fila);
  return { vigentes, legible: true };
}

/**
 * `active` y `approved_at` se miran los dos a propósito.
 *
 * Un valor puede estar aprobado y desactivado a mano (`desactivarValor` limpia
 * `approved_at`), pero también puede quedar `active` sin `approved_at` si algún
 * día alguien escribe una fila por otro camino. Cualquiera de las dos señales
 * significa "aquí ya pasó una persona", y con eso basta para no pisarlo.
 */
function estaAprobado(v: Vigente): boolean {
  return v.active === true || v.approved_at != null;
}

/** ¿El documento nuevo dice lo mismo que ya estaba aprobado? */
function mismoValor(previo: Vigente, nuevo: Extraido): boolean {
  if (previo.kind !== nuevo.kind) return false;
  if (!mismoNumero(previo.value, nuevo.value)) return false;
  if ((previo.value_text ?? null) !== (nuevo.value_text ?? null)) return false;
  // La moneda es parte del valor: $850 MXN y $850 USD no son el mismo número.
  // Sólo cuenta cuando hay un monto de por medio.
  if (nuevo.kind === 'money' && (previo.currency || '') !== (nuevo.currency || '')) return false;
  return true;
}

/** `1500` y `'1500.00'` son el mismo número: PostgREST devuelve numeric como texto. */
function mismoNumero(a: number | string | null, b: number | null): boolean {
  if (a == null || b == null) return a == null && b == null;
  return Number(a) === Number(b);
}

/**
 * Deja la cifra vigente intacta y guarda la contradicción al lado.
 *
 * El `update` toca SÓLO las columnas `conflict_*`: ni `value`, ni `active`, ni
 * `approved_at`. Ésa es toda la diferencia entre este arreglo y el upsert que
 * había antes.
 */
async function marcarConflicto(
  ctx: TenantContext,
  valorId: string,
  docId: string,
  v: Extraido,
): Promise<boolean> {
  const { error } = await tenantDb(ctx)
    .from('canonical_values')
    .update({
      conflict_value: v.value,
      conflict_value_text: v.value_text,
      conflict_currency: v.currency,
      conflict_note: v.note,
      conflict_doc_id: docId,
      conflict_at: new Date().toISOString(),
    })
    .eq('id', valorId);

  if (error) {
    console.warn(`[vault] no se pudo marcar el conflicto de '${valorId}': ${error.message}`);
    return false;
  }
  return true;
}

async function limpiarConflicto(ctx: TenantContext, valorId: string): Promise<void> {
  const { error } = await tenantDb(ctx)
    .from('canonical_values')
    .update({ ...CONFLICTO_LIMPIO })
    .eq('id', valorId);
  if (error) {
    console.warn(`[vault] no se pudo limpiar el conflicto de '${valorId}': ${error.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

function describirNegocio(nombre: string | undefined, giro: string, blurb: string): string {
  const quien = nombre ? `El negocio se llama ${nombre}.` : '';
  return `${quien} Su giro es: ${giro}. ${blurb}`.trim();
}

/** Dirección si el giro la tiene; si no, la primera área que exista. */
function areaPorDefecto(areasValidas: string[]): string {
  return areasValidas.includes('direccion') ? 'direccion' : (areasValidas[0] ?? 'direccion');
}

/** El primer encabezado markdown, o la primera línea con texto. */
function tituloDesdeContenido(contenido: string): string {
  for (const linea of contenido.split('\n')) {
    const l = linea.trim();
    if (!l) continue;
    const h = l.match(/^#{1,3}\s+(.{2,160})$/);
    if (h?.[1]) return h[1].trim();
    return l.replace(/[#*_`]/g, '').slice(0, 160).trim() || 'Documento sin título';
  }
  return 'Documento sin título';
}
