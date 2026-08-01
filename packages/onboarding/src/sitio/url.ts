/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Qué URL se puede pedir, y cuál no. Sin red, sin base, sin modelo.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Todo aquí es puro para que la parte peligrosa del producto —pedirle al
 *  servidor que visite una dirección que escribió un desconocido— se pueda
 *  probar entera en CI, con la lista de evasiones reales delante.
 *
 *  ── El ataque, dicho sin rodeos ───────────────────────────────────────────
 *
 *  Un invitado autenticado pega `http://169.254.169.254/latest/meta-data/` y le
 *  pedimos ESO desde el VPS. Él no alcanza esa dirección; nosotros sí. Lo mismo
 *  con `http://127.0.0.1:5432`, con `http://10.x` y con cualquier panel interno
 *  que no espere visitas. Eso es SSRF, y no hace falta un bug para tenerlo: hace
 *  falta exactamente la funcionalidad que este archivo habilita.
 *
 *  ── Las cuatro puertas ────────────────────────────────────────────────────
 *
 *   1. **Esquema.** Sólo `http:` y `https:`. `file:`, `gopher:`, `data:` y
 *      `javascript:` ni se intentan.
 *   2. **Forma del host.** La `URL` de la plataforma normaliza cualquier IPv4
 *      —decimal, octal, hexadecimal— a punteada, así que `http://2130706433/`
 *      llega aquí ya como `127.0.0.1` y cae en la lista. Es la razón por la que
 *      se revisa DESPUÉS de parsear y no antes con una expresión regular.
 *   3. **Nombres reservados.** `localhost`, `.local`, `.internal`.
 *   4. **Rangos privados.** IPv4 e IPv6, incluidas las IPv4 mapeadas
 *      (`::ffff:127.0.0.1`), que es la evasión que se le olvida a todo el mundo.
 *
 *  Y las dos que NO se pueden cerrar mirando texto —el DNS que resuelve a una
 *  IP privada y la redirección hacia ella— se cierran en `leer.ts`, resolviendo
 *  el nombre antes de pedir y revisando cada salto. Un dominio público que
 *  redirige a 127.0.0.1 es la evasión clásica y aquí no pasaría este archivo:
 *  pasaría el primer `fetch`.
 */
import type { TipoDeEnlace } from '../types';

// ════════════════════════════════════════════════════════════════════════════
// Normalizar
// ════════════════════════════════════════════════════════════════════════════

/** Esquemas que nunca se intentan, ni siquiera para decir que no. */
const ESQUEMAS_BUENOS = new Set(['http:', 'https:']);

/**
 * Lo que pegó, convertido en `URL`, o `null` si no hay forma.
 *
 * Casi nadie escribe el esquema. "lataqueria.mx" es lo que la gente teclea y
 * exigirle `https://` sería cobrarle a él un detalle nuestro, así que se le pone
 * — pero SÓLO cuando no traía ninguno, porque pegárselo a `javascript:alert(1)`
 * produciría `https://javascript:alert(1)`, que parece inofensivo y no lo es.
 */
