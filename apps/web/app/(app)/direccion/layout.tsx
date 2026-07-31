import type { Metadata } from 'next';
import Link from 'next/link';
import { BookOpen, ClipboardPaste, Compass, Layers } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Dirección · ABRAXA',
  description: 'Tu bóveda: los números, los documentos y la biblioteca de tu negocio.',
};

/**
 * El área Dirección.
 *
 * El acento es ámbar, como manda H5 §6 para esta área. Va en una variable CSS
 * y no en clases con color: cambiar `--primary` aquí recolorea todo el subárbol
 * sin tocar un solo componente. Ésa es la ley visual de GARDEN que se conserva.
 *
 * Cuando H5 publique `accentVars()` —que sube la luminosidad en bucle hasta
 * garantizar contraste AA— estas tres líneas se sustituyen por una llamada.
 */
const ACENTO_DIRECCION = {
  '--primary': '38 92% 58%',
  '--ring': '38 92% 58%',
  '--primary-foreground': '222 28% 6%',
} as React.CSSProperties;

const PESTANAS = [
  { href: '/direccion', label: 'Panel', Icono: Compass },
  { href: '/direccion/valores', label: 'Valores', Icono: Layers },
  { href: '/direccion/biblioteca', label: 'Biblioteca', Icono: BookOpen },
  { href: '/direccion/ingesta', label: 'Agregar documento', Icono: ClipboardPaste },
];

export default function DireccionLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-area="direccion" style={ACENTO_DIRECCION} className="min-h-screen">
      <header className="border-b border-[hsl(var(--border))]">
        <div className="mx-auto max-w-6xl px-4 pt-6 sm:px-6">
          <div className="flex items-center gap-2">
            <Compass className="h-5 w-5 text-[hsl(var(--primary))]" />
            <h1 className="text-lg font-semibold tracking-tight">Dirección</h1>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-[hsl(var(--muted-foreground))]">
            Aquí vive cada número de tu negocio. Lo defines una vez y se actualiza solo en tus
            contratos, tus mensajes y lo que contestan tus agentes.
          </p>

          <nav className="mt-4 flex gap-1 overflow-x-auto" aria-label="Secciones de Dirección">
            {PESTANAS.map(({ href, label, Icono }) => (
              <Link
                key={href}
                href={href}
                className="flex shrink-0 items-center gap-1.5 rounded-t-md border-b-2 border-transparent px-3 py-2 text-sm text-[hsl(var(--muted-foreground))] transition-colors hover:border-[hsl(var(--border))] hover:text-[hsl(var(--foreground))]"
              >
                <Icono className="h-3.5 w-3.5" />
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
