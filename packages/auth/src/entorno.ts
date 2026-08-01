/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Las variables de identidad, leídas en UN solo lugar.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Seis variables deciden si alguien puede entrar a ABRAXA. Cuando se leen
 *  esparcidas —un `process.env.NEXTAUTH_SECRET ?? ''` aquí, un
 *  `process.env.GOOGLE_CLIENT_ID!` allá— fallan de la peor manera posible: no
 *  fallan. El servidor arranca, la pantalla de entrada se pinta, el invitado
 *  aprieta el botón y Google enseña una pantalla de error suya, con un código
 *  de Google, que desde este repo no se puede diagnosticar.
 *
 *  Por eso están todas aquí, cada una con su forma de faltar:
 *
 *    GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET   sin ellas no hay proveedor
 *    NEXTAUTH_URL                              de aquí salen la URI de
 *                                              redirección Y el prefijo
 *                                              `__Secure-` de la cookie
 *    NEXTAUTH_SECRET / AUTH_SECRET             firma la cookie
 *    PROXY_SECRET                              acredita al BFF ante la API
 *    API_BASE_URL                              dónde vive `apps/api`
 *
 *  ── Por qué el entorno se pasa como argumento ──────────────────────────────
 *
 *  Cada función toma un `Entorno` con `process.env` por defecto. En producción
 *  nadie lo pasa y se lee lo de siempre; en las pruebas se pasa un objeto
 *  literal, y por eso `entorno.test.ts` puede comprobar los diez casos —incluido
 *  "en producción sin PROXY_SECRET"— sin escribir en `process.env`, que es
 *  global, compartido entre archivos y la causa clásica de una prueba que pasa
 *  sola y falla en la suite.
 *
 *  ── Una variable en blanco cuenta como ausente ─────────────────────────────
 *
 *  `PROXY_SECRET=` en un `.env` es lo que deja alguien a medio configurar, y es
 *  peor que no ponerla: una cadena vacía pasa cualquier `if (x)` mal escrito y
 *  llega hasta el `fetch`, que manda una cabecera vacía y recibe un 401 sin
 *  explicación. Aquí se recorta y, si no queda nada, no existe.
 */

/** Sólo lo que hace falta de `process.env`. Nunca `NodeJS.ProcessEnv`. */
export type Entorno = Record<string, string | undefined>;

export interface CredencialesDeGoogle {
  clientId: string;
  clientSecret: string;
}

export interface Diagnostico {
  /** `true` cuando el login puede funcionar de verdad en este entorno. */
  listo: boolean;
  /** Lo que impide entrar, en español y con el nombre de la variable. */
  faltantes: string[];
  /** Lo que va a doler pero no impide entrar hoy. */
  advertencias: string[];
  /** La que hay que tener registrada en Google Cloud Console. */
  uriDeRedireccion: string | null;
}

/** La ruta del callback de Google. La fija NextAuth y la replica nginx. */
export const RUTA_DE_CALLBACK = '/api/auth/callback/google';

const entornoActual = (): Entorno => process.env as Entorno;

/** El valor recortado, o `undefined` si estaba vacío o en blanco. */
function leer(env: Entorno, clave: string): string | undefined {
  const valor = (env[clave] ?? '').trim();
  return valor.length > 0 ? valor : undefined;
}

const esProduccion = (env: Entorno): boolean => leer(env, 'NODE_ENV') === 'production';

// ─── Las lecturas ─────────────────────────────────────────────────────────

/**
 * Dónde vive `apps/api`, sin barra final.
 *
 * La barra final importa porque las rutas se concatenan (`${base}/tenants`) y
 * `http://api:3100//tenants` es una URL distinta: Express no la casa con su
 * router y contesta 404, que se lee como "la API no tiene ese endpoint" en vez
 * de "sobra una barra en una variable de entorno".
 *
 * El valor por defecto es el de desarrollo y es el mismo puerto que usa
 * `apps/api` sin configurar nada — para que `npm run dev:web` funcione recién
 * clonado el repo.
 */
export function baseDeLaApi(env: Entorno = entornoActual()): string {
  const base = leer(env, 'API_BASE_URL') ?? 'http://localhost:3100';
  return base.replace(/\/+$/, '');
}

/**
 * El cliente OAuth de Google, o `null` si falta cualquiera de las dos mitades.
 *
 * `null` y no un objeto con cadenas vacías: con cadenas vacías se construiría
 * un `GoogleProvider` que manda al invitado a `accounts.google.com` con
 * `client_id=`, y Google enseña su propia pantalla de error. Con `null` no hay
 * proveedor, NextAuth dice "no hay proveedores configurados" y
 * `diagnosticoDeIdentidad()` explica cuál de las dos falta.
 */
