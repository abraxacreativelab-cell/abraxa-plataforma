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
import { etiquetaDesdeClave, parsePricingDoc } from './money';

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
  note: string | null;
  /** De dónde salió. La UI lo muestra: el emprendedor decide mejor sabiéndolo. */
  origen: 'deterministico' | 'modelo';
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
  const porClave = new Map<
    string,
    { kind: VaultKind; value: number | null; value_text: string | null; label: string; note: string | null; origen: 'deterministico' | 'modelo' }
  >();

  for (const c of cifras) {
    porClave.set(c.key, {
      kind: c.kind,
      value: c.value,
      value_text: null,
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
      label: v.label || etiquetaDesdeClave(v.key),
      note: v.note,
      origen: 'modelo',
    });
  }

  // ── 5. Crear los valores. TODOS en borrador ───────────────────────────────
  const valores: ValorPropuesto[] = [];
  const db = tenantDb(ctx);
  let posicion = 0;

  for (const [key, v] of porClave) {
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
          currency: 'MXN',
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
        },
        { onConflict: 'tenant_id,key,scope_type,scope_id' },
      )
      .select('id, key, label, kind, value, value_text, note')
      .maybeSingle();

    if (error) {
      console.warn(`[vault] no se pudo proponer '${key}': ${error.message}`);
      continue;
    }
    if (!data) continue;

    const fila = data as { id: string; key: string; label: string; kind: VaultKind; value: number | null; value_text: string | null; note: string | null };
    valores.push({ ...fila, origen: v.origen });
  }

  if (cifras.length === 0 && valores.length === 0) {
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
    indexado,
    huecos,
    avisos,
  };
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
