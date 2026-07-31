/**
 * De una petición HTTP al `TenantContext` verificado.
 *
 * ── 2026-07-31 · lo que había aquí ────────────────────────────────────────
 *
 * Este archivo resolvía el contexto por su cuenta y NUNCA llamaba a
 * `proxyVerified()`. Como `apps/api` monta este router en `/vault`
 * (`apps/api/src/packages.ts`) y H2 ya mergeó —el port `tenancy` está
 * registrado—, en `main` bastaban dos cabeceras inventadas con `curl` para
 * leer la bóveda de cualquier empresa: precios, márgenes, documentos. No era
 * un agujero esperando un merge; estaba abierto.
 *
 * No fue descuido de H4. Fue el CUARTO carril que escribió su propio
 * resolvedor de contexto porque el patrón correcto no existía como pieza
 * importable. Ahora existe, y este archivo se limita a delegar.
 *
 * `contextoDe` se conserva como nombre para no tocar las 40 llamadas de
 * `routes.ts`, pero ya no tiene lógica propia: es un alias del canónico.
 * Ver `packages/db/src/http/tenant-context.ts` y `context.test.ts` al lado.
 */
export { contextoDePeticion as contextoDe } from '@abraxa/db';
