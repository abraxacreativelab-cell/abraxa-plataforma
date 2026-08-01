'use client';

import * as React from 'react';
import { Icon } from '../primitives/icon';
import { cn } from '../../lib/cn';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  La frontera de error del shell — lo primero que hay que cerrar
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Trece carriles cuelgan sus pantallas de `(app)/layout.tsx`. Cualquiera de
 *  ellas puede lanzar: un `undefined.map`, un JSON que cambió de forma, una API
 *  que contestó 500 dentro de un Server Component. Sin una frontera, eso es la
 *  pantalla BLANCA de React —o peor, un stack trace— delante de un invitado.
 *
 *  ── Por qué una clase y no `error.tsx` ─────────────────────────────────────
 *
 *  `error.tsx` sería lo idiomático, pero `apps/web/app/(app)/error.tsx` no cae
 *  en los globs de NINGÚN carril de `.ownership.json` (h1 sólo cubre `page.tsx`
 *  y `layout.tsx`), así que crearlo dejaría un archivo huérfano y
 *  `--check-overlap` —que corre en el PR de los 15 carriles— se pondría rojo
 *  para todos. Esto vive en `packages/ui`, que sí es de H5, y hace exactamente
 *  lo mismo: `error.tsx` de Next ES un ErrorBoundary de cliente, y React
 *  entrega a la frontera más cercana también los errores de Server Components,
 *  porque viajan por el payload RSC y se relanzan al hidratar.
 *
 *  ── Las tres cosas que hace y ninguna más ──────────────────────────────────
 *
 *   1. **Dice algo digno, en español.** Nunca "Application error", nunca un
 *      stack. El detalle técnico sólo se pinta fuera de producción.
 *   2. **Deja salir.** Reintentar sin recargar y un camino de vuelta al panel.
 *      Un error sin salida es un callejón, y en un evento con invitados el
 *      callejón se resuelve cerrando la pestaña.
 *   3. **Se rearma al navegar.** Sin `resetKey`, React deja la frontera en
 *      estado de error para siempre: el usuario pica otra sección, la ruta
 *      cambia, y sigue viendo el mismo error de la anterior. Es el defecto
 *      clásico de los ErrorBoundary escritos a mano.
 */

export interface FronteraDeErrorProps {
  /** Cambia al navegar (el pathname). Al cambiar, la frontera se rearma. */
  resetKey?: string;
  /** Qué se estaba intentando ver. Entra en el texto: "…al abrir Bandeja". */
  contexto?: string | null;
  children: React.ReactNode;
}

interface EstadoFrontera {
  error: Error | null;
  /** El `resetKey` con el que se capturó, para saber si ya cambió. */
  clave: string | undefined;
}

export class FronteraDeError extends React.Component<FronteraDeErrorProps, EstadoFrontera> {
  constructor(props: FronteraDeErrorProps) {
    super(props);
    this.state = { error: null, clave: props.resetKey };
  }

  static getDerivedStateFromError(error: Error): Pick<EstadoFrontera, 'error'> {
    return { error };
  }

  /**
   * El rearme al navegar. Va aquí y no en un `useEffect` porque tiene que
   * pasar ANTES del render: si esperara a un efecto, se pintaría un frame con
   * el error de la pantalla anterior encima de la nueva.
   */
  static getDerivedStateFromProps(
    props: FronteraDeErrorProps,
    state: EstadoFrontera,
  ): EstadoFrontera | null {
    if (state.error && props.resetKey !== state.clave) {
      return { error: null, clave: props.resetKey };
    }
    if (props.resetKey !== state.clave) return { ...state, clave: props.resetKey };
    return null;
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Se registra SIEMPRE, también en producción: el invitado ve una frase
    // amable, pero nosotros tenemos que poder ver qué pasó sin pedirle que nos
    // cuente. `console.error` es lo único disponible aquí — `packages/ui` no
    // puede arrastrar un logger de servidor al navegador.
    console.error('[abraxa] una pantalla del producto falló', error, info.componentStack);
  }

  private reintentar = (): void => {
    this.setState({ error: null });
  };

  override render(): React.ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <PantallaDeFallo
        error={this.state.error}
        contexto={this.props.contexto ?? null}
        onReintentar={this.reintentar}
      />
    );
  }
}

// ════════════════════════════════════════════════════════════════════════════

export interface PantallaDeFalloProps {
  error?: Error | null;
  contexto?: string | null;
  onReintentar?: () => void;
  /** Fuera de producción se enseña el mensaje técnico. Se puede forzar en
   *  pruebas sin tocar `process.env`. */
  mostrarDetalle?: boolean;
  className?: string;
}

/**
 * Lo que ve el invitado cuando algo se rompe.
 *
 * Separada de la clase a propósito: así se puede renderizar y verificar en una
 * prueba sin tener que provocar un error real dentro de React, que en el
 * renderizador de servidor no se puede atrapar.
 *
 * El rojo sale del token semántico de error, que NO sigue al acento — un fallo
 * se ve igual de rojo dentro de un área dorada que dentro de una verde.
 */
export function PantallaDeFallo({
  error,
  contexto,
  onReintentar,
  mostrarDetalle,
  className,
}: PantallaDeFalloProps) {
  const detalle =
    (mostrarDetalle ?? process.env.NODE_ENV !== 'production') && error?.message
      ? error.message
      : null;

  return (
    <main
      role="alert"
      className={cn(
        'mx-auto flex w-full max-w-xl flex-col items-center px-6 py-16 text-center sm:py-24',
        className,
      )}
    >
      <div className="glass-btn mb-6 grid h-14 w-14 place-items-center rounded-full">
        <Icon name="warning" className="h-6 w-6 text-[hsl(var(--color-error-fg))]" />
      </div>

      <p className="eyebrow">Algo se rompió de nuestro lado</p>

      <h1 className="mt-3 text-balance text-2xl font-light tracking-tight sm:text-3xl">
        {contexto ? `No pudimos abrir ${contexto}.` : 'No pudimos abrir esta pantalla.'}
      </h1>

      <p className="mt-4 text-pretty text-sm leading-relaxed text-muted-foreground">
        No fue algo que hiciste tú, y no se perdió nada de tu negocio. Ya quedó registrado de
        nuestro lado. Puedes volver a intentarlo o seguir en otra sección.
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        {onReintentar && (
          <button
            type="button"
            onClick={onReintentar}
            className="glass-btn inline-flex min-h-11 items-center gap-2 rounded-md px-4 text-sm text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Icon name="refresh" className="h-3.5 w-3.5" />
            Intentar de nuevo
          </button>
        )}
        <a
          href="/panel"
          className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-4 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Icon name="resumen" className="h-3.5 w-3.5" />
          Volver a tu panel
        </a>
      </div>

      {detalle && (
        <p className="mt-10 max-w-full overflow-x-auto rounded-md border border-dashed border-border px-4 py-3 text-left font-mono text-[11px] leading-relaxed text-muted-foreground/70">
          {detalle}
        </p>
      )}
    </main>
  );
}
