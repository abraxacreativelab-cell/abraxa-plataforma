/**
 * La entrada de NAVEGADOR de `@abraxa/flows`.
 *
 * Existe porque el barril principal (`src/index.ts`) importa Express y registra
 * el port: meterlo en el bundle del cliente arrastraría medio backend a la
 * pantalla del emprendedor. Aquí sólo hay tipos y funciones puras.
 *
 *     import { suscribirseACorrida } from '@abraxa/flows/ui';
 */
export { suscribirseACorrida } from './suscripcion';
export type {
  FuenteDeCorrida,
  OpcionesDeSuscripcion,
  Reloj,
  Visibilidad,
} from './suscripcion';

export { CATALOGO, DISPARADORES, definicionDe, disparadorDe, disparadoresVivos } from '../catalog';
export { CANALES_DE_SALIDA, OPERADORES, TIPOS_DE_NODO, esTerminal } from '../types';
export type {
  CampoDeNodo,
  DefinicionDeNodo,
  Flow,
  FlowDefinition,
  FlowEdge,
  FlowNode,
  FlowRun,
  FlowStatus,
  FlowStep,
  FlowVersion,
  NodeType,
  RunSnapshot,
  RunStatus,
  StepStatus,
} from '../types';
export type { DefinicionDeDisparador } from '../catalog';
