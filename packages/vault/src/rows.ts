/**
 * Cómo se tipan las filas que devuelve PostgREST.
 *
 * H1 decidió a propósito no tener un `Database` generado central: sería el
 * punto de colisión número uno del repo, porque las 14 conversaciones tendrían
 * que regenerarlo cada vez que alguien agrega una tabla. En su lugar,
 * «cada paquete declara las interfaces de SUS filas dentro de su propio
 * carril» (`packages/db/src/client.ts`).
 *
 * La consecuencia práctica: `postgrest-js` no puede inferir la forma de la
 * fila a partir de un `select()` cuya lista de columnas no es un literal, y la
 * tipa como `GenericStringError`. No es un error de verdad — es su forma de
 * decir «no sé qué me pediste».
 *
 * Estos dos helpers hacen esa conversión en UN solo lugar, con el porqué
 * escrito, en vez de sembrar `as unknown as X` por todo el paquete. Quien lea
 * un `filas<VaultRow>(data)` sabe que el contrato de esa forma lo garantiza la
 * constante de columnas de arriba y la migración, no el compilador.
 */

/** Un conjunto de filas. `null` (una consulta sin resultados) se vuelve `[]`. */
export function filas<T>(data: unknown): T[] {
  return (data ?? []) as T[];
}

/** Una sola fila, de un `.single()` o `.maybeSingle()`. */
export function fila<T>(data: unknown): T {
  return data as T;
}
