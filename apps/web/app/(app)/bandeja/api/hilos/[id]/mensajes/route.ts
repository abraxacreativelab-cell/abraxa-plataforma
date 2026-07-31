import { NextResponse } from 'next/server';
import { api, modoDemo, sesion, sinSesion } from '../../../bff';
import { enviar } from '../../../demo';

export const dynamic = 'force-dynamic';

interface Ctx {
  params: { id: string };
}

/**
 * POST /bandeja/api/hilos/:id/mensajes — escribir en el hilo.
 *
 * El `author` NO viaja en el cuerpo: lo pone la API desde el contexto
 * verificado. Si el navegador pudiera declarar quién escribe, podría hacerse
 * pasar por otro y —peor— marcar como humano un mensaje de la IA.
 */
export async function POST(req: Request, { params }: Ctx): Promise<NextResponse> {
  const cuerpo = (await req.json().catch(() => ({}))) as { body?: string; media?: string[] };
  const texto = String(cuerpo.body ?? '').trim();

  if (!texto && !(cuerpo.media ?? []).length) {
    return NextResponse.json(
      { error: { code: 'VALIDATION', message: 'No se puede mandar un mensaje vacío.' } },
      { status: 422 },
    );
  }

  const s = await sesion();
  if (s) {
    return api(s, `/threads/${encodeURIComponent(params.id)}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body: texto, ...(cuerpo.media ? { media: cuerpo.media } : {}) }),
    });
  }

  if (modoDemo()) {
    const m = enviar(params.id, texto);
    return m
      ? NextResponse.json({ message: m })
      : NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Hilo no encontrado.' } }, { status: 404 });
  }
  return sinSesion();
}
