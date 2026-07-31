import Link from 'next/link';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ClipboardPaste,
  FileText,
  Layers,
  Search,
} from 'lucide-react';
import {
  contarBorradores,
  detectGapsDetallado,
  embeddingsStatus,
  listarDocumentos,
  listarValores,
  loadTenantMeta,
  taxonomiaDe,
  type AreaGap,
} from '@abraxa/vault/api';
import { BovedaVacia, EstadoBoveda } from './_components/estado-boveda';
import { Insignia, Tarjeta } from './_components/ui';
import { contextoActual } from './_lib/session';

export const dynamic = 'force-dynamic';

/**
 * El panel de Dirección: en qué está tu bóveda hoy.
 *
 * Tres cosas y en este orden, porque es el orden en que le sirven al
 * emprendedor:
 *   1. Qué tiene pendiente de aprobar — una decisión suya, de un clic.
 *   2. Qué le falta al negocio — lo que hace que sus agentes no sepan.
 *   3. Qué hay dentro.
 */
export default async function PanelDireccion() {
  let datos;
  try {
    const ctx = await contextoActual();
    const meta = await loadTenantMeta(ctx);
    const [valores, documentos, huecos, borradores, taxonomia] = await Promise.all([
      listarValores(ctx),
      listarDocumentos(ctx),
      detectGapsDetallado(ctx),
      contarBorradores(ctx),
      taxonomiaDe(meta?.industryType),
    ]);
    datos = {
      valores,
      documentos,
      huecos,
      borradores,
      taxonomia,
      meta,
      embeddings: embeddingsStatus(),
    };
  } catch (e) {
    return <EstadoBoveda error={e} />;
  }

  const { valores, documentos, huecos, borradores, taxonomia, embeddings } = datos;
  const activos = valores.filter((v) => v.active).length;
  const totalHuecos = huecos.reduce((n, g) => n + g.missingDocs.length + g.missingValues.length, 0);

  if (valores.length === 0 && documentos.length === 0) return <BovedaVacia />;

  return (
    <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-3">
        <Metrica
          href="/direccion/valores"
          Icono={Layers}
          numero={activos}
          etiqueta={activos === 1 ? 'número vigente' : 'números vigentes'}
          nota="Se usan tal cual en contratos, mensajes y agentes."
        />
        <Metrica
          href="/direccion/valores?estado=borrador"
          Icono={CheckCircle2}
          numero={borradores}
          etiqueta={borradores === 1 ? 'espera tu visto bueno' : 'esperan tu visto bueno'}
          nota="Nada se usa hasta que tú lo apruebes."
          resaltado={borradores > 0}
        />
        <Metrica
          href="/direccion/biblioteca"
          Icono={FileText}
          numero={documentos.length}
          etiqueta={documentos.length === 1 ? 'documento' : 'documentos'}
          nota="De aquí salen los números de arriba."
        />
      </section>

      {borradores > 0 ? (
        <Tarjeta className="border-amber-500/25 bg-amber-500/[0.04] p-4">
          <div className="flex flex-wrap items-center gap-3">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-amber-400" />
            <p className="flex-1 text-sm">
              Tienes <b>{borradores}</b> dato{borradores === 1 ? '' : 's'} que saqué de tus
              documentos y todavía no {borradores === 1 ? 'usa' : 'usan'} nadie.{' '}
              <span className="text-[hsl(var(--muted-foreground))]">
                Revísalos y quédate con los que sean correctos.
              </span>
            </p>
            <Link
              href="/direccion/valores?estado=borrador"
              className="shrink-0 rounded-md border border-amber-500/30 px-3 py-1.5 text-sm font-medium text-amber-300 hover:bg-amber-500/10"
            >
              Revisar ahora
            </Link>
          </div>
        </Tarjeta>
      ) : null}

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">Qué le falta a tu negocio</h2>
          <span className="text-xs text-[hsl(var(--muted-foreground))]">
            {taxonomia.name}
            {datos.meta?.industryType ? null : ' · aún sin definir tu giro'}
          </span>
        </div>

        {totalHuecos === 0 ? (
          <Tarjeta className="flex items-center gap-2 p-4 text-sm">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            No falta nada de lo básico de tu giro. Tus agentes tienen con qué contestar.
          </Tarjeta>
        ) : (
          <>
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              Son {totalHuecos} dato{totalHuecos === 1 ? '' : 's'} que tus agentes todavía no
              conocen. Mientras falten, van a decir que no saben en vez de inventarlos.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              {huecos.map((g) => (
                <TarjetaHueco key={g.areaSlug} gap={g} />
              ))}
            </div>
          </>
        )}
      </section>

      {embeddings.ok ? null : (
        <Tarjeta className="flex items-start gap-2 p-3 text-xs text-[hsl(var(--muted-foreground))]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
          <span>
            La búsqueda por significado está en pausa ({embeddings.reason}). La búsqueda por
            palabras sigue funcionando y los documentos se indexan solos cuando vuelva.
          </span>
        </Tarjeta>
      )}

      <section className="grid gap-3 sm:grid-cols-3">
        <Atajo
          href="/direccion/ingesta"
          Icono={ClipboardPaste}
          titulo="Agregar un documento"
          texto="Pega precios, políticas o procesos y te propongo los datos."
        />
        <Atajo
          href="/direccion/valores"
          Icono={Layers}
          titulo="Editar un número"
          texto="Cámbialo aquí y se actualiza en todos lados."
        />
        <Atajo
          href="/direccion/biblioteca"
          Icono={Search}
          titulo="Buscar en tus documentos"
          texto="Por significado, no sólo por palabra exacta."
        />
      </section>
    </div>
  );
}

