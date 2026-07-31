'use client';

/**
 * Primitivas mínimas de la UI de Dirección.
 *
 * ── Por qué están aquí y no en `@abraxa/ui` ─────────────────────────────────
 *
 * H5 es dueño del design system y su handoff enumera button, card, badge,
 * input, select-native, separator y empty-state. No incluye Modal ni Field, y
 * `sonner` (los avisos flotantes) no está en las dependencias que instaló H1 —
 * y la regla 4 prohíbe agregar ninguna.
 *
 * Así que estas viven en mi carril, sin dependencias nuevas, y el día que H5
 * publique las suyas se borran y se cambia el import. Anotado en el PR.
 *
 * Dos reglas de GARDEN que aquí sí se respetan:
 *   · Cero hex. Todo por token (`--primary`, `--border`, `--muted`…).
 *   · Los estados semánticos NO siguen al acento: un borrador se ve ámbar
 *     dentro de un área ámbar y también dentro de una verde. "Activo" no puede
 *     volverse rojo dentro de un área roja.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, Loader2, X } from 'lucide-react';

export function cn(...clases: Array<string | false | null | undefined>): string {
  return clases.filter(Boolean).join(' ');
}

// ─── Botón ───────────────────────────────────────────────────────────────────

type Variante = 'primario' | 'silencioso' | 'contorno' | 'peligro';

const VARIANTE: Record<Variante, string> = {
  primario:
    'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90 border-transparent',
  silencioso:
    'bg-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] border-transparent',
  contorno:
    'bg-transparent text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] border-[hsl(var(--border))]',
  peligro: 'bg-transparent text-rose-400 hover:bg-rose-500/10 border-transparent',
};

export function Boton({
  children,
  variante = 'contorno',
  cargando = false,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante; cargando?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || cargando}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-1.5',
        'text-sm font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
        'disabled:pointer-events-none disabled:opacity-50',
        VARIANTE[variante],
        className,
      )}
    >
      {cargando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
      {children}
    </button>
  );
}

// ─── Campos ──────────────────────────────────────────────────────────────────

const CAMPO =
  'w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 px-3 py-1.5 ' +
  'text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))]/60 ' +
  'focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))] disabled:opacity-50';

export function Entrada({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(CAMPO, className)} />;
}

export function AreaTexto({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(CAMPO, 'font-mono leading-relaxed', className)} />;
}

export function Selector({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cn(CAMPO, className)}>
      {children}
    </select>
  );
}

export function Campo({
  etiqueta,
  ayuda,
  children,
}: {
  etiqueta: string;
  ayuda?: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-[hsl(var(--muted-foreground))]">{etiqueta}</span>
      {children}
      {ayuda ? (
        <span className="block text-[11px] leading-snug text-[hsl(var(--muted-foreground))]/70">
          {ayuda}
        </span>
      ) : null}
    </label>
  );
}

// ─── Insignias ───────────────────────────────────────────────────────────────
// Los estados semánticos NO siguen al acento. Ver la nota de arriba.

type TonoInsignia = 'neutro' | 'activo' | 'borrador' | 'info' | 'alerta';

const TONO: Record<TonoInsignia, string> = {
  neutro: 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] border-[hsl(var(--border))]',
  activo: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25',
  borrador: 'bg-amber-500/10 text-amber-400 border-amber-500/25',
  info: 'bg-sky-500/10 text-sky-300 border-sky-500/25',
  alerta: 'bg-rose-500/10 text-rose-400 border-rose-500/25',
};

export function Insignia({
  children,
  tono = 'neutro',
  title,
}: {
  children: ReactNode;
  tono?: TonoInsignia;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium',
        TONO[tono],
      )}
    >
      {children}
    </span>
  );
}

// ─── Superficies ─────────────────────────────────────────────────────────────

export function Tarjeta({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20',
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * "No tienes nada" y "falló la carga" son cosas distintas y se ven distintas.
 * Un cero cuando en realidad la petición murió es una mentira que le cuesta
 * confianza al producto. GARDEN acertó en esto.
 */
