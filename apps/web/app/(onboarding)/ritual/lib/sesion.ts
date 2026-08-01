import { headers } from 'next/headers';
import { HEADER } from '@abraxa/config';
import { nombreParaElCorreo, slugParaElCorreo } from './slug';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Quién está entrando, resuelto SIEMPRE server-side.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  El correo y la empresa salen de la sesión verificada. Nunca de un header ni
 *  de una cookie que mandó el navegador: ese 403 es lo único que impide que el
 *  cliente A lea los datos del B, y una pantalla que "mientras tanto" confía en
 *  el navegador es exactamente cómo se cuela un agujero de aislamiento a
 *  producción.
 *
 *  ── Lo que este archivo hacía mal, y por qué el Ritual no arrancaba nunca ──
 *
 *  Llamaba `getServerSession()` y exigía `session.user.tenantSlug`. Ese campo
 *  NO puede existir: sólo lo pondría un `callbacks.session` propio, y sin
 *  `authOptions` NextAuth arma el cuerpo por defecto —`{ user: { name, email,
 *  image } }`— y nada más (next-auth 4.24, `next/index.js:100-107`). O sea que
 *  la función devolvía `null` pasara lo que pasara, la ruta contestaba 401 a
 *  las cinco acciones, y la pantalla enseñaba un impedimento con la ruta de
 *  este archivo. El Ritual estaba apagado por construcción.
 *
 *  ── Las tres puertas, en orden, y ninguna confía en el navegador ──────────
 *
 *   1. **El correo.** Se le pregunta al PROPIO handler de NextAuth por HTTP
 *      (`GET /api/auth/session`, con la cookie de esta petición). Ése es el
 *      camino principal porque corre con las `authOptions` reales, sean cuales
 *      sean: sesiones en base de datos, otro nombre de cookie o un
 *      `callbacks.session` que agrega campos. Si no contesta, se cae a
 *      `getServerSession()` en proceso, que es más barata y no necesita red,
 *      pero de ella se toma el correo y NADA más — ver `sesionDeNextAuth()`.
 *      Las dos leen la cookie de sesión; ninguna lee un header de identidad.
 *
 *   2. **La empresa.** El slug NO viaja en la sesión, y no debe: el canon lo
 *      resuelve con `primaryTenantSlugFor()` contra `app.memberships`. Aquí se
 *      pide por el endpoint servidor-a-servidor de H2
 *      (`GET /tenants/internal/primary-tenant`), que exige el secreto del
 *      proxy. Si la sesión SÍ trae `tenantSlug` se respeta y se ahorra el
 *      viaje, pero **sólo cuando vino por HTTP**: de la vía en proceso ese
 *      campo puede llegar `undefined` sin error ni aviso, y creerle sería
 *      confundir "no corrió el callback" con "no tiene empresa".
 *
 *   3. **El alta.** Un invitado que entra por primera vez con Google no tiene
 *      empresa, y sin empresa el Ritual no tiene a quién entrevistar. Se le da
 *      de alta una, con un slug derivado de SU correo.
 *
 *      Eso no abre nada: `provision()` es idempotente por slug **para el mismo
 *      dueño** y lanza CONFLICT si el slug ya es de otra persona
 *      (`packages/tenancy/src/services/provision.ts`). Dos invitados jamás
 *      caen en la misma empresa: el slug lleva la huella de su correo. Y el
 *      correo con el que se da de alta es el de la sesión verificada, nunca uno
 *      del cuerpo de la petición — `POST /tenants` ignora el `ownerEmail` que
 *      le manden y usa el de la cabecera del BFF.
 *
 *      Se apaga con `RITUAL_ALTA_AUTOMATICA=off` el día que el carril de
 *      identidad traiga su propia alta: mientras `primaryTenantSlugFor`
 *      conteste un slug, esto no se ejecuta nunca.
 */
export interface Identidad {
  userEmail: string;
  tenantSlug: string;
}

/**
 * Por qué no hay identidad.
 *
 * Los dos casos se ven igual de rotos si se cuentan igual, y no lo son: a uno
 * le falta iniciar sesión —tiene algo que hacer— y al otro le falló el alta de
 * su empresa, que no es culpa suya y sí se puede reintentar.
 */
export type MotivoSinIdentidad = 'sin-sesion' | 'sin-empresa';

export type ResultadoDeIdentidad =
  | { ok: true; identidad: Identidad }
  | { ok: false; motivo: MotivoSinIdentidad };

interface SesionDeNextAuth {
  user?: { email?: string | null; tenantSlug?: string | null } | null;
}

