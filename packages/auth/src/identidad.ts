/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Quién eres — y qué se puede abrir sin ser nadie.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Dos cosas, las dos puras y sin una sola dependencia: el tipo de la identidad
 *  ya verificada, y la política de qué rutas exigen sesión.
 *
 *  La política vive aquí y no dentro de `middleware.ts` porque el middleware
 *  corre en el runtime Edge y no se puede probar sin levantar Next entero. La
 *  decisión —"esta ruta con esta identidad: ¿pasa, entra o se niega?"— es una
 *  función de dos argumentos, y como función se prueba en milisegundos y se
 *  lee de un vistazo. El middleware queda como lo que debe ser: veinte líneas
 *  de pegamento.
 *
 *  ── La lista es de lo PÚBLICO, no de lo protegido ──────────────────────────
 *
 *  Falla cerrado. Una ruta nueva de cualquiera de los catorce carriles nace
 *  exigiendo sesión, y para abrirla hay que venir a este archivo y escribirla.
 *  Al revés —una lista de rutas protegidas— la pantalla que alguien añada
 *  mañana nace abierta, y nadie se entera hasta que se entera todo el mundo.
 */

/** Quién eres, ya resuelto server-side. `empresa` es null antes del Ritual. */
export interface IdentidadVerificada {
  correo: string;
  empresa: string | null;
}

/**
 * Rutas que se abren sin sesión, por prefijo.
 *
 *   `/`                 la landing de H10
 *   `/bienvenida`       y `/gracias`, el resto del grupo (public)
 *   `/entrar`           la pantalla de entrada de H10 (todavía no existe;
 *                       listarla ya evita el bucle el día que aterrice)
 *   `/api/auth`         NextAuth. Protegerla sería pedir sesión para poder
 *                       iniciar sesión: un bucle de redirección infinito.
 *
 * La raíz se compara aparte porque como prefijo casaría con todo.
 */
export const PREFIJOS_PUBLICOS: readonly string[] = [
  '/api/auth',
  '/bienvenida',
  '/gracias',
  '/entrar',
];

/** Rutas públicas exactas. Sólo la raíz, y por eso está sola. */
export const RUTAS_PUBLICAS: readonly string[] = ['/'];

export function esRutaPublica(ruta: string): boolean {
  const limpia = normalizarRuta(ruta);
  if (RUTAS_PUBLICAS.includes(limpia)) return true;
  return PREFIJOS_PUBLICOS.some((p) => limpia === p || limpia.startsWith(`${p}/`));
}

/**
 * Quita la barra final y colapsa las repetidas.
 *
 * `//api/auth/session` y `/api/auth/session/` tienen que decidirse igual que
 * `/api/auth/session`. Una política de rutas que se puede esquivar con una
 * barra de más no es una política.
 */
export function normalizarRuta(ruta: string): string {
  const colapsada = `/${ruta}`.replace(/\/+/g, '/');
  return colapsada.length > 1 ? colapsada.replace(/\/+$/, '') : '/';
}

/**
 * ¿Esto lo pidió un `fetch` o el barra de direcciones?
 *
 * Importa porque a un `fetch` no se le contesta con un 307 a una pantalla de
 * login: el navegador la sigue, recibe HTML y el `await r.json()` del otro lado
 * revienta con un error de sintaxis que no se parece en nada a "no hay sesión".
 * A las rutas de datos se les niega con 401 y ya.
 *
 * Se detecta por la forma de la ruta y no por `Accept`, que el atacante
 * controla: las rutas BFF de este producto llevan todas `/api/` en medio
 * —`/bandeja/api/hilos`, `/ritual/api/turno`— por convención de los carriles.
 */
export function esRutaDeDatos(ruta: string): boolean {
  const limpia = normalizarRuta(ruta);
  return limpia === '/api' || limpia.startsWith('/api/') || limpia.includes('/api/');
}

export type Decision = { tipo: 'seguir' } | { tipo: 'entrar'; destino: string } | { tipo: 'negar' };

/** Dónde vive la pantalla de entrada. La de NextAuth: un botón, un clic. */
export const RUTA_DE_ENTRADA = '/api/auth/signin';

/**
 * Qué hacer con esta petición.
 *
 * `callbackUrl` conserva a dónde iba el invitado. Quien abre un enlace a
 * `/contactos` sin sesión vuelve a `/contactos` después de entrar, y no a una
 * portada desde la que tiene que volver a buscar.
 */
export function decidir(
  ruta: string,
  identidad: IdentidadVerificada | null,
  busqueda = '',
): Decision {
  if (identidad) return { tipo: 'seguir' };
  if (esRutaPublica(ruta)) return { tipo: 'seguir' };
  if (esRutaDeDatos(ruta)) return { tipo: 'negar' };

  const volverA = `${normalizarRuta(ruta)}${busqueda}`;
  return {
    tipo: 'entrar',
    destino: `${RUTA_DE_ENTRADA}?callbackUrl=${encodeURIComponent(volverA)}`,
  };
}
