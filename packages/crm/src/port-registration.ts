/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El registro de ContactsPort en el registro central de H1
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  `@abraxa/db` tiene UN registro de ports y `ContactsPort` entra en ÉSE, no en
 *  uno paralelo. Que existan dos registros sería peor que el problema que
 *  resuelven: `GET /_health/packages` mostraría un mapa incompleto y alguien
 *  perdería una tarde buscando por qué su port "no está registrado" cuando lo
 *  está, en el otro.
 *
 *  ── El cast, y por qué está aquí y en ningún otro lado ─────────────────────
 *
 *  `registerPort<K extends PortName>` sólo acepta las ocho llaves que H1 puso
 *  en `PortRegistry`. Ampliarlas por aumentación de interfaz desde aquí es
 *  posible en TypeScript pero rompe el typecheck de OTRO carril:
 *  `port-registry.ts:8` declara `const OWNER: Record<PortName, string>` con las
 *  ocho llaves literales, y una novena hace que ese objeto deje de ser
 *  exhaustivo. Un carril nuevo no puede romper la compilación de H1 para
 *  entrar.
 *
 *  Así que la llave viaja como string. El cast está en ESTE archivo, tres
 *  veces, con nombre y con la fecha en que deja de hacer falta — y no
 *  desperdigado en cada llamada de H6 y H8, que es como un atajo se vuelve
 *  permanente.
 *
 *  ── Cómo desaparece ────────────────────────────────────────────────────────
 *
 *  Cuando H1 mueva `ContactsPort` a `packages/db/ports.ts` y agregue
 *  `contacts: ContactsPort` a `PortRegistry` + la línea correspondiente en
 *  `OWNER`, este archivo se colapsa a tres reexports de `usePort`/`tryPort` y
 *  los llamadores no cambian una sola línea. El parche exacto (6 líneas) está
 *  en `docs/handoffs/H15-crm.md` §9.
 */
import { PlatformError, registerPort, tryPort } from '@abraxa/db';
import type { PortName, PortRegistry } from '@abraxa/db';
import type { ContactsPort } from './port';

/**
 * La llave con la que vive en el registro central.
 *
 * `as unknown as PortName` y no `as PortName` porque TypeScript rechaza —con
 * razón— convertir un literal que no está en la unión: el doble cast es la
 * forma de decir "sé que esto no está en el tipo todavía" en vez de esconderlo.
 */
const CONTACTS = 'contacts' as unknown as PortName;

/** Nombre público del port, para mensajes y para `/_health`. */
export const CONTACTS_PORT = 'contacts';

/**
 * Registra la implementación. Lo llama `src/index.ts` al importarse el
 * paquete, igual que hacen H3 y los demás desde su propio `index.ts`.
 *
 * También es el gancho de las pruebas de H6 y H8: `registerContactsPort(doble)`
 * y a construir, sin esperar a que este paquete mergee.
 */
export function registerContactsPort(impl: ContactsPort): void {
  registerPort(CONTACTS, impl as unknown as PortRegistry[PortName]);
}

/**
 * La implementación registrada, o lanza diciendo qué falta.
 *
 * No delega el error a `usePort` a propósito: `port-registry.ts` compone su
 * mensaje con `OWNER[name]`, que para una llave que no está en el mapa daría
 * "Lo entrega undefined". Un mensaje de error que no dice a quién esperas es
 * medio mensaje de error.
 */
export function useContacts(): ContactsPort {
  const impl = tryPort(CONTACTS) as unknown as ContactsPort | null;
  if (!impl) {
    throw new PlatformError(
      'PORT_NOT_IMPLEMENTED',
      "El port 'contacts' todavía no está registrado. Lo entrega H15 · packages/crm. " +
        "Importa '@abraxa/crm' una vez al arrancar tu proceso (o llama " +
        'registerContactsPort(doble) en tus pruebas): el paquete se registra solo al importarse.',
      { details: { port: CONTACTS_PORT, owner: 'H15 · packages/crm' } },
    );
  }
  return impl;
}

/** Igual, pero `null` en vez de lanzar. Para caminos best-effort. */
export function tryContacts(): ContactsPort | null {
  return (tryPort(CONTACTS) as unknown as ContactsPort | null) ?? null;
}

/** `true` si ya hay una implementación registrada. */
export function isContactsReady(): boolean {
  return tryContacts() !== null;
}

/** Sólo para pruebas: `usePort` no expone un "desregistrar" por llave. */
export function __unregisterContactsPort(): void {
  registerPort(CONTACTS, null as unknown as PortRegistry[PortName]);
}
