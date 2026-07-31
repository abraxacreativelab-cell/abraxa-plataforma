import * as React from 'react';
import { cn } from '../../lib/cn';

/**
 * Select nativo, como en GARDEN, y a propósito: en móvil el selector del
 * sistema operativo se maneja mejor que cualquier lista que dibujemos nosotros,
 * y ya viene accesible. Un combobox de Radix sólo hace falta cuando hay que
 * buscar dentro de las opciones.
 */
export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'h-9 rounded-md border border-input bg-background/40 px-3 py-1 text-sm text-foreground shadow-sm transition-colors focus-visible:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = 'Select';
