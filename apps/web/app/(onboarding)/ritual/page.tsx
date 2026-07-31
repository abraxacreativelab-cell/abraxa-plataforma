import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'El Ritual de Fundación · ABRAXA Plataforma' };

/**
 * ANDAMIO DE H1 — bórralo y escribe lo tuyo. Es de H7.
 * Ruta: /ritual · archivo: apps/web/app/(onboarding)/ritual/page.tsx
 */
export default function Page() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6 py-24">
      <p className="text-sm font-medium uppercase tracking-widest text-[hsl(var(--primary))]">
        H7
      </p>
      <h1 className="text-4xl font-semibold tracking-tight">El Ritual de Fundación</h1>
      <p className="text-lg text-[hsl(var(--muted-foreground))]">Tu agente aparece, te pide que le pongas nombre y entiende tu negocio. Puedes parar cuando quieras y volver mañana.</p>
      <p className="mt-6 text-sm text-[hsl(var(--muted-foreground))]">
        Andamio de H1. La ruta <code className="text-[hsl(var(--foreground))]">/ritual</code> ya existe y
        renderiza; el contenido lo trae H7 en su carril.
      </p>
    </main>
  );
}