export function credencialesDeGoogle(env: Entorno = entornoActual()): CredencialesDeGoogle | null {
  const clientId = leer(env, 'GOOGLE_CLIENT_ID');
  const clientSecret = leer(env, 'GOOGLE_CLIENT_SECRET');
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/**
 * El secreto que firma la cookie. Acepta el nombre de v4 y el de v5.
 *
 * `NEXTAUTH_SECRET` (v4) manda sobre `AUTH_SECRET` (v5) porque v4 es lo que
 * está instalado. Los dos están puestos con el MISMO valor en el VPS, así que
 * el orden sólo importa el día que alguien cambie uno y se olvide del otro — y
 * ese día gana el que la versión instalada usa de verdad.
 */
export function secretoDeSesion(env: Entorno = entornoActual()): string | undefined {
  return leer(env, 'NEXTAUTH_SECRET') ?? leer(env, 'AUTH_SECRET');
}

/**
 * El secreto compartido con `apps/api`.
 *
 * Sin él, `proxyVerified()` del otro lado rechaza al BFF en producción: el
 * invitado entra con Google y no ve un solo dato. Es peor que no dejarlo
 * entrar, porque parece que el producto está vacío.
 */
export function secretoDeProxy(env: Entorno = entornoActual()): string | undefined {
  return leer(env, 'PROXY_SECRET');
}

/** El origen público del sitio, según `NEXTAUTH_URL`. `null` si no se puede leer. */
export function origenAutorizado(env: Entorno = entornoActual()): string | null {
  const bruta = leer(env, 'NEXTAUTH_URL');
  if (!bruta) return null;

  try {
    return new URL(bruta).origin;
  } catch {
    return null;
  }
}

/**
 * La URI de redirección EXACTA que hay que tener registrada en Google.
 *
 * Se deriva de `NEXTAUTH_URL` igual que la deriva NextAuth. Si no coincidiera
 * con la registrada, el login falla con `redirect_uri_mismatch` en la pantalla
 * de Google — que no se puede diagnosticar desde aquí, y por eso esta función
 * existe: para poder imprimirla y compararla a ojo.
 *
 * `null` y no una URI inventada: una URI compuesta sobre `undefined` sería
 * `undefined/api/auth/callback/google`, que parece una respuesta y no lo es.
 */
export function uriDeRedireccion(env: Entorno = entornoActual()): string | null {
  const bruta = leer(env, 'NEXTAUTH_URL');
  if (!bruta) return null;

  let base: string;
  try {
    // `href` normaliza (`https://x` → `https://x/`); el recorte quita la barra
    // para que no salga `https://x//api/auth/...`. Se conserva el path por si
    // el sitio vive bajo un prefijo.
    base = new URL(bruta).href.replace(/\/+$/, '');
  } catch {
    return null;
  }

  return `${base}${RUTA_DE_CALLBACK}`;
}

// ─── El diagnóstico ───────────────────────────────────────────────────────

/**
 * Qué falta para que el login funcione, en español.
 *
 * Existe porque el modo de fallo de este carril es mudo: sin una variable, el
 * servidor arranca igual y el error aparece en una pantalla de Google. Esto lo
 * dice antes, con el nombre de la variable y la consecuencia.
 *
 * `PROXY_SECRET` es la única que cambia de peso según el entorno: en desarrollo
 * `proxyVerified()` deja pasar sin él y todo funciona, así que es una
 * advertencia; en producción cierra la puerta entera, así que es un faltante.
 * Tratarlo igual en los dos sitios daría, o un CI rojo por nada, o un invitado
 * sin datos en el evento.
 */
export function diagnosticoDeIdentidad(env: Entorno = entornoActual()): Diagnostico {
  const faltantes: string[] = [];
  const advertencias: string[] = [];

  if (!credencialesDeGoogle(env)) {
    faltantes.push(
      'GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET: sin las dos no hay proveedor de Google y ' +
        'la pantalla de entrada sale sin ningún botón.',
    );
  }

  if (!secretoDeSesion(env)) {
    faltantes.push(
      'NEXTAUTH_SECRET (o AUTH_SECRET): sin él la cookie de sesión no va firmada y el ' +
        'middleware no reconoce a nadie — se entra y se vuelve a pedir entrar, en bucle.',
    );
  }

  const uri = uriDeRedireccion(env);
  if (!uri) {
    faltantes.push(
      'NEXTAUTH_URL: de ella salen la URI de redirección que Google tiene registrada y el ' +
        'prefijo `__Secure-` de la cookie. Sin ella el callback de Google no vuelve.',
    );
  }

  const produccion = esProduccion(env);

  if (!secretoDeProxy(env)) {
    const mensaje =
      'PROXY_SECRET: acredita al BFF ante la API. Sin él el invitado entra con Google y ' +
      'no ve un solo dato, que parece un producto vacío y no un error.';
    if (produccion) faltantes.push(mensaje);
    else advertencias.push(`${mensaje} En desarrollo la API deja pasar sin él.`);
  }

  const origen = origenAutorizado(env);
  if (produccion && origen && !origen.startsWith('https://')) {
    advertencias.push(
      `NEXTAUTH_URL apunta a ${origen}, que no es https. En producción la cookie de sesión ` +
        'no lleva el prefijo `__Secure-` y viaja en claro.',
    );
  }

  return { listo: faltantes.length === 0, faltantes, advertencias, uriDeRedireccion: uri };
}
