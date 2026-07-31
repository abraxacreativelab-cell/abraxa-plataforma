'use client';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Los primitivos que a H9 le faltaban — y por qué están AQUÍ
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  `packages/ui` es de H5 y no se toca. H5 entrega botón, insignia, tarjeta,
 *  campo, selector, separador, esqueleto, icono y los estados honestos
 *  (`AsyncBoundary`, `EmptyState`, `LoadError`), y todo eso se usa tal cual.
 *
 *  Lo que no entrega y esta pantalla necesita: una ventana modal, un panel
 *  lateral, un menú, un avatar, una barra de progreso y una pastilla que se
 *  prende y se apaga. Se construyen aquí, dentro del carril de H9.
 *
 *  ── Sin Radix, a propósito ─────────────────────────────────────────────────
 *
 *  `@radix-ui/react-dialog` está instalado, pero como dependencia de
 *  `packages/ui`, no de `apps/web`. Usarlo desde aquí sería apoyarse en el
 *  aplanado de node_modules, y la regla 4 del contrato dice que las
 *  dependencias no se instalan desde un carril. Así que el diálogo se escribe
 *  a mano: `role="dialog"`, `aria-modal`, foco atrapado, Escape, clic fuera y
 *  el scroll del fondo bloqueado. Son cincuenta líneas y no le deben nada a
 *  nadie.
 *
 *  ── La ley de H5 sigue vigente ─────────────────────────────────────────────
 *
 *  Cero hex. Todo por token. El acento entra por `--primary` / `--glow`, y los
 *  cuatro estados semánticos (success, warning, error, info) son FIJOS: "listo"
 *  tiene que seguir siendo verde dentro de un área roja.
 */
import * as React from 'react';
import { cn } from '@abraxa/ui';
import { Icon } from '@abraxa/ui';
import { iniciales, nombreCorto } from '@abraxa/work/domain';

// ════════════════════════════════════════════════════════════════════════════
// Capa modal — la mecánica compartida entre la ventana y el panel lateral
// ════════════════════════════════════════════════════════════════════════════

const SELECTOR_ENFOCABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Atrapa el foco, cierra con Escape y devuelve el foco a donde estaba.
 *
 * Lo tercero es lo que casi siempre falta: si al cerrar el panel el foco se va
 * al `<body>`, quien navega con teclado vuelve a empezar desde el principio de
 * la página cada vez que mira una tarea.
 */
