/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Bajar una página ajena sin convertirse en el proxy de nadie.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  `url.ts` ya dijo que la dirección se ve bien. Aquí se cierran las dos
 *  evasiones que NO se ven en el texto:
 *
 *   1. **El DNS.** `mi-dominio-publico.mx` puede tener un registro A que apunta
 *      a `127.0.0.1`. La URL pasa cualquier revisión de texto y el `fetch`
 *      termina hablando con el propio servidor. Por eso se resuelve el nombre
 *      con `dns.lookup(..., { all: true })` y se revisa CADA dirección: basta
 *      una privada para no ir.
 *   2. **La redirección.** Ésa es la evasión clásica: un dominio público que
 *      contesta `302 Location: http://169.254.169.254/`. Por eso `redirect` va
 *      en `'manual'` y cada salto vuelve a pasar por las dos puertas —texto y
 *      DNS— antes de pedirse. Un `fetch` con `redirect: 'follow'` haría el
 *      trabajo del atacante con toda la buena fe del mundo.
 *
 *  Y tres topes que no son de seguridad sino de no colgar la entrevista:
 *  8 segundos, 3 saltos y 512 KB. Pasado cualquiera se corta y se contesta lo
 *  que ya se tenga — nunca un error en pantalla.
 *
 *  ── Queda un hueco, y está dicho a propósito ──────────────────────────────
 *
 *  Entre resolver el nombre y pedir la URL hay microsegundos en los que el DNS
 *  podría cambiar de respuesta (TOCTOU). Cerrarlo de verdad exige pedirle a la
 *  IP y mandar el `Host` a mano, lo que rompe TLS con SNI para medio internet.
 *  Con el resto de las puertas puestas, el riesgo que queda es que alguien con
 *  control de un dominio y de su DNS autoritativo alcance un puerto interno; y
 *  la respuesta ni siquiera vuelve cruda: pasa por el modelo, que devuelve
 *  campos del guion. Se documenta, no se esconde.
 */
import { lookup } from 'node:dns/promises';
import { log } from '../logger';
import { esHostPrivado, revisarUrl, type Revision } from './url';

/** Ni una entrevista puede esperar más que esto por una página ajena. */
const TIMEOUT_MS = 8_000;

/** Redirecciones que se siguen. Tres cubre www→apex→https; más es una trampa. */
const SALTOS = 3;

/** 512 KB de HTML es una página enorme. Lo que pase de ahí no aporta y sí cuelga. */
const TOPE_BYTES = 512 * 1024;

/**
 * Un navegador de verdad en la cabecera.
 *
 * No es para disfrazarse: media internet le contesta 403 a un cliente sin
 * `User-Agent`, y un 403 de Cloudflare se ve idéntico a "tu página no sirve"
 * desde aquí. Se identifica como lo que es, con una URL para quien quiera saber.
 */
const CABECERAS: Record<string, string> = {
  'user-agent':
    'Mozilla/5.0 (compatible; AbraxaRitual/1.0; +https://mi.abraxa.club) AppleWebKit/537.36',
  accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
  'accept-language': 'es-MX,es;q=0.9,en;q=0.6',
};

export type FalloDeLectura =
  /** No pasó las puertas de `url.ts`. */
  | 'rechazada'
  /** No contestó, tardó, o contestó un error. */
  | 'sin-respuesta'
  /** Contestó algo que no es una página (un PDF, una imagen, un JSON). */
  | 'no-es-pagina'
  /** Contestó HTML, pero no hay texto legible: casi siempre una SPA. */
  | 'sin-texto';

export type ResultadoDeLectura =
  | { ok: true; url: string; titulo: string | null; texto: string }
  | { ok: false; fallo: FalloDeLectura };

// ════════════════════════════════════════════════════════════════════════════
// La puerta del DNS
// ════════════════════════════════════════════════════════════════════════════

/**
 * `true` si el nombre resuelve SÓLO a direcciones públicas.
 *
 * Un fallo de resolución devuelve `false`: si no se sabe a dónde apunta, no se
 * pide. Es la postura correcta para una puerta de seguridad y además es la
 * misma respuesta que daría el `fetch` un segundo después.
 */
