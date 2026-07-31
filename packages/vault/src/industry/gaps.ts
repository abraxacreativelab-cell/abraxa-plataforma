/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Qué le falta al negocio. La lista de huecos.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Compara lo que el giro espera contra lo que el tenant realmente tiene, y
 *  devuelve la diferencia por área.
 *
 *  Es lo que le permite al agente maestro decir *"todavía no me has dicho
 *  cuánto cobras"* en vez de inventarse una cifra — que es, en una frase, la
 *  razón de ser de este paquete.
 *
 *  Portado de GARDEN `src/vault/area-templates.ts:343-362`. La lógica era
 *  genérica y se conserva; lo que cambió es de dónde sale la taxonomía: antes
 *  de un `Record` hardcodeado por `company_id`, ahora de
 *  `app.industry_templates` según `tenants.industry_type`.
 *
 *  ── El detalle que hay que conservar ────────────────────────────────────────
 *
 *  UN VALOR EN BORRADOR CUENTA COMO FALTANTE. `active = false` significa que
 *  un modelo lo propuso y nadie lo aprobó todavía: no se puede citar, no se
 *  propaga, no existe para los agentes. Contarlo como "ya lo tienes" haría que
 *  el agente dejara de preguntar por un dato que en la práctica sigue sin
 *  estar. GARDEN acertó en esto (`v.active !== false`) y se conserva.
 */
import { tenantDb } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import { loadTenantMeta } from '../global-tables';
import type { ExpectedDoc, ExpectedValue, IndustryTemplate } from './catalog';
import { taxonomiaDe } from './catalog';

export interface AreaGap {
  areaSlug: string;
  areaLabel: string;
  missingDocs: ExpectedDoc[];
  missingValues: ExpectedValue[];
}

/** La forma que pide `VaultPort.detectGaps` en packages/db/ports.ts. */
export interface GapResumen {
  areaSlug: string;
  missing: string[];
}

interface DocMinimo {
  area_slug: string | null;
  doc_type: string;
}
interface ValorMinimo {
  key: string;
  value: number | null;
  value_text: string | null;
  value_json: unknown;
  active: boolean;
}

/** La lista completa, con todo el detalle. La consume la UI de Dirección. */
export async function detectGapsDetallado(ctx: TenantContext): Promise<AreaGap[]> {
  const meta = await loadTenantMeta(ctx);
  const taxonomia: IndustryTemplate = await taxonomiaDe(meta?.industryType);

  const db = tenantDb(ctx);
  const [docsRes, valsRes] = await Promise.all([
    db.from('documents').select('area_slug, doc_type').neq('status', 'archived'),
    db.from('canonical_values').select('key, value, value_text, value_json, active'),
  ]);

  if (docsRes.error) console.warn(`[vault] huecos: no se leyeron documentos: ${docsRes.error.message}`);
  if (valsRes.error) console.warn(`[vault] huecos: no se leyeron valores: ${valsRes.error.message}`);

  const docs = (docsRes.data ?? []) as DocMinimo[];
  const vals = (valsRes.data ?? []) as ValorMinimo[];

  // Un documento cuenta si existe uno de ese tipo en esa área. No se compara
  // por título: pedirle al emprendedor que lo nombre igual que la plantilla
  // sería absurdo.
  const hayDoc = new Set(docs.map((d) => `${d.area_slug ?? ''}|${d.doc_type}`));
  const valorPorClave = new Map(vals.map((v) => [v.key, v]));

  const etiqueta = new Map(taxonomia.areas.map((a) => [a.slug, a.label]));
  const gaps: AreaGap[] = [];

  for (const area of taxonomia.areas) {
    const missingDocs = taxonomia.expectedDocs.filter(
      (d) => d.areaSlug === area.slug && !hayDoc.has(`${area.slug}|${d.docType}`),
    );

    const missingValues = taxonomia.expectedValues.filter((ev) => {
      if (ev.areaSlug !== area.slug) return false;
      const v = valorPorClave.get(ev.key);
      return !estaDefinido(v);
    });

    if (missingDocs.length || missingValues.length) {
      gaps.push({
        areaSlug: area.slug,
        areaLabel: etiqueta.get(area.slug) ?? area.slug,
        missingDocs,
        missingValues,
      });
    }
  }

  return gaps;
}

/**
 * Definido = existe, está APROBADO y tiene algo dentro.
 * Un borrador no cuenta. Una clave creada y vacía tampoco.
 */
function estaDefinido(v: ValorMinimo | undefined): boolean {
  if (!v) return false;
  if (v.active === false) return false;
  return v.value != null || (v.value_text ?? '') !== '' || v.value_json != null;
}

/**
 * La versión que exige el contrato cruzado: área → lista de qué falta, en
 * lenguaje que un agente pueda leerle al emprendedor tal cual.
 */
export async function detectGaps(ctx: TenantContext): Promise<GapResumen[]> {
  const detalle = await detectGapsDetallado(ctx);
  return detalle.map((g) => ({
    areaSlug: g.areaSlug,
    missing: [
      ...g.missingValues.map((v) => (v.hint ? `${v.key} (${v.hint})` : v.key)),
      ...g.missingDocs.map((d) => `documento: ${d.title}`),
    ],
  }));
}

/** Cuántos huecos hay en total. El número del panel de Dirección. */
export async function contarHuecos(ctx: TenantContext): Promise<number> {
  const gaps = await detectGapsDetallado(ctx);
  return gaps.reduce((n, g) => n + g.missingDocs.length + g.missingValues.length, 0);
}
