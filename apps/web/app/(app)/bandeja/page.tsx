import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Bandeja · ABRAXA Plataforma' };

/**
 * ANDAMIO DE H1 — bórralo y escribe lo tuyo. Es de H6.
 * Ruta: /bandeja · archivo: apps/web/app/(app)/bandeja/page.tsx
 */
export default function Page() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6 py-24">
      <p className="text-sm font-medium uppercase tracking-widest text-[hsl(var(--primary))]">
        H6
      </p>
      <h1 className="text-4xl font-semibold tracking-tight">Bandeja</h1>
      <p className="text-lg text-[hsl(var(--muted-foreground))]">Tu agente contesta a tus clientes mientras duermes. Y se calla en cuanto tomas el hilo.</p>
      <p className="mt-6 text-sm text-[hsl(var(--muted-foreground))]">
        Andamio de H1. La ruta <code className="text-[hsl(var(--foreground))]">/bandeja</code> ya existe y
        renderiza; el contenido lo trae H6 en su carril.
      </p>
    </main>
  );
}
