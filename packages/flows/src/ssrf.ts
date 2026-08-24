/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El único nodo donde el cliente escribe una dirección: `webhook`.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  El emprendedor es semi-confiable: puede editar sus flujos, no puede pedirle
 *  al worker que hable con la red interna. Sin este guard, `webhook` con
 *  `http://169.254.169.254/…` convierte el motor de automatizaciones en un
 *  lector de credenciales del proveedor de nube — desde dentro del perímetro,
 *  que es donde no hay firewall que valga.
 *
 *  Portado de GARDEN (`src/crm/util.ts:39`) con tres endurecimientos:
 *
 *    · Los IPv6 comprimidos y los IPv4 mapeados (`::ffff:127.0.0.1`) también
 *      caen: en GARDEN `::ffff:7f00:1` pasaba.
 *    · Los decimales/octales/hexadecimales de un IPv4 (`http://2130706433/`,
 *      `http://0177.0.0.1/`) se normalizan antes de juzgarlos. Es la evasión
 *      clásica y es una línea.
 *    · Sólo `http` y `https`. `file://`, `gopher://` y compañía se bloquean por
 *      esquema y no por host.
 *
 *  Se prueba entero sin red — por eso no se pospone aunque no haya `.env`.
 *
 *  ── Lo que este guard NO cubre, dicho aquí y no en la sala de máquinas ─────
 *
 *  Un dominio público que resuelve a 127.0.0.1 (DNS rebinding) pasa esta
 *  puerta: se juzga la URL, no la IP a la que el sistema termina conectándose.
 *  Cerrarlo de verdad exige resolver el nombre y fijar la conexión a esa IP
 *  —un agente de HTTP propio—, que es trabajo de infraestructura y no de este
 *  carril. Mitigado en parte: `redirect: 'error'` en el fetch, así que al menos
 *  no se sigue un 302 hacia dentro.
 */

/** Sólo estos dos esquemas pueden salir del worker. */
const ESQUEMAS = new Set(['http:', 'https:']);

const SUFIJOS_INTERNOS = ['.localhost', '.internal', '.local', '.home.arpa'];

/**
 * `2130706433`, `0177.0.0.1`, `0x7f.1` → `127.0.0.1`.
 *
 * Devuelve `null` si no parece un IPv4 escrito de ninguna de las formas que
 * acepta `inet_aton` (que es lo que acaba usando el sistema operativo).
 */
function normalizarIPv4(host: string): string | null {
  const partes = host.split('.');
  if (partes.length > 4 || partes.length === 0) return null;

  const numeros: number[] = [];
  for (const p of partes) {
    if (p === '') return null;
    let n: number;
    if (/^0[xX][0-9a-fA-F]+$/.test(p)) n = parseInt(p.slice(2), 16);
    else if (/^0[0-7]+$/.test(p)) n = parseInt(p.slice(1), 8);
    else if (/^\d+$/.test(p)) n = Number(p);
    else return null;
    if (!Number.isFinite(n) || n < 0) return null;
    numeros.push(n);
  }

  // `a.b.c.d`, `a.b.c`, `a.b` y `a`: la última parte absorbe el resto.
  const ultimo = numeros[numeros.length - 1];
  if (ultimo === undefined) return null;
  const restantes = 4 - numeros.length;
  if (ultimo >= 256 ** (restantes + 1)) return null;
  for (const n of numeros.slice(0, -1)) if (n > 255) return null;

  let valor = 0;
  for (const n of numeros.slice(0, -1)) valor = valor * 256 + n;
  valor = valor * 256 ** (restantes + 1) + ultimo;
  if (valor > 0xffffffff) return null;

  return [
    (valor >>> 24) & 255,
    (valor >>> 16) & 255,
    (valor >>> 8) & 255,
    valor & 255,
  ].join('.');
}

/** ¿Es un IPv4 de un rango que no debe salir del worker? */
function ipv4Bloqueada(ip: string): boolean {
  const o = ip.split('.').map(Number);
  const a = o[0];
  const b = o[1];
  if (a === undefined || b === undefined) return true;

  if (a === 0) return true; // "esta red"
  if (a === 10) return true; // privada
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local · metadata 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true; // privada
  if (a === 192 && b === 168) return true; // privada
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast y reservado
  return false;
}

/**
 * `true` si esta URL NO debe llamarse desde el worker.
 *
 * Falla CERRADO: cualquier cosa que no se pueda interpretar se bloquea. Una
 * URL rara que se deja pasar "porque seguro no es nada" es exactamente la que
 * termina siendo algo.
 */
export function esBloqueadaPorSsrf(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return true;
  }

  if (!ESQUEMAS.has(u.protocol)) return true;

  // `new URL()` deja los corchetes del IPv6 y no baja a minúsculas los
  // hexadecimales.
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;

  if (host === 'localhost') return true;
  if (SUFIJOS_INTERNOS.some((s) => host.endsWith(s))) return true;

  // ── IPv6 ────────────────────────────────────────────────────────────────
  if (host.includes(':')) {
    if (host === '::1' || host === '::') return true;
    // Único local (fc00::/7) y link-local (fe80::/10).
    if (/^f[cd][0-9a-f]{0,2}:/.test(host)) return true;
    if (/^fe[89ab][0-9a-f]?:/.test(host)) return true;
    // IPv4 mapeado o traducido: `::ffff:127.0.0.1` y `::ffff:7f00:1`.
    const mapeado = /^::ffff:(.+)$/.exec(host);
    if (mapeado?.[1]) {
      const resto = mapeado[1];
      if (resto.includes('.')) {
        const ip = normalizarIPv4(resto);
        return ip === null ? true : ipv4Bloqueada(ip);
      }
      const hex = resto.split(':');
      const alto = parseInt(hex[0] ?? '', 16);
      const bajo = parseInt(hex[1] ?? '', 16);
      if (Number.isFinite(alto) && Number.isFinite(bajo)) {
        const ip = [(alto >>> 8) & 255, alto & 255, (bajo >>> 8) & 255, bajo & 255].join('.');
        return ipv4Bloqueada(ip);
      }
      return true;
    }
    return false;
  }

  // ── IPv4, en cualquiera de sus notaciones ───────────────────────────────
  const ip = normalizarIPv4(host);
  if (ip !== null) return ipv4Bloqueada(ip);

  // ── Nombre de una sola etiqueta: `http://redis/`, `http://api/` ─────────
  //
  // Un host sin punto NO existe en el DNS público: sólo resuelve por el DNS
  // interno o por los dominios de búsqueda del sistema. En una red de
  // contenedores, `http://postgres/` es la base de datos y `http://api/` es la
  // API — es la misma puerta que `localhost`, entrando por otro nombre.
  //
  // Salió de una prueba en rojo: Node parsea `http:///x` como host `"x"`, así
  // que el caso "sin host" que se creía bloqueado no lo estaba. La URL rara no
  // era el problema; el hueco que destapó, sí.
  //
  // Ninguna URL pública de un cliente se ve así: siempre trae un punto.
  if (!host.includes('.')) return true;

  // Un nombre de dominio normal. Ver la nota de DNS rebinding en la cabecera.
  return false;
}
