// Los contratos cruzados. Se re-exportan aquí para que nadie tenga que
// acordarse de la ruta: `import type { TenantContext } from '@abraxa/db'`.
export type * from '../ports';

export { tenantDb, stampTenant, stripTenant, type TenantDb, type TenantScopedTable } from './tenant-db';
export { adminDb, serviceClient, __setClientForTests, type AnyClient } from './client';
export { PlatformError, forbidden, notFound, budgetExceeded } from './errors';
export {
  registerPort,
  usePort,
  tryPort,
  isPortReady,
  listPorts,
  __clearPorts,
} from './port-registry';
/**
 * El borde HTTP compartido. `contextoDePeticion(req)` es la ÚNICA forma
 * correcta de convertir una petición en un `TenantContext`: ningún router de
 * dominio escribe su propio `contextoDe`. Ver `src/http/tenant-context.ts`.
 */
export {
  contextoDePeticion,
  correoVerificadoDe,
  proxyVerified,
  responderError,
  type PeticionEntrante,
  type RespuestaSaliente,
} from './http/index';
export { APP_SCHEMA, type DomainTable, type DomainTableRegistry } from './tables';
export { meta } from './meta';
