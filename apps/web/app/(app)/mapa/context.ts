import { tryPort } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';

/**
 * El contexto del tenant para el Mapa de Negocio.
 *
 * Se construye SIEMPRE server-side desde una sesión verificada. Lo entrega
 * `TenancyPort.contextFor()` (H2), y mientras el puente con la sesión no
 * aterrice esto devuelve `null` — que es la respuesta honesta.
 *
 * Lo que NO se hace es leer el correo de una cabecera o de una cookie y seguir
 * adelante. Ese 403 es lo único que impide que el cliente A vea el mapa del B,
 * y una pantalla que "mientras tanto" le cree al navegador es exactamente cómo
 * se coló un agujero de aislamiento a `main` el 2026-07-31.
 *
 * El mismo razonamiento y el mismo TODO están en `(app)/layout.tsx` (H5) y en
 * `(app)/tareas/context.ts` (H9): el punto de cableado con la sesión es uno
 * solo y aterriza en todos a la vez.
 */
export async function contextoDelMapa(): Promise<TenantContext | null> {
  const tenancy = tryPort('tenancy');
  if (!tenancy) return null;

  // TODO(H18/H2): leer la sesión verificada y llamar
  //   tenancy.contextFor({ userEmail, tenantSlug })
  // En cuanto exista, esta pantalla empieza a servir datos reales sin que
  // cambie una línea de `page.tsx` ni de `actions.ts`.
  return null;
}

/** Por qué no hay datos, para poder decirlo con precisión en la pantalla. */
export function motivoSinContexto(): string {
  return tryPort('tenancy')
    ? 'Falta cablear la sesión verificada con TenancyPort.contextFor().'
    : 'El módulo de sesión y empresa (H2) todavía no está registrado.';
}
