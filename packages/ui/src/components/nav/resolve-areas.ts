import type { AreaSummary } from '@abraxa/db/ports';
// Desde `failure.ts`, NO desde `load-error.tsx`: esta función corre en el
// servidor y ese archivo es `'use client'`.
import { type LoadFailure, toLoadFailure } from '../feedback/failure';
import { type SenalesDelRitual, areasDeArranque } from './areas-de-arranque';

/**
 * De dónde salieron las áreas que está pintando el sidebar.
 *
 * `arranque` sustituye al antiguo `mock`, y no es sólo el nombre: el mock traía
 * cuatro áreas inventadas y cuatro rutas muertas. El catálogo de arranque son
 * las áreas del giro `general` de `app.industry_templates` —la misma semilla con
 * la que H11 va a materializar el mapa— y todas sus rutas existen.
 */
export type AreasResult =
  | { source: 'port'; areas: AreaSummary[]; failure?: never }
  | { source: 'arranque'; areas: AreaSummary[]; failure?: never }
  | { source: 'error'; areas: null; failure: LoadFailure };

/**
 * Resuelve la navegación. Es una función PURA a propósito: recibe el lector de
 * datos en vez de importarlo.
 *
 * Así `packages/ui` no arrastra `@abraxa/db` —ni por tanto el cliente de
 * Supabase— al paquete del navegador, y la lógica se puede probar sin levantar
 * nada. El cableado con `tryPort('areas')` vive en `(app)/layout.tsx`, que sí
 * corre en el servidor.
 *
 * Regla 5 del contrato: se programa contra `AreasPort`, no contra H11. Mientras
 * H11 no registre su implementación, `fetcher` llega en `null` y se usa el
 * catálogo de arranque, que se abre solo conforme avanza el Ritual.
 */
export async function resolveAreas(
  fetcher: (() => Promise<AreaSummary[]>) | null,
  senales: SenalesDelRitual | null = null,
): Promise<AreasResult> {
  // Ojo: el registro de herramientas NO se toca aquí. Esto corre en el
  // servidor y el sidebar lee el registro en el cliente — son dos instancias
  // distintas del módulo. Las de respaldo las registra `AppShell`, que sí corre
  // en los dos lados.
  if (!fetcher) return { source: 'arranque', areas: areasDeArranque(senales) };

  try {
    const areas = await fetcher();
    // Un arreglo vacío es un dato legítimo —un emprendedor recién dado de alta
    // no tiene áreas todavía— y NO es un error. El shell lo distingue.
    return { source: 'port', areas: [...areas].sort((a, b) => a.position - b.position) };
  } catch (e) {
    return { source: 'error', areas: null, failure: toLoadFailure(e) };
  }
}

/** ¿Se puede entrar? Las bloqueadas se ven, pero no se abren. */
export function isNavigable(area: Pick<AreaSummary, 'state' | 'access'>): boolean {
  return area.state !== 'bloqueada' && area.access !== null;
}