export function normalizarUrl(crudo: string): URL | null {
  // La coma y el punto finales son de dictado y de copiar y pegar, no del
  // dominio. Los paréntesis y comillas vienen de pegar desde WhatsApp.
  const limpio = crudo.trim().replace(/^[<("']+/, '').replace(/[>)"'.,;]+$/, '');
  if (!limpio) return null;

  const conEsquema = /^[a-z][a-z0-9+.-]*:/i.test(limpio) ? limpio : `https://${limpio}`;

  let url: URL;
  try {
    url = new URL(conEsquema);
  } catch {
    return null;
  }

  // Sin host no hay a dónde ir. `http://` y `https://` solos llegan aquí.
  if (!url.hostname) return null;

  // Un "dominio" sin punto y sin ser IP es una palabra suelta: "hola" se
  // convertiría en `https://hola/`, que parece una URL y no lo es.
  if (!url.hostname.includes('.') && !url.hostname.startsWith('[')) return null;

  return url;
}

// ════════════════════════════════════════════════════════════════════════════
// IPs privadas
// ════════════════════════════════════════════════════════════════════════════

/** IPv4 punteada → los cuatro octetos, o `null` si no lo es. */
function octetos(host: string): [number, number, number, number] | null {
  const partes = host.split('.');
  if (partes.length !== 4) return null;

  const nums: number[] = [];
  for (const p of partes) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    nums.push(n);
  }
  const [a, b, c, d] = nums;
  if (a === undefined || b === undefined || c === undefined || d === undefined) return null;
  return [a, b, c, d];
}

/**
 * ¿Esta IPv4 apunta a algo que no es la internet pública?
 *
 * La lista es la de IANA, no una intuición. `100.64/10` (CGNAT) y `198.18/15`
 * (pruebas de red) están porque en un VPS pueden ser la red del proveedor.
 */
export function esIpv4Privada(ip: string): boolean {
  const o = octetos(ip);
  if (!o) return false;
  const [a, b] = o;

  if (a === 0) return true; // 0.0.0.0/8 — "esta red"
  if (a === 10) return true; // privada
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + metadatos de la nube
  if (a === 172 && b >= 16 && b <= 31) return true; // privada
  if (a === 192 && b === 168) return true; // privada
  if (a === 192 && b === 0) return true; // 192.0.0/24 y 192.0.2/24
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // pruebas de red
  if (a === 198 && b === 51) return true; // documentación
  if (a === 203 && b === 0) return true; // documentación
  if (a >= 224) return true; // multicast y reservado

  return false;
}

/** ¿Esta IPv6 —sin corchetes— apunta a algo que no es la internet pública? */
export function esIpv6Privada(ip: string): boolean {
  const v = ip.toLowerCase().split('%')[0] ?? ''; // `%eth0` es el scope, no la dirección
  if (!v) return true;

  if (v === '::1' || v === '::') return true;

  // IPv4 mapeada o compatible: la que se le olvida a todo el mundo.
  // `::ffff:127.0.0.1` es 127.0.0.1 con otro traje.
  const mapeada = /^::(?:ffff:(?:0{1,4}:)?)?((?:\d{1,3}\.){3}\d{1,3})$/.exec(v);
  if (mapeada?.[1]) return esIpv4Privada(mapeada[1]);

  // NAT64 (64:ff9b::/96) y 6to4 (2002::/16) también pueden envolver una IPv4.
  const nat64 = /^64:ff9b::((?:\d{1,3}\.){3}\d{1,3})$/.exec(v);
  if (nat64?.[1]) return esIpv4Privada(nat64[1]);

  if (/^f[cd]/.test(v)) return true; // fc00::/7 — únicas locales
  if (/^fe[89ab]/.test(v)) return true; // fe80::/10 — link-local
  if (/^ff/.test(v)) return true; // ff00::/8 — multicast
  if (/^2002:/.test(v)) return true; // 6to4: puede envolver cualquier IPv4

  return false;
}

/**
 * `true` si este host no se debe pedir jamás.
 *
 * Recibe el `hostname` de una `URL` ya parseada, así que las IPv4 en decimal u
 * octal llegan aquí ya normalizadas y las IPv6 llegan entre corchetes.
 */
export function esHostPrivado(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/\.$/, '');
  if (!h) return true;

  if (h.startsWith('[') && h.endsWith(']')) return esIpv6Privada(h.slice(1, -1));
  // Node a veces entrega la IPv6 sin corchetes (por ejemplo desde `dns.lookup`).
  if (h.includes(':')) return esIpv6Privada(h);

  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.home.arpa')) return true;
  // El nombre con el que se llega a los metadatos en Google Cloud.
  if (h === 'metadata' || h.endsWith('.metadata.google.internal')) return true;

  return esIpv4Privada(h);
}

// ════════════════════════════════════════════════════════════════════════════
// Redes sociales
// ════════════════════════════════════════════════════════════════════════════

/**
 * Los dominios que NO son una página web: son un perfil.
 *
 * Importa distinguirlos porque pedirlos no sirve de nada —Instagram le contesta
 * a un servidor con un muro de inicio de sesión— y porque el handle SÍ es un
 * dato bueno del negocio: es su canal, y muchas veces su nombre comercial.
 */
const REDES: Array<{ red: string; hosts: RegExp }> = [
  { red: 'instagram', hosts: /(^|\.)instagram\.com$|(^|\.)instagr\.am$/ },
  { red: 'facebook', hosts: /(^|\.)facebook\.com$|(^|\.)fb\.com$|(^|\.)fb\.me$/ },
  { red: 'tiktok', hosts: /(^|\.)tiktok\.com$/ },
  { red: 'x', hosts: /(^|\.)twitter\.com$|(^|\.)x\.com$/ },
  { red: 'linkedin', hosts: /(^|\.)linkedin\.com$/ },
  { red: 'youtube', hosts: /(^|\.)youtube\.com$|(^|\.)youtu\.be$/ },
  { red: 'whatsapp', hosts: /(^|\.)wa\.me$|(^|\.)whatsapp\.com$/ },
];

/** Segmentos de ruta que son de la plataforma, no del negocio. */
const SEGMENTOS_VACIOS = new Set([
  'p',
  'pages',
  'page',
  'profile.php',
  'company',
  'in',
  'reel',
  'reels',
  'explore',
  'channel',
  'c',
  'watch',
]);

export interface Clasificacion {
  tipo: TipoDeEnlace;
  red: string | null;
  handle: string | null;
}

/** Qué clase de enlace es y, si es un perfil, de quién. */
export function clasificarEnlace(url: URL): Clasificacion {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const red = REDES.find((r) => r.hosts.test(host))?.red ?? null;

  if (!red) return { tipo: 'sitio', red: null, handle: null };

  const segmentos = url.pathname.split('/').filter((s) => s.length > 0);
  const primero = segmentos.find((s) => !SEGMENTOS_VACIOS.has(s.toLowerCase()));

  const handle = primero ? `@${decodeURIComponent(primero).replace(/^@/, '')}` : null;

  return { tipo: 'red-social', red, handle };
}

// ════════════════════════════════════════════════════════════════════════════
// La puerta
// ════════════════════════════════════════════════════════════════════════════

export type MotivoRechazo = 'ilegible' | 'esquema' | 'privada';

export type Revision =
  | { ok: true; url: URL; tipo: TipoDeEnlace; red: string | null; handle: string | null }
  | { ok: false; motivo: MotivoRechazo; mensaje: string };

/**
 * Los mensajes de rechazo, escritos para enseñarse TAL CUAL.
 *
 * Ninguno dice qué se bloqueó ni por qué técnicamente: eso le confirmaría a
 * quien está probando el sistema que hay algo detrás que sí responde. Y ninguno
 * suena a error: los tres terminan invitando a seguir por el camino normal, que
 * es contarlo con sus palabras.
 */
const MENSAJES: Record<MotivoRechazo, string> = {
  ilegible:
    'No alcancé a reconocer una página ahí. Da igual: cuéntame tú de tu negocio y avanzamos.',
  esquema: 'Sólo puedo abrir páginas de internet. Si no tienes una, me lo cuentas tú y ya.',
  privada:
    'Esa dirección no la puedo abrir desde aquí. Cuéntame tú de tu negocio y seguimos igual de rápido.',
};

/**
 * Un `@handle` suelto, sin dominio.
 *
 * Mucha gente no tiene página y lo que pega es "@lataqueriadelbarrio". Tratarlo
 * como basura sería tirar un dato bueno; se asume Instagram, que es donde vive
 * ese formato en México, y el invitado lo confirma después como todo lo demás.
 */
const HANDLE_SUELTO = /^@([a-z0-9._-]{2,40})$/i;

export function revisarUrl(crudo: string): Revision {
  const texto = crudo.trim();

  const suelto = HANDLE_SUELTO.exec(texto);
  if (suelto?.[1]) {
    return {
      ok: true,
      url: new URL(`https://www.instagram.com/${suelto[1]}/`),
      tipo: 'red-social',
      red: 'instagram',
      handle: `@${suelto[1]}`,
    };
  }

  // El esquema se revisa ANTES de normalizar. Si se hiciera después, un
  // `javascript:alert(1)` habría recibido un `https://` delante y se leería
  // como un host llamado "javascript".
  const esquemaEscrito = /^([a-z][a-z0-9+.-]*):/i.exec(texto)?.[1];
  if (esquemaEscrito && !ESQUEMAS_BUENOS.has(`${esquemaEscrito.toLowerCase()}:`)) {
    return { ok: false, motivo: 'esquema', mensaje: MENSAJES.esquema };
  }

  const url = normalizarUrl(texto);
  if (!url) return { ok: false, motivo: 'ilegible', mensaje: MENSAJES.ilegible };

  if (!ESQUEMAS_BUENOS.has(url.protocol)) {
    return { ok: false, motivo: 'esquema', mensaje: MENSAJES.esquema };
  }

  if (esHostPrivado(url.hostname)) {
    return { ok: false, motivo: 'privada', mensaje: MENSAJES.privada };
  }

  const c = clasificarEnlace(url);
  return { ok: true, url, tipo: c.tipo, red: c.red, handle: c.handle };
}

/** El mensaje de rechazo de un motivo. Lo usa el motor para hablar. */
export function mensajeDeRechazo(motivo: MotivoRechazo): string {
  return MENSAJES[motivo];
}
