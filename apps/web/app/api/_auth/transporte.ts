/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El único sitio del BFF que le habla a `apps/api` en nombre de alguien.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Implementa el `Transporte` que pide `packages/auth/src/empresa.ts`. Ahí vive
 *  la decisión —qué empresa le toca a este correo, y si hay que crearla—; aquí
 *  vive lo único que esa decisión no puede saber: cómo se acredita el BFF ante
 *  la API.
 *
 *  ── El contrato, que es de H2 y no de este carril ──────────────────────────
 *
 *    x-user-email     el correo de la sesión verificada server-side
 *    x-proxy-secret   el secreto compartido que prueba que esto es el BFF
 *
 *  `proxyVerified()` del otro lado comprueba el segundo ANTES de mirar el
 *  primero, y en producción sin `PROXY_SECRET` cierra la puerta entera. O sea:
 *  si esta variable falta en el VPS, el invitado entra con Google y se queda
 *  sin empresa. No hay forma de que "casi funcione" — y es a propósito.
 *
 *  ── Por qué hay timeout ────────────────────────────────────────────────────
 *
 *  Esto corre DENTRO del callback de OAuth de Google. Un `fetch` sin plazo
 *  contra una API que no contesta deja al invitado mirando la pantalla blanca
 *  de Google durante minutos, sin nada que apretar y sin saber si funcionó.
 *  Con plazo, a los ocho segundos entra igual y ve una pantalla que le explica
 *  que su empresa no se pudo crear. Ocho segundos son eternos en una demo y
 *  siguen siendo mejores que infinitos.
 *
 *  Se anota `runtime = 'nodejs'` en quien lo usa: este módulo NO va al Edge.
 */
import { baseDeLaApi, secretoDeProxy } from '../../../../../packages/auth/src/entorno';
import type { PeticionApi, RespuestaApi } from '../../../../../packages/auth/src/empresa';

/** El plazo máximo de una llamada del BFF a la API durante el login. */
export const TIMEOUT_MS = 8_000;

/**
 * Habla con `apps/api` poniendo la identidad de la sesión verificada.
 *
 * Nunca lanza por un error HTTP: devuelve el `status` y el cuerpo para que
 * quien decide pueda distinguir un 409 —el slug es de otro, prueba con otro—
 * de un 401 —falta el secreto, no insistas—. Sí lanza si la red se cae, y
 * `empresaDe()` lo atrapa.
 */
export async function transporteDeLaApi(peticion: PeticionApi): Promise<RespuestaApi> {
  const secreto = secretoDeProxy();

  const cabeceras: Record<string, string> = {
    accept: 'application/json',
    'x-user-email': peticion.correo.trim().toLowerCase(),
  };
  if (secreto) cabeceras['x-proxy-secret'] = secreto;
  if (peticion.cuerpo !== undefined) cabeceras['content-type'] = 'application/json';

  /*
   * `cache: 'no-store'` NO es decorativo, y por eso se molesta uno en tiparlo.
   *
   * Next parchea `fetch` y le pone caché por defecto. `/tenants/mine` tiene la
   * MISMA URL para todos los invitados —quién pregunta va en la cabecera— así
   * que una respuesta cacheada aquí es, literalmente, la lista de empresas de
   * una persona servida a otra. Es el peor fallo posible de este carril y se
   * evita con una línea.
   *
   * El tipo se amplía a mano porque el `RequestInit` de `@types/node` no
   * conoce `cache` (sí el del navegador y el de Next). Ampliarlo con la clave
   * exacta es honesto; un `as RequestInit` de escopeta habría tapado también
   * cualquier otro error de este objeto.
   */
  const opciones: RequestInit & { cache?: 'no-store' } = {
    method: peticion.metodo,
    headers: cabeceras,
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    ...(peticion.cuerpo !== undefined ? { body: JSON.stringify(peticion.cuerpo) } : {}),
  };

  const respuesta = await fetch(`${baseDeLaApi()}${peticion.ruta}`, opciones);

  // Un cuerpo ilegible no es un fallo del transporte: el status ya dice lo
  // esencial, y quien decide sabe qué hacer con un 500 sin cuerpo.
  const cuerpo: unknown = await respuesta.json().catch(() => null);

  return { status: respuesta.status, cuerpo };
}
