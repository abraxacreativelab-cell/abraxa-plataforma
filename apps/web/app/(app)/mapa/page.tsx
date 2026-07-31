import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Mapa de negocio · ABRAXA Plataforma' };

/**
 * ANDAMIO DE H1 — bórralo y escribe lo tuyo. Es de H11.
 * Ruta: /mapa · archivo: apps/web/app/(app)/mapa/page.tsx
 */
export default function Page() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6 py-24">
      <p className="text-sm font-medium uppercase tracking-widest text-[hsl(var(--primary))]">
        H11
      </p>
      <h1 className="text-4xl font-semibold tracking-tight">Mapa de negocio</h1>
      <p className="text-lg text-[hsl(var(--muted-foreground))]">Tus áreas: las que ya puedes usar, las que están en camino y qué te falta para abrirlas.</p>
      <p className="mt-6 text-sm text-[hsl(var(--muted-foreground))]">
        Andamio de H1. La ruta <code className="text-[hsl(var(--foreground))]">/mapa</code> ya existe y
        renderiza; el contenido lo trae H11 en su carril.
      </p>
    </main>
  );
}
