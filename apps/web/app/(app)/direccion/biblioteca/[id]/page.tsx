import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import {
  canEditVault,
  listarValores,
  listarVersiones,
  loadTenantMeta,
  obtenerDocumento,
  taxonomiaDe,
} from '@abraxa/vault/api';
import { EstadoBoveda } from '../../_components/estado-boveda';
import { contextoActual } from '../../_lib/session';
import { LectorDocumento } from './lector-documento';

export const dynamic = 'force-dynamic';

/**
 * Un documento: leerlo, editarlo y ver qué números salieron de él.
 *
 * Esa última parte es la que sostiene la regla de diseño de todo el paquete:
 * el documento es la fuente de verdad y los valores son una proyección. Si el
 * emprendedor no puede ver la liga entre los dos, la regla es sólo una frase
 * bonita en un comentario.
 */
export default async function PaginaDocumento({ params }: { params: { id: string } }) {
  let datos;
  try {
    const ctx = await contextoActual();
    const doc = await obtenerDocumento(ctx, params.id);
    const meta = await loadTenantMeta(ctx);
    const [versiones, valores, taxonomia] = await Promise.all([
      listarVersiones(ctx, params.id),
      listarValores(ctx),
      taxonomiaDe(meta?.industryType),
    ]);
    datos = {
      doc,
      versiones,
      derivados: valores.filter((v) => v.source_doc_id === params.id),
      areas: taxonomia.areas.map((a) => ({ slug: a.slug, label: a.label })),
      puedeEditar: canEditVault(ctx),
    };
  } catch (e) {
    return <EstadoBoveda error={e} />;
  }

  return (
    <div className="space-y-4">
      <Link
        href="/direccion/biblioteca"
        className="inline-flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Biblioteca
      </Link>

      <LectorDocumento
        documento={datos.doc}
        versiones={datos.versiones}
        derivados={datos.derivados}
        areas={datos.areas}
        puedeEditar={datos.puedeEditar}
      />
    </div>
  );
}