function Metrica({
  href,
  Icono,
  numero,
  etiqueta,
  nota,
  resaltado,
}: {
  href: string;
  Icono: typeof Layers;
  numero: number;
  etiqueta: string;
  nota: string;
  resaltado?: boolean;
}) {
  return (
    <Link href={href} className="group">
      <Tarjeta
        className={`h-full p-4 transition-colors ${
          resaltado
            ? 'border-amber-500/25 bg-amber-500/[0.04]'
            : 'group-hover:border-[hsl(var(--primary))]/30'
        }`}
      >
        <Icono className={resaltado ? 'h-4 w-4 text-amber-400' : 'h-4 w-4 text-[hsl(var(--primary))]'} />
        <p className="mt-2 text-2xl font-semibold tabular-nums">{numero}</p>
        <p className="text-sm">{etiqueta}</p>
        <p className="mt-1 text-xs leading-snug text-[hsl(var(--muted-foreground))]">{nota}</p>
      </Tarjeta>
    </Link>
  );
}

function TarjetaHueco({ gap }: { gap: AreaGap }) {
  const total = gap.missingValues.length + gap.missingDocs.length;
  return (
    <Tarjeta className="p-4">
      <div className="flex items-center gap-2">
        <h3 className="flex-1 text-sm font-medium">{gap.areaLabel}</h3>
        <Insignia tono="borrador">
          {total} pendiente{total === 1 ? '' : 's'}
        </Insignia>
      </div>

      {gap.missingValues.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {gap.missingValues.map((v) => (
            <li key={v.key} className="flex items-baseline gap-2 text-sm">
              <span className="font-mono text-[11px] text-[hsl(var(--primary))]">{v.key}</span>
              {v.hint ? (
                <span className="text-xs text-[hsl(var(--muted-foreground))]">{v.hint}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {gap.missingDocs.length > 0 ? (
        <ul className="mt-3 space-y-1.5 border-t border-[hsl(var(--border))] pt-3">
          {gap.missingDocs.map((d) => (
            <li key={`${d.docType}-${d.title}`} className="flex items-baseline gap-2 text-sm">
              <BookOpen className="h-3 w-3 shrink-0 translate-y-0.5 text-[hsl(var(--muted-foreground))]" />
              <span>
                {d.title}
                {d.hint ? (
                  <span className="ml-1 text-xs text-[hsl(var(--muted-foreground))]">· {d.hint}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </Tarjeta>
  );
}

function Atajo({
  href,
  Icono,
  titulo,
  texto,
}: {
  href: string;
  Icono: typeof Layers;
  titulo: string;
  texto: string;
}) {
  return (
    <Link href={href} className="group">
      <Tarjeta className="h-full p-4 transition-colors group-hover:border-[hsl(var(--primary))]/30">
        <Icono className="h-4 w-4 text-[hsl(var(--primary))]" />
        <p className="mt-2 text-sm font-medium">{titulo}</p>
        <p className="mt-1 text-xs leading-snug text-[hsl(var(--muted-foreground))]">{texto}</p>
      </Tarjeta>
    </Link>
  );
}