// ════════════════════════════════════════════════════════════════════════════
// El borde con la API
// ════════════════════════════════════════════════════════════════════════════

export function baseDeLaApi(): string {
  return process.env.API_BASE_URL ?? 'http://localhost:3100';
}

/** Las cabeceras del contrato BFF→API para esta identidad. */
export function cabecerasPara(id: Identidad): Record<string, string> {
  const cabeceras: Record<string, string> = {
    'content-type': 'application/json',
    [HEADER.userEmail]: id.userEmail,
    [HEADER.tenantSlug]: id.tenantSlug,
  };

  const secreto = process.env.PROXY_SECRET;
  if (secreto) cabeceras[HEADER.proxySecret] = secreto;

  return cabeceras;
}

/** Cabeceras de "hay persona, todavía no hay empresa". Es lo que pide `sessionMiddleware`. */
function cabecerasDeSesion(userEmail: string): Record<string, string> {
  const cabeceras: Record<string, string> = {
    'content-type': 'application/json',
    [HEADER.userEmail]: userEmail,
  };

  const secreto = process.env.PROXY_SECRET;
  if (secreto) cabeceras[HEADER.proxySecret] = secreto;

  return cabeceras;
}

/**
 * Un viaje a la API que NUNCA revienta la pantalla.
 *
 * Cualquier fallo aquí —la API caída, un timeout, un cuerpo que no es JSON—
 * tiene que terminar en una pantalla que lo diga, no en un error 500 de Next en
 * la cara de alguien que sólo quiso entrar.
 */
