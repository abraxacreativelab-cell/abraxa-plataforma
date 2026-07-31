/**
 * El enforcement del BFF. Portado de GARDEN
 * (src/api/middleware/tenant.ts:22-35) prácticamente sin cambios: sólo el
 * nombre del secreto y el del header.
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
 */
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { HEADER } from '@abraxa/config';

/**
 * ¿Esta petición viene de verdad del BFF?
 *
 * ── Fail-closed en producción ─────────────────────────────────────────────
 *
 * Sin `PROXY_SECRET` configurado, en producción esto devuelve `false` y la vía
 * de headers queda CERRADA. Es el caso que importa: si un deploy pierde la
 * variable — una rotación a medias, un `.env` truncado — el sistema no
 * reabre la suplantación de identidad por header, se cae de forma segura.
 *
 * En desarrollo, sin secreto, se permite la vía directa para poder trabajar
 * sin levantar el BFF. Es exactamente el criterio de GARDEN y es el criterio
 * #4 del handoff.
 *
 * Se lee `process.env` directamente y no `env()` de @abraxa/config a
 * propósito: `env()` valida TODO el entorno y lanza si falta cualquier otra
 * cosa. Una decisión de seguridad no puede depender de que quince variables
 * ajenas estén bien puestas.
 */
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
