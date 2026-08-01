/**
 * `@abraxa/vault/api` — los servicios de la bóveda SIN Express y sin efectos
 * secundarios.
 *
 * Existe para que `apps/web` pueda llamar a la bóveda desde un Server
 * Component sin arrastrar el router de Express a la compilación de Next, y sin
 * disparar el `registerPort()` del barril principal en un proceso donde no
 * significa nada.
 *
 * `index.ts` sigue siendo el punto de entrada de `apps/api`: ahí sí hace falta
 * el router y el registro del port.
 */

export { resolveVault, getVaultValue, scopeToContext } from './resolver';
export { injectIntoPrompt } from './agent-inject';
export { interpolate, interpolateVerbose, renderTemplate, tokensUsados } from './render';
export { formatVault, formatMoney, formatMoney2, KIND_LABEL } from './format';
export { bumpVaultCache, notifyVaultChanged } from './cache';

export {
  listarValores,
  obtenerValor,
  crearValor,
  editarValor,
  aprobarValor,
  desactivarValor,
  borrarValor,
  contarBorradores,
  contarConflictos,
  resolverConflicto,
  tieneConflicto,
  propuestaSinCifra,
} from './values/service';

export {
  crearDocumento,
  editarDocumento,
  obtenerDocumento,
  listarDocumentos,
  listarVersiones,
  obtenerVersion,
  archivarDocumento,
  indexarDocumento,
  contarTrozosSinVector,
  excerptDe,
} from './documents/service';
export { buscar, type ResultadoBusqueda } from './documents/search';
export { embeddingsStatus } from './documents/embeddings';

export {
  ingestDocument,
  type IngestResult,
  type ValorPropuesto,
  type ConflictoValor,
} from './ingest/pipeline';
export { parsePricingDoc, detectarMoneda, MONEDA_POR_DEFECTO } from './ingest/money';

export { taxonomiaDe, listarGiros, type IndustryTemplate, type AreaTemplate } from './industry/catalog';
export { detectGapsDetallado, contarHuecos, type AreaGap } from './industry/gaps';
export { loadTenantMeta } from './global-tables';

// ── Cómo le habla la bóveda a un cliente ────────────────────────────────────
export {
  ETIQUETA_DOC_TYPE,
  ETIQUETA_CAMPO,
  etiquetaDocType,
  etiquetaKind,
  etiquetaCampo,
  mensajeEsParaElCliente,
  jergaEn,
  PATRONES_DE_JERGA,
  BUSQUEDA_SOLO_POR_PALABRAS,
  SIGNIFICADO_EN_PAUSA,
  FALLO_NUESTRO,
} from './copy';


export { canEditVault, hasArea, AREA_BOVEDA } from './rbac';

export type {
  VaultKind,
  ScopeType,
  DocType,
  DocStatus,
  DecisionConflicto,
  VaultRow,
  DocumentRow,
  DocumentSummary,
  SearchHit,
} from './types';
export { VAULT_KINDS, DOC_TYPES } from './types';
