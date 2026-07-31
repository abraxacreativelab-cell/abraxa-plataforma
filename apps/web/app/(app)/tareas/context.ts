import { tryPort } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';

/**
 * El contexto del tenant para la pantalla de tareas.
 *
 * Se construye SIEMPRE server-side desde una sesión verificada. Lo entrega
 * `TenancyPort.contextFor()` (H2), y mientras H2 no aterrice esto devuelve
 * `null` — que es la respuesta honesta.
 *
 * Lo que NO se hace es leer el correo de una cabecera o de una cookie y seguir
 * adelante. Ese 403 es lo único que impide que el cliente A lea las tareas del
 * B, y una pantalla que "mientras tanto" confía en el navegador es exactamente
 * cómo se cuela un agujero de aislamiento a producción.
 *
 * El mismo razonamiento y el mismo TODO están en `(app)/layout.tsx`, que es de
 * H5: el punto de cableado con la sesión es de H2 y aterriza en los dos a la
 * vez.
 */
export async function contextoDeTareas(): Promise<TenantContext | null> {
  const tenancy = tryPort('tenancy');
  if (!tenancy) return null;

  // TODO(H2): leer la sesión verificada y llamar
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
