import Link from 'next/link';

/**
 * Layout del route group `(public)`. Dueño: H10 · packages/billing.
 *
 * Landing, cobro y alta self-service. **No lleva el shell del producto**: aquí
 * todavía no hay sesión, no hay empresa y no hay áreas que navegar. Una barra
 * lateral vacía en la pantalla de venta sólo comunica que falta algo.
 *
 * El acento se queda en el neutro que define H5 (`--primary` por defecto). El
 * acento contextual distingue áreas DEL NEGOCIO del emprendedor, y aquí
 * todavía no tiene negocio.
 */
export default function GroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-[hsl(var(--background)/0.8)] backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-5 sm:px-6">
          <Link
            href="/"
            className="font-display text-sm font-semibold tracking-[0.2em] text-foreground"
          >
            ABRAXA
          </Link>
          <Link
            href="/#empezar"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Empezar
          </Link>
        </div>
      </header>

      <div className="flex-1">{children}</div>

      <footer className="border-t border-border/60 py-8">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-5 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>ABRAXA · Ciudad de México</p>
          <p>
            ¿Dudas antes de empezar?{' '}
            <a
              className="text-foreground underline underline-offset-4"
              href="mailto:hola@abraxa.club"
            >
              hola@abraxa.club
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
