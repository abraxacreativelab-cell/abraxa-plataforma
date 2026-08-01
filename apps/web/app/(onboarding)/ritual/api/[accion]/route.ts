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
  // «Pégame tu página y te ahorro preguntas.» El guardia de SSRF vive del lado
  // de la API (packages/onboarding/src/sitio/), donde está el `fetch` que sale
  // a internet — no aquí, que sólo reenvía con la identidad puesta.
  sitio: { metodo: 'POST', ruta: '/onboarding/ritual/sitio' },
};

/**
 * Un turno de entrevista puede tardar: el modelo escribe varios párrafos y el
 * cierre corre DOS corridas (la síntesis y su narración). El default de `fetch`
 * cortaría justo el turno que más importa.
 *
 * ── Lo que este timeout NO hace, y por qué importa (auditoría PR #8) ───────
 *
 * `control.abort()` cierra el socket BFF→API. Nada más. El handler de Express
 * del otro lado no se entera: termina su corrida del modelo, escribe su turno y
 * COMMITEA, cinco segundos después de que aquí ya se contestó 504.
 *
 * Y no se cancela a propósito. Encadenar el abort hasta el motor cortaría la
 * petición en cualquier punto —incluido el hueco entre "el modelo ya contestó"
 * y "el turno está escrito"—, y ahí sí se perdería lo que la persona dijo. Un
 * turno que termina de escribirse aunque nadie lo esté esperando es el
 * comportamiento correcto: la escritura es lo que la protege.
 *
 * Lo que estaba mal era lo que se le decía después. El mensaje del 504 era
 * «vuelve a mandar tu mensaje: no se perdió nada», el compositor le devolvía el
 * texto y reenviar era un click — así que el producto pedía, activamente, la
 * segunda petición que duplicaba el turno. Ahora el 504 dice que no se sabe, y
 * el cliente reconcilia contra `GET /ritual` antes de ofrecer nada. Ver
 * `ritual.tsx`.
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
    // entrando.
    //
    // El mensaje se pinta TAL CUAL en la burbuja de error del Ritual, así que
    // no lleva nombres de carriles ni rutas del repo: la sesión se pudo haber
    // caducado a media entrevista y lo que esa persona necesita saber es que
    // vuelva a entrar, no quién debía el módulo.
    return NextResponse.json(
      {
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Tu sesión se cerró. Vuelve a entrar y sigues justo donde te quedaste.',
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
          // Ni "se perdió" ni "no se perdió": desde aquí no se sabe, y decir
          // cualquiera de las dos es adivinar con el trabajo de alguien más.
          // Quien sí puede saberlo es el cliente, preguntándole al Ritual en
          // qué quedó — y eso es justo lo que hace antes de ofrecer reenviar.
          message: abortada
            ? 'Tu agente se está tardando más de la cuenta. Puede que tu mensaje sí haya ' +
              'entrado, así que no lo mandes otra vez todavía: estamos revisando en qué quedó.'
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
