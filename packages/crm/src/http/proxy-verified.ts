/**
 * ════════════════════════════════════════════════════════════════════════════
 *  ¿Esta petición viene de verdad del BFF?
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   navegador → NextAuth (Google) → BFF verificado server-side → API
 *                                        ↓
 *      inyecta x-user-email VERIFICADO (de la sesión, NUNCA de un header que
 *      mandó el cliente) + x-proxy-secret
 *
 * Sin esta comprobación, `x-user-email` es un header como cualquier otro y
 * cualquiera se declara quien quiera con un `curl` — y en un CRM eso es leer
 * la cartera de clientes de otra empresa.
 *
 * ── Fail-closed en producción ─────────────────────────────────────────────
 *
 * Sin `PROXY_SECRET` configurado, en producción devuelve `false` y la vía de
 * headers queda CERRADA. Si un deploy pierde la variable —una rotación a
 * medias, un `.env` truncado— el sistema no reabre la suplantación por header:
 * se cae de forma segura.
 *
 * En desarrollo, sin secreto, se permite la vía directa para poder trabajar
 * sin levantar el BFF.
 *
 * Se lee `process.env` directamente y no `env()` de `@abraxa/config` a
 * propósito: `env()` valida TODO el entorno y lanza si falta cualquier otra
 * cosa. Una decisión de seguridad no puede depender de que quince variables
 * ajenas estén bien puestas.
 *
 * ── Por qué hay una copia en este paquete ─────────────────────────────────
 *
 * La copia canónica es de H2 (`packages/tenancy/src/middleware/proxy.ts`) y
 * H3 tiene otra igual por la misma razón: mientras H2 no esté en `main`,
 * `@abraxa/tenancy` existe pero está vacío. Encadenar el cierre de un agujero
 * de autenticación al merge de otro carril es exactamente cómo un agujero
 * llega a producción "porque estábamos esperando".
 *
 * DEUDA DECLARADA: cuando H2 mergee, este archivo se colapsa a
 * `export { proxyVerified } from '@abraxa/tenancy'` y su prueba se queda como
 * prueba de contrato. Anotado en docs/handoffs/H15-crm.md §9.
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
