/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Lo que se puede guardar de la respuesta de un proveedor, y lo que no
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Meta y Twilio DEVUELVEN EL TOKEN EN EL ECO DE ERROR con más frecuencia de
 *  la que uno esperaría:
 *
 *      { "message": "The API key 'evolution-token-…' is not valid" }
 *
 *  Un `verify()` que guardara `await r.text()` en `last_error` convertiría la
 *  bitácora en un almacén de secretos en claro —con RLS, pero sin cifrado—.
 *
 *  Por eso aquí no se recorta el cuerpo del proveedor: se RECONSTRUYE el
 *  motivo con las tres cosas que sirven para depurar y no comprometen nada.
 *
 *    · el código HTTP        401, 404, 502…
 *    · un código corto       'unauthorized', 'invalid_grant'
 *    · el id de la petición  'req-88f1', para pedirle soporte al proveedor
 *
 *  Y encima de eso, una segunda red: `sinSecretos()` tacha el valor exacto de
 *  la credencial por si algún camino nuevo lo dejara pasar. Dos redes y no una
 *  porque la primera depende de que quien escriba el próximo verificador se
 *  acuerde, y la segunda no.
 */

/** Un código corto de proveedor: nada de frases, nada de comillas. */
const CODIGO_SEGURO = /^[A-Za-z0-9_.:-]{1,48}$/;
/** Un identificador de petición. Mismo criterio. */
const ID_SEGURO = /^[A-Za-z0-9_.:-]{1,64}$/;

/** El motivo cabe en la columna y en una línea de la pantalla. */
export const LARGO_MAX_MOTIVO = 200;

/** Un campo del cuerpo, sólo si tiene forma de código y no de frase. */
export function codigoDe(cuerpo: unknown, llaves: string[]): string | null {
  if (!cuerpo || typeof cuerpo !== 'object') return null;
  const obj = cuerpo as Record<string, unknown>;
  for (const llave of llaves) {
    const v = obj[llave];
    if (typeof v === 'string' && CODIGO_SEGURO.test(v)) return v;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    // Meta anida: { error: { code: 190, type: 'OAuthException' } }
    if (v && typeof v === 'object') {
      const anidado = codigoDe(v, ['code', 'type', 'error_subcode', 'status']);
      if (anidado) return anidado;
    }
  }
  return null;
}

/** El id de la petición, que es lo que pide el soporte del proveedor. */
export function idDePeticion(cuerpo: unknown, cabeceras?: Headers): string | null {
  if (cuerpo && typeof cuerpo === 'object') {
    const obj = cuerpo as Record<string, unknown>;
    for (const llave of ['request_id', 'requestId', 'x-request-id', 'sid']) {
      const v = obj[llave];
      if (typeof v === 'string' && ID_SEGURO.test(v)) return v;
    }
  }
  const cab = cabeceras?.get('x-request-id') ?? cabeceras?.get('x-amzn-requestid');
  return cab && ID_SEGURO.test(cab) ? cab : null;
}

/**
 * La segunda red: tacha el secreto —y cualquier trozo largo de él— de un texto
 * que va a quedar escrito.
 *
 * Tacha también los fragmentos porque un proveedor puede devolver el token
 * truncado (`'evolution-tok…'`), y medio secreto en un log sigue siendo medio
 * secreto de más.
 */
export function sinSecretos(texto: string, secretos: Array<string | null | undefined>): string {
  let salida = texto;
  for (const s of secretos) {
    if (!s || s.length < 4) continue;
    salida = salida.split(s).join('«oculto»');
    // Prefijos largos del secreto: 12 caracteres ya lo identifican.
    if (s.length > 12) salida = salida.split(s.slice(0, 12)).join('«oculto»');
  }
  return salida;
}

/** Motivo corto, sin secretos y acotado. Es lo único que llega a `last_error`. */
export function motivo(
  partes: Array<string | number | null | undefined>,
  secretos: Array<string | null | undefined> = [],
): string {
  const texto = partes
    .filter((p) => p !== null && p !== undefined && String(p).trim() !== '')
    .map((p) => String(p).trim())
    .join(' · ');
  return sinSecretos(texto, secretos).slice(0, LARGO_MAX_MOTIVO);
}

/**
 * Lee el cuerpo como JSON sin dejar que un cuerpo enorme o roto tumbe la
 * verificación. Un HTML de error de un proxy no es JSON y no pasa nada.
 */
export async function cuerpoJson(r: Response): Promise<unknown> {
  try {
    const texto = await r.text();
    if (!texto) return null;
    return JSON.parse(texto.slice(0, 8192)) as unknown;
  } catch {
    return null;
  }
}
