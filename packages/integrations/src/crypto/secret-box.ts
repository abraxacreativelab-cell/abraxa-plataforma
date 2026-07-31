/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El sobre: AES-256-GCM con `node:crypto`
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Cuatro decisiones, todas con su razón:
 *
 *  ── 1. GCM y no CBC ────────────────────────────────────────────────────────
 *  GCM AUTENTICA. Un ciphertext alterado en un byte falla al descifrar en vez
 *  de producir basura silenciosa que el proceso mandaría al proveedor como si
 *  fuera una llave.
 *
 *  ── 2. En la aplicación y no con `pgcrypto` ────────────────────────────────
 *  `pgp_sym_encrypt(secreto, llave)` mete la llave EN EL TEXTO DEL STATEMENT,
 *  y ese texto acaba en `pg_stat_statements`, en el log de consultas lentas y
 *  en el explorador de logs de Supabase. Se termina auditando una base donde
 *  el secreto está cifrado y la llave está en el log de al lado. Aquí la llave
 *  vive en un solo sitio: la memoria del proceso.
 *
 *  ── 3. `key_version` desde el día uno ──────────────────────────────────────
 *  Rotar sin versión obliga a un downtime o a un big-bang. Con versión:
 *  `INTEGRATIONS_KEY_2` cifra lo nuevo, `INTEGRATIONS_KEY` sigue abriendo lo
 *  viejo, y `src/bin/rotate.ts` re-cifra por lotes sin apagar nada.
 *
 *  ── 4. Fail-closed sin llave ───────────────────────────────────────────────
 *  Sin `INTEGRATIONS_KEY`, `cerrar()` y `abrir()` LANZAN. No guardan en claro
 *  "por ahora". Es el mismo criterio de `proxyVerified()`
 *  (`packages/tenancy/src/middleware/proxy.ts:42`): un deploy que pierde una
 *  variable no degrada a inseguro, se cae.
 *
 *  ── Y una más, que no estaba en el handoff ─────────────────────────────────
 *  El sobre se ata a su empresa con el dato asociado (AAD) de GCM:
 *  `"<tenantId>:<provider>"`. Copiar la fila entera de una empresa a otra
 *  —por un bug, un import mal hecho o alguien con acceso a la base— produce un
 *  sobre que YA NO ABRE. El cifrado deja de ser sólo "no se lee sin la llave"
 *  y pasa a ser "no se lee fuera de su sitio". Cuesta una línea.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { PlatformError } from '@abraxa/db';

export interface Sobre {
  ct: Buffer;
  iv: Buffer;
  tag: Buffer;
  version: number;
}

/** 12 bytes es el nonce canónico de GCM: más corto lo debilita, más largo lo
 *  obliga a un hash interno sin ganar nada. */
const LARGO_NONCE = 12;
const LARGO_LLAVE = 32;
/** Hasta dónde se buscan versiones de llave. Nadie va a rotar 16 veces sin
 *  retirar las viejas, y un tope evita recorrer el entorno entero. */
const MAX_VERSION = 16;

/** `INTEGRATIONS_KEY` para la v1; `INTEGRATIONS_KEY_N` de ahí en adelante. */
export function nombreDeLlave(version: number): string {
  return version <= 1 ? 'INTEGRATIONS_KEY' : `INTEGRATIONS_KEY_${version}`;
}

function crudaDe(version: number): string | undefined {
  const v = process.env[nombreDeLlave(version)];
  return v && v.trim() ? v.trim() : undefined;
}

/**
 * La llave de una versión, o lanza diciendo QUÉ variable falta.
 *
 * El mensaje nombra la variable a propósito y no dice nada del secreto que se
 * estaba cifrando: un error de configuración tiene que ser fácil de arreglar
 * sin convertirse en una filtración.
 */
