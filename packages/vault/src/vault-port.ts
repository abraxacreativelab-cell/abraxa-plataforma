/**
 * `VaultPort` — la cara pública de la bóveda para los demás handoffs.
 *
 * Es deliberadamente pequeña. H3 inyecta la bóveda en cada prompt, H7 usa la
 * ingesta durante la entrevista, y ninguno de los dos necesita saber que
 * existen borradores, versiones de documentos ni un índice HNSW.
 *
 * El contrato está en `packages/db/ports.ts` y es de H1: aquí sólo se cumple.
 *
 * ── Los cinco métodos degradan, no explotan ────────────────────────────────
 *
 * Los tres de lectura (`resolve`, `injectIntoPrompt`, `render`) son best
 * effort a propósito. Los llama un agente en medio de una conversación con el
 * cliente final de alguien: si la bóveda tose, el agente contesta con menos
 * datos, no deja de contestar.
 *
 * `ingestDocument` sí puede lanzar: la llama una persona que pegó un texto y
 * está esperando ver qué pasó. Un error silencioso ahí sería peor.
 */
import type { TenantContext, VaultPort, VaultScope } from '@abraxa/db';
import { injectIntoPrompt } from './agent-inject';
import { detectGaps } from './industry/gaps';
import { ingestDocument } from './ingest/pipeline';
import { renderTemplate } from './render';
import { resolveVault, scopeToContext } from './resolver';

export const vaultService: VaultPort = {
  async resolve(ctx: TenantContext, scope?: VaultScope): Promise<Record<string, string>> {
    try {
      const resuelto = await resolveVault(ctx, scopeToContext(scope));
      return resuelto?.values ?? {};
    } catch (e) {
      console.warn(`[vault] resolve degradado: ${(e as Error).message}`);
      return {};
    }
  },

  // Ya es best effort por dentro y nunca lanza. Ver agent-inject.ts.
  injectIntoPrompt,

  async render(ctx: TenantContext, template: string, scope?: VaultScope): Promise<string> {
    try {
      const { text } = await renderTemplate(ctx, template, { scope });
      return text;
    } catch (e) {
      console.warn(`[vault] render degradado: ${(e as Error).message}`);
      // Sin bóveda, los tokens se vacían igual: lo que NUNCA puede pasar es
      // que al cliente final le llegue un `{precio_base}` a la vista.
      return String(template ?? '').replace(/\{[\w.áéíóúÁÉÍÓÚñÑüÜ-]+\}/g, '');
    }
  },

  async ingestDocument(
    ctx: TenantContext,
    i: { title?: string; content: string; areaSlug?: string },
  ): Promise<{ documentId: string; valueIds: string[] }> {
    const r = await ingestDocument(ctx, {
      content: i.content,
      title: i.title,
      areaSlug: i.areaSlug,
      // Quien entra por el port es otro handoff, no una persona tecleando.
      sourceKind: 'agent',
    });
    return { documentId: r.documentId, valueIds: r.valores.map((v) => v.id) };
  },

  async detectGaps(ctx: TenantContext) {
    try {
      return await detectGaps(ctx);
    } catch (e) {
      console.warn(`[vault] detectGaps degradado: ${(e as Error).message}`);
      return [];
    }
  },
};
