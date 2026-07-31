import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Dirección · ABRAXA Plataforma' };

/**
 * ANDAMIO DE H1 — bórralo y escribe lo tuyo. Es de H4.
 * Ruta: /direccion · archivo: apps/web/app/(app)/direccion/page.tsx
 */
export default function Page() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6 py-24">
      <p className="text-sm font-medium uppercase tracking-widest text-[hsl(var(--primary))]">
        H4
      </p>
      <h1 className="text-4xl font-semibold tracking-tight">Dirección</h1>
      <p className="text-lg text-[hsl(var(--muted-foreground))]">La bóveda: tus números, tus documentos y tu biblioteca. Definidos una vez, propagados a todo.</p>
      <p className="mt-6 text-sm text-[hsl(var(--muted-foreground))]">
        Andamio de H1. La ruta <code className="text-[hsl(var(--foreground))]">/direccion</code> ya existe y
        renderiza; el contenido lo trae H4 en su carril.
      </p>
    </main>
  );
}
