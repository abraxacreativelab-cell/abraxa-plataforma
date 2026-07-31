/**
 * ════════════════════════════════════════════════════════════════════════════
 *  ¿Esta petición viene de verdad del BFF?  — LA ÚNICA COPIA DEL REPO
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ── El patrón ─────────────────────────────────────────────────────────────
 *
 *   navegador → NextAuth (Google) → BFF verificado server-side → API
 *                                        ↓
 *      inyecta x-user-email VERIFICADO (de la sesión, NUNCA de un header que
 *      mandó el cliente) + x-proxy-secret
 *
 * Sin esta comprobación, `x-user-email` es un header como cualquier otro y
 * cualquiera se declara quien quiera con un `curl`.
 *
 * ── Fail-closed en producción ─────────────────────────────────────────────
 *
 * Sin `PROXY_SECRET` configurado, en producción esto devuelve `false` y la vía
 * de headers queda CERRADA. Es el caso que importa: si un deploy pierde la
 * variable —una rotación a medias, un `.env` truncado— el sistema no reabre la
 * suplantación de identidad por header, se cae de forma segura.
 *
 * En desarrollo, sin secreto, se permite la vía directa para poder trabajar sin
 * levantar el BFF. Es el criterio de GARDEN y el criterio #4 del handoff de H2.
 *
 * Se lee `process.env` directamente y no `env()` de `@abraxa/config` a
 * propósito: `env()` valida TODO el entorno y lanza si falta cualquier otra
 * cosa. Una decisión de seguridad no puede depender de que quince variables
 * ajenas estén bien puestas.
 *
 * ── Por qué vive en `@abraxa/db` y no en `@abraxa/tenancy` ────────────────
 *
 * Porque `@abraxa/db` es el único paquete del que YA dependen los catorce
 * carriles. Un carril puede adoptar esta función con una línea de `import`,
 * dentro de su propio árbol, sin tocar su `package.json` (que es de H1) ni el
 * lockfile (que también). Puesta en `@abraxa/tenancy`, adoptarla exigía una
 * intervención del orquestador por carril — y una pieza que no se puede
 * adoptar sola no evita que la vuelvan a escribir. Que la hayan reescrito
 * cuatro veces es la prueba.
 *
 * `@abraxa/tenancy` la re-exporta, así que su API pública no cambió.
 */
import { timingSafeEqual } from 'node:crypto';
import { HEADER } from '@abraxa/config';
import type { PeticionEntrante } from './types';

/** `true` sólo si la petición trae el secreto compartido del BFF. */
export function proxyVerified(req: PeticionEntrante): boolean {
  const secret = process.env.PROXY_SECRET;

  if (!secret) return process.env.NODE_ENV !== 'production';

  const recibido = String(req.headers[HEADER.proxySecret] ?? '');
  const a = Buffer.from(recibido);
  const b = Buffer.from(secret);

  // La comparación de longitud va antes porque `timingSafeEqual` lanza si los
  // buffers difieren en tamaño. La longitud de un secreto no es información
  // que valga la pena proteger contra un ataque de tiempo.
  return a.length === b.length && timingSafeEqual(a, b);
}
