/**
 * La deuda que este carril dejó anotada, saldada.
 *
 * Este archivo era la QUINTA copia byte-por-byte del mismo guardia. Nació con
 * una razón buena —cuando se escribió, `@abraxa/tenancy` no estaba en `main` y
 * encadenar el cierre de un agujero de autenticación al merge de otro carril es
 * exactamente cómo un agujero llega a producción "porque estábamos esperando"—
 * y con la deuda declarada en `docs/handoffs/H15-crm.md` §9.
 *
 * La copia canónica ya no está en tenancy sino en `@abraxa/db` (PR #16), que es
 * el único paquete del que dependen los quince carriles: adoptarla no exige
 * tocar ningún `package.json` ni el lockfile. Ver
 * `packages/db/src/http/proxy-verified.ts`.
 *
 * Se conserva el archivo, y no se borra el módulo, para que nada de fuera tenga
 * que cambiar de import. Su prueba se quedó como prueba de CONTRATO: afirma que
 * esto es la MISMA función y no una copia que un día volvió a divergir.
 */
export { proxyVerified } from '@abraxa/db';
