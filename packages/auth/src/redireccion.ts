/**
 * ════════════════════════════════════════════════════════════════════════════
 *  A dónde va el invitado justo después de entrar.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Dos trabajos en una función, y el segundo es de seguridad.
 *
 *  ── 1. Que aterrice en el Ritual ───────────────────────────────────────────
 *
 *  Quien entra sin haber pedido nada en concreto —apretó el botón desde la
 *  pantalla de NextAuth— va a `/ritual`. Es lo primero que vive alguien en el
 *  producto y lo que decide si se queda. Mandarlo a la landing, que es a donde
 *  lo mandaría el default de NextAuth, sería devolverlo a la puerta por la que
 *  acaba de entrar.
 *
 *  Quien SÍ pedía algo —abrió `/contactos`, el middleware lo mandó a entrar—
 *  vuelve exactamente ahí.
 *
 *  ── 2. Que no sea un redirector abierto ────────────────────────────────────
 *
 *  `callbackUrl` viaja en la URL y lo controla quien mande el enlace. Un
 *  `redirect` que devuelva lo que le pasen convierte
 *  `https://mi.abraxa.club/api/auth/signin?callbackUrl=https://mi-abraxa.club/…`
 *  en un enlace legítimo, del dominio de verdad, con candado, que acaba en el
 *  sitio del atacante justo después de un login correcto. Es el peor momento
 *  posible para mandar a alguien a una pantalla falsa: acaba de teclear su
 *  contraseña de Google y está esperando ver su empresa.
 *
 *  Por eso todo lo que no sea del mismo origen se descarta sin más. El default
 *  de NextAuth ya hace esta comprobación; se rehace aquí porque este callback
 *  la SUSTITUYE, y una comprobación que se hereda de la versión de una
 *  dependencia no es una comprobación que se pueda enseñar en una prueba.
 *
 *  Aquí vive también `origenPublico()`, que es el problema simétrico —desde qué
 *  origen se está sirviendo esto— y que el middleware necesita para no mandar a
 *  nadie a `http://127.0.0.1:3041`. El único import de este módulo es
 *  `origenAutorizado` de `entorno.ts`, que es puro: lee `process.env` y usa
 *  `URL`. Nada de esto arrastra Node al runtime Edge.
 */
import { origenAutorizado, type Entorno } from './entorno';

/** Donde empieza todo el mundo la primera vez. */
export const DESTINO_POR_DEFECTO = '/ritual';

/**
 * Resuelve el `redirect` de NextAuth: devuelve SIEMPRE una URL absoluta del
 * mismo origen.
 *
 * @param url      lo que pide NextAuth (relativa o absoluta; no se confía).
 * @param baseUrl  el origen del sitio, que lo pone NextAuth desde NEXTAUTH_URL.
 */
export function destinoDeRedireccion(
  url: string,
  baseUrl: string,
  porDefecto: string = DESTINO_POR_DEFECTO,
): string {
  const base = baseUrl.replace(/\/+$/, '');
  const destino = `${base}${porDefecto}`;

  const candidata = (url ?? '').trim();
  if (!candidata) return destino;

  // Relativa. `//otro.com/x` es relativa según el protocolo y NO es del mismo
  // origen: se descarta antes que nada, que es el caso que se olvida siempre.
  if (candidata.startsWith('//')) return destino;
  if (candidata.startsWith('/')) {
    return candidata === '/' ? destino : `${base}${candidata}`;
  }

  let absoluta: URL;
  try {
    absoluta = new URL(candidata);
  } catch {
    return destino;
  }

  if (absoluta.origin !== originDe(base)) return destino;

  // Del mismo origen, pero sin nada que pedir: al Ritual.
  const ruta = `${absoluta.pathname}${absoluta.search}`;
  return ruta === '/' || ruta === '' ? destino : `${base}${ruta}`;
}

function originDe(base: string): string {
  try {
    return new URL(base).origin;
  } catch {
    // Sin `NEXTAUTH_URL` bien puesta no hay origen contra el que comparar, así
    // que ninguna URL absoluta pasa. Fail-closed. El espacio del principio es
    // lo que lo hace imposible: ningún `URL.origin` empieza por un espacio.
    return ' sin-origen';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Desde qué origen se está sirviendo esto — el problema simétrico
// ─────────────────────────────────────────────────────────────────────────────

/** Lo mínimo de `Headers`. Tipar así permite probarlo con un objeto literal. */
export interface CabecerasLeibles {
  get(nombre: string): string | null;
}

/**
 * El origen PÚBLICO de esta petición. Nunca el interno.
 *
 * ── Por qué `req.nextUrl.origin` no basta ──────────────────────────────────
 *
 * Detrás de nginx, Next recibe la petición en `http://127.0.0.1:3041`. Un
 * `NextResponse.redirect(new URL('/api/auth/signin', req.nextUrl.origin))`
 * mandaría al navegador del invitado a `http://127.0.0.1:3041/api/auth/signin`
 * — o sea, a SU propia máquina, donde no hay nada. El síntoma es "el login no
 * abre" desde el teléfono y funciona perfecto desde el servidor, que es la
 * clase de fallo que se descubre en vivo.
 *
 * ── El orden, y por qué `NEXTAUTH_URL` va primero ──────────────────────────
 *
 *  1. `NEXTAUTH_URL`. Es lo único que NO controla quien manda la petición, y es
 *     la misma fuente de la que NextAuth compone la URI de redirección de
 *     Google. Que las dos salgan del mismo sitio es lo que impide que el
 *     redirect y el callback discrepen.
 *  2. `x-forwarded-proto` / `x-forwarded-host`, que pone nginx. Se usan sólo
 *     cuando no hay `NEXTAUTH_URL` — en desarrollo detrás de un túnel, por
 *     ejemplo. Un atacante puede forjarlas, y por eso van SEGUNDAS: en
 *     producción `NEXTAUTH_URL` está puesta y gana siempre.
 *  3. La URL de la petición, que es lo correcto en local sin proxy.
 *
 * Devuelve `''` —y no lanza— cuando no hay forma de saberlo. Quien llama cae a
 * su propio origen; una excepción aquí tumbaría el middleware entero, y con él
 * TODAS las pantallas, por no poder componer un redirect.
 */
export function origenPublico(
  url: string,
  cabeceras: CabecerasLeibles,
  env: Entorno = process.env as Entorno,
): string {
  const declarado = origenAutorizado(env);
  if (declarado) return declarado;

  const host = primerValor(cabeceras.get('x-forwarded-host'));
  if (host) {
    const proto = primerValor(cabeceras.get('x-forwarded-proto')) || protocoloDe(url) || 'https';
    return `${proto}://${host}`;
  }

  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

/**
 * El primero de una lista separada por comas.
 *
 * Una cadena de proxies llega como `https, http` y `a.com, b.com`: el primer
 * valor es el que habló con el navegador, y es el único que sirve para componer
 * una URL a la que ese navegador pueda volver.
 */
function primerValor(valor: string | null): string {
  return (valor ?? '').split(',')[0]?.trim() ?? '';
}

function protocoloDe(url: string): string {
  try {
    return new URL(url).protocol.replace(/:$/, '');
  } catch {
    return '';
  }
}
