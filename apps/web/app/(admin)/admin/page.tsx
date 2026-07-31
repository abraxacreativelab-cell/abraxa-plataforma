import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Panel de agencia · ABRAXA Plataforma' };

/**
 * ANDAMIO DE H1 — bórralo y escribe lo tuyo. Es de H14.
 * Ruta: /admin · archivo: apps/web/app/(admin)/admin/page.tsx
 */
export default function Page() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6 py-24">
      <p className="text-sm font-medium uppercase tracking-widest text-[hsl(var(--primary))]">
        H14
      </p>
      <h1 className="text-4xl font-semibold tracking-tight">Panel de agencia</h1>
      <p className="text-lg text-[hsl(var(--muted-foreground))]">Ver y operar varias empresas desde un solo lugar.</p>
      <p className="mt-6 text-sm text-[hsl(var(--muted-foreground))]">
        Andamio de H1. La ruta <code className="text-[hsl(var(--foreground))]">/admin</code> ya existe y
        renderiza; el contenido lo trae H14 en su carril.
      </p>
    </main>
  );
}
