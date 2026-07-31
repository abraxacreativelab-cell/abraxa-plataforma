/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El puente hacia `/flows`, con lista blanca.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Una sola ruta atrapa todo lo que la pantalla pide y lo reenvía a `apps/api`
 *  con las cabeceras de la sesión. La LISTA BLANCA es lo que la separa de un
 *  proxy abierto: sólo pasan las rutas que esta pantalla usa, y sólo con el
 *  método que les toca.
 *
 *  Un `[...ruta]` que reenvía cualquier cosa a la API interna es un agujero con
 *  otro nombre: el navegador podría alcanzar endpoints de otros paquetes con
 *  la sesión ya puesta. Aquí no: lo que no está en la lista es 404.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { api, modoDemo, sesion, sinSesion } from '../bff';
import { corridaDemo, corridasDemo, listaDemo, reiniciarDemo, FLUJO_DEMO } from '../demo';

export const dynamic = 'force-dynamic';

type Metodo = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** Lo que esta pantalla tiene permitido pedirle a `/flows`. */
const PERMITIDAS: Array<{ metodo: Metodo; patron: RegExp }> = [
  { metodo: 'GET', patron: /^catalogo$/ },
  { metodo: 'GET', patron: /^catalogo\/empresa$/ },
  { metodo: 'GET', patron: /^$/ },
  { metodo: 'POST', patron: /^$/ },
  { metodo: 'POST', patron: /^asistente$/ },
  { metodo: 'POST', patron: /^revisar$/ },
  { metodo: 'GET', patron: /^runs$/ },
  { metodo: 'GET', patron: /^runs\/[\w-]+$/ },
  { metodo: 'GET', patron: /^[\w-]+$/ },
  { metodo: 'PUT', patron: /^[\w-]+$/ },
  { metodo: 'DELETE', patron: /^[\w-]+$/ },
  { metodo: 'POST', patron: /^[\w-]+\/(activar|pausar|probar)$/ },
  { metodo: 'GET', patron: /^[\w-]+\/versiones$/ },
  { metodo: 'POST', patron: /^[\w-]+\/versiones\/\d+\/restaurar$/ },
];

const permitida = (metodo: Metodo, ruta: string): boolean =>
  PERMITIDAS.some((p) => p.metodo === metodo && p.patron.test(ruta));

function noPermitida(metodo: string, ruta: string): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: 'NOT_FOUND',
        message: `Esta pantalla no pide ${metodo} /${ruta}. El puente sólo reenvía lo que usa.`,
      },
    },
    { status: 404 },
  );
}

/** El juego de demostración, para las rutas que la pantalla necesita ver viva. */
function demo(metodo: Metodo, ruta: string): NextResponse | null {
  if (metodo === 'GET' && ruta === '') return NextResponse.json(listaDemo());
  if (metodo === 'GET' && ruta === 'runs') return NextResponse.json(corridasDemo());
  if (metodo === 'GET' && /^runs\/[\w-]+$/.test(ruta)) {
    return NextResponse.json(corridaDemo(), { headers: { 'cache-control': 'no-store' } });
  }
  if (metodo === 'GET' && ruta === FLUJO_DEMO.id) return NextResponse.json(FLUJO_DEMO);
  if (metodo === 'POST' && /^[\w-]+\/probar$/.test(ruta)) {
    reiniciarDemo();
    return NextResponse.json({ corridas: 1, runId: 'corrida-demo' });
  }
  return null;
}

async function manejar(req: NextRequest, metodo: Metodo, partes: string[]): Promise<NextResponse> {
  const ruta = partes.join('/');
  if (!permitida(metodo, ruta)) return noPermitida(metodo, ruta);

  const s = await sesion();
  if (!s) {
    const enDemo = modoDemo() ? demo(metodo, ruta) : null;
    return enDemo ?? sinSesion();
  }

  const busqueda = req.nextUrl.search;
  const cuerpo =
    metodo === 'GET' || metodo === 'DELETE' ? undefined : await req.text().catch(() => undefined);

  return api(s, `/${ruta}${busqueda}`, {
    method: metodo,
    ...(cuerpo !== undefined ? { body: cuerpo } : {}),
  });
}

interface Contexto {
  params: { ruta?: string[] };
}

export const GET = (req: NextRequest, { params }: Contexto): Promise<NextResponse> =>
  manejar(req, 'GET', params.ruta ?? []);

export const POST = (req: NextRequest, { params }: Contexto): Promise<NextResponse> =>
  manejar(req, 'POST', params.ruta ?? []);

export const PUT = (req: NextRequest, { params }: Contexto): Promise<NextResponse> =>
  manejar(req, 'PUT', params.ruta ?? []);

export const DELETE = (req: NextRequest, { params }: Contexto): Promise<NextResponse> =>
  manejar(req, 'DELETE', params.ruta ?? []);
