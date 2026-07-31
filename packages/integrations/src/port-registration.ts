/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El registro de IntegrationsPort en el registro central de H1
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  `@abraxa/db` tiene UN registro de ports y `IntegrationsPort` entra en ÉSE,
 *  no en uno paralelo. Dos registros serían peor que el problema que resuelven:
 *  `GET /_health/packages` mostraría un mapa incompleto y alguien perdería una
 *  tarde buscando por qué su port "no está registrado" cuando lo está, en el
 *  otro.
 *
 *  ── El cast, y por qué está aquí y en ningún otro lado ─────────────────────
 *
 *  `registerPort<K extends PortName>` sólo acepta las ocho llaves que H1 puso
 *  en `PortRegistry`. Ampliarlas desde aquí rompe el typecheck de OTRO carril:
 *  `port-registry.ts` declara `const OWNER: Record<PortName, string>` con las
 *  ocho llaves literales, y una novena hace que ese objeto deje de ser
 *  exhaustivo. Un carril nuevo no puede romper la compilación de H1 para entrar.
 *
 *  Es exactamente lo que hizo H15 con `ContactsPort`
 *  (`packages/crm/src/port-registration.ts`) y por la misma razón. El cast está
 *  en ESTE archivo, con su fecha de caducidad escrita, y no desperdigado en
 *  cada llamada de H6, H12 y H13 — que es como un atajo se vuelve permanente.
 *
 *  ── Cómo desaparece ────────────────────────────────────────────────────────
 *
 *  Cuando H1 mueva `IntegrationsPort` a `packages/db/ports.ts` y agregue
 *  `integrations: IntegrationsPort` a `PortRegistry` más su línea en `OWNER`,
 *  este archivo se colapsa a tres reexports de `usePort`/`tryPort` y los
 *  llamadores no cambian una sola línea.
 */
import { PlatformError, registerPort, tryPort } from '@abraxa/db';
import type { PortName, PortRegistry } from '@abraxa/db';
import type { IntegrationsPort } from './port';

/**
 * La llave con la que vive en el registro central.
 *
 * `as unknown as PortName` y no `as PortName` porque TypeScript rechaza —con
 * razón— convertir un literal que no está en la unión: el doble cast dice "sé
 * que esto no está en el tipo todavía" en vez de esconderlo.
 */
const INTEGRATIONS = 'integrations' as unknown as PortName;

/** Nombre público del port, para mensajes y para `/_health`. */
export const INTEGRATIONS_PORT = 'integrations';

/**
 * Registra la implementación. Lo llama `src/index.ts` al importarse el
 * paquete, igual que hacen los demás desde su propio `index.ts`.
 *
 * También es el gancho de las pruebas de H6, H12 y H13:
 * `registerIntegrationsPort(doble)` y a construir, sin esperar a que este
 * paquete mergee.
 */
export function registerIntegrationsPort(impl: IntegrationsPort): void {
  registerPort(INTEGRATIONS, impl as unknown as PortRegistry[PortName]);
}

/**
 * La implementación registrada, o lanza diciendo qué falta.
 *
 * No delega el error a `usePort` a propósito: `port-registry.ts` compone su
 * mensaje con `OWNER[name]`, que para una llave que no está en el mapa daría
 * "Lo entrega undefined". Un mensaje de error que no dice a quién esperas es
 * medio mensaje de error.
 */
export function useIntegrations(): IntegrationsPort {
  const impl = tryPort(INTEGRATIONS) as unknown as IntegrationsPort | null;
  if (!impl) {
    throw new PlatformError(
      'PORT_NOT_IMPLEMENTED',
      "El port 'integrations' todavía no está registrado. Lo entrega H17 · " +
        "packages/integrations. Importa '@abraxa/integrations' una vez al arrancar tu proceso " +
        '(o llama registerIntegrationsPort(doble) en tus pruebas): el paquete se registra solo ' +
        'al importarse.',
      { details: { port: INTEGRATIONS_PORT, owner: 'H17 · packages/integrations' } },
    );
  }
  return impl;
}

/** Igual, pero `null` en vez de lanzar. Para caminos best-effort. */
export function tryIntegrations(): IntegrationsPort | null {
  return (tryPort(INTEGRATIONS) as unknown as IntegrationsPort | null) ?? null;
}

/** `true` si ya hay una implementación registrada. */
export function isIntegrationsReady(): boolean {
  return tryIntegrations() !== null;
}

/** Sólo para pruebas: `usePort` no expone un "desregistrar" por llave. */
export function __unregisterIntegrationsPort(): void {
  registerPort(INTEGRATIONS, null as unknown as PortRegistry[PortName]);
}
