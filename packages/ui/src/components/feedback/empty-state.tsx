import * as React from 'react';
import { Icon } from '../primitives/icon';
import { cn } from '../../lib/cn';

export interface EmptyStateProps {
  /** Qué es lo que aún no existe. En español y en concreto: "Aún no tienes
   *  contactos" dice más que "Sin datos". */
  title: string;
  description?: string;
  icon?: string;
  /** La acción para crear el primero. Un estado vacío sin salida es un
   *  callejón. */
  children?: React.ReactNode;
  className?: string;
}

/**
 * Estado VACÍO: la petición salió bien y de verdad no hay nada todavía.
 *
 * Se ve claramente distinto de `LoadError` —borde neutro y tono de invitación,
 * contra borde rojo y tono de disculpa— porque son cosas distintas y el usuario
 * tiene que poder distinguirlas de un vistazo.
 */
export function EmptyState({
  title,
  description,
  icon = 'sparkles',
  children,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-dashed border-border bg-card/30 p-10 text-center',
        className,
      )}
    >
      <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full border border-border">
        <Icon name={icon} className="h-5 w-5 text-muted-foreground" />
      </div>

      <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">{title}</p>

      {description && (
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground/70">{description}</p>
      )}

      {children && <div className="mt-5 flex justify-center">{children}</div>}
    </div>
  );
}
