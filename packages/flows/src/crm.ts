/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Cómo este paquete habla con el CRM (H15) — sin acoplarse a su código.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Cuatro de los diez nodos —`assign_owner`, `move_stage`, `add_tag` y el
 *  `send_message` que necesita saber a qué dirección escribirle— operan sobre
 *  contactos. El contrato es `ContactsPort` de H15.
 *
 *  ── Por qué se importa el PORT y no el paquete ─────────────────────────────
 *
 *  `@abraxa/crm` publica `useContacts()`, y su handoff le dice a H8 que lo use.
 *  Aquí se usa `tryPort('contacts')` con un import de SÓLO TIPOS a
 *  `@abraxa/crm/port` — que es un archivo sin una línea de runtime. Dos razones,
 *  las dos mecánicas:
 *
 *    1. `@abraxa/crm` NO está en las dependencias de `packages/flows`, y no se
 *       puede agregar: mover `package-lock.json` desde una rama que no es la de
 *       H1 falla el gate (regla 4), y un workspace nuevo en el `package.json` de
 *       un paquete sin su entrada en el lockfile hace que `npm ci` se niegue a
 *       instalar — que es exactamente por lo que h15, h17 y h18 llevan
 *       `lockfile: true`. Queda ANOTADO en el PR, como manda la regla.
 *
 *    2. Un import de VALOR arrastraría el paquete entero al bundle de la API a
 *       través de este carril, y con él su `registerContactsPort()`. Que el CRM
 *       se registre o no en un proceso es decisión de quien arma ese proceso
 *       (`apps/api/src/packages.ts`), no efecto colateral de que alguien
 *       importara automatizaciones.
 *
 *  El resultado es el mismo contrato, comprobado por el compilador, con cero
 *  runtime. Cuando H1 mueva `ContactsPort` a `packages/db/ports.ts`, este
 *  archivo se colapsa a un reexport de `tryPort('contacts')`.
 *
 *  ── En las pruebas ─────────────────────────────────────────────────────────
 *
 *      registrarContactosDePrueba(doble)   // ../testing/dobles
 *
 *  …que es `registerPort('contacts', …)`, el mismo gancho que usa H15.
 */
import { PlatformError, tryPort } from '@abraxa/db';
import type { PortName } from '@abraxa/db';
import type { Contact, ContactsPort, Pipeline } from '@abraxa/crm/port';

/**
 * La llave con la que H15 vive en el registro central de H1.
 *
 * El doble cast es de ellos y por su razón: `PortRegistry` tiene ocho llaves
 * literales y `port-registry.ts` declara `Record<PortName, string>`, así que
 * una novena por aumentación de interfaz rompería el typecheck de H1. Ver
 * `packages/crm/src/port-registration.ts`.
 */
export const LLAVE_CONTACTOS = 'contacts' as unknown as PortName;

export type { Contact, ContactsPort, Pipeline };

/** La implementación registrada, o `null`. Para los caminos best-effort. */
export function contactos(): ContactsPort | null {
  return (tryPort(LLAVE_CONTACTOS) as unknown as ContactsPort | null) ?? null;
}

/**
 * La implementación registrada, o lanza diciendo a quién se espera.
 *
 * Lo usan los nodos que SIN CRM no pueden hacer nada (`move_stage`, `add_tag`,
 * `assign_owner`): fallar con "falta H15" es información; fallar con
 * "undefined is not a function" es una tarde perdida.
 */
export function exigirContactos(): ContactsPort {
  const impl = contactos();
  if (!impl) {
    throw new PlatformError(
      'PORT_NOT_IMPLEMENTED',
      "El port 'contacts' no está registrado en este proceso. Lo entrega H15 · packages/crm: " +
        "importa '@abraxa/crm' una vez al arrancar (se registra solo al importarse).",
      { details: { port: 'contacts', owner: 'H15 · packages/crm' } },
    );
  }
  return impl;
}
