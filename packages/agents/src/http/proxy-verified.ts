/**
 * ════════════════════════════════════════════════════════════════════════════
 *  ¿Esta petición viene de verdad del BFF?
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
 * variable — una rotación a medias, un `.env` truncado — el sistema no reabre
 * la suplantación de identidad por header, se cae de forma segura.
 *
 * En desarrollo, sin secreto, se permite la vía directa para poder trabajar
 * sin levantar el BFF.
 *
 * Se lee `process.env` directamente y no `env()` de `@abraxa/config` a
 * propósito: `env()` valida TODO el entorno y lanza si falta cualquier otra
 * cosa. Una decisión de seguridad no puede depender de que quince variables
 * ajenas estén bien puestas.
 *
 * ── Por qué vive aquí y no en @abraxa/tenancy ─────────────────────────────
 *
 * H2 tiene la copia canónica en `packages/tenancy/src/middleware/proxy.ts`,
 * byte por byte con este mismo criterio y la misma tabla de casos probada.
 * Mientras H2 no esté en `main`, `@abraxa/agents` no puede importarla: el
 * paquete existe pero está vacío, y encadenar el arreglo de un agujero de
 * autenticación a un merge ajeno es exactamente cómo un agujero llega a
 * producción "porque estábamos esperando".
 *
 * DEUDA DECLARADA (H0): cuando el PR #6 mergee, este archivo se colapsa a
 * `export { proxyVerified } from '@abraxa/tenancy'` y `proxy-verified.test.ts`
 * se queda como prueba de contrato. Anotado en docs/handoffs/H0-orquestador.md.
 */
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { HEADER } from '@abraxa/config';

/** `true` sólo si la petición trae el secreto compartido del BFF. */
export function proxyVerified(req: Pick<Request, 'headers'>): boolean {
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
