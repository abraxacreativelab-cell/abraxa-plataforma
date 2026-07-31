/**
 * El tipo de una falla de carga y su traductor.
 *
 * Vive en su propio módulo **sin `'use client'`** a propósito: `resolveAreas`
 * corre en el servidor y necesita llamar a `toLoadFailure`. Si esto viviera en
 * `load-error.tsx` —que sí es cliente— Next lo trataría como una referencia de
 * cliente y llamarlo desde un componente de servidor fallaría.
 */

/** ¿Por qué falló? No es lo mismo "estás sin internet" que "no tienes permiso":
 *  el usuario tiene que hacer cosas distintas y reintentar sólo ayuda en unas. */
export type LoadFailureKind = 'red' | 'servidor' | 'permiso' | 'desconocido';

export interface LoadFailure {
  kind: LoadFailureKind;
  /** Código HTTP, si lo hubo. */
  status?: number;
  /** Detalle técnico. NO se le muestra al usuario: se registra. */
  detail?: string;
}

/** Traduce una respuesta o un error de red a una falla con causa. */
export function toLoadFailure(e: unknown): LoadFailure {
  if (e instanceof Response) {
    if (e.status === 401 || e.status === 403) return { kind: 'permiso', status: e.status };
    if (e.status >= 500) return { kind: 'servidor', status: e.status };
    return { kind: 'desconocido', status: e.status };
  }
  if (e instanceof TypeError) return { kind: 'red', detail: e.message };
  return { kind: 'desconocido', detail: e instanceof Error ? e.message : String(e) };
}

export const FAILURE_COPY: Record<
  LoadFailureKind,
  { titulo: string; texto: string; reintentar: boolean }
> = {
  red: {
    titulo: 'Sin conexión',
    texto: 'No pudimos comunicarnos con el servidor. Revisa tu conexión e inténtalo otra vez.',
    reintentar: true,
  },
  servidor: {
    titulo: 'Falló de nuestro lado',
    texto: 'El problema es nuestro, no tuyo. Ya quedó registrado. Puedes volver a intentarlo.',
    reintentar: true,
  },
  permiso: {
    titulo: 'Sin acceso',
    texto: 'Tu cuenta no tiene permiso para ver esto. Pídeselo a quien administra tu empresa.',
    reintentar: false,
  },
  desconocido: {
    titulo: 'Algo falló',
    texto: 'No pudimos cargar esta información. Inténtalo de nuevo en un momento.',
    reintentar: true,
  },
};
