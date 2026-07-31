/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El adaptador de navegador de `suscribirseACorrida`.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Todo lo que sabe del transporte está aquí y en `@abraxa/flows/ui`:
 *
 *    · esta función pone el `fetch` y el `document.visibilityState`;
 *    · la lógica —cada cuánto, cuándo parar, qué hacer al fallar— vive en el
 *      paquete, donde se prueba con un reloj falso y sin navegador.
 *
 *  El panel importa `seguirCorrida` y no sabe nada más. El día que exista
 *  `LISTEN`/`NOTIFY`, cambia esto y `ui/suscripcion.ts`; la pantalla no.
 */
import { suscribirseACorrida } from '@abraxa/flows/ui';
import type { RunSnapshot } from '@abraxa/flows/ui';

/** Pide una foto al BFF. `no-store` para que ningún intermedio la congele. */
async function pedirCorrida(runId: string): Promise<RunSnapshot> {
  const r = await fetch(`/automatizaciones/api/runs/${encodeURIComponent(runId)}`, {
    cache: 'no-store',
    headers: { accept: 'application/json' },
  });
  if (!r.ok) {
    const cuerpo = (await r.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(cuerpo?.error?.message ?? `La API respondió ${r.status}`);
  }
  return (await r.json()) as RunSnapshot;
}

/** La visibilidad de la pestaña, del `document` de verdad. */
const visibilidadDelNavegador = {
  visible: (): boolean =>
    typeof document === 'undefined' || document.visibilityState === 'visible',
  alCambiar: (cb: () => void): (() => void) => {
    if (typeof document === 'undefined') return () => undefined;
    document.addEventListener('visibilitychange', cb);
    return () => document.removeEventListener('visibilitychange', cb);
  },
};

/**
 * Sigue una corrida en vivo. Devuelve cómo dejar de seguirla.
 *
 * Un segundo entre fotos: se ve vivo para un humano y funciona de verdad. Se
 * apaga sola cuando la corrida termina y cuando la pestaña se oculta — las dos
 * cosas están probadas en `packages/flows/src/ui/suscripcion.test.ts`.
 */
export function seguirCorrida(
  runId: string,
  alRecibir: (foto: RunSnapshot) => void,
  alFallar?: (err: unknown) => void,
): () => void {
  return suscribirseACorrida(runId, alRecibir, {
    pedir: pedirCorrida,
    intervaloMs: 1000,
    visibilidad: visibilidadDelNavegador,
    ...(alFallar ? { alFallar } : {}),
  });
}
