/**
 * ════════════════════════════════════════════════════════════════════════════
 *  POST/GET /api/voz/narrar
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Cinco líneas de pegamento. Toda la lógica está en
 *  `apps/web/src/voz/servidor/narrar.ts`, que no importa nada de Next y por eso
 *  se prueba llamándolo con un `new Request(...)`.
 *
 *  ── `runtime = 'nodejs'` NO es opcional ────────────────────────────────────
 *
 *  El runtime Edge no tiene el `fetch` de Node con streaming duplex ni
 *  `AbortSignal.timeout` con el mismo comportamiento, y este handler reenvía un
 *  `ReadableStream` de un proveedor externo mientras acumula una copia. En Edge
 *  eso se rompe de formas que sólo aparecen bajo carga.
 *
 *  ── `dynamic = 'force-dynamic'` tampoco ────────────────────────────────────
 *
 *  Sin él Next puede intentar prerenderizar la ruta en el build, donde no hay
 *  sesión ni variables de entorno, y el `next build` falla con un error que no
 *  menciona ninguna de las dos cosas.
 *
 *  ── ⚠ nginx: esta ruta necesita un bloque ──────────────────────────────────
 *
 *  En el VPS, `location /api/` va a Express (3040) y sólo `^~ /api/auth/` va a
 *  Next (3041). Medido en vivo el 2026-08-01: `GET /api/voz/prueba` devuelve el
 *  404 de Express, no el de Next. Hace falta añadir, ANTES de `location /api/`:
 *
 *      location ^~ /api/voz/ { proxy_pass http://127.0.0.1:3041; ... }
 *
 *  Está escrito completo en `apps/web/src/voz/README.md`.
 */
import { manejarNarrar } from '../../../../../src/voz/servidor/narrar';
import { quienEntra } from '../../../../../src/voz/servidor/sesion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  return manejarNarrar(req, { sesion: quienEntra });
}

export async function POST(req: Request): Promise<Response> {
  return manejarNarrar(req, { sesion: quienEntra });
}
