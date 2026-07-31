// Trae la augmentación que declara las tablas de la bóveda como aisladas por
// tenant. El import NO es decorativo: sin él, `tenantDb(ctx).from(...)` no
// compila desde `apps/web`, cuyo tsconfig sólo ve lo que llega por un import.
import './tables';

/**
 * El vocabulario de la bóveda.
 *
 * Portado de GARDEN `src/vault/resolver.ts:19-60`, con un cambio de fondo:
 * los alcances bajaron de cuatro a dos. GARDEN tenía
 * `tenant | area | socio | propiedad`; los dos últimos son de una inmobiliaria
 * (Inperio Rooms) y no se heredan a un producto para cualquier giro. Si algún
 * día un giro necesita un tercer nivel, se agrega — pero no se hereda el
 * vocabulario de otro negocio.
 */

/** Los 7 tipos de un valor canónico. */
export type VaultKind = 'money' | 'percent' | 'number' | 'text' | 'date' | 'bool' | 'list';

/** Sin anotación de tipo a propósito: `z.enum()` necesita la tupla literal. */
export const VAULT_KINDS = ['money', 'percent', 'number', 'text', 'date', 'bool', 'list'] as const;

/** Alcance de un valor. Gana el más específico: `area` > `tenant`. */
export type ScopeType = 'tenant' | 'area';

/** Tipos de documento de la biblioteca. */
export type DocType =
  | 'sop'
  | 'contrato'
  | 'precios'
  | 'guion'
  | 'politica'
  | 'manual'
  | 'faq'
  | 'plantilla'
  | 'otro';

export const DOC_TYPES = [
  'sop',
  'contrato',
  'precios',
  'guion',
  'politica',
  'manual',
  'faq',
  'plantilla',
  'otro',
] as const;

export type DocStatus = 'draft' | 'active' | 'archived';

export type DocSourceKind = 'paste' | 'upload' | 'agent' | 'connector' | 'manual';

/** Una fila de `app.canonical_values`. */
export interface VaultRow {
  id: string;
  key: string;
  label: string;
  kind: VaultKind;
  value: number | null;
  value_text: string | null;
  value_json: unknown;
  currency: string;
  unit: string | null;
  note: string | null;
  area_slug: string | null;
  scope_type: ScopeType;
  scope_id: string;
  active: boolean;
  source_doc_id: string | null;
  position: number;
  approved_at?: string | null;
  approved_by?: string | null;

  /**
   * La contradicción pendiente: lo que un documento POSTERIOR propone para este
   * valor, sin haberlo pisado. `conflict_at != null` es el marcador. Ver la
   * migración 031 y el corolario de `ingest/pipeline.ts`.
   */
  conflict_value?: number | null;
  conflict_value_text?: string | null;
  conflict_currency?: string | null;
  conflict_note?: string | null;
  conflict_doc_id?: string | null;
  conflict_at?: string | null;

  created_at?: string;
  updated_at?: string;
}

/** Qué hacer con una contradicción. No hay una tercera opción a propósito. */
export type DecisionConflicto = 'aceptar' | 'descartar';

/** Lo que hace falta saber del tenant para poblar `{empresa.*}` y `{marca.*}`. */
export interface TenantMeta {
  id: string;
  slug: string;
  name: string;
  industryType: string | null;
  settings: Record<string, unknown>;
}

/** El contexto que decide qué valor gana. Hoy sólo el área. */
export interface VaultContext {
  area?: string | null;
}

export interface ResolvedVault {
  tenant: TenantMeta;
  /** key → fila ganadora tras la jerarquía. Para lógica: una comisión numérica. */
  rows: Record<string, VaultRow>;
  /** Mapa listo para interpolar: `{valor.*}`, `{precio.*}`, `{empresa.*}`, `{marca.*}`. */
  values: Record<string, string>;
}

/** Una fila de `app.documents`. */
export interface DocumentRow {
  id: string;
  area_slug: string | null;
  title: string;
  content: string;
  doc_type: DocType;
  status: DocStatus;
  version: number;
  source_kind: DocSourceKind;
  tags: string[];
  confidence: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Igual pero SIN el cuerpo: lo que pinta el árbol de la biblioteca.
 * No se trae el contenido a propósito — son megabytes que nadie está viendo.
 */
export type DocumentSummary = Omit<DocumentRow, 'content'>;

export interface KnowledgeChunkRow {
  id: number;
  document_id: string | null;
  content: string;
  chunk_index: number;
}

/** Un resultado de búsqueda en la biblioteca. */
export interface SearchHit {
  documentId: string | null;
  title: string;
  excerpt: string;
  chunkIndex: number;
  /** 0–1 en la semántica; en la léxica es el rango de `ts_rank` normalizado. */
  score: number;
  /** De dónde salió. La UI lo dice: buscar por significado no es lo mismo que
   *  buscar por palabra, y el usuario merece saber cuál le contestó. */
  via: 'semantica' | 'lexica';
}
