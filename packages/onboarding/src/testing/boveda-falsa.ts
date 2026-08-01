/**
 * Un `VaultPort` de mentiras que cuenta lo que se le ingirió.
 *
 * Existe por una sola razón: el documento madre del cierre es un efecto que se
 * puede duplicar, y duplicarlo no rompe nada visible — la bóveda acepta los dos,
 * H4 extrae y clasifica los mismos valores canónicos dos veces, y el
 * emprendedor termina con dos "Mi negocio — panadería" en su bóveda sin que
 * ningún error salga por ningún lado.
 *
 * Un efecto que se duplica en silencio sólo se prueba contándolo. Por eso este
 * doble guarda cada llamada en vez de sólo contestar.
 */
import type { TenantContext, VaultPort, VaultScope } from '@abraxa/db';

export interface DocumentoIngerido {
  title?: string;
  content: string;
  areaSlug?: string;
}

export interface BovedaFalsa extends VaultPort {
  /** Todo lo que se mandó a `ingestDocument`, en orden. */
  readonly documentos: DocumentoIngerido[];
}

export function crearBovedaFalsa(): BovedaFalsa {
  const documentos: DocumentoIngerido[] = [];
  let n = 0;

  return {
    documentos,

    ingestDocument(
      _ctx: TenantContext,
      i: { title?: string; content: string; areaSlug?: string },
    ): Promise<{ documentId: string; valueIds: string[] }> {
      documentos.push({ ...i });
      n++;
      return Promise.resolve({ documentId: `doc-${n}`, valueIds: [`val-${n}`] });
    },

    resolve(): Promise<Record<string, string>> {
      return Promise.resolve({});
    },

    injectIntoPrompt(_ctx: TenantContext, prompt: string): Promise<string> {
      return Promise.resolve(prompt);
    },

    render(_ctx: TenantContext, template: string, _scope?: VaultScope): Promise<string> {
      return Promise.resolve(template);
    },

    detectGaps(): Promise<Array<{ areaSlug: string; missing: string[] }>> {
      return Promise.resolve([]);
    },
  };
}
