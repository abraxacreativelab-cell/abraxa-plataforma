/**
 * La deuda que el PR #12 dejó anotada, saldada.
 *
 * Este archivo era una copia byte-por-byte de la de H2, porque cuando se cerró
 * el agujero de `x-user-email` (PR #12) el paquete de tenancy todavía no estaba
 * en `main`, y encadenar el arreglo de un agujero de autenticación a un merge
 * ajeno es exactamente cómo un agujero llega a producción "porque estábamos
 * esperando".
 *
 * La copia canónica ya no está en tenancy sino en `@abraxa/db` —el único
 * paquete del que dependen los catorce carriles, así que adoptarla no exige
 * tocar ningún `package.json`—. Ver `packages/db/src/http/proxy-verified.ts`.
 */
export { proxyVerified } from '@abraxa/db';
