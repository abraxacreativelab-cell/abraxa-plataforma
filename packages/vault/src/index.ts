/**
 * ════════════════════════════════════════════════════════════════════════════
 *  @abraxa/vault — LA BÓVEDA
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  El emprendedor define UNA vez los números de su negocio y se propagan solos
 *  a sus contratos, a sus mensajes y a los prompts de sus agentes. Cuando
 *  cambia un precio, cambia en todos lados. Nadie inventa cifras.
 *
 *  Tres reglas de diseño, heredadas de GARDEN y conservadas enteras:
 *
 *    1. El DOCUMENTO es la fuente de verdad. Los valores son una PROYECCIÓN.
 *    2. NADA SE ACTIVA SOLO. Todo valor extraído nace en borrador y lo aprueba
 *       una persona.
 *    3. La inyección al prompt es BEST EFFORT. Un agente sin bóveda contesta
 *       peor; un agente caído no contesta.
 *
 *  Handoff H4. Migraciones 030–033.
 */
import { registerPort } from '@abraxa/db';
import { router } from './http/routes';
import { registrarTools } from './tools';
import { vaultService } from './vault-port';

// El port, disponible para quien lo pida con `usePort('vault')`.
registerPort('vault', vaultService);

// Las tools, si H3 ya aterrizó. Si no, no pasa nada: `registrarTools` no lanza
// y el motor de agentes las tomará cuando ambos estén arriba.
registrarTools();

export { router };
export { meta } from './meta';

// ── El port ─────────────────────────────────────────────────────────────────
export { vaultService };

// ── Resolución y propagación ────────────────────────────────────────────────
export { resolveVault, getVaultValue, scopeToContext } from './resolver';
export { injectIntoPrompt } from './agent-inject';
export { interpolate, interpolateVerbose, renderTemplate, tokensUsados } from './render';
export { formatVault, formatMoney, formatMoney2, KIND_LABEL } from './format';
export {
  bumpVaultCache,
  notifyVaultChanged,
  setVaultCacheBroadcaster,
  VAULT_CACHE_TTL_MS,
  type VaultCacheBroadcaster,
} from './cache';

// ── Valores ─────────────────────────────────────────────────────────────────
export {
  listarValores,
  obtenerValor,
  crearValor,
  editarValor,
  aprobarValor,
  desactivarValor,
  borrarValor,
  contarBorradores,
} from './values/service';
export { crearValorSchema, editarValorSchema, claveSchema, CLAVE_RE } from './values/schema';

// ── Documentos y biblioteca ─────────────────────────────────────────────────
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
export { chunkText } from './documents/chunker';
export {
  generateEmbedding,
  embeddingsStatus,
  isEmbeddingsAvailable,
  resetEmbeddingsCooldown,
  EMBEDDING_MODEL,
  EMBEDDING_DIMS,
} from './documents/embeddings';

// ── Ingesta ─────────────────────────────────────────────────────────────────
export { ingestDocument, type IngestResult, type ValorPropuesto } from './ingest/pipeline';
export { parsePricingDoc, normalizarClave, etiquetaDesdeClave } from './ingest/money';
export {
  anthropicClassifier,
  desdeAgentPort,
  noopClassifier,
  clasificadorPorDefecto,
  type DocClassifier,
} from './ingest/classifier';

// ── Giro y huecos ───────────────────────────────────────────────────────────
export {
  taxonomiaDe,
  listarGiros,
  GIRO_POR_DEFECTO,
  type IndustryTemplate,
  type AreaTemplate,
  type ExpectedDoc,
  type ExpectedValue,
} from './industry/catalog';
export { detectGaps, detectGapsDetallado, contarHuecos, type AreaGap } from './industry/gaps';

// ── Tools para agentes ──────────────────────────────────────────────────────
export { VAULT_TOOLS, vaultValueTool, vaultSearchTool, registrarTools } from './tools';

// ── RBAC ────────────────────────────────────────────────────────────────────
export { canEditVault, requireVaultEdit, requireVaultRead, hasArea, AREA_BOVEDA } from './rbac';

// ── Tipos ───────────────────────────────────────────────────────────────────
export type {
  VaultKind,
  ScopeType,
  DocType,
  DocStatus,
  VaultRow,
  VaultContext,
  ResolvedVault,
  TenantMeta,
  DocumentRow,
  DocumentSummary,
  SearchHit,
} from './types';
export { VAULT_KINDS, DOC_TYPES } from './types';