function llaveDe(version: number): Buffer {
  const cruda = crudaDe(version);
  if (!cruda) {
    throw new PlatformError(
      'INTERNAL',
      `Falta ${nombreDeLlave(version)} en el entorno. Las credenciales de canal se guardan ` +
        'cifradas con AES-256-GCM y sin la llave no se guardan de ninguna otra forma: ' +
        'un despliegue sin ella se cae en vez de escribir secretos en claro. ' +
        'Genera una con:  openssl rand -base64 32',
    );
  }

  const llave = Buffer.from(cruda, 'base64');
  if (llave.length !== LARGO_LLAVE) {
    throw new PlatformError(
      'INTERNAL',
      `${nombreDeLlave(version)} tiene ${llave.length} bytes y AES-256 pide 32 bytes ` +
        'en base64. No se recorta ni se rellena: una llave del largo equivocado por accidente ' +
        'produciría cifrado real pero indescifrable mañana. Genera una con:  openssl rand -base64 32',
    );
  }
  return llave;
}

/** La versión más alta disponible en el entorno. Con la que se cifra hoy. */
export function versionActual(): number {
  let mayor = 1;
  for (let v = 2; v <= MAX_VERSION; v += 1) if (crudaDe(v)) mayor = v;
  return mayor;
}

/** `true` si esa versión está configurada. No lanza: lo consulta `/_status`. */
export function hayLlave(version: number = versionActual()): boolean {
  const cruda = crudaDe(version);
  return Boolean(cruda) && Buffer.from(cruda as string, 'base64').length === LARGO_LLAVE;
}

/**
 * Cifra con la versión más alta disponible.
 *
 * `aad` ata el sobre a su sitio: se pasa `"<tenantId>:<provider>"` y el mismo
 * valor hace falta para abrirlo.
 */
export function cerrar(plano: string, aad?: string): Sobre {
  const version = versionActual();
  const llave = llaveDe(version);
  const iv = randomBytes(LARGO_NONCE);
  const cifrador = createCipheriv('aes-256-gcm', llave, iv);
  if (aad) cifrador.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cifrador.update(plano, 'utf8'), cifrador.final()]);
  return { ct, iv, tag: cifrador.getAuthTag(), version };
}

/**
 * Descifra con la versión que diga el sobre.
 *
 * Lanza si la llave no está, si el `aad` no es el mismo o si cualquier byte
 * cambió. Las tres son la misma respuesta a propósito: "esto no se puede usar".
 */
export function abrir(sobre: Sobre, aad?: string): string {
  const llave = llaveDe(sobre.version);
  try {
    const descifrador = createDecipheriv('aes-256-gcm', llave, sobre.iv);
    if (aad) descifrador.setAAD(Buffer.from(aad, 'utf8'));
    descifrador.setAuthTag(sobre.tag);
    return Buffer.concat([descifrador.update(sobre.ct), descifrador.final()]).toString('utf8');
  } catch (e) {
    if (PlatformError.is(e)) throw e;
    throw new PlatformError(
      'INTERNAL',
      `La credencial cifrada con ${nombreDeLlave(sobre.version)} no se pudo descifrar: ` +
        'o la llave no es la que la cifró, o el dato fue alterado. AES-GCM autentica, ' +
        'así que esto falla en vez de devolver basura. La credencial hay que volver a conectarla.',
      { cause: e },
    );
  }
}

/**
 * La huella de un secreto: `••••4821 · a1b2c3d4`.
 *
 * Sirve para lo único que hay que poder hacer sin el valor: distinguir una
 * credencial de otra —"¿la que está puesta es la que acabo de pegar?"— y ver
 * de un vistazo que cambió al reconectar.
 *
 * La cola sólo se muestra si el secreto es largo: enseñar los últimos cuatro
 * caracteres de algo de seis es enseñar el secreto.
 */
export function huella(secreto: string): string {
  const sha = createHash('sha256').update(secreto, 'utf8').digest('hex').slice(0, 8);
  const cola = secreto.length >= 8 ? secreto.slice(-4) : '';
  return `${'•'.repeat(cola ? 4 : 8)}${cola} · ${sha}`;
}
