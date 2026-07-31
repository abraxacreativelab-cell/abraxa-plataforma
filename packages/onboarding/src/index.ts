/**
 * @abraxa/onboarding — El Ritual de Fundación.
 *
 * Lo primero que vive un emprendedor en el producto: un agente aparece, le pide
 * que le ponga nombre, lo entrevista sobre su negocio y le entrega su Mapa de
 * Negocio. Puede parar cuando quiera y volver mañana.
 *
 * ── Los dos huecos de GARDEN que aquí no se repiten ─────────────────────────
 *
 *   1. **El historial vivía en memoria.** El motor de entrevista de GARDEN
 *      (extensions/abraxa-bookkeeper) guarda fase y datos en Postgres pero la
 *      conversación en un `Map` del proceso (handler.ts:36). Un deploy y el
 *      entrevistado vuelve a un agente que conserva sus datos y perdió el hilo.
 *      Aquí el transcript es una columna y se pasa como `history` explícito en
 *      cada corrida.
 *
 *   2. **Karen estaba clavada a una inmobiliaria.** Ocho áreas de property
 *      management (karen/src/types.ts:86-95) y un prompt que se autodescribe
 *      como "bookkeeper de Inperio". Aquí el catálogo es genérico, el estado
 *      inicial de cada área se decide leyendo la entrevista, y **el agente lo
 *      bautiza el emprendedor**: Karen no existe como personaje aparte.
 *
 * ── Cómo se usa ────────────────────────────────────────────────────────────
 *
 *   // Desde el proceso (apps/web habla por HTTP con /onboarding)
 *   const foto = await fotoDelRitual(ctx);        // sin gastar un token
 *   const r    = await responder(ctx, 'vendo pan artesanal');
 *
 *   // H11, el día que aterrice — ver ports/blueprint-sink.ts
 *   registrarBlueprintSink(miSink);
 *   await aplicarBlueprintsPendientes(ctx);
 */
export { router } from './routes';
export { meta } from './meta';

// ── El motor de la entrevista ───────────────────────────────────────────────
export {
  fotoDelRitual,
  historialParaElModelo,
  iniciar,
  memoriaDe,
  pausar,
  responder,
  vistaDe,
  type FotoDelRitual,
} from './session/ritual';

export {
  abrirSesion,
  cargarSesion,
  guardarTurno,
  marcarEstado,
  type CambiosDelTurno,
} from './session/repositorio';

// ── La máquina de estados ───────────────────────────────────────────────────
export { aplicarTurno, type ResultadoDelTurno } from './interview/maquina';
export { faltantesDe, puedeCerrar, requisitosDe } from './interview/cierre';
export { FASES, FICHAS, indiceDeFase, progresoDe, siguienteFase } from './interview/fases';
export {
  MARCADORES,
  leerMarcadores,
  limpiarMarcadores,
  tieneMarcadores,
  type SenalesDelTurno,
} from './interview/marcadores';
export { PROMPT_MAESTRO_BASE, guionDelTurno, loQueYaSabes } from './interview/guion';
export { ausenciaEnPalabras, loQueRecuerdo, mensajeDeRegreso } from './interview/regreso';

// ── La síntesis ─────────────────────────────────────────────────────────────
export { CATALOGO, areaDelCatalogo, type AreaDelCatalogo } from './synthesis/catalogo';
export {
  areasPara,
  construirMapa,
  hitosPara,
  mensajeDeEntrega,
  resumenDelNegocio,
  tipoDeIndustria,
} from './synthesis/mapa';
export {
  aplicarBlueprint,
  aplicarBlueprintsPendientes,
  blueprintVigente,
  guardarBlueprint,
  listarBlueprints,
} from './synthesis/blueprint';
export { bautizarAgente, sembrarBoveda, sembrarGiro } from './synthesis/entrega';

// ── El contrato que le falta a AreasPort. Lo implementa H11. ────────────────
export {
  blueprintSink,
  haySink,
  registrarBlueprintSink,
  type BlueprintSink,
} from './ports/blueprint-sink';

// ── Vocabulario ─────────────────────────────────────────────────────────────
export type {
  AreaDelMapa,
  BlueprintGuardado,
  Dolor,
  EstadoNegocio,
  EstadoSesion,
  Fase,
  Hito,
  MapaDeNegocio,
  PasoDelProceso,
  PropuestaDeArea,
  RequisitoDeArea,
  RespuestaDelRitual,
  SesionRitual,
  TurnoTranscrito,
  VistaDelRitual,
} from './types';
