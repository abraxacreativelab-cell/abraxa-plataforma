import { NextResponse } from 'next/server';
import { api, modoDemo, sesion, sinSesion } from '../../bff';
import { ajustar, ver } from '../../demo';

export const dynamic = 'force-dynamic';

interface Ctx {
  params: { id: string };
}

/** GET /bandeja/api/hilos/:id — la conversación completa. */
export async function GET(_req: Request, { params }: Ctx): Promise<NextResponse> {
  const s = await sesion();
  if (s) return api(s, `/threads/${encodeURIComponent(params.id)}`);

  if (modoDemo()) {
    const c = ver(params.id);
    return c
      ? NextResponse.json(c)
      : NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Hilo no encontrado.' } }, { status: 404 });
  }
  return sinSesion();
}

/**
 * PATCH /bandeja/api/hilos/:id — el interruptor de la IA y tomar/soltar el hilo.
 *
 * Es el control que el emprendedor tiene que poder accionar en un clic para
 * callar a su agente y meterse él.
 */
export async function PATCH(req: Request, { params }: Ctx): Promise<NextResponse> {
  const cuerpo = (await req.json().catch(() => ({}))) as {
    aiEnabled?: boolean;
    assignedTo?: string | null;
  };

  const s = await sesion();
  if (s) {
    return api(s, `/threads/${encodeURIComponent(params.id)}`, {
      method: 'PATCH',
      body: JSON.stringify(cuerpo),
    });
  }

  if (modoDemo()) {
    const c = ajustar(params.id, cuerpo);
    return c
      ? NextResponse.json(c)
      : NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Hilo no encontrado.' } }, { status: 404 });
  }
  return sinSesion();
}
