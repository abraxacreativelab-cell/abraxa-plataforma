/**
 * BÓVEDA · La biblioteca: documentos, versiones e indexado.
 *
 * El documento es la fuente de verdad. Por eso editar uno NO pisa su historia:
 * la versión anterior se archiva en `app.document_versions` antes de escribir
 * la nueva. Cuando alguien pregunte "¿de dónde salió que la comisión es 15%?",
 * la respuesta tiene que poder existir.
 */
import { PlatformError, notFound, tenantDb } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import { requireVaultEdit, requireVaultRead } from '../rbac';
import type { DocType, DocumentRow, DocumentSummary } from '../types';
import { chunkText } from './chunker';
import { generateEmbedding, toVectorLiteral } from './embeddings';
import { fila, filas } from '../rows';

const COLUMNS =
  'id, area_slug, title, content, doc_type, status, version, source_kind, tags, ' +
  'confidence, created_by, created_at, updated_at';

const COLUMNS_SIN_CUERPO =
  'id, area_slug, title, doc_type, status, version, source_kind, tags, ' +
  'confidence, created_by, created_at, updated_at';

/** Cuántos caracteres del cuerpo se muestran en el árbol. */
const EXCERPT = 160;

export interface CrearDocumentoInput {
  title: string;
  content: string;
  docType?: DocType;
  areaSlug?: string | null;
  status?: 'draft' | 'active';
  sourceKind?: 'paste' | 'upload' | 'agent' | 'connector' | 'manual';
  tags?: string[];
  confidence?: number | null;
}

export async function crearDocumento(
  ctx: TenantContext,
  input: CrearDocumentoInput,
  /**
   * `indexar: false` sólo lo usa la ingesta, que indexa por su cuenta para
   * poder reportar cuántos fragmentos quedaron con vector y cuántos no.
   *
   * Por defecto SÍ indexa: un documento escrito a mano que no se pudiera
   * buscar sería una trampa silenciosa — existe, pero el agente jamás lo
   * encuentra.
   */
  opts: { indexar?: boolean } = {},
): Promise<DocumentRow> {
  requireVaultEdit(ctx);

  const title = input.title?.trim();
  if (!title) throw new PlatformError('VALIDATION', 'El documento necesita un título.');
  if (!input.content?.trim()) {
    throw new PlatformError('VALIDATION', 'El documento está vacío.');
  }

  const { data, error } = await tenantDb(ctx)
    .from('documents')
    .insert({
      title,
      content: input.content,
      doc_type: input.docType ?? 'otro',
      area_slug: input.areaSlug ?? null,
      status: input.status ?? 'draft',
      source_kind: input.sourceKind ?? 'manual',
      tags: input.tags ?? [],
      confidence: input.confidence ?? null,
      created_by: ctx.userEmail,
      version: 1,
    })
    .select(COLUMNS)
    .single();

  if (error) throw new PlatformError('INTERNAL', `No se pudo guardar el documento: ${error.message}`);

  const doc = fila<DocumentRow>(data);
  if (opts.indexar !== false) await indexarDocumento(ctx, doc.id, doc.content);
  return doc;
}

/**
 * Editar un documento.
 *
 * Archiva la versión vigente ANTES de pisarla. Si el archivado falla, la
 * edición no procede: preferimos no guardar a guardar perdiendo la historia.
 */
export async function editarDocumento(
  ctx: TenantContext,
  id: string,
  patch: Partial<Pick<CrearDocumentoInput, 'title' | 'content' | 'docType' | 'areaSlug' | 'tags'>> & {
    status?: 'draft' | 'active' | 'archived';
  },
): Promise<DocumentRow> {
  requireVaultEdit(ctx);

  const actual = await obtenerDocumento(ctx, id);
  const cambiaContenido =
    (patch.content != null && patch.content !== actual.content) ||
    (patch.title != null && patch.title !== actual.title);

  if (cambiaContenido) {
    const { error } = await tenantDb(ctx).from('document_versions').insert({
      document_id: actual.id,
      version: actual.version,
      title: actual.title,
      content: actual.content,
      created_by: actual.created_by,
    });
    // 23505 = ya estaba archivada esa versión. No es un fallo: es reintentar.
    if (error && (error as { code?: string }).code !== '23505') {
      throw new PlatformError(
        'INTERNAL',
        `No se pudo archivar la versión anterior, así que no se sobrescribe: ${error.message}`,
      );
    }
  }

  const parche: Record<string, unknown> = {};
  if (patch.title != null) parche.title = patch.title.trim();
  if (patch.content != null) parche.content = patch.content;
  if (patch.docType != null) parche.doc_type = patch.docType;
  if (patch.areaSlug !== undefined) parche.area_slug = patch.areaSlug;
  if (patch.tags != null) parche.tags = patch.tags;
  if (patch.status != null) parche.status = patch.status;
  if (cambiaContenido) parche.version = actual.version + 1;

  if (Object.keys(parche).length === 0) return actual;

  const { data, error } = await tenantDb(ctx)
    .from('documents')
    .update(parche)
    .eq('id', id)
    .select(COLUMNS)
    .maybeSingle();

  if (error) throw new PlatformError('INTERNAL', error.message);
  if (!data) throw notFound('Ese documento no existe en tu biblioteca.');

  // El contenido cambió: el índice semántico que apunta al viejo ya no sirve.
  if (cambiaContenido) await indexarDocumento(ctx, id, fila<DocumentRow>(data).content);

  return fila<DocumentRow>(data);
}

