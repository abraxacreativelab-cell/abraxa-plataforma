/**
 * El borde HTTP compartido: la puerta por la que una petición se convierte en
 * identidad verificada. Todo lo de aquí se re-exporta desde `@abraxa/db`.
 *
 * Es propiedad de `h0-integracion` (ver `.ownership.json`) y no por capricho:
 * es la única pieza del repo que TODOS los carriles usan y que NINGUNO puede
 * reescribir. Cuando se encuentra un agujero aquí, se arregla en un archivo y
 * queda arreglado en los catorce.
 */
export { proxyVerified } from './proxy-verified';
export { contextoDePeticion, correoVerificadoDe, responderError } from './tenant-context';
export type { PeticionEntrante, RespuestaSaliente } from './types';
