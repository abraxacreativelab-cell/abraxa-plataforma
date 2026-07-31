/**
 * ════════════════════════════════════════════════════════════════════════════
 *  @abraxa/inbox — la bandeja, WhatsApp y el puente agente↔inbox.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  La promesa que vende el producto es una sola frase: **"tu agente contesta a
 *  tus clientes mientras duermes."** Este paquete es lo que la hace verdad.
 *
 *  ── El hueco de GARDEN que aquí se cierra ──────────────────────────────────
 *
 *  En GARDEN, `crm_threads.ai_enabled` está declarado en el tipo y NO SE LEE EN
 *  NINGÚN LADO: su única aparición en todo el repo es `src/crm/types.ts:281`.
 *  Los bots viven en un mundo (`garden.conversations`, `garden.bots`) y la
 *  bandeja del CRM en otro (`crm_threads`, `crm_messages`). Están
 *  desconectados: nunca se cableó el puente.
 *
 *  Aquí ese campo se lee en cada mensaje que entra, en `bridge/decide.ts`.
 *
 *  ── El recorrido completo ──────────────────────────────────────────────────
 *
 *      POST /inbox/webhooks/:channelId?token=…      routes/webhooks.ts
 *        → resolverCanalDeWebhook()                 channels/lookup.ts
 *        → contextoDeCanal()                        context.ts
 *        → driver.parseWebhook()                    drivers/whatsapp/parse.ts
 *        → asegurarHilo() + INSERT idempotente      ingest.ts
 *        → decidirSiContesta()                      bridge/decide.ts
 *        → AgentPort.run({ …, threadId })           bridge/responder.ts
 *        → driver.send()                            inbox/service.ts
 *
 *  ── Para H8 (flows) ────────────────────────────────────────────────────────
 *
 *      await usePort('inbox').send(ctx, { threadId, body });
 *
 *  ── Para H12 y H13 (canales nuevos) ────────────────────────────────────────
 *
 *      import { registerDriver } from '@abraxa/inbox';
 *      registerDriver(miDriver);   // desde packages/inbox/src/drivers/<canal>/
 *
 *  El registro no asume nada de WhatsApp, y `drivers/registry.test.ts` lo
 *  demuestra corriendo la cadena entera con un driver que no lo es.
 */
import { registerPort } from '@abraxa/db';
import { createInboxService } from './inbox/service';
import { createWhatsAppDriver } from './drivers/whatsapp';
import { registerDriver } from './drivers/registry';

export { router } from './routes';
export { meta } from './meta';

// ── La implementación del port ──────────────────────────────────────────────
export const inboxService = createInboxService();
registerPort('inbox', inboxService);

// ── El driver de WhatsApp, auto-registrado ──────────────────────────────────
//
// Importar el paquete deja el canal listo. H12 y H13 hacen lo mismo desde sus
// carpetas y nadie edita un registro central.
registerDriver(createWhatsAppDriver());

// ── Superficie pública ──────────────────────────────────────────────────────

export {
  createInboxService,
  enviarEnHilo,
  asegurarHilo,
  canalParaTipo,
  pausarIA,
} from './inbox/service';
export { listarHilos, verHilo, contarNoLeidos, type FiltroHilos } from './inbox/queries';

// Canales
export {
  ajustarCanal,
  borrarCanal,
  crearCanal,
  estadoCanal,
  listarCanales,
  sanearCanal,
  validarHorario,
  type AjustesCanal,
  type CanalPublico,
  type EntradaCanal,
  type OpcionesBaja,
  type ResultadoBaja,
} from './channels/service';
export { cargarCanalPorId, resolverCanalDeWebhook } from './channels/lookup';

// El puente
export {
  decidirSiContesta,
  pausaVigente,
  EXPLICACION,
  type Decision,
  type EntradaDecision,
  type RazonSilencio,
} from './bridge/decide';
export { dentroDeHorario, minutosDe, momentoLocal } from './bridge/hours';
export {
  responderConAgente,
  type CorredorDeAgentes,
  type OpcionesPuente,
  type ResultadoPuente,
} from './bridge/responder';

// Recepción
export {
  ingerirWebhook,
  ingerirMensaje,
  aplicarEvento,
  type OpcionesIngesta,
  type ResultadoIngesta,
  type ResultadoMensaje,
} from './ingest';

// Contexto sintético
export { contextoDeCanal, esContextoDeCanal, type FuenteDeContexto } from './context';

// El enchufe de H12 y H13
export {
  registerDriver,
  driverFor,
  hasDriver,
  listDrivers,
  normalizarDireccion,
  mostrarDireccion,
  __clearDrivers,
} from './drivers/registry';
export {
  leerSobre,
  type DriverCompleto,
  type EventoAcuse,
  type EventoCanal,
  type EventoConexion,
  type ExtrasDriver,
  type SobreWebhook,
} from './drivers/types';

// WhatsApp
export { createWhatsAppDriver, urlDelWebhook } from './drivers/whatsapp';
export { createEvolutionClient, type ClienteEvolution } from './drivers/whatsapp/evolution';
export {
  jidATelefono,
  normalizarTelefono,
  telefonoAJid,
  esJidIgnorable,
} from './drivers/whatsapp/phone';

export type * from './types';
