/**
 * @abraxa/crm — contactos, identidades por canal, embudo y línea de tiempo.
 *
 * ── Por qué existe este carril ─────────────────────────────────────────────
 *
 * Hasta hoy la plataforma no tenía una tabla de contactos. H6 declaró
 * `app.threads.contact_id` SIN `REFERENCES` porque no había a qué apuntar
 * (H6-inbox.md:110). Tres nodos de H8 —`assign_owner`, `move_stage`,
 * `add_tag`— y cuatro de sus disparadores no tenían dónde escribir. Media
 * Ola 3 esperaba esto.
 *
 * ── Lo que hay que saber para usarlo ───────────────────────────────────────
 *
 *   1. Un contacto es una PERSONA. Sus direcciones (`whatsapp:+52…`,
 *      `email:…`, `instagram:…`) son filas de `app.contact_identities`, N por
 *      contacto, con `UNIQUE (tenant_id, channel, identifier)`. Es la
 *      diferencia con GARDEN, donde `email` y `phone` son dos columnas planas
 *      y una persona con dos teléfonos son dos contactos.
 *
 *   2. `resolveByIdentity` crea si no existe y es SEGURA ANTE CONCURRENCIA:
 *      dos webhooks simultáneos del mismo número devuelven el mismo contacto.
 *      El árbitro es el índice único, no un SELECT previo.
 *
 *   3. Fusionar NO borra. El perdedor queda apuntando al ganador con
 *      `merged_into`, y `resolveByIdentity` sigue la cadena. Un hilo de hace
 *      tres meses nunca abre una tarjeta que ya no existe.
 *
 * ── Cómo se consume ────────────────────────────────────────────────────────
 *
 *     import { useContacts } from '@abraxa/crm';
 *
 *     // H6, al llegar un webhook
 *     const { contactId } = await useContacts().resolveByIdentity(ctx, {
 *       channel: 'whatsapp', identifier: msg.address, name: msg.contactName,
 *     });
 *
 *     // H8, el nodo move_stage
 *     await useContacts().moveStage(ctx, { contactId, stage: 'contactado' });
 *
 * `useContacts()` y no `usePort('contacts')` porque `PortRegistry` de H1 no
 * conoce esta llave todavía; el port SÍ vive en el registro central. El porqué
 * completo y el parche que lo colapsa están en `src/port-registration.ts`.
 */
import { createCrmService } from './service';
import { registerContactsPort } from './port-registration';

export { router } from './routes';
export { meta } from './meta';

// ── La implementación del port ─────────────────────────────────────────────
export const crmService = createCrmService();
registerContactsPort(crmService);

// ── El contrato ────────────────────────────────────────────────────────────
export type {
  Contact,
  ContactEvent,
  ContactEventType,
  ContactIdentity,
  ContactPlacement,
  ContactsPort,
  CreateContactInput,
  EventSource,
  IdentityChannel,
  IdentityInput,
  Lifecycle,
  ListContactsInput,
  ListContactsResult,
  Pipeline,
  PipelineStage,
  RecordEventInput,
  ResolveInput,
  UpdateContactInput,
} from './port';

export {
  CONTACTS_PORT,
  __unregisterContactsPort,
  isContactsReady,
  registerContactsPort,
  tryContacts,
  useContacts,
} from './port-registration';

// ── Superficie pública del paquete ─────────────────────────────────────────
export { createCrmService } from './service';

// Normalización de identidades. Se exporta porque H6 la necesita ANTES de
// llamar al port: `esGrupo()` decide si un webhook merece ficha de contacto.
export {
  colaTelefonica,
  esGrupo,
  etiquetaCanal,
  normalizarCorreo,
  normalizarHandle,
  normalizarIdentidad,
  normalizarTelefono,
  type IdentidadNormalizada,
} from './identity';

// Embudo
export { EMBUDO_POR_DEFECTO, ETAPAS_POR_DEFECTO, type EtapaSemilla } from './pipeline/defaults';

// Fusión
export { detectarDuplicados, fusionar, type ParDuplicado } from './contacts/merge';

// Línea de tiempo, más allá de lo que expone el port
export { leerFeed } from './timeline/service';

// Disparadores que este paquete le entrega a H8
export { emitir, type CrmTrigger } from './events';
