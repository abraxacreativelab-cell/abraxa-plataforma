import type { PortName, PortRegistry } from '../ports';
import { PlatformError } from './errors';

/** Quién debe registrar cada port. Sale en el mensaje de error para que la
 *  conversación que lo topa sepa a quién está esperando sin preguntarle a nadie. */
const OWNER: Record<PortName, string> = {
  tenancy: 'H2 · packages/tenancy',
  agents: 'H3 · packages/agents',
  vault: 'H4 · packages/vault',
  inbox: 'H6 · packages/inbox',
  flows: 'H8 · packages/flows',
  work: 'H9 · packages/work',
  billing: 'H10 · packages/billing',
  areas: 'H11 · packages/areas',
};

const registro = new Map<PortName, PortRegistry[PortName]>();

/**
 * Cada paquete registra SU port desde su propio `src/index.ts`.
 * Nadie edita un cableado central — ésa es toda la idea.
 *
 *   // packages/inbox/src/index.ts
 *   registerPort('inbox', inboxService);
 */
export function registerPort<K extends PortName>(name: K, impl: PortRegistry[K]): void {
  registro.set(name, impl);
}

/**
 * La implementación registrada, o lanza diciendo a quién le falta.
 *
 * Ésta es la regla 5 del contrato hecha código: H8 manda WhatsApp llamando
 * `usePort('inbox')` sin esperar a que H6 exista. Se encuentran en el merge.
 */
export function usePort<K extends PortName>(name: K): PortRegistry[K] {
  const impl = registro.get(name);
  if (!impl) {
    throw new PlatformError(
      'PORT_NOT_IMPLEMENTED',
      `El port '${name}' todavía no está implementado. Lo entrega ${OWNER[name]}. ` +
        'Programa contra la interfaz de packages/db/ports.ts y usa un doble en tus pruebas: ' +
        'no esperes su código ni lo escribas tú (el gate de propiedad falla tu PR).',
      { details: { port: name, owner: OWNER[name] } },
    );
  }
  return impl as PortRegistry[K];
}

/** Igual que `usePort` pero devuelve `null` en vez de lanzar. Para caminos
 *  best-effort: H3 sigue sin bóveda si H4 aún no aterriza. */
export function tryPort<K extends PortName>(name: K): PortRegistry[K] | null {
  return (registro.get(name) as PortRegistry[K] | undefined) ?? null;
}

export function isPortReady(name: PortName): boolean {
  return registro.has(name);
}

/** Foto del avance de las olas. La sirve `GET /_health/packages`. */
export function listPorts(): Array<{ port: PortName; ready: boolean; owner: string }> {
  return (Object.keys(OWNER) as PortName[]).map((port) => ({
    port,
    ready: registro.has(port),
    owner: OWNER[port],
  }));
}

/** Sólo para pruebas. */
export function __clearPorts(): void {
  registro.clear();
}
