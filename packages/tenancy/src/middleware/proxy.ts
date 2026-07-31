/**
 * El enforcement del BFF.
 *
 * ── El patrón ─────────────────────────────────────────────────────────────
 *
 *   navegador → NextAuth (Google) → BFF verificado server-side → API
 *                                        ↓
 *      inyecta x-user-email VERIFICADO (de la sesión, NUNCA de un header
 *      que mandó el cliente) + x-proxy-secret
 *
 * Sin esta comprobación, `x-user-email` es un header como cualquier otro y
 * cualquiera se declara quien quiera con un curl.
 *
 * ── Dónde vive ahora, y por qué se movió (H0, 2026-07-31) ─────────────────
 *
 * La lógica se portó de GARDEN a este archivo y desde hoy vive en
 * `@abraxa/db` (`packages/db/src/http/proxy-verified.ts`), byte por byte con
 * el mismo criterio y la misma tabla de casos.
 *
 * El motivo es de adopción, no de estética: `@abraxa/db` es el único paquete
 * del que YA dependen los catorce carriles, así que cualquiera puede importar
 * la pieza con una línea dentro de su propio árbol. Puesta aquí, adoptarla
 * exigía editarle su `package.json` —que es de H1— y el lockfile. Esa fricción
 * es la razón por la que CUATRO carriles escribieron su propia copia y tres
 * salieron mal igual (H3 PR #12, H6 PR #10, H7 PR #8, y H4 ya en `main`).
 *
 * La API pública de `@abraxa/tenancy` no cambia: `proxyVerified` se sigue
 * exportando desde aquí, y `proxy.test.ts` se queda como prueba de contrato.
 */
export { proxyVerified } from '@abraxa/db';
