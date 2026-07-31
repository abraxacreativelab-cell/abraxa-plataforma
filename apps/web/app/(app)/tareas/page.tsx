import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Tareas · ABRAXA Plataforma' };

/**
 * ANDAMIO DE H1 — bórralo y escribe lo tuyo. Es de H9.
 * Ruta: /tareas · archivo: apps/web/app/(app)/tareas/page.tsx
 */
export default function Page() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6 py-24">
      <p className="text-sm font-medium uppercase tracking-widest text-[hsl(var(--primary))]">
        H9
      </p>
      <h1 className="text-4xl font-semibold tracking-tight">Tareas</h1>
      <p className="text-lg text-[hsl(var(--muted-foreground))]">Qué hay que hacer, quién lo trae y qué se vence esta semana.</p>
      <p className="mt-6 text-sm text-[hsl(var(--muted-foreground))]">
        Andamio de H1. La ruta <code className="text-[hsl(var(--foreground))]">/tareas</code> ya existe y
        renderiza; el contenido lo trae H9 en su carril.
      </p>
    </main>
  );
}
