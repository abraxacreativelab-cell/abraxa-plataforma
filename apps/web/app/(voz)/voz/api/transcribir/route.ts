/**
 * ════════════════════════════════════════════════════════════════════════════
 *  POST /api/voz/transcribir
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Sólo POST. No hay GET a propósito: una transcripción se pide con un cuerpo,
 *  y una ruta que acepta GET acaba con alguien poniéndola en un `<img src>`.
 *
 *  Toda la lógica está en `apps/web/src/voz/servidor/transcribir.ts`. Ver
 *  `narrar/route.ts` para por qué `runtime` y `dynamic` no son opcionales, y
 *  para el bloque de nginx que esta ruta necesita en el VPS.
 */
import { manejarTranscribir } from '../../../../../src/voz/servidor/transcribir';
import { quienEntra } from '../../../../../src/voz/servidor/sesion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  return manejarTranscribir(req, { sesion: quienEntra });
}
