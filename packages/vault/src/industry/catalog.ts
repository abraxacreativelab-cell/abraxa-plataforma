/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Taxonomías por giro. Antes en el código, ahora una fila de base de datos.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  En GARDEN esto era `src/vault/area-templates.ts`: 362 líneas con las ocho
 *  empresas de Santiago escritas a mano (`inperio: 'property'`,
 *  `carineeto: 'franchise'`, `rito: 'agency'`…) y ocho taxonomías completas de
 *  property management, franquicia de helados y agencia de marketing.
 *
 *  La ESTRUCTURA es buena y se conserva: un giro define sus áreas, los
 *  documentos que se espera que existan y los valores que se espera que estén
 *  definidos. Eso es exactamente lo que necesita `detectGaps`.
 *
 *  El CONTENIDO se tiró entero. Vive en `app.industry_templates`, sembrado por
 *  la migración 033 con cinco giros genéricos de PyME mexicana. Dar de alta un
 *  giro nuevo es un INSERT, no un deploy.
 */
import { loadIndustryTemplate, listIndustryTemplates, type IndustryTemplateRaw } from '../global-tables';
import type { DocType, VaultKind } from '../types';

export interface AreaTemplate {
  slug: string;
  label: string;
  /** Nombre de icono de lucide. Viene de la DB porque el sidebar tampoco está
   *  en el código (ver H5 §7). */
  icon: string;
  position: number;
  blurb: string;
}

export interface ExpectedDoc {
  areaSlug: string;
  docType: DocType;
  title: string;
  hint?: string;
}

export interface ExpectedValue {
  areaSlug: string;
  key: string;
  kind: VaultKind;
  hint?: string;
}

export interface IndustryTemplate {
  id: string;
  name: string;
  blurb: string;
  areas: AreaTemplate[];
  expectedDocs: ExpectedDoc[];
  expectedValues: ExpectedValue[];
}

/** El giro que se usa mientras H7 no descubre a qué se dedica el negocio. */
export const GIRO_POR_DEFECTO = 'general';

/**
 * Red de seguridad en memoria.
 *
 * Si la migración 033 no corrió, o la base no contesta, `detectGaps` devolvería
 * "no te falta nada" — que es la mentira más cara que puede decir este módulo:
 * el agente maestro dejaría de preguntar justo lo que no sabe. Con esto, al
 * menos las cuatro áreas mínimas siguen existiendo.
 */
const RESPALDO: IndustryTemplate = {
  id: GIRO_POR_DEFECTO,
  name: 'Otro giro',
  blurb: 'Lo mínimo que todo negocio necesita tener claro.',
  areas: [
    { slug: 'ventas', label: 'Ventas', icon: 'Target', position: 1, blurb: 'Cómo llega y se cierra un cliente.' },
    { slug: 'operaciones', label: 'Operaciones', icon: 'Wrench', position: 2, blurb: 'Cómo se entrega lo que vendes.' },
    { slug: 'finanzas', label: 'Finanzas', icon: 'Wallet', position: 3, blurb: 'Qué entra, qué sale y cuánto queda.' },
    { slug: 'direccion', label: 'Dirección', icon: 'Compass', position: 9, blurb: 'Tu bóveda: números, documentos y biblioteca.' },
  ],
  expectedDocs: [
    { areaSlug: 'ventas', docType: 'precios', title: 'Lista de precios' },
    { areaSlug: 'direccion', docType: 'otro', title: 'A qué se dedica el negocio' },
  ],
  expectedValues: [
    { areaSlug: 'ventas', key: 'ticket_promedio', kind: 'money' },
    { areaSlug: 'finanzas', key: 'iva_pct', kind: 'percent', hint: '16 en México' },
  ],
};

function comoArreglo(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]) : [];
}

export function normalizarTemplate(raw: IndustryTemplateRaw): IndustryTemplate {
  const areas = comoArreglo(raw.areas)
    .map<AreaTemplate>((a, i) => ({
      slug: String(a.slug ?? ''),
      label: String(a.label ?? a.slug ?? ''),
      icon: String(a.icon ?? 'Square'),
      position: Number(a.position ?? i + 1),
      blurb: String(a.blurb ?? ''),
    }))
    .filter((a) => a.slug)
    .sort((x, y) => x.position - y.position);

  const slugs = new Set(areas.map((a) => a.slug));

  const expectedDocs = comoArreglo(raw.expected_docs)
    .map<ExpectedDoc>((d) => ({
      areaSlug: String(d.area_slug ?? ''),
      docType: String(d.doc_type ?? 'otro') as DocType,
      title: String(d.title ?? ''),
      hint: d.hint == null ? undefined : String(d.hint),
    }))
    // Un documento esperado en un área que el giro no tiene es un hueco que
    // nadie podría llenar nunca. Se descarta en vez de acusarlo para siempre.
    .filter((d) => d.title && slugs.has(d.areaSlug));

  const expectedValues = comoArreglo(raw.expected_values)
    .map<ExpectedValue>((v) => ({
      areaSlug: String(v.area_slug ?? ''),
      key: String(v.key ?? ''),
      kind: String(v.kind ?? 'text') as VaultKind,
      hint: v.hint == null ? undefined : String(v.hint),
    }))
    .filter((v) => v.key && slugs.has(v.areaSlug));

  return {
    id: raw.id,
    name: raw.name,
    blurb: raw.blurb ?? '',
    areas,
    expectedDocs,
    expectedValues,
  };
}

/** La plantilla de un giro. Cae al genérico si el id no existe. */
export async function taxonomiaDe(industryType: string | null | undefined): Promise<IndustryTemplate> {
  const id = (industryType ?? '').trim() || GIRO_POR_DEFECTO;

  const raw = await loadIndustryTemplate(id);
  if (raw) return normalizarTemplate(raw);

  if (id !== GIRO_POR_DEFECTO) {
    console.warn(`[vault] el giro '${id}' no está en el catálogo; se usa '${GIRO_POR_DEFECTO}'.`);
    const generico = await loadIndustryTemplate(GIRO_POR_DEFECTO);
    if (generico) return normalizarTemplate(generico);
  }

  console.warn('[vault] el catálogo de giros no respondió; se usa el respaldo en memoria.');
  return RESPALDO;
}

/** El catálogo completo. Lo consume H7 para preguntar "¿a qué te dedicas?". */
export async function listarGiros(): Promise<IndustryTemplate[]> {
  const filas = await listIndustryTemplates();
  return filas.length > 0 ? filas.map(normalizarTemplate) : [RESPALDO];
}