async function resuelveAPublica(host: string): Promise<boolean> {
  // Una IP literal ya la revisó `url.ts`; resolverla no aporta nada.
  if (/^\[|^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return !esHostPrivado(host);

  try {
    const direcciones = await lookup(host, { all: true, verbatim: true });
    if (direcciones.length === 0) return false;
    return direcciones.every((d) => !esHostPrivado(d.address));
  } catch {
    return false;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// El cuerpo, con tope
// ════════════════════════════════════════════════════════════════════════════

/**
 * Lee hasta `TOPE_BYTES` y corta.
 *
 * Se lee por trozos y no con `res.text()` porque `text()` no tiene tope: una
 * página que declara `content-length: 4 GB` —o que no lo declara y no termina
 * nunca— se comería la memoria del proceso que atiende la entrevista.
 */
async function cuerpoAcotado(res: Response): Promise<string> {
  const declarado = Number(res.headers.get('content-length') ?? '0');
  if (declarado > TOPE_BYTES * 4) return '';

  const cuerpo = res.body;
  if (!cuerpo) return '';

  const lector = cuerpo.getReader();
  const trozos: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      if (!value) continue;
      trozos.push(value);
      total += value.byteLength;
      if (total >= TOPE_BYTES) break;
    }
  } finally {
    // Cancelar suelta el socket. Sin esto, la conexión de una página enorme se
    // queda abierta hasta el timeout aunque ya no la estemos leyendo.
    await lector.cancel().catch(() => undefined);
  }

  const juntos = new Uint8Array(total);
  let offset = 0;
  for (const t of trozos) {
    if (offset + t.byteLength > total) {
      juntos.set(t.subarray(0, total - offset), offset);
      break;
    }
    juntos.set(t, offset);
    offset += t.byteLength;
  }

  return new TextDecoder('utf-8', { fatal: false }).decode(juntos);
}

// ════════════════════════════════════════════════════════════════════════════
// HTML → texto
// ════════════════════════════════════════════════════════════════════════════

/** El `<title>`, si lo hay. */
export function tituloDe(html: string): string | null {
  const m = /<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(html);
  const t = m?.[1] ? decodificar(m[1]).trim() : '';
  return t.length > 0 ? t : null;
}

/** El contenido de un `<meta name|property="…" content="…">`. */
function meta(html: string, nombre: string): string | null {
  const patron = new RegExp(
    `<meta[^>]+(?:name|property)\\s*=\\s*["']${nombre}["'][^>]*>`,
    'i',
  );
  const etiqueta = patron.exec(html)?.[0];
  if (!etiqueta) return null;
  const contenido = /content\s*=\s*["']([\s\S]*?)["']/i.exec(etiqueta)?.[1];
  const t = contenido ? decodificar(contenido).trim() : '';
  return t.length > 0 ? t : null;
}

const ENTIDADES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  aacute: 'á',
  eacute: 'é',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  ntilde: 'ñ',
  Ntilde: 'Ñ',
  uuml: 'ü',
  iexcl: '¡',
  iquest: '¿',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  laquo: '«',
  raquo: '»',
};

/** Las entidades que de verdad aparecen en una página en español. */
export function decodificar(texto: string): string {
  return texto
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (todo, n: string) => ENTIDADES[n] ?? ENTIDADES[n.toLowerCase()] ?? todo);
}

/**
 * El texto visible de una página, en el orden en que se lee.
 *
 * Un parser de HTML de verdad sería mejor y sería una dependencia, y las
 * dependencias de este repo son de H1. Esto no tiene que entender el DOM: tiene
 * que juntar frases para que un modelo diga de qué va el negocio. Para eso
 * quitar guiones y aplastar espacios alcanza y sobra.
 */
export function textoDe(html: string, tope = 12_000): string {
  const limpio = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  return decodificar(limpio)
    .replace(/[ \t\u00a0\u2000-\u200b\u3000]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, tope);
}

/**
 * Lo que se le manda al modelo: encabezados primero, cuerpo después.
 *
 * El `<title>` y las etiquetas `og:` son lo que mejor describe un negocio en
 * una página mexicana promedio —muchas veces son lo ÚNICO que la describe— y
 * ponerlas al frente hace que sobrevivan al recorte del cuerpo.
 */
export function paraElModelo(html: string, url: string): { titulo: string | null; texto: string } {
  const titulo = tituloDe(html) ?? meta(html, 'og:title');

  const encabezado = [
    `URL: ${url}`,
    titulo ? `Título: ${titulo}` : null,
    meta(html, 'description') ? `Descripción: ${meta(html, 'description')}` : null,
    meta(html, 'og:description') ? `Og: ${meta(html, 'og:description')}` : null,
    meta(html, 'og:site_name') ? `Sitio: ${meta(html, 'og:site_name')}` : null,
  ].filter((x): x is string => x !== null);

  const cuerpo = textoDe(html);

  return { titulo, texto: [encabezado.join('\n'), cuerpo].filter((s) => s.length > 0).join('\n\n') };
}

/**
 * ¿Esto tiene texto suficiente para sacar algo?
 *
 * Framer, Wix y Squarespace devuelven un `<div id="root">` vacío y todo el
 * contenido lo pinta el navegador. Aquí llega HTML válido, con 200, y sin una
 * sola frase del negocio. Distinguirlo es lo que separa un camino digno —"no
 * pude leer tu página, mejor cuéntame tú"— de mandarle al modelo un montón de
 * nada y presentarle al invitado datos inventados como si fueran suyos.
 */
export function hayTextoUtil(texto: string): boolean {
  const cuerpo = texto.replace(/^URL:.*$/m, '').trim();
  const palabras = cuerpo.split(/\s+/).filter((p) => p.length > 2);
  return cuerpo.length >= 200 && palabras.length >= 40;
}

// ════════════════════════════════════════════════════════════════════════════
// La lectura
// ════════════════════════════════════════════════════════════════════════════

/**
 * Baja una página, siguiendo redirecciones A MANO y revisando cada salto.
 *
 * Nunca lanza: cualquier tropiezo sale como `{ ok: false, fallo }` y quien
 * llama decide qué decirle al invitado. Una excepción aquí sería un 500 en la
 * cara de alguien que sólo quiso ahorrarse tres preguntas.
 */
export async function leerPagina(revision: Revision): Promise<ResultadoDeLectura> {
  if (!revision.ok) return { ok: false, fallo: 'rechazada' };

  let actual = revision.url;

  for (let salto = 0; salto <= SALTOS; salto++) {
    if (!(await resuelveAPublica(actual.hostname))) {
      log.warn(`el sitio pegado en el Ritual resuelve a una dirección no pública; no se pide.`);
      return { ok: false, fallo: 'rechazada' };
    }

    let res: Response;
    try {
      res = await fetch(actual.href, {
        method: 'GET',
        headers: CABECERAS,
        redirect: 'manual',
        // Sin `cache: 'no-store'`: en el `fetch` de Node esa propiedad no
        // existe en el tipo y no hace nada en tiempo de ejecución. Es una
        // costumbre traída del navegador; aquí sólo rompería el typecheck.
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      log.info(`no se pudo abrir la página que pegó el invitado: ${String(err)}`);
      return { ok: false, fallo: 'sin-respuesta' };
    }

    // ── ¿Redirige? ────────────────────────────────────────────────────────
    if (res.status >= 300 && res.status < 400) {
      const destino = res.headers.get('location');
      await res.body?.cancel().catch(() => undefined);
      if (!destino) return { ok: false, fallo: 'sin-respuesta' };

      let siguiente: URL;
      try {
        siguiente = new URL(destino, actual);
      } catch {
        return { ok: false, fallo: 'sin-respuesta' };
      }

      // El salto pasa por la MISMA puerta que la URL original. Es aquí donde
      // muere el "dominio público que redirige a 127.0.0.1".
      const revisado = revisarUrl(siguiente.href);
      if (!revisado.ok) {
        log.warn('la página que pegó el invitado redirige a una dirección que no se puede pedir.');
        return { ok: false, fallo: 'rechazada' };
      }

      actual = revisado.url;
      continue;
    }

    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return { ok: false, fallo: 'sin-respuesta' };
    }

    const tipo = (res.headers.get('content-type') ?? '').toLowerCase();
    if (tipo && !/text\/html|application\/xhtml|text\/plain/.test(tipo)) {
      await res.body?.cancel().catch(() => undefined);
      return { ok: false, fallo: 'no-es-pagina' };
    }

    const html = await cuerpoAcotado(res);
    if (!html) return { ok: false, fallo: 'sin-texto' };

    const { titulo, texto } = paraElModelo(html, actual.href);
    if (!hayTextoUtil(texto)) return { ok: false, fallo: 'sin-texto' };

    return { ok: true, url: actual.href, titulo, texto };
  }

  return { ok: false, fallo: 'sin-respuesta' };
}
