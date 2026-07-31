import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Automatizaciones · ABRAXA Plataforma' };

/**
 * ANDAMIO DE H1 — bórralo y escribe lo tuyo. Es de H8.
 * Ruta: /automatizaciones · archivo: apps/web/app/(app)/automatizaciones/page.tsx
 */
export default function Page() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6 py-24">
      <p className="text-sm font-medium uppercase tracking-widest text-[hsl(var(--primary))]">
        H8
      </p>
      <h1 className="text-4xl font-semibold tracking-tight">Automatizaciones</h1>
      <p className="text-lg text-[hsl(var(--muted-foreground))]">Descríbelo en español y míralo correr paso por paso.</p>
      <p className="mt-6 text-sm text-[hsl(var(--muted-foreground))]">
        Andamio de H1. La ruta <code className="text-[hsl(var(--foreground))]">/automatizaciones</code> ya existe y
        renderiza; el contenido lo trae H8 en su carril.
      </p>
    </main>
  );
}