function useCapaModal(abierto: boolean, onClose: () => void) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const previo = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (!abierto) return;
    previo.current = document.activeElement as HTMLElement | null;

    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const nodo = ref.current;
    nodo?.querySelector<HTMLElement>(SELECTOR_ENFOCABLE)?.focus();

    const alTeclear = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !nodo) return;

      const enfocables = [...nodo.querySelectorAll<HTMLElement>(SELECTOR_ENFOCABLE)];
      const primero = enfocables[0];
      const ultimo = enfocables[enfocables.length - 1];
      if (!primero || !ultimo) return;

      if (e.shiftKey && document.activeElement === primero) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primero.focus();
      }
    };

    document.addEventListener('keydown', alTeclear, true);
    return () => {
      document.removeEventListener('keydown', alTeclear, true);
      document.body.style.overflow = overflow;
      previo.current?.focus?.();
    };
  }, [abierto, onClose]);

  return ref;
}

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  /** `centro` para confirmar algo, `lateral` para trabajar dentro. */
  variant?: 'centro' | 'lateral';
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function Modal({ open, onClose, title, description, variant = 'centro', children, footer }: ModalProps) {
  const ref = useCapaModal(open, onClose);
  const idTitulo = React.useId();
  if (!open) return null;

  const lateral = variant === 'lateral';

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex bg-background/70 backdrop-blur-sm',
        lateral ? 'justify-end' : 'items-center justify-center p-4',
      )}
      onMouseDown={(e) => {
        // `mousedown` y no `click`: si el usuario empieza a seleccionar texto
        // dentro y suelta fuera, un `click` cerraría el panel y perdería lo
        // que estaba escribiendo.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        className={cn(
          'glass flex flex-col overflow-hidden',
          lateral
            ? 'h-full w-full max-w-xl rounded-none border-l sm:rounded-l-lg'
            : 'w-full max-w-lg rounded-lg',
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 id={idTitulo} className="truncate text-base font-semibold tracking-tight">
              {title}
            </h2>
            {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Icon name="x" className="h-4 w-4" />
          </button>
        </header>

        <div className="scrollbar-thin flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Menú — la alternativa táctil a arrastrar
// ════════════════════════════════════════════════════════════════════════════

export interface MenuItem {
  label: string;
  icon?: string;
  onSelect: () => void;
  /** Marca la opción vigente. */
  active?: boolean;
  danger?: boolean;
}

/**
 * Menú desplegable.
 *
 * Existe sobre todo por el móvil: `draggable` de HTML5 no funciona con el
 * dedo, así que TODA acción que se puede hacer arrastrando se puede hacer
 * también desde aquí. Un tablero que sólo se opera con ratón es un tablero que
 * la mitad de la gente no puede usar.
 */
export function Menu({
  trigger,
  items,
  align = 'start',
  label,
}: {
  trigger: React.ReactNode;
  items: MenuItem[];
  align?: 'start' | 'end';
  label: string;
}) {
  const [abierto, setAbierto] = React.useState(false);
  const caja = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent): void => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false);
    };
    const escape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setAbierto(false);
    };
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', fuera);
      document.removeEventListener('keydown', escape);
    };
  }, [abierto]);

  return (
    <div ref={caja} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-label={label}
        onClick={() => setAbierto((v) => !v)}
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {trigger}
      </button>

      {abierto && (
        <div
          role="menu"
          className={cn(
            'glass absolute z-40 mt-1 min-w-48 overflow-hidden rounded-md py-1 shadow-lg',
            align === 'end' ? 'right-0' : 'left-0',
          )}
        >
          {items.map((item, i) => (
            <button
              // Las etiquetas de un menú pueden repetirse (dos proyectos con el
              // mismo nombre), así que el índice es la llave honesta.
              key={`${item.label}-${i}`}
              type="button"
              role="menuitem"
              onClick={() => {
                setAbierto(false);
                item.onSelect();
              }}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-secondary',
                item.active && 'text-primary',
                item.danger && 'text-[hsl(var(--color-error-fg))]',
              )}
            >
              {item.icon && <Icon name={item.icon} className="h-3.5 w-3.5 shrink-0" />}
              <span className="flex-1 truncate">{item.label}</span>
              {item.active && <Icon name="check" className="h-3.5 w-3.5 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Piezas pequeñas
// ════════════════════════════════════════════════════════════════════════════

/** Pastilla que se prende y se apaga. Es el filtro rápido del handoff §2.3. */
export function Chip({
  active,
  children,
  onClick,
  title,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        'rounded-full border px-3 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'border-primary/50 bg-primary/15 text-primary'
          : 'border-border text-muted-foreground hover:border-border hover:bg-secondary hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

export function Avatar({ email, name, className }: { email: string | null; name?: string | null; className?: string }) {
  return (
    <span
      title={email ?? 'Sin responsable'}
      className={cn(
        'inline-grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[10px] font-medium',
        email ? 'border-primary/40 bg-primary/10 text-primary' : 'border-dashed border-border text-muted-foreground',
        className,
      )}
    >
      {email ? iniciales(email, name) : '·'}
    </span>
  );
}

export function AvatarConNombre({ email, name }: { email: string | null; name?: string | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Avatar email={email} name={name} className="h-5 w-5 text-[9px]" />
      <span className="truncate">{nombreCorto(email, name)}</span>
    </span>
  );
}

/** Barra de progreso. `value` es 0–100 y se recorta: una barra al 120% dice
 *  más de un bug que del avance. */
export function Progress({ value, className, label }: { value: number; className?: string; label?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? 'Progreso'}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-secondary', className)}
    >
      <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Field({
  label,
  children,
  hint,
  htmlFor,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  htmlFor?: string;
}) {
  return (
    <label className="block space-y-1.5" htmlFor={htmlFor}>
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground/70">{hint}</span>}
    </label>
  );
}

/**
 * El aviso de que algo falló, sin tumbar la pantalla.
 *
 * Una acción que falla en silencio es peor que una que falla: el usuario cree
 * que quedó y se entera al recargar.
 */
export function Aviso({
  tone,
  children,
  onDismiss,
}: {
  tone: 'error' | 'warning' | 'info';
  children: React.ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2 rounded-md border px-3 py-2 text-sm',
        tone === 'error' &&
          'border-[hsl(var(--color-error-border))] bg-[hsl(var(--color-error-bg))] text-[hsl(var(--color-error-fg))]',
        tone === 'warning' &&
          'border-[hsl(var(--color-warning-border))] bg-[hsl(var(--color-warning-bg))] text-[hsl(var(--color-warning-fg))]',
        tone === 'info' &&
          'border-[hsl(var(--color-info-border))] bg-[hsl(var(--color-info-bg))] text-[hsl(var(--color-info-fg))]',
      )}
    >
      <Icon name={tone === 'info' ? 'help' : 'warning'} className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1">{children}</div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Descartar"
          className="rounded p-0.5 opacity-70 transition-opacity hover:opacity-100"
        >
          <Icon name="x" className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
