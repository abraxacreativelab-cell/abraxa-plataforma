import Link from 'next/link';
import { BookOpen, FileText, Search } from 'lucide-react';
import {
  buscar,
  etiquetaDocType,
  listarDocumentos,
  loadTenantMeta,
  taxonomiaDe,
  type DocumentSummary,
} from '@abraxa/vault/api';
import { EstadoBoveda } from '../_components/estado-boveda';
import { Entrada, Insignia, SinNada, Tarjeta } from '../_components/ui';
import { contextoActual } from '../_lib/session';

export const dynamic = 'force-dynamic';

/**
 * La biblioteca: UNA vista.
 *
 * GARDEN tenía cinco superficies para lo mismo —biblioteca, carpetas,
 * constelación 3D, flujo y generados— y el emprendedor tenía que aprenderse
 * cuál servía para qué. Aquí es un árbol por área con buscador y lector.
 *
 * El buscador corre las dos vías (significado y palabras) y DICE cuál
 * contestó. Cuando el índice semántico está caído, decirlo es la diferencia
 * entre «no existe» y «no pude buscar bien», que no es lo mismo.
 */
export default async function PaginaBiblioteca({
  searchParams,
}: {
  searchParams?: { q?: string };
}) {
  const consulta = (searchParams?.q ?? '').trim();

  let datos;
  try {
    const ctx = await contextoActual();
    const meta = await loadTenantMeta(ctx);
    const [documentos, taxonomia, resultados] = await Promise.all([
      listarDocumentos(ctx),
      taxonomiaDe(meta?.industryType),
      consulta ? buscar(ctx, consulta, { limite: 12 }) : null,
    ]);
    datos = { documentos, taxonomia, resultados };
  } catch (e) {
    return <EstadoBoveda error={e} />;
  }

  const { documentos, taxonomia, resultados } = datos;
  const titulos = new Map(documentos.map((d) => [d.id, d.title]));

  const porArea = new Map<string, DocumentSummary[]>();
  for (const d of documentos) {
    const k = d.area_slug ?? '__general';
    const lista = porArea.get(k);
    if (lista) lista.push(d);
    else porArea.set(k, [d]);
  }
  const orden = [...taxonomia.areas.map((a) => a.slug), '__general'];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold">Tu biblioteca</h2>
        <p className="mt-1 max-w-2xl text-sm text-[hsl(var(--muted-foreground))]">
          Todo lo que tu negocio sabe por escrito. De aquí salen los números de la bóveda y es lo
          que consultan tus agentes cuando alguien pregunta algo que debería estar documentado.
        </p>
      </div>

      <form className="flex max-w-xl gap-2" role="search">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[hsl(var(--muted-foreground))]/60" />
          <Entrada
            name="q"
            defaultValue={consulta}
            placeholder="¿Cuánto cobro por instalar? — busca por significado, no sólo por palabra"
            className="pl-8"
            aria-label="Buscar en la biblioteca"
          />
        </div>
        <button
          type="submit"
          className="rounded-md border border-[hsl(var(--border))] px-3 py-1.5 text-sm hover:bg-[hsl(var(--muted))]"
        >
          Buscar
        </button>
      </form>

      {resultados ? (
        <section className="space-y-2">
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="text-sm font-semibold">
              {resultados.hits.length} resultado{resultados.hits.length === 1 ? '' : 's'} para «
              {consulta}»
            </h3>
            <Link
              href="/direccion/biblioteca"
              className="text-xs text-[hsl(var(--muted-foreground))] underline"
            >
              limpiar
            </Link>
          </div>

          {resultados.semanticaDegradada ? (
            <p className="rounded-md border border-amber-500/25 bg-amber-500/[0.04] px-3 py-2 text-xs text-[hsl(var(--muted-foreground))]">
              {resultados.motivoDegradacion}
            </p>
          ) : null}

          {resultados.hits.length === 0 ? (
            <SinNada
              titulo="Nada coincide"
              descripcion="Prueba con otras palabras, o agrega el documento que te falta."
            />
          ) : (
            <ul className="space-y-2">
              {resultados.hits.map((h, i) => (
                <li key={`${h.documentId}-${h.chunkIndex}-${i}`}>
                  <Link href={h.documentId ? `/direccion/biblioteca/${h.documentId}` : '#'}>
                    <Tarjeta className="p-3 transition-colors hover:border-[hsl(var(--primary))]/30">
                      <div className="flex items-center gap-2">
                        <FileText className="h-3.5 w-3.5 text-[hsl(var(--primary))]" />
                        <span className="flex-1 truncate text-sm font-medium">
                          {h.title || titulos.get(h.documentId ?? '') || 'Documento'}
                        </span>
                        <Insignia tono={h.via === 'semantica' ? 'info' : 'neutro'}>
                          {h.via === 'semantica' ? 'por significado' : 'por palabras'}
                        </Insignia>
                      </div>
                      <p className="mt-1.5 text-xs leading-snug text-[hsl(var(--muted-foreground))]">
                        {h.excerpt}
                      </p>
                    </Tarjeta>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {documentos.length === 0 ? (
        <SinNada
          titulo="Todavía no hay documentos"
          descripcion="Pega tu primer documento y empieza a construir la memoria de tu negocio."
        >
          <Link
            href="/direccion/ingesta"
            className="rounded-md border border-transparent bg-[hsl(var(--primary))] px-3 py-1.5 text-sm font-medium text-[hsl(var(--primary-foreground))] hover:opacity-90"
          >
            Agregar un documento
          </Link>
        </SinNada>
      ) : (
        <section className="space-y-4">
          {orden
            .filter((slug) => porArea.has(slug))
            .map((slug) => {
              const area = taxonomia.areas.find((a) => a.slug === slug);
              const docs = porArea.get(slug)!;
              return (
                <Tarjeta key={slug} className="overflow-hidden">
                  <div className="flex items-center gap-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-4 py-2">
                    <BookOpen className="h-3.5 w-3.5 text-[hsl(var(--primary))]" />
                    <h3 className="flex-1 text-sm font-medium">{area?.label ?? 'Sin área'}</h3>
                    <span className="font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
                      {docs.length}
                    </span>
                  </div>
                  <ul>
                    {docs.map((d) => (
                      <li key={d.id} className="border-b border-[hsl(var(--border))]/50 last:border-0">
                        <Link
                          href={`/direccion/biblioteca/${d.id}`}
                          className="flex flex-wrap items-center gap-2 px-4 py-2.5 transition-colors hover:bg-[hsl(var(--muted))]/40"
                        >
                          <FileText className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
                          <span className="min-w-0 flex-1 truncate text-sm">{d.title}</span>
                          <Insignia tono="neutro">{etiquetaDocType(d.doc_type)}</Insignia>
                          {d.status === 'draft' ? (
                            <Insignia tono="borrador">borrador</Insignia>
                          ) : null}
                          {d.version > 1 ? (
                            <span className="font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
                              v{d.version}
                            </span>
                          ) : null}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Tarjeta>
              );
            })}
        </section>
      )}
    </div>
  );
}
