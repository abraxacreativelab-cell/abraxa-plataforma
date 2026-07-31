'use client';

import { Button } from '../primitives/button';
import { Icon } from '../primitives/icon';
import { cn } from '../../lib/cn';
import { FAILURE_COPY, type LoadFailure } from './failure';

export interface LoadErrorProps {
  failure?: LoadFailure;
  /** Sobrescribe el texto generado a partir de la causa. */
  description?: string;
  onRetry?: () => void;
  className?: string;
}

/**
 * Estado de ERROR de carga. **No es un estado vacío**, y por eso se ve
 * distinto: borde rojo, el motivo, y un camino para seguir.
 *
 * Un `0` cuando en realidad la petición murió es una mentira que le cuesta
 * confianza al producto. Es el acierto de GARDEN que aquí se conserva.
 *
 * El rojo sale del token semántico de error, que NO sigue al acento: un fallo
 * se ve igual de rojo dentro de un área verde que dentro de una dorada.
 */
export function LoadError({ failure, description, onRetry, className }: LoadErrorProps) {
  const copy = FAILURE_COPY[failure?.kind ?? 'desconocido'];

  return (
    <div
      role="alert"
      className={cn(
        'rounded-lg border border-dashed border-[hsl(var(--color-error-border))] bg-[hsl(var(--color-error-bg))] p-8 text-center',
        className,
      )}
    >
      <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full border border-[hsl(var(--color-error-border))]">
        <Icon name="warning" className="h-5 w-5 text-[hsl(var(--color-error-fg))]" />
      </div>

      <p className="font-mono text-xs uppercase tracking-widest text-[hsl(var(--color-error-fg))]">
        {copy.titulo}
      </p>

      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        {description ?? copy.texto}
        {failure?.status ? <span className="tabular ml-1 opacity-60">({failure.status})</span> : null}
      </p>

      {onRetry && copy.reintentar && (
        <Button variant="outline" size="sm" className="mt-5" onClick={onRetry}>
          <Icon name="refresh" className="h-3.5 w-3.5" />
          Reintentar
        </Button>
      )}
    </div>
  );
}

export { toLoadFailure, type LoadFailure, type LoadFailureKind } from './failure';
