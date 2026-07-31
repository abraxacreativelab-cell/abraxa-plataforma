/**
 * ════════════════════════════════════════════════════════════════════════════
 *  LA PIEZA CANÓNICA: de una petición HTTP a un `TenantContext` verificado.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  **Ningún router de dominio escribe su propio `contextoDe`. Se importa el
 *  canónico:**
 *
 *      import { contextoDePeticion } from '@abraxa/db';
 *      const ctx = await contextoDePeticion(req);
 *
 * ── Por qué existe este archivo ────────────────────────────────────────────
 *
 * Entre el 2026-07-30 y el 07-31, CUATRO carriles escribieron cada uno su
 * propio resolvedor de contexto desde cero, y tres de los cuatro salieron mal
 * de la misma manera: leían `x-user-email` sin comprobar antes el secreto
 * compartido del BFF.
 *
 *   · H3 agents      packages/agents/src/routes.ts:34-48      (PR #12, cerrado)
 *   · H6 inbox       packages/inbox/src/routes/index.ts:179   (PR #10, abierto)
 *   · H7 ritual      packages/onboarding/src/routes.ts:30     (PR #8,  abierto)
 *   · H4 bóveda      packages/vault/src/http/context.ts       (¡ya en main!)
 *
 * Un carril que se equivoca es un error. Cuatro es un defecto de diseño: el
 * patrón correcto no estaba disponible como pieza importable, así que cada
 * carril tenía que reconstruirlo de memoria. Este archivo es esa pieza.
 *
 * ── Las tres puertas, y su orden ───────────────────────────────────────────
 *
 *  1. `proxyVerified(req)` — ANTES de mirar un solo header de identidad.
 *     `x-user-email` sólo significa algo si lo puso el proxy desde una sesión
 *     verificada server-side; puesto por el navegador es texto libre. En
 *     producción sin `PROXY_SECRET` esta puerta está CERRADA (fail-closed).
 *
 *  2. Identidad presente. Sin correo no hay quién; sin slug no hay cuál.
 *
 *  3. La membresía, que la valida H2 vía `TenancyPort.contextFor()`. El
 *     `x-tenant-slug` lo manda el navegador y NO se cree: ese 403 es lo único
 *     que impide que el cliente A lea los datos del cliente B.
 *
 * Se llama por el port y no por `@abraxa/tenancy` directamente: es la regla 5
 * del contrato (`packages/db/ports.ts`), y además evita el ciclo —`tenancy`
 * depende de `db`, no al revés—. Si H2 no estuviera registrado, `usePort`
 * lanza `PORT_NOT_IMPLEMENTED` (501) nombrando al handoff que falta; jamás
 * inventa un contexto.
 *
 * Todos los errores son `PlatformError` del catálogo de `ports.ts`, así que la
 * capa de transporte los traduce a HTTP sin conocer este archivo.
 */
import { HEADER } from '@abraxa/config';
import type { TenantContext } from '../../ports';
import { PlatformError } from '../errors';
import { usePort } from '../port-registry';
import { proxyVerified } from './proxy-verified';
import type { PeticionEntrante, RespuestaSaliente } from './types';

/** Una cabecera, ya normalizada. Cadena vacía si no vino. */
function cabecera(req: PeticionEntrante, nombre: string): string {
  const crudo = req.headers[nombre];
  // Node entrega un arreglo cuando la cabecera llega repetida. Un atacante que
  // manda `x-user-email` dos veces no debe poder elegir cuál gana por accidente
  // de implementación: se toma siempre la primera, como hace Express.
  const valor = Array.isArray(crudo) ? crudo[0] : crudo;
  return typeof valor === 'string' ? valor.trim() : '';
}

const SIN_PROXY = new PlatformError(
  'UNAUTHENTICATED',
  'Sólo por el proxy verificado de la aplicación (sesión server-side). ' +
    'Las cabeceras de identidad no acreditan nada por sí solas.',
);

/**
 * El correo de la sesión, ya verificado. Sin resolver empresa.
 *
 * Para lo que ocurre ANTES de pertenecer a una: crear tu empresa, listar las
 * tuyas, aceptar una invitación, arrancar el ritual de fundación.
 *
 * Lanza `UNAUTHENTICATED` si la petición no viene del BFF o no trae correo.
 */
export function correoVerificadoDe(req: PeticionEntrante): string {
  // Puerta 1. Va primero, siempre.
  if (!proxyVerified(req)) throw SIN_PROXY;

  // Puerta 2. Se normaliza igual que en `app.users`: minúsculas y sin espacios.
  const correo = cabecera(req, HEADER.userEmail).toLowerCase();
  if (!correo) {
    throw new PlatformError(
      'UNAUTHENTICATED',
      'Falta el correo de la sesión. Lo pone el BFF desde la sesión verificada, no el navegador.',
    );
  }
  return correo;
}

/**
 * El contexto de empresa verificado de esta petición.
 *
 * Es la ÚNICA forma correcta de convertir una petición HTTP en un
 * `TenantContext`. Si estás por escribir un `contextoDe` en tu router, no lo
 * escribas: importa éste.
 */
export async function contextoDePeticion(req: PeticionEntrante): Promise<TenantContext> {
  const userEmail = correoVerificadoDe(req);

  const tenantSlug = cabecera(req, HEADER.tenantSlug);
  if (!tenantSlug) {
    throw new PlatformError('VALIDATION', 'Falta indicar de qué empresa se trata.');
  }

  // Puerta 3. El slug viene del navegador y NO se cree: H2 lo valida contra
  // `app.memberships` y lanza FORBIDDEN si no cuadra.
  return usePort('tenancy').contextFor({ userEmail, tenantSlug });
}

/**
 * Traduce un error a HTTP y lo responde.
 *
 * Vive aquí por la misma razón que lo de arriba: cada carril escribía su propio
 * `responder()`, y el que se equivoca deja escapar `details` internos o
 * convierte un 403 en un 500. `toResponse()` nunca filtra `details`.
 *
 * `apps/api` tiene además un manejador central. Éste es para el router que
 * quiere negar en el sitio y no depender de que alguien más esté bien cableado.
 */
export function responderError(res: RespuestaSaliente, err: unknown): void {
  if (PlatformError.is(err)) {
    res.status(err.status).json(err.toResponse());
    return;
  }
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Error interno' } });
}
