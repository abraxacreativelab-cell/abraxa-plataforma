/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El BFF del Ritual. Una lista blanca, no un túnel.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  El navegador nunca habla con la API directo: habla con estas rutas, y son
 *  ellas las que ponen la identidad —del lado del servidor, desde la sesión
 *  verificada— antes de reenviar. Es el contrato BFF↔API que define H2 §7.
 *
 *  Las cuatro acciones están escritas a mano a propósito. Un proxy que reenvía
 *  `params.ruta` tal cual le deja al navegador elegir a qué endpoint interno
 *  llegar con credenciales de servidor, que es un problema mucho más grande que
 *  el que resolvía.
 */
import { NextResponse } from 'next/server';
import { baseDeLaApi, cabecerasPara, identidadDeLaSesion } from '../../lib/sesion';

export const dynamic = 'force-dynamic';

interface Destino {
  metodo: 'GET' | 'POST';
  ruta: string;
}

const ACCIONES: Record<string, Destino> = {
  estado: { metodo: 'GET', ruta: '/onboarding/ritual' },
  mapa: { metodo: 'GET', ruta: '/onboarding/ritual/mapa' },
  iniciar: { metodo: 'POST', ruta: '/onboarding/ritual/iniciar' },
  turno: { metodo: 'POST', ruta: '/onboarding/ritual/turno' },
  pausa: { metodo: 'POST', ruta: '/onboarding/ritual/pausa' },
};

/**
 * Un turno de entrevista puede tardar: el modelo escribe varios párrafos y el
 * cierre corre DOS corridas (la síntesis y su narración). El default de `fetch`
 * cortaría justo el turno que más importa.
 */
const TIMEOUT_MS = 90_000;

async function reenviar(accion: string | undefined, cuerpo: unknown): Promise<NextResponse> {
  const destino = accion ? ACCIONES[accion] : undefined;
  if (!destino) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Acción desconocida.' } },
      { status: 404 },
    );
  }

  const identidad = await identidadDeLaSesion();
  if (!identidad) {
    // 401 y no 500: no es que algo se haya roto, es que no hay quién esté
    // entrando. La pantalla distingue los dos casos y dice cuál es.
    return NextResponse.json(
      {
        error: {
          code: 'UNAUTHENTICATED',
          message:
            'No hay sesión verificada. El inicio de sesión lo entrega H2 (packages/tenancy); ' +
            'hasta entonces el Ritual no puede saber de qué empresa es quien entra.',
        },
      },
      { status: 401 },
    );
  }

  const control = new AbortController();
  const alarma = setTimeout(() => control.abort(), TIMEOUT_MS);

  try {
    const respuesta = await fetch(`${baseDeLaApi()}${destino.ruta}`, {
      method: destino.metodo,
      headers: cabecerasPara(identidad),
      body: destino.metodo === 'POST' ? JSON.stringify(cuerpo ?? {}) : undefined,
      cache: 'no-store',
      signal: control.signal,
    });

    const texto = await respuesta.text();
    return new NextResponse(texto, {
      status: respuesta.status,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    const abortada = err instanceof Error && err.name === 'AbortError';
    return NextResponse.json(
      {
        error: {
          code: abortada ? 'RATE_LIMITED' : 'INTERNAL',
          message: abortada
            ? 'Tu agente se tardó más de la cuenta. Vuelve a mandar tu mensaje: no se perdió nada.'
            : 'No se pudo hablar con la API del Ritual.',
        },
      },
      { status: abortada ? 504 : 502 },
    );
  } finally {
    clearTimeout(alarma);
  }
}

export async function GET(
  _req: Request,
  { params }: { params: { accion: string } },
): Promise<NextResponse> {
  return reenviar(params.accion, null);
}

export async function POST(
  req: Request,
  { params }: { params: { accion: string } },
): Promise<NextResponse> {
  const cuerpo = await req.json().catch(() => ({}));
  return reenviar(params.accion, cuerpo);
}
