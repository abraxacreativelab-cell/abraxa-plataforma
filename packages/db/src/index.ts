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
export { APP_SCHEMA, type DomainTable, type DomainTableRegistry } from './tables';
export { meta } from './meta';
