/**
 * ════════════════════════════════════════════════════════════════════════════
 *  La capa de voz — H18 · Identidad
 *
 *  Lo que hace falta para que el producto hable y escuche. Nada de lo que se
 *  dice ni de lo que se pregunta: eso es del Ritual (H7) y no se toca desde
 *  aquí.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Todo lo de este barril es PURO —igual que el resto de `packages/auth`—: sin
 *  React, sin Next, sin Express, sin base de datos y sin un solo `fetch`. Arma
 *  peticiones, lee respuestas, decide topes y traduce fallos.
 *
 *  Lo que toca el mundo real vive en `apps/web/src/voz/`:
 *    · `servidor/narrar.ts` y `servidor/transcribir.ts` — los dos handlers
 *    · `cliente.ts` — el micrófono y la bocina del navegador
 *
 *  Ese corte es lo que hace que la parte difícil se pueda probar sin red, sin
 *  navegador y sin gastar un centavo: la clasificación de un 401 de ElevenLabs
 *  con la factura sin pagar es una función de dos argumentos.
 *
 *  Se importa por ruta relativa —`../../packages/auth/src/voz`— igual que el
 *  resto de `packages/auth`, porque este paquete no tiene `package.json` (no es
 *  un workspace: es fuente compartida que compila con el resto).
 */

export {
  FalloDeVoz,
  falloDesdeCuerpo,
  type CodigoDeVoz,
  type CuerpoDeFallo,
} from './errores';

export {
  configDeDictado,
  configDeNarracion,
  diagnosticoDeVoz,
  FORMATO_DE_AUDIO,
  hayDictado,
  hayNarracion,
  MODELO_POR_DEFECTO,
  ORDEN_DE_DICTADO,
  PROVEEDORES,
  VOCES,
  VOZ_POR_DEFECTO,
  vozValida,
  type ConfigDeDictado,
  type ConfigDeNarracion,
  type DiagnosticoDeVoz,
  type Entorno as EntornoDeVoz,
  type NombreDeVoz,
  type ProveedorDeDictado,
} from './entorno';

export {
  extensionDeAudio,
  nombreDeArchivo,
  revisarAudio,
  revisarTexto,
  tipoBase,
  TIMEOUT_DICTAR_MS,
  TIMEOUT_NARRAR_MS,
  TOPE_AUDIO_BYTES,
  TOPE_TEXTO,
  TOPE_TEXTO_EN_URL,
} from './audio';

export {
  CacheDeNarracion,
  fraccionPorEntrada,
  TOPE_CACHE_BYTES,
  type EntradaDeCache,
  type EstadoDeCache,
} from './cache';

export {
  camposDeDictado,
  falloDeDictado,
  falloDeNarracion,
  IDIOMA_POR_DEFECTO,
  leerTranscripcion,
  peticionDeNarracion,
  tipoDeSalida,
  type CamposDeDictado,
  type PeticionHttp,
} from './proveedores';
