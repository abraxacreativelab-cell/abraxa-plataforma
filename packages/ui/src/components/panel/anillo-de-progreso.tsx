import * as React from 'react';
import { cn } from '../../lib/cn';

export interface AnilloDeProgresoProps {
  /** 0–100. Se recorta a ese rango: un dato malo no puede pintar un anillo roto. */
  valor: number;
  /** Lo que va en el centro. Si no se pasa, el porcentaje. */
  children?: React.ReactNode;
  /** Texto para lectores de pantalla. El anillo es un `<svg>` decorativo. */
  etiqueta: string;
  className?: string;
}

/**
 * El progreso del Ritual, en un anillo.
 *
 * Cero hex: el arco es `stroke-primary`, así que hereda el acento del ámbito
 * donde se pinte. Dentro de `AccentScope` de un área toma su color; en el panel,
 * el de la marca del emprendedor.
 *
 * Se dibuja con `pathLength={100}` para que el `stroke-dasharray` sea
 * literalmente el porcentaje: sin `2πr`, sin número mágico, y sin que cambiar el
 * radio descuadre el arco.
 */
export function AnilloDeProgreso({ valor, children, etiqueta, className }: AnilloDeProgresoProps) {
  const pct = Math.max(0, Math.min(100, Number.isFinite(valor) ? valor : 0));

  return (
    <div
      className={cn('relative grid h-24 w-24 shrink-0 place-items-center', className)}
      role="img"
      aria-label={etiqueta}
    >
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden>
        <circle
          cx="50"
          cy="50"
          r="44"
          fill="none"
          strokeWidth="6"
          className="stroke-border"
          pathLength={100}
        />
        <circle
          cx="50"
          cy="50"
          r="44"
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          className="stroke-primary transition-[stroke-dasharray] duration-700"
          pathLength={100}
          strokeDasharray={`${pct} ${100 - pct}`}
        />
      </svg>

      <span className="tabular relative text-center text-lg font-light leading-none">
        {children ?? `${Math.round(pct)}%`}
      </span>
    </div>
  );
}
