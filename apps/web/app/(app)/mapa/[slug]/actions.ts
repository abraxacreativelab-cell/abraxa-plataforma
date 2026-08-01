'use server';

import { revalidatePath } from 'next/cache';
import { PlatformError } from '@abraxa/db';
import { areaOnboarding, type OnboardingView } from '@abraxa/areas';
import { contextoDelMapa, motivoSinContextoTexto } from '../context';

/**
 * Las acciones del mini-onboarding de un área.
 *
 * Corren en el SERVIDOR y llaman a los servicios en proceso con el mismo
 * `TenantContext` que armó la página. Devuelven la vista completa en vez de
 * `void`: el tutorial es una conversación, y cada respuesta tiene que poder
 * pintar la siguiente pregunta sin recargar la página.
 */
export interface RespuestaAccion {
  ok: boolean;
  error: string | null;
  /** La vista ya avanzada. `null` si la acción no pudo correr. */
  view: OnboardingView | null;
  /** Por qué no hay resultado del agente, si es el caso. No es un fallo. */
  degraded?: string | null;
}

async function correr(
  trabajo: (
    ctx: NonNullable<Awaited<ReturnType<typeof contextoDelMapa>>>,
  ) => Promise<{ view: OnboardingView; degraded?: string | null }>,
): Promise<RespuestaAccion> {
  const ctx = await contextoDelMapa();
  if (!ctx) return { ok: false, error: motivoSinContextoTexto(), view: null };

  try {
    const { view, degraded } = await trabajo(ctx);
    revalidatePath('/mapa');
    return { ok: true, error: null, view, degraded: degraded ?? null };
  } catch (e) {
    if (e instanceof PlatformError) return { ok: false, error: e.message, view: null };
    return { ok: false, error: 'No se pudo continuar el tutorial.', view: null };
  }
}

export async function empezar(slug: string): Promise<RespuestaAccion> {
  return correr(async (ctx) => ({ view: await areaOnboarding.start(ctx, slug) }));
}

export async function responder(
  slug: string,
  key: string,
  texto: string,
): Promise<RespuestaAccion> {
  return correr(async (ctx) => ({ view: await areaOnboarding.answer(ctx, slug, key, texto) }));
}

export async function terminar(slug: string): Promise<RespuestaAccion> {
  return correr((ctx) => areaOnboarding.finish(ctx, slug));
}
