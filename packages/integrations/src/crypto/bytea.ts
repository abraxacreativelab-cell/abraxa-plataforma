/**
 * `bytea` de Postgres ↔ `Buffer` de Node, pasando por PostgREST.
 *
 * PostgREST no habla binario: un `bytea` sale como la cadena hexadecimal de
 * Postgres —`\x48656c6c6f`— y entra igual. Sin estas dos funciones el
 * ciphertext viajaría como el JSON de un `Buffer`
 * (`{"type":"Buffer","data":[…]}`), que la columna acepta convirtiendo el
 * texto entero a bytes y devuelve algo que ya no descifra. Es el tipo de fallo
 * que sólo aparece en producción, con la fila ya escrita.
 */

/** `Buffer` → `\x…`, la forma que Postgres entiende. */
export function aHex(b: Buffer): string {
  return `\\x${b.toString('hex')}`;
}

/**
 * Lo que venga de la base → `Buffer`.
 *
 * Acepta las tres formas que aparecen de verdad: la cadena `\x…` de PostgREST,
 * un `Buffer` (cuando el doble de pruebas guarda lo que le dieron) y un
 * `Uint8Array`. Cualquier otra cosa es un dato que no debería estar ahí y se
 * devuelve vacía, que hace fallar el descifrado en vez de producir basura.
 */
export function deHex(v: unknown): Buffer {
  if (Buffer.isBuffer(v)) return v;
  if (v instanceof Uint8Array) return Buffer.from(v);
  if (typeof v === 'string') {
    const limpio = v.startsWith('\\x') ? v.slice(2) : v;
    if (/^[0-9a-fA-F]*$/.test(limpio) && limpio.length % 2 === 0) {
      return Buffer.from(limpio, 'hex');
    }
  }
  return Buffer.alloc(0);
}

/** `true` si hay algo que descifrar. Una fila sin secreto es legítima: el
 *  OAuth a medias, o un proveedor que sólo necesita `config`. */
export function tieneBytes(v: unknown): boolean {
  return deHex(v).length > 0;
}