async function pedirALaApi<T>(
  ruta: string,
  init: { metodo?: 'GET' | 'POST'; cabeceras: Record<string, string>; cuerpo?: unknown },
): Promise<T | null> {
  try {
    const r = await fetch(`${baseDeLaApi()}${ruta}`, {
      method: init.metodo ?? 'GET',
      headers: init.cabeceras,
      body: init.cuerpo === undefined ? undefined : JSON.stringify(init.cuerpo),
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Puerta 1 — el correo de la sesión
// ════════════════════════════════════════════════════════════════════════════

/**
 * La ruta del canon (H0-B) a las `authOptions` del carril de identidad.
 *
 * Va en una constante y NO escrita dentro del `import()`, y la diferencia no es
 * de estilo: decide si esto degrada o si tumba el build.
 *
 * Un especificador LITERAL lo resuelve `tsc` —y `next build`, que typechequea— en
 * tiempo de COMPILACIÓN. Mientras `apps/web/app/api/auth/opciones.ts` no exista,
 * la forma literal no cae en el `catch` de abajo: no llega a haber runtime.
 * Medido en este repo:
 *
 *   sesion.ts(149,42): error TS2307: Cannot find module '../../../api/auth/opciones'
 *
 * Con la ruta en una variable, `tsc` deja de intentar resolverla (un `import()`
 * de especificador no literal tipa como `any`) y el fallo se mueve a donde el
 * `catch` sí lo agarra. El día que el carril de identidad aterrice su archivo,
 * esto empieza a resolver solo — sin tocar una línea de este carril, que es
 * exactamente lo que pidió el arbitraje.
 */
const OPCIONES_DE_AUTH = '../../../api/auth/opciones';

/**
 * `getServerSession(authOptions)` en proceso — la vía del canon.
 *
 * Se le PASAN las `authOptions`, y eso es lo que hace que la sesión venga con
 * los `callbacks` del carril de identidad aplicados: sin ellas NextAuth arma el
 * cuerpo de fábrica —`{ user: { name, email, image } }`— y `user.tenantSlug` no
 * puede existir por construcción.
 *
 * Los dos imports son dinámicos y van en el mismo `try`: hoy el segundo falla
 * —el archivo lo entrega otro handoff y todavía no está— y esta función
 * devuelve `null`, que es "no hay sesión en proceso". El respaldo por HTTP de
 * abajo cubre ese hueco mientras tanto, y sigue siendo útil después: le pregunta
 * al propio handler, que corre con esas mismas `authOptions`.
 */
async function sesionEnProceso(): Promise<SesionDeNextAuth | null> {
  try {
    const { getServerSession } = await import('next-auth/next');

    const modulo = (await import(OPCIONES_DE_AUTH)) as {
      authOptions?: Parameters<typeof getServerSession>[0];
    };
    if (!modulo?.authOptions) return null;

    return (await getServerSession(modulo.authOptions)) as SesionDeNextAuth | null;
  } catch {
    return null;
  }
}

/** El origen público de esta petición, tal como lo ve el navegador. */
function origenPublico(): string | null {
  try {
    const h = headers();
    const host = h.get('x-forwarded-host') ?? h.get('host');
    if (!host) return null;
    const proto =
      h.get('x-forwarded-proto') ?? (/^(localhost|127\.0\.0\.1)/.test(host) ? 'http' : 'https');
    return `${proto}://${host}`;
  } catch {
    return null;
  }
}

/**
 * La sesión, preguntándole al propio handler de NextAuth.
 *
 * Es el respaldo para cuando la vía en proceso no alcanza: sesiones en base de
 * datos, un nombre de cookie propio, o un `callbacks.session` que agrega
 * campos. El handler sí conoce su configuración, así que su respuesta es la
 * buena — incluido un `tenantSlug` si alguien decidió ponerlo ahí.
 *
 * Se manda la cookie de ESTA petición y nada más. No hay forma de que el
 * navegador se declare otra persona: la cookie la firma NextAuth.
 */
async function sesionPorHttp(): Promise<SesionDeNextAuth | null> {
  try {
    const cookie = headers().get('cookie');
    if (!cookie) return null;

    const origen = origenPublico();
    if (!origen) return null;

    const r = await fetch(`${origen}/api/auth/session`, {
      headers: { cookie },
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    });
    if (!r.ok) return null;

    const cuerpo = (await r.json()) as SesionDeNextAuth | null;
    return cuerpo?.user?.email ? cuerpo : null;
  } catch {
    return null;
  }
}

/**
 * De dónde salió la sesión. No es telemetría: decide qué campos se pueden creer.
 *
 * `http` viene del propio handler de NextAuth, que corre con SUS `authOptions`
 * y por lo tanto con `callbacks.session` ya aplicado. Ahí un `tenantSlug` es un
 * dato real.
 *
 * `proceso` viene de `getServerSession()` en este proceso. Sirve para el correo
 * y NADA MÁS — ver `sesionDeNextAuth()`.
 */
type ViaDeSesion = 'http' | 'proceso';

interface SesionResuelta {
  sesion: SesionDeNextAuth;
  via: ViaDeSesion;
}

/**
 * La sesión, preguntando PRIMERO por HTTP.
 *
 * ── Por qué el HTTP va primero y no de respaldo (arbitraje H0-B) ───────────
 *
 * Porque el orden inverso tiene un modo de fallo que no avisa. `getServerSession()`
 * sin `authOptions` —o con unas que no son las del carril de identidad— igual
 * devuelve el correo: NextAuth decodifica el JWT con los valores de fábrica y
 * arma `{ user: { name, email, image } }`. Lo que NO devuelve es `tenantSlug`,
 * porque ese campo sólo existe si corre `callbacks.session`, y ese callback sólo
 * corre si le pasas las `authOptions` de verdad. El resultado no es un error:
 * es un `tenantSlug: undefined` silencioso. Con la vía en proceso de primera,
 * una sesión así se daba por buena y el HTTP nunca se intentaba.
 *
 * El handler de `/api/auth/session` no tiene ese problema: corre con la
 * configuración real, sea cual sea, así que su respuesta es la única en la que
 * un `tenantSlug` significa algo.
 *
 * La vía en proceso se conserva porque es más barata y funciona sin red, pero
 * queda marcada como `proceso` para que `resolverIdentidad()` le crea el correo
 * y le ignore el slug.
 */
async function sesionDeNextAuth(): Promise<SesionResuelta | null> {
  const porHttp = await sesionPorHttp();
  if (porHttp?.user?.email) return { sesion: porHttp, via: 'http' };

  const enProceso = await sesionEnProceso();
  if (enProceso?.user?.email) return { sesion: enProceso, via: 'proceso' };

  return null;
}

// ════════════════════════════════════════════════════════════════════════════
// Puerta 2 — la empresa
// ════════════════════════════════════════════════════════════════════════════

async function slugPrincipalDe(userEmail: string): Promise<string | null> {
  const r = await pedirALaApi<{ slug?: string | null }>(
    `/tenants/internal/primary-tenant?email=${encodeURIComponent(userEmail)}`,
    { cabeceras: cabecerasDeSesion(userEmail) },
  );
  const slug = r?.slug;
  return typeof slug === 'string' && slug.length > 0 ? slug : null;
}

// ════════════════════════════════════════════════════════════════════════════
// Puerta 3 — el alta
// ════════════════════════════════════════════════════════════════════════════

const altaAutomaticaEncendida = (): boolean =>
  (process.env.RITUAL_ALTA_AUTOMATICA ?? 'on').toLowerCase() !== 'off';

/**
 * Le da de alta su empresa a quien acaba de entrar y no tiene ninguna.
 *
 * El dueño es SIEMPRE el de la sesión: `POST /tenants` ignora cualquier
 * `ownerEmail` del cuerpo y usa el de la cabecera verificada
 * (`packages/tenancy/src/routes/index.ts`, decisión 2).
 */
async function darDeAltaSuEmpresa(userEmail: string): Promise<string | null> {
  if (!altaAutomaticaEncendida()) return null;

  const slug = slugParaElCorreo(userEmail);
  const r = await pedirALaApi<{ tenantId?: string }>('/tenants', {
    metodo: 'POST',
    cabeceras: cabecerasDeSesion(userEmail),
    cuerpo: { slug, name: nombreParaElCorreo(userEmail) },
  });

  // Un fallo aquí incluye el CONFLICT de un slug que ya es de otra persona. En
  // los dos casos la respuesta correcta es la misma: no hay empresa, y la
  // pantalla lo dice. Jamás se cae hacia la empresa de alguien más.
  return r?.tenantId ? slug : null;
}

// ════════════════════════════════════════════════════════════════════════════
// La función
// ════════════════════════════════════════════════════════════════════════════

export async function resolverIdentidad(): Promise<ResultadoDeIdentidad> {
  const resuelta = await sesionDeNextAuth();
  // Se sale con `resuelta` y no con el correo para que TypeScript lo estreche:
  // abajo hace falta la VÍA, no sólo el correo, y `resuelta?.` no lo estrecha.
  if (!resuelta) return { ok: false, motivo: 'sin-sesion' };

  const userEmail = resuelta.sesion.user?.email?.trim().toLowerCase();
  if (!userEmail) return { ok: false, motivo: 'sin-sesion' };

  // El slug SÓLO se acepta de la vía HTTP. De la vía en proceso se toma el
  // correo y nada más: ahí `tenantSlug` puede venir `undefined` sin que nadie
  // avise —porque `callbacks.session` no corrió— y un `undefined` silencioso es
  // indistinguible de "esta persona no tiene empresa". Cuando no se acepta, no
  // se pierde nada: abajo está `primaryTenantSlugFor()` de H2, que es la fuente
  // canónica de todos modos.
  const deLaSesion = resuelta.via === 'http' ? resuelta.sesion.user?.tenantSlug?.trim() : null;
  const tenantSlug =
    (deLaSesion && deLaSesion.length > 0 ? deLaSesion : null) ??
    (await slugPrincipalDe(userEmail)) ??
    (await darDeAltaSuEmpresa(userEmail));

  if (!tenantSlug) return { ok: false, motivo: 'sin-empresa' };

  return { ok: true, identidad: { userEmail, tenantSlug } };
}

/** La identidad, o `null`. Es lo que necesita el BFF, que sólo distingue 401. */
export async function identidadDeLaSesion(): Promise<Identidad | null> {
  const r = await resolverIdentidad();
  return r.ok ? r.identidad : null;
}

// ════════════════════════════════════════════════════════════════════════════
// Por dónde se entra
// ════════════════════════════════════════════════════════════════════════════

/**
 * La puerta de entrada que EXISTE hoy, no la que debería existir.
 *
 * Se comprueba en vivo, y no se clava en el código, porque la pantalla de
 * inicio de sesión no es de este carril: puede aterrizar como `/entrar` —la
 * que promete el canon, con la marca y en español— o sólo como el handler de
 * NextAuth, cuya pantalla de fábrica es fea pero abre sesión.
 *
 * Un botón que apunta a una ruta que todavía no existe manda al invitado a un
 * 404, que es peor que no tener botón. Así que si no hay ninguna de las dos, se
 * devuelve `null` y la pantalla dice la verdad.
 */
export async function puertaDeEntrada(): Promise<string | null> {
  const origen = origenPublico();
  if (!origen) return null;

  if (await responde(`${origen}/entrar`)) return '/entrar?callbackUrl=%2Fritual';
  if (await responde(`${origen}/api/auth/providers`)) {
    return '/api/auth/signin?callbackUrl=%2Fritual';
  }
  return null;
}

async function responde(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, {
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(2_500),
    });
    // Un 3xx cuenta: una pantalla de entrada que redirige sigue siendo una
    // pantalla de entrada. Lo que no cuenta es un 404.
    return r.status < 400;
  } catch {
    return false;
  }
}
