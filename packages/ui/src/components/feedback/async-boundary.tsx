'use client';

import * as React from 'react';
import { EmptyState } from './empty-state';
import { LoadError, type LoadFailure } from './load-error';
import { SkeletonText } from '../primitives/skeleton';

/**
 * El estado de cualquier carga del producto. Los tres casos son EXCLUYENTES y
 * el tipo lo obliga: no se puede tener datos y error a la vez, ni quedarse en
 * "cargando" con datos ya puestos.
 */
export type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'error'; failure: LoadFailure }
  | { status: 'ready'; data: T };

export interface AsyncBoundaryProps<T> {
  state: AsyncState<T>;
  /** Qué se ve mientras carga. Por defecto, líneas de esqueleto. */
  skeleton?: React.ReactNode;
  /** Qué se ve cuando no hay nada. Si se omite, no se distingue vacío de
   *  contenido: el hijo decide. */
  empty?: React.ReactNode;
  /** Cómo se sabe que "no hay nada". Por defecto: array vacío. */
  isEmpty?: (data: T) => boolean;
  onRetry?: () => void;
  children: (data: T) => React.ReactNode;
}

const vacioPorDefecto = (data: unknown) =>
  Array.isArray(data) ? data.length === 0 : data === null || data === undefined;

/**
 * Decide entre cargando, error, vacío y contenido — y hace **estructuralmente
 * imposible** el error que más confianza cuesta: mostrar un cero cuando en
 * realidad la petición murió.
 *
 * Es la regla del handoff convertida en tipo, en vez de en disciplina. Los 13
 * handoffs que cuelgan del shell obtienen estados honestos sin escribirlos:
 *
 *   <AsyncBoundary state={estado} empty={<EmptyState title="Aún no tienes contactos" />}>
 *     {(contactos) => <Tabla filas={contactos} />}
 *   </AsyncBoundary>
 *
 * Nunca un spinner eterno: si la carga falla, el esqueleto cede su lugar a
 * `LoadError`, no se queda girando.
 */
export function AsyncBoundary<T>({
  state,
  skeleton,
  empty,
  isEmpty = vacioPorDefecto as (data: T) => boolean,
  onRetry,
  children,
}: AsyncBoundaryProps<T>) {
  if (state.status === 'loading') {
    return (
      <div aria-busy="true" aria-live="polite">
        {skeleton ?? <SkeletonText lines={4} />}
      </div>
    );
  }

  if (state.status === 'error') {
    return <LoadError failure={state.failure} onRetry={onRetry} />;
  }

  if (empty && isEmpty(state.data)) {
    return <>{empty}</>;
  }

  return <>{children(state.data)}</>;
}

/** Atajo cuando no hay un componente de vacío a la medida. */
export function DefaultEmpty({ title, description }: { title: string; description?: string }) {
  return <EmptyState title={title} description={description} />;
}
