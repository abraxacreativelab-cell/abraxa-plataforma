/**
 * ════════════════════════════════════════════════════════════════════════════
 *  EL MIDDLEWARE. Lo único que impide que un invitado lea la empresa de otro.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  ── El agujero que cierra ──────────────────────────────────────────────────
 *
 *  Dos pantallas del producto resuelven quién eres leyendo cabeceras de la
 *  petición ENTRANTE:
 *
 *    apps/web/app/(app)/ajustes/plan/_lib/datos.ts:41-42
 *    apps/web/app/(app)/contactos/datos.ts:42-43
 *
 *        const correo  = h.get('x-abraxa-session-email');
 *        const empresa = h.get('x-abraxa-session-tenant');
 *
 *  `headers()` de Next devuelve lo que mandó el navegador. Sin este archivo,
 *  esto lee la empresa de quien sea:
 *
 *    curl https://mi.abraxa.club/contactos \
 *      -H 'x-abraxa-session-email: victima@ejemplo.com' \
 *      -H 'x-abraxa-session-tenant: empresa-de-la-victima'
 *
 *  Y contesta con datos de verdad, porque el servidor le añade
 *  `x-proxy-secret` a la llamada a la API: para la API eso es el BFF diciendo
 *  quién es el usuario, que es exactamente lo que el secreto certifica.
 *
 *  Esos dos archivos son de H16 y H15 y este carril NO los toca. No hace falta:
 *  el middleware es el único punto de Next donde se pueden **reescribir** las
 *  cabeceras que los Server Components van a ver, así que arreglarlo aquí lo
 *  arregla para las dos pantallas y para todas las que vengan, sin coordinar
 *  con nadie y sin que nadie tenga que acordarse de nada.
 *
 *  ── El orden de las cuatro cosas que hace ──────────────────────────────────
 *
 *   1. LEE la sesión del token firmado (`getToken`). Nunca de una cabecera.
 *   2. BORRA todas las cabeceras de identidad que vinieron de fuera — con
 *      sesión o sin ella, en rutas públicas y privadas. La petición anónima
 *      que trae la cabecera forjada ES el ataque.
 *   3. ESCRIBE las suyas desde lo que verificó.
 *   4. DECIDE: pasar, mandar a entrar, o negar con 401.
 *
 *  El 2 va antes que el 3 y los dos van SIEMPRE. Limpiar sólo cuando hay
 *  sesión dejaría pasar justo al que no la tiene.
 *
 *  ── Por qué esto corre en Edge y no hace ni una consulta ───────────────────
 *
 *  `getToken()` sólo descifra la cookie con `NEXTAUTH_SECRET`: sin red, sin
 *  base de datos, sin llamar a la API. El alta de la empresa ocurre una vez, en
 *  el callback `jwt` de `app/api/auth/opciones.ts`, que corre en Node. Aquí
 *  sólo se lee lo que aquél ya escribió — por eso el middleware no le cuesta
 *  nada a ninguna de las peticiones del producto.
 *
 *  ── Lo que este archivo NO decide ──────────────────────────────────────────
 *
 *  Nada sobre qué datos se ven. El slug que escribe es una PISTA para el BFF;
 *  quien decide es `contextoDePeticion(req)` en la API, que revalida la
 *  membresía contra `TenancyPort.contextFor()` y tira 403. Si mañana este
 *  archivo escribiera el slug equivocado, la API seguiría negando. Dos redes,
 *  no una.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { sellarIdentidad } from './app/api/_auth/cabeceras';
import { decidir, type IdentidadVerificada } from '../../packages/auth/src/identidad';
import { origenPublico } from '../../packages/auth/src/redireccion';

/**
 * Corre en TODO menos los estáticos.
 *
 * La tentación es limitarlo a `(app)` y `(onboarding)`, y es un error: los
 * grupos de rutas no aparecen en la URL, así que la lista habría que
 * mantenerla a mano y una pantalla nueva de cualquiera de los catorce carriles
 * nacería fuera de ella — sin limpiar y sin proteger. Lo que sí se excluye son
 * rutas que no renderizan un Server Component y por lo tanto no pueden leer
 * una cabecera forjada.
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml).*)'],
};

/** El secreto con el que se firmó la cookie. v4 y v5 lo llaman distinto. */
const secreto = (): string | undefined =>
  process.env.NEXTAUTH_SECRET?.trim() || process.env.AUTH_SECRET?.trim() || undefined;

/**
 * `true` cuando la cookie de sesión lleva el prefijo `__Secure-`.
 *
 * NextAuth lo decide por el protocolo de `NEXTAUTH_URL` al ESCRIBIRLA. Si aquí
 * se dedujera de otra cosa —del protocolo de la petición, por ejemplo, que
 * detrás de nginx es http— se buscaría una cookie con otro nombre, `getToken`
 * devolvería null y TODA sesión válida parecería inexistente. El síntoma es
 * "entro y me vuelve a pedir entrar", en bucle, y no se parece en nada a su
 * causa.
 */
const cookieSegura = (): boolean => (process.env.NEXTAUTH_URL ?? '').startsWith('https://');

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const identidad = await identidadDe(req);

  const decision = decidir(req.nextUrl.pathname, identidad, req.nextUrl.search);

  if (decision.tipo === 'negar') {
    // A un `fetch` no se le contesta con una pantalla de login: seguiría el
    // 307, recibiría HTML y el `await r.json()` del otro lado reventaría con
    // un error de sintaxis que no se parece a "no hay sesión". Mismo formato
    // de error que usa la API (`PlatformError.toResponse()`), para que el
    // cliente no tenga que distinguir de dónde vino.
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Necesitas iniciar sesión.' } },
      { status: 401 },
    );
  }

  if (decision.tipo === 'entrar') {
    const origen = origenPublico(req.url, req.headers) || req.nextUrl.origin;
    return NextResponse.redirect(new URL(decision.destino, origen));
  }

  // Lo único que sigue viaje. Las cabeceras que ve el Server Component son
  // ÉSTAS, no las que mandó el navegador.
  const cabeceras = new Headers(req.headers);
  sellarIdentidad(cabeceras, identidad);

  return NextResponse.next({ request: { headers: cabeceras } });
}

/**
 * La sesión, o nada.
 *
 * Falla cerrada a propósito: sin secreto, con una cookie corrupta o con una
 * firma que no cuadra, esto devuelve `null` y el invitado va a entrar otra vez.
 * La alternativa —dejar pasar cuando algo no se puede verificar— es cómo se
 * cuela un agujero de aislamiento un viernes por la tarde.
 */
async function identidadDe(req: NextRequest): Promise<IdentidadVerificada | null> {
  const clave = secreto();
  if (!clave) return null;

  try {
    const token = await getToken({ req, secret: clave, secureCookie: cookieSegura() });
    const correo = typeof token?.email === 'string' ? token.email.trim().toLowerCase() : '';
    if (!correo) return null;

    const empresa = typeof token?.tenantSlug === 'string' ? token.tenantSlug.trim() : '';
    return { correo, empresa: empresa.length > 0 ? empresa : null };
  } catch {
    return null;
  }
}
