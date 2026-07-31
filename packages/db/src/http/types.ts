/**
 * Los dos tipos mínimos del borde HTTP.
 *
 * Deliberadamente estructurales y NO `express.Request` / `express.Response`:
 * `@abraxa/db` es el piso que importan los catorce carriles y no puede
 * arrastrar Express como dependencia sólo para poder tipar dos campos. Un
 * `Request` de Express satisface `PeticionEntrante` sin conversión alguna, y
 * también lo satisface un `IncomingMessage` de node, o un objeto literal en
 * una prueba.
 */

/** Lo único que la pieza canónica necesita de una petición: sus cabeceras. */
export interface PeticionEntrante {
  readonly headers: Record<string, string | string[] | undefined>;
}

/** Lo único que necesita de una respuesta para negar. */
export interface RespuestaSaliente {
  status(codigo: number): RespuestaSaliente;
  json(cuerpo: unknown): unknown;
}