export function SinNada({
  titulo,
  descripcion,
  children,
}: {
  titulo: string;
  descripcion?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-[hsl(var(--border))] px-6 py-14 text-center">
      <p className="text-sm font-medium">{titulo}</p>
      {descripcion ? (
        <p className="max-w-md text-sm text-[hsl(var(--muted-foreground))]">{descripcion}</p>
      ) : null}
      {children ? <div className="mt-2">{children}</div> : null}
    </div>
  );
}

export function FalloDeCarga({
  titulo = 'No pudimos cargar esto',
  detalle,
  children,
}: {
  titulo?: string;
  detalle?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-rose-500/25 bg-rose-500/[0.04] px-6 py-14 text-center">
      <AlertCircle className="h-5 w-5 text-rose-400" />
      <p className="text-sm font-medium">{titulo}</p>
      {detalle ? (
        <p className="max-w-md text-sm text-[hsl(var(--muted-foreground))]">{detalle}</p>
      ) : null}
      {children ? <div className="mt-2">{children}</div> : null}
    </div>
  );
}

// ─── Modal ───────────────────────────────────────────────────────────────────

export function Modal({
  abierto,
  titulo,
  onCerrar,
  children,
  pie,
}: {
  abierto: boolean;
  titulo: string;
  onCerrar: () => void;
  children: ReactNode;
  pie?: ReactNode;
}) {
  const contenedor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar();
    };
    document.addEventListener('keydown', alTeclear);
    contenedor.current?.focus();
    return () => document.removeEventListener('keydown', alTeclear);
  }, [abierto, onCerrar]);

  if (!abierto) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[hsl(var(--background))]/80 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onCerrar}
    >
      <div
        ref={contenedor}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] shadow-2xl focus:outline-none sm:rounded-xl"
      >
        <div className="flex items-center gap-2 border-b border-[hsl(var(--border))] px-4 py-3">
          <h2 className="flex-1 truncate text-sm font-semibold">{titulo}</h2>
          <button
            onClick={onCerrar}
            aria-label="Cerrar"
            className="grid h-7 w-7 place-items-center rounded text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">{children}</div>
        {pie ? (
          <div className="flex items-center justify-end gap-2 border-t border-[hsl(var(--border))] px-4 py-3">
            {pie}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─── Avisos flotantes ────────────────────────────────────────────────────────

export interface Aviso {
  id: number;
  texto: string;
  tono: 'ok' | 'error';
}

let siguienteId = 0;

/**
 * Un toaster diminuto porque `sonner` no está instalado y no puedo instalarlo.
 * Hace lo único que de verdad importa aquí: decir QUÉ se propagó al aprobar un
 * valor, en vez de un "guardado" que no informa nada.
 */
export function useAvisos() {
  const [avisos, setAvisos] = useState<Aviso[]>([]);

  const empujar = (texto: string, tono: 'ok' | 'error' = 'ok') => {
    const id = ++siguienteId;
    setAvisos((a) => [...a, { id, texto, tono }]);
    setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== id)), 6000);
  };

  return {
    avisos,
    ok: (t: string) => empujar(t, 'ok'),
    error: (t: string) => empujar(t, 'error'),
    cerrar: (id: number) => setAvisos((a) => a.filter((x) => x.id !== id)),
  };
}

export function Avisos({ avisos, onCerrar }: { avisos: Aviso[]; onCerrar: (id: number) => void }) {
  if (avisos.length === 0) return null;
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2"
    >
      {avisos.map((a) => (
        <div
          key={a.id}
          className={cn(
            'pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2 text-sm shadow-lg backdrop-blur',
            a.tono === 'ok'
              ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-100'
              : 'border-rose-500/25 bg-rose-500/10 text-rose-100',
          )}
        >
          <span className="flex-1 leading-snug">{a.texto}</span>
          <button
            onClick={() => onCerrar(a.id)}
            aria-label="Cerrar aviso"
            className="opacity-60 hover:opacity-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
