/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Las cabeceras de identidad: se BORRAN al entrar, se ESCRIBEN al salir.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Éste es el archivo que separa un demo de un accidente.
 *
 *  Dos pantallas del producto —`(app)/ajustes/plan/_lib/datos.ts:41-42` y
 *  `(app)/contactos/datos.ts:42-43`— resuelven quién eres leyendo
 *  `x-abraxa-session-email` y `x-abraxa-session-tenant` con `headers()` de
 *  Next. `headers()` devuelve las cabeceras de la petición **ENTRANTE**: las
 *  que mandó el navegador. Tal cual, sin middleware, esto es todo lo que hace
 *  falta para leer los datos de otra empresa:
 *
 *    curl https://mi.abraxa.club/contactos \
 *      -H 'x-abraxa-session-email: victima@ejemplo.com' \
 *      -H 'x-abraxa-session-tenant: empresa-de-la-victima'
 *
 *  Y el propio servidor le agrega `x-proxy-secret` a la llamada a la API, así
 *  que la API contesta encantada: para ella la petición viene del BFF, que es
 *  justo lo que el secreto compartido certifica.
 *
 *  La única forma de cerrarlo en Next.js es el middleware, porque es el único
 *  lugar donde se pueden REESCRIBIR las cabeceras que los Server Components van
 *  a ver (`NextResponse.next({ request: { headers } })`).
 *
 *  ── El orden importa, y no es cosmético ────────────────────────────────────
 *
 *  Primero BORRAR, después ESCRIBIR. Si se escribe encima sin borrar, un
 *  atacante que mande la cabecera DOS veces gana: `Headers.set` reemplaza la
 *  lista completa, pero cualquier otro camino que use `append`, o un proxy
 *  intermedio que concatene, deja `victima@x.com, yo@x.com` — y `h.get()`
 *  devuelve la cadena entera, con la del atacante primero.
 *
 *  Y se borran TAMBIÉN las del contrato BFF→API (`x-user-email`,
 *  `x-tenant-slug`, `x-proxy-secret`): hoy ninguna pantalla las lee de la
 *  petición entrante, pero el día que alguien reenvíe cabeceras a la API sin
 *  filtrarlas, el agujero vuelve por otra puerta. Borrar de más cuesta cero.
 *
 *  ── Por qué este archivo está en `apps/web` y no en `packages/auth` ────────
 *
 *  Porque `eslint.config.mjs` prohíbe escribir a mano `x-user-email`,
 *  `x-tenant-slug` y `x-proxy-secret` en todo `packages/*` —la regla que impide
 *  que un quinto carril reescriba `contextoDe`— y exime `apps/web/**` con esta
 *  razón textual: «el BFF es quien PONE la cabecera; es el único lugar del
 *  sistema donde eso es correcto». Éste es ese lugar. Meterlo en un paquete y
 *  esquivar la regla concatenando cadenas habría sido saltarse una protección
 *  del repo para quedar más ordenado.
 *
 *  Sin dependencias de runtime a propósito: este módulo lo importa el
 *  middleware, que corre en el runtime Edge. Un `import` de Node aquí lo tumba
 *  entero. El único import es de TIPO, y desaparece al compilar.
 */
import type { IdentidadVerificada } from '../../../../../packages/auth/src/identidad';

export type { IdentidadVerificada };

/** Lo que el middleware ESCRIBE cuando hay sesión verificada. */
export const CABECERA_CORREO = 'x-abraxa-session-email';
export const CABECERA_EMPRESA = 'x-abraxa-session-tenant';

/**
 * Toda cabecera que un navegador NO tiene permitido inventar.
 *
 * Las dos primeras son las de la sesión del BFF. Las tres siguientes son el
 * contrato BFF→API de H2: si llegaran desde fuera y alguien las reenviara, la
 * API las creería.
 */
export const CABECERAS_DE_IDENTIDAD: readonly string[] = [
  CABECERA_CORREO,
  CABECERA_EMPRESA,
  'x-user-email',
  'x-tenant-slug',
  'x-proxy-secret',
];

/** El mínimo de `Headers` que hace falta aquí. Tipar así permite probarlo. */
export interface CabecerasMutables {
  get(nombre: string): string | null;
  set(nombre: string, valor: string): void;
  delete(nombre: string): void;
}

/**
 * Borra del juego todas las cabeceras de identidad que vinieron de fuera.
 *
 * Se llama SIEMPRE, con sesión o sin ella. Una petición anónima que trae
 * `x-abraxa-session-email` es exactamente el ataque, y si sólo limpiáramos
 * cuando hay sesión, el anónimo sería el único que pasa.
 */
export function limpiarIdentidadEntrante(h: CabecerasMutables): void {
  for (const nombre of CABECERAS_DE_IDENTIDAD) h.delete(nombre);
}

/**
 * Borra lo que vino de fuera y escribe lo que el servidor verificó.
 *
 * Con `identidad` en null, sólo borra: la petición sigue viaje sin identidad y
 * las pantallas entran en su estado honesto de "no hay sesión".
 */
export function sellarIdentidad(h: CabecerasMutables, identidad: IdentidadVerificada | null): void {
  limpiarIdentidadEntrante(h);
  if (!identidad) return;

  const correo = identidad.correo.trim().toLowerCase();
  if (!correo) return;

  h.set(CABECERA_CORREO, correo);
  // Sin empresa NO se escribe la cabecera. Escribirla vacía haría que
  // `if (!correo || !empresa)` de las pantallas pasara con `''` en algún
  // refactor futuro, y una consulta con tenant vacío es una consulta sin filtro.
  if (identidad.empresa) h.set(CABECERA_EMPRESA, identidad.empresa);
}

/**
 * Lo que un Server Component lee de la petición YA SELLADA.
 *
 * Es la contraparte de `sellarIdentidad`: lo que sale de aquí sólo puede
 * haberlo escrito el middleware, porque lo que traía el navegador se borró
 * antes. Existe para que la pantalla de `/ajustes` no vuelva a escribir a mano
 * los nombres de las cabeceras — el mismo motivo por el que existe
 * `contextoDePeticion()` del otro lado.
 */
export function identidadSellada(h: {
  get(nombre: string): string | null;
}): IdentidadVerificada | null {
  const correo = (h.get(CABECERA_CORREO) ?? '').trim().toLowerCase();
  if (!correo) return null;

  const empresa = (h.get(CABECERA_EMPRESA) ?? '').trim();
  return { correo, empresa: empresa.length > 0 ? empresa : null };
}
