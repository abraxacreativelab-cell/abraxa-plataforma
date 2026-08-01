import Link from 'next/link';
import { RUTA_DE_ENTRADA } from '../../../../packages/auth/src/identidad';

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
 *
 * ── Por qué hay un "Entrar" y por qué apunta a donde apunta ────────────────
 *
 * El ensayo del 2026-07-31 buscó la palabra "Entrar" en el HTML de la landing
 * y no aparecía ni una vez. El único camino hacia adentro era el formulario
 * que va a Stripe, así que quien YA se dio de alta —o quien pagó ayer y hoy
 * vuelve— no tenía por dónde volver a entrar. Una plataforma sin puerta de
 * regreso pierde justo a los usuarios que ya convirtió.
 *
 * Va a `RUTA_DE_ENTRADA` (`/api/auth/signin`), la pantalla propia de NextAuth,
 * y NO a `/entrar`: esa ruta está listada como pública en `identidad.ts` para
 * que el día que exista no haya bucle, pero hoy NO EXISTE y enlazarla sería
 * cambiar un 404 por otro. La de NextAuth es fea y es un botón que funciona.
 *
 * ── `<a>` y no `<Link>`, a propósito ───────────────────────────────────────
 *
 * `/api/auth/signin` no es una página del App Router: es un Route Handler que
 * devuelve HTML. `<Link>` intentaría navegación de cliente y una carga RSC de
 * algo que no lo es. Se necesita una navegación de documento completa, que es
 * exactamente lo que hace un ancla normal. Es el mismo patrón que ya usa
 * `app/(app)/ajustes/page.tsx`.
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
          <nav className="flex items-center gap-4 sm:gap-6">
            <Link
              href="/#empezar"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Empezar
            </Link>
            <a
              href={RUTA_DE_ENTRADA}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:border-primary hover:text-primary"
            >
              Entrar
            </a>
          </nav>
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