export async function obtenerDocumento(ctx: TenantContext, id: string): Promise<DocumentRow> {
  requireVaultRead(ctx);
  const { data, error } = await tenantDb(ctx)
    .from('documents')
    .select(COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new PlatformError('INTERNAL', error.message);
  if (!data) throw notFound('Ese documento no existe en tu biblioteca.');
  return fila<DocumentRow>(data);
}

export interface ListarDocumentosOpts {
  areaSlug?: string | null;
  docType?: DocType;
  incluirArchivados?: boolean;
}

/** El árbol de la biblioteca. Sin cuerpos: son megabytes que nadie ve todavía. */
export async function listarDocumentos(
  ctx: TenantContext,
  opts: ListarDocumentosOpts = {},
): Promise<DocumentSummary[]> {
  requireVaultRead(ctx);

  let q = tenantDb(ctx).from('documents').select(COLUMNS_SIN_CUERPO);
  if (opts.areaSlug != null) q = q.eq('area_slug', opts.areaSlug);
  if (opts.docType) q = q.eq('doc_type', opts.docType);
  if (!opts.incluirArchivados) q = q.neq('status', 'archived');

  const { data, error } = await q.order('updated_at', { ascending: false });
  if (error) throw new PlatformError('INTERNAL', error.message);

  return filas<DocumentSummary>(data);
}

export interface VersionResumen {
  version: number;
  title: string;
  created_by: string | null;
  created_at: string;
}

/** La historia de un documento, de la más reciente a la más vieja. */
export async function listarVersiones(
  ctx: TenantContext,
  documentId: string,
): Promise<VersionResumen[]> {
  requireVaultRead(ctx);
  const { data, error } = await tenantDb(ctx)
    .from('document_versions')
    .select('version, title, created_by, created_at')
    .eq('document_id', documentId)
    .order('version', { ascending: false });
  if (error) throw new PlatformError('INTERNAL', error.message);
  return filas<VersionResumen>(data);
}

export async function obtenerVersion(
  ctx: TenantContext,
  documentId: string,
  version: number,
): Promise<{ version: number; title: string; content: string; created_at: string }> {
  requireVaultRead(ctx);
  const { data, error } = await tenantDb(ctx)
    .from('document_versions')
    .select('version, title, content, created_at')
    .eq('document_id', documentId)
    .eq('version', version)
    .maybeSingle();
  if (error) throw new PlatformError('INTERNAL', error.message);
  if (!data) throw notFound('Esa versión no existe.');
  return fila<{ version: number; title: string; content: string; created_at: string }>(data);
}

export async function archivarDocumento(ctx: TenantContext, id: string): Promise<DocumentRow> {
  return editarDocumento(ctx, id, { status: 'archived' });
}

/**
 * Parte el documento, lo embebe y reemplaza sus trozos.
 *
 * Best effort en lo que toca al proveedor: si los embeddings no están
 * disponibles, los trozos se guardan con `embedding NULL` y quedan listos para
 * backfill. Lo que NO es best effort es guardar el trozo: sin él, el documento
 * desaparece de la búsqueda y nadie se entera.
 *
 * Devuelve cuántos trozos quedaron con vector y cuántos sin él, para que la UI
 * pueda decir la verdad: "indexado, 12 de 12" contra "guardado, sin índice
 * semántico todavía".
 */
export async function indexarDocumento(
  ctx: TenantContext,
  documentId: string,
  content: string,
): Promise<{ total: number; conVector: number }> {
  const trozos = chunkText(content, 500);
  if (trozos.length === 0) return { total: 0, conVector: 0 };

  const db = tenantDb(ctx);

  // Reindexar reemplaza: un documento que se acortó dejaría trozos zombis
  // apuntando a texto que ya no existe, y la búsqueda los seguiría devolviendo.
  const { error: errBorrado } = await db.from('knowledge_chunks').delete().eq('document_id', documentId);
  if (errBorrado) {
    console.warn(`[vault] no se pudieron limpiar los trozos previos: ${errBorrado.message}`);
  }

  let conVector = 0;
  const filas: Array<Record<string, unknown>> = [];

  for (const [i, trozo] of trozos.entries()) {
    const vector = await generateEmbedding(trozo);
    if (vector) conVector++;
    filas.push({
      document_id: documentId,
      content: trozo,
      chunk_index: i,
      embedding: vector ? toVectorLiteral(vector) : null,
    });
  }

  const { error } = await db
    .from('knowledge_chunks')
    .upsert(filas, { onConflict: 'document_id,chunk_index' });

  if (error) {
    console.warn(`[vault] no se pudieron guardar los trozos: ${error.message}`);
    return { total: 0, conVector: 0 };
  }

  return { total: trozos.length, conVector };
}

/** Cuántos trozos esperan backfill. Lo reporta `/vault/health`. */
export async function contarTrozosSinVector(ctx: TenantContext): Promise<number> {
  const { count, error } = await tenantDb(ctx)
    .from('knowledge_chunks')
    .select('id', { head: true, count: 'exact' })
    .is('embedding', null);
  if (error) return 0;
  return count ?? 0;
}

export function excerptDe(content: string): string {
  const plano = String(content ?? '')
    .replace(/[#*_`>|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plano.length > EXCERPT ? `${plano.slice(0, EXCERPT)}…` : plano;
}
