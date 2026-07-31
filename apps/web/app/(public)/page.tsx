import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Tu negocio, operando solo · ABRAXA Plataforma' };

/**
 * ANDAMIO DE H1 — bórralo y escribe lo tuyo. Es de H10.
 * Ruta: / · archivo: apps/web/app/(public)/page.tsx
 */
export default function Page() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6 py-24">
      <p className="text-sm font-medium uppercase tracking-widest text-[hsl(var(--primary))]">
        H10
      </p>
      <h1 className="text-4xl font-semibold tracking-tight">Tu negocio, operando solo</h1>
      <p className="text-lg text-[hsl(var(--muted-foreground))]">Qué es, qué cambia en tu día y cómo empezar — sin que nadie meta la mano.</p>
      <p className="mt-6 text-sm text-[hsl(var(--muted-foreground))]">
        Andamio de H1. La ruta <code className="text-[hsl(var(--foreground))]">/</code> ya existe y
        renderiza; el contenido lo trae H10 en su carril.
      </p>
    </main>
  );
}
