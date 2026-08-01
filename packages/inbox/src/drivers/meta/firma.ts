/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Las dos puertas del webhook de Meta: el challenge y la firma.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  ── 1. El challenge (GET) ──────────────────────────────────────────────────
 *
 *  Antes de mandar un solo mensaje, Meta hace un **GET** a la URL del webhook
 *  con tres parámetros y exige que se le devuelva `hub.challenge` **crudo, como
 *  texto plano**:
 *
 *      GET /inbox/webhooks/<id>?token=…&hub.mode=subscribe
 *                               &hub.verify_token=…&hub.challenge=1158201444
 *      → 200  1158201444          ← el cuerpo es ESO y nada más
 *
 *  Devolver `{"ok":true}` —que es lo que responde hoy la ruta de H6— hace que
 *  la verificación falle SIEMPRE, con un error del panel de Meta que no dice
 *  por qué. Es la trampa que se lleva media tarde. Ver el README: el arreglo es
 *  de H6 y son seis líneas.
 *
 *  ── 2. La firma (POST) ─────────────────────────────────────────────────────
 *
 *  Cada POST viene con `X-Hub-Signature-256: sha256=<hex>`, que es el HMAC-SHA256
 *  del **cuerpo CRUDO** con el App Secret.
 *
 *  Crudo quiere decir los bytes exactos que llegaron por el socket. Verificar
 *  contra `JSON.stringify(req.body)` calcula el HMAC sobre bytes DISTINTOS —
 *  Meta no pone espacios donde los pone `JSON.stringify`, escapa los no-ASCII
 *  de otra forma y el orden de las llaves no está garantizado— así que **todos**
 *  los eventos legítimos se rechazan. Y el síntoma engaña: parece un App Secret
 *  equivocado, y quien lo depure va a rotar el secreto tres veces antes de
 *  mirar los bytes.
 *
 *  Por eso `cuerpoCrudoDelSobre()` NO tiene un respaldo que re-serialice. Si el
 *  cuerpo crudo no llega, se dice que no llega.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { igualSeguro } from '../../channels/lookup';

/** La cabecera donde viaja la firma. En minúsculas: así las guarda Node. */
export const CABECERA_FIRMA = 'x-hub-signature-256';

/**
 * El cuerpo crudo que viene en el sobre del webhook.
 *
 * `SobreWebhook` (H6, `drivers/types.ts:93-99`) declara hoy `channelId`,
 * `payload` y `headers`, y **no** el cuerpo crudo. `apps/api` sí lo guarda
 * —`app.ts:14-16` deja el Buffer en `req.rawBody` justamente para esto— pero la
 * ruta no lo pasa. Es una línea de H6; está escrita en el README.
 *
 * Se lee por pato en vez de por tipo para que el día que H6 la agregue esto
 * funcione sin recompilar nada ni coordinar un merge.
 */
export function cuerpoCrudoDelSobre(sobre: unknown): Buffer | null {
  const crudo = (sobre as { rawBody?: unknown } | null)?.rawBody;
  return aBuffer(crudo);
}

function aBuffer(v: unknown): Buffer | null {
  if (Buffer.isBuffer(v)) return v.length > 0 ? v : null;
  if (typeof v === 'string') return v.length > 0 ? Buffer.from(v, 'utf8') : null;
  if (v instanceof Uint8Array) return v.length > 0 ? Buffer.from(v) : null;
  return null;
}

/** El valor que Meta debió mandar en la cabecera, para este cuerpo y este secreto. */
export function firmaDe(cuerpo: Buffer | string, appSecret: string): string {
  const bytes = typeof cuerpo === 'string' ? Buffer.from(cuerpo, 'utf8') : cuerpo;
  return `sha256=${createHmac('sha256', appSecret).update(bytes).digest('hex')}`;
}

/**
 * ¿La firma corresponde a este cuerpo?
 *
 * Comparación en tiempo constante sobre los BYTES del digest, no sobre el hexa:
 * comparar cadenas con `===` filtra por cuánto tarda cuántos caracteres del
 * prefijo acertó quien la mandó, y eso convierte una firma en algo que se puede
 * adivinar a fuerza de intentos.
 */
export function verificarFirma(i: {
  cuerpo: Buffer | string;
  firma: string | undefined;
  appSecret: string;
}): boolean {
  if (!i.appSecret || !i.firma) return false;

  const recibida = i.firma.trim();
  // Sólo sha256. `X-Hub-Signature` (sha1) sigue llegando por compatibilidad y
  // no se acepta: aceptar el algoritmo débil cuando el fuerte está disponible
  // deja abierta la degradación que la cabecera nueva vino a cerrar.
  if (!recibida.toLowerCase().startsWith('sha256=')) return false;

  const esperada = firmaDe(i.cuerpo, i.appSecret);

  let a: Buffer;
  let b: Buffer;
  try {
    a = Buffer.from(recibida.slice(7), 'hex');
    b = Buffer.from(esperada.slice(7), 'hex');
  } catch {
    return false;
  }
  if (a.length !== b.length || a.length === 0) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El challenge del GET de alta.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Devuelve el challenge que hay que responder **en texto plano**, o `null` si
 *  la petición no es una verificación válida.
 *
 *  `null` significa 403, no 200: contestar 200 a un challenge que no se pudo
 *  verificar le diría a Meta que la URL es buena sin que nadie haya probado que
 *  el secreto coincide.
 *
 *  Express con su parser por defecto deja `hub.mode` tal cual —los puntos no se
 *  expanden— pero un proxy o un parser con `allowDots` los convierte en
 *  `{ hub: { mode } }`. Se aceptan las dos formas: la alternativa es un fallo
 *  que sólo aparece en producción y sólo con cierta configuración de nginx.
 */
export function verificarChallenge(query: unknown, verifyToken: string): string | null {
  const q = (query ?? {}) as Record<string, unknown>;
  const anidado = (q.hub ?? {}) as Record<string, unknown>;

  const leer = (llave: string): string => {
    const plano = q[`hub.${llave}`] ?? q[`hub_${llave}`] ?? anidado[llave];
    return typeof plano === 'string' ? plano : '';
  };

  if (leer('mode') !== 'subscribe') return null;
  if (!verifyToken) return null;
  if (!igualSeguro(leer('verify_token'), verifyToken)) return null;

  const challenge = leer('challenge');
  return challenge.length > 0 ? challenge : null;
}
