/**
 * De una petición HTTP al `TenantContext` verificado.
 *
 * El contrato de headers lo fijó H1 en `@abraxa/config`:
 *
 *   x-user-email    el correo, YA verificado server-side por el BFF de Next
 *                   contra la sesión. Nunca lo manda el navegador.
 *   x-tenant-slug   qué empresa pide. NO se confía: `contextFor()` lo valida
 *                   contra las membresías y lanza 403 si no cuadra.
 *
 * Ese 403 es lo único que impide que el cliente A lea los datos del cliente B,
 * así que aquí no se toma ningún atajo: sin `TenancyPort` no hay contexto, y
 * sin contexto no hay respuesta.
 */
import { HEADER } from '@abraxa/config';
import { PlatformError, usePort } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';

interface PeticionMinima {
  header(name: string): string | undefined;
}

export async function contextoDe(req: PeticionMinima): Promise<TenantContext> {
  const userEmail = (req.header(HEADER.userEmail) ?? '').trim();
  const tenantSlug = (req.header(HEADER.tenantSlug) ?? '').trim();

  if (!userEmail) {
    throw new PlatformError(
      'UNAUTHENTICATED',
      'Falta la identidad de la sesión. Esta API se consume a través del BFF, no directo.',
    );
  }
  if (!tenantSlug) {
    throw new PlatformError('VALIDATION', 'Falta indicar de qué empresa se trata.');
  }

  // `usePort` lanza PORT_NOT_IMPLEMENTED (501) con el nombre del handoff que
  // falta si H2 todavía no aterriza. Es mejor mensaje que cualquier respaldo
  // que pudiera improvisar aquí — y sobre todo, no inventa un contexto.
  const tenancy = usePort('tenancy');
  return tenancy.contextFor({ userEmail, tenantSlug });
}
