'use server';

import { revalidatePath } from 'next/cache';
import { PlatformError } from '@abraxa/db';
import {
  createMilestone,
  declare,
  deleteMilestone,
  proposeMilestones,
  reorderMilestones,
  unlockArea,
  updateMilestone,
} from '@abraxa/areas';
import { contextoDelMapa, motivoSinContexto } from './context';

/**
 * Las acciones del Mapa de Negocio.
 *
 * Corren en el SERVIDOR y llaman a los servicios de `@abraxa/areas` en proceso,
 * con el mismo `TenantContext` que armó la página — sin dar la vuelta por HTTP
 * y sin que el navegador mande jamás un identificador de empresa.
 *
 * Todas devuelven `{ ok, error }` en vez de lanzar: una excepción en una server
 * action se convierte en un error genérico y opaco del lado del cliente, y el
 * usuario merece leer *"cerrar el área requiere permiso de administración"* y
 * no *"An error occurred in the Server Components render"*.
 */
export interface Resultado {
  ok: boolean;
  error: string | null;
}

const OK: Resultado = { ok: true, error: null };

/** Sin sesión verificada no se escribe nada. Nunca se cae a un tenant supuesto. */
async function conContexto(
  trabajo: (ctx: NonNullable<Awaited<ReturnType<typeof contextoDelMapa>>>) => Promise<unknown>,
): Promise<Resultado> {
  const ctx = await contextoDelMapa();
  if (!ctx) return { ok: false, error: motivoSinContexto() };

  try {
    await trabajo(ctx);
    revalidatePath('/mapa');
    return OK;
  } catch (e) {
    if (e instanceof PlatformError) return { ok: false, error: e.message };
    return { ok: false, error: 'No se pudo completar la acción.' };
  }
}

// ── Áreas ───────────────────────────────────────────────────────────────────

export async function abrirArea(slug: string): Promise<Resultado> {
  return conContexto((ctx) => unlockArea(ctx, slug));
}

/** "Sí, voy a contratar". Lo que ninguna tabla puede contar por él. */
export async function declararEnArea(slug: string, key: string): Promise<Resultado> {
  return conContexto((ctx) => declare(ctx, slug, key));
}

// ── Roadmap ─────────────────────────────────────────────────────────────────

export async function marcarHito(id: string, hecho: boolean): Promise<Resultado> {
  return conContexto((ctx) => updateMilestone(ctx, id, { done: hecho }));
}

export async function editarHito(id: string, titulo: string): Promise<Resultado> {
  return conContexto((ctx) => updateMilestone(ctx, id, { title: titulo }));
}

export async function agregarHito(titulo: string): Promise<Resultado> {
  return conContexto((ctx) => createMilestone(ctx, { title: titulo }));
}

export async function borrarHito(id: string): Promise<Resultado> {
  return conContexto((ctx) => deleteMilestone(ctx, id));
}

export async function reordenarHitos(ids: string[]): Promise<Resultado> {
  return conContexto((ctx) => reorderMilestones(ctx, ids));
}

/** Le pide al agente maestro que proponga el roadmap. No borra lo que ya hay. */
export async function proponerRoadmap(): Promise<Resultado> {
  const ctx = await contextoDelMapa();
  if (!ctx) return { ok: false, error: motivoSinContexto() };

  try {
    const r = await proposeMilestones(ctx);
    revalidatePath('/mapa');
    // `reason` no es un fallo del sistema: es el agente diciendo que no pudo.
    // Se devuelve como error para que la pantalla lo muestre tal cual.
    return r.created > 0 ? OK : { ok: false, error: r.reason };
  } catch (e) {
    if (e instanceof PlatformError) return { ok: false, error: e.message };
    return { ok: false, error: 'No se pudo pedir el roadmap.' };
  }
}
