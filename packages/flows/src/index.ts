/**
 * @abraxa/flows — Automatizaciones: motor, catálogo de nodos y asistente en español.
 *
 * ── Lo que hace este paquete ───────────────────────────────────────────────
 *
 * El emprendedor describe en español lo que quiere que pase solo, el sistema
 * lo arma como un grafo de pasos que puede ver y editar, y lo ve correr paso
 * por paso. Es la función que convierte "un CRM bonito" en "mi negocio
 * trabaja solo".
 *
 * ── Cómo está partido, y por qué ───────────────────────────────────────────
 *
 *   engine/decision.ts   el cerebro. FUNCIONES PURAS: idempotencia, tope
 *                        anti-bucle, elección de rama, pausa y cierre. Ni una
 *                        línea de base de datos ni de cola — por eso los
 *                        criterios #5 y #6 se prueban en CI, donde no hay
 *                        `DATABASE_URL` ni llaves de ningún proveedor.
 *   engine/nodes.ts      los diez nodos. Todo efecto sale por un port.
 *   engine/step.ts       carga → decide → ejecuta → guarda → encola.
 *   queue.ts             lo único que sabe de pg-boss.
 *   validate.ts          zod + semántica contra el catálogo real del tenant.
 *   store.ts             `tenantDb(ctx)`, siempre.
 *
 * ── El transporte del panel en vivo ────────────────────────────────────────
 *
 * `ui/suscripcion.ts` — polling de 1 segundo detrás de UNA función. No es SSE
 * a propósito: `apps/api` y `apps/worker` son procesos distintos, así que un
 * `EventEmitter` en proceso pasaría todas las pruebas y no emitiría un solo
 * evento en producción. Ver la cabecera de ese archivo.
 */
import { registerPort } from '@abraxa/db';
import type { FlowPort, TenantContext, TriggerType } from '@abraxa/db';
import { emitirEvento } from './events';
import { encolar } from './queue';

export { router } from './routes';
export { meta } from './meta';

// ── La implementación del port ─────────────────────────────────────────────

/**
 * `FlowPort.emit` — cualquier paquete publica un evento y los flujos activos
 * que lo escuchan se enrolan solos.
 *
 * Devuelve `void` y no el resumen porque así lo declara el contrato de H1.
 * Quien necesita el detalle (el botón "probar") llama a `emitirEvento`
 * directamente, que sí lo devuelve.
 *
 * NO se traga los errores: H15 ya lo llama dentro de un `try` con `tryPort`
 * justo para poder anotar en la línea de tiempo del contacto que el motor no
 * respondió. Tragárselos aquí le quitaría esa información a quien la pide.
 */
export const flowService: FlowPort = {
  async emit(ctx: TenantContext, e: { type: TriggerType; payload: unknown }): Promise<void> {
    await emitirEvento(ctx, e, { encolar: encolar() });
  },
};

registerPort('flows', flowService);

// ── Superficie pública ─────────────────────────────────────────────────────

export {
  CATALOGO,
  DISPARADORES,
  definicionDe,
  disparadorDe,
  disparadoresVivos,
} from './catalog';

export {
  CANALES_DE_SALIDA,
  ESTADOS_TERMINALES,
  OPERADORES,
  TIPOS_DE_DISPARADOR,
  TIPOS_DE_NODO,
  esTerminal,
} from './types';

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
  NodeResult,
  NodeType,
  Operador,
  RunContext,
  RunSnapshot,
  RunStatus,
  StepStatus,
} from './types';

// El motor, para quien quiera correrlo (el worker, las pruebas, un guion).
export { MAX_PASOS, decidirAntes, decidirDespues, primerNodo } from './engine/decision';
export type { Antes, Despues, EstadoDeCorrida, PasoARegistrar } from './engine/decision';
export { ejecutarNodo, esTransitorio } from './engine/nodes';
export type { EntornoDeNodo } from './engine/nodes';
export { contextoDelMotor, ejecutarPaso, reanudar } from './engine/step';
export type { Encolar, EntornoDelMotor, ResultadoDePaso, TrabajoDePaso } from './engine/step';

// La cola. `descriptorDeCola()` es la línea que le falta al worker.
export {
  COLA,
  colaAusente,
  colaDePgBoss,
  colaEnLinea,
  configurarCola,
  descriptorDeCola,
  encolar,
  reanudarPendientes,
} from './queue';

// Validación y asistente.
export { CATALOGO_VACIO, tieneCiclo, validar, validarSemantica, zPropuesta } from './validate';
export type { CatalogoDelTenant, Propuesta, ResultadoValidacion } from './validate';
export { extraerJson, promptDelSistema, proponer } from './assist';

// Plantillas.
export { construirVariables, renderizar, variablesDelContexto } from './templating';
export type { Variables } from './templating';

// El guard del único nodo que apunta a una URL que escribe el cliente.
export { esBloqueadaPorSsrf } from './ssrf';

// Eventos y servicio.
export { disparadorCalza, emitirEvento, enrolar } from './events';
export * as flujos from './service';
