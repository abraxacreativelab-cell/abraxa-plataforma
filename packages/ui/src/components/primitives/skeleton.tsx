import * as React from 'react';
import { cn } from '../../lib/cn';

/**
 * La alternativa honesta al spinner eterno. Un esqueleto dice "esto está por
 * llegar y va a tener esta forma"; un spinner sólo dice "espera", y si la
 * petición murió, espera para siempre.
 *
 * La regla del producto: nunca un spinner eterno, nunca un cero falso. Si la
 * carga falla, el esqueleto cede su lugar a `LoadError`, no se queda girando.
 *
 * El latido se apaga solo con `prefers-reduced-motion` (styles.css).
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn(
        'animate-pulse rounded-md bg-[hsl(var(--white)/0.06)] motion-reduce:animate-none',
        className,
      )}
      {...props}
    />
  );
}

/** Varias líneas de texto en carga. `lines` controla cuántas. */
export function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={cn('space-y-2', className)} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          className="h-3"
          // La última línea corta, como el texto real. Un bloque perfectamente
          // rectangular se lee como una caja, no como un párrafo cargando.
          style={{ width: i === lines - 1 ? '62%' : '100%' }}
        />
      ))}
    </div>
  );
}
