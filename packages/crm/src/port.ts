/**
 * ════════════════════════════════════════════════════════════════════════════
 *  ContactsPort — el contrato del CRM
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Escrito con las mismas tres reglas que `packages/db/ports.ts`:
 *
 *  1. SÓLO TIPOS. Ni una línea de implementación, ni una constante en runtime.
 *  2. Programa contra el port, no contra el paquete. H6 resuelve el contacto de
 *     un webhook y H8 mueve etapas sin conocer una sola tabla de aquí.
 *  3. Es de H15. Si te falta algo, anótalo en tu PR — no lo edites en tu rama.
 *
 *  ── Por qué este archivo no está en packages/db/ports.ts ───────────────────
 *
 *  Porque no puede estarlo todavía. `packages/db/**` es de H1 y el gate de
 *  propiedad falla cualquier PR que lo toque. Y el problema no es sólo de
 *  permisos: `PortName` es `keyof PortRegistry`, y `port-registry.ts:8` declara
 *  `const OWNER: Record<PortName, string>` con las ocho llaves escritas a mano.
 *  Agregar `contacts` al registro desde aquí —incluso por aumentación de
 *  interfaz— haría que ESE objeto dejara de ser exhaustivo y `npm run
 *  typecheck` fallaría en un archivo de otro carril.
 *
 *  Así que el contrato vive aquí, se registra en el MISMO registro central de
 *  H1 (ver `port-registration.ts`), y se consume con `useContacts()` en vez de
 *  `usePort('contacts')`. La diferencia es una línea de import y desaparece en
 *  cuanto H1 mueva estos tipos a `ports.ts`; el parche exacto está en
 *  `docs/handoffs/H15-crm.md` §9.
 *
 *  ── Cómo lo usan los dos carriles que lo esperaban ─────────────────────────
 *
 *      // H6 · packages/inbox — el puente, al llegar un webhook
 *      import { useContacts } from '@abraxa/crm';
 *      const { contactId } = await useContacts().resolveByIdentity(ctx, {
 *        channel: msg.channelType, identifier: msg.address, name: msg.contactName,
 *      });
 *
 *      // H8 · packages/flows — los nodos move_stage / assign_owner / add_tag
 *      await useContacts().moveStage(ctx, { contactId, stage: 'contactado' });
 *      await useContacts().assignOwner(ctx, { contactId, ownerEmail: 'ana@…' });
 *      await useContacts().addTag(ctx, { contactId, tag: 'vip' });
 *
 *  En tus pruebas no me esperes: `registerContactsPort(doble)` y sigue.
 */
import type { ChannelType, TenantContext } from '@abraxa/db';

// ════════════════════════════════════════════════════════════════════════════
// Vocabulario
// ════════════════════════════════════════════════════════════════════════════

/**
 * Canal de una identidad.
 *
 * Es el `ChannelType` de H1 más `web` — un formulario de la página no es un
 * canal de mensajería (no tiene driver, no se le puede contestar) pero sí es
 * una identidad: el correo con el que alguien llenó un formulario identifica a
 * una persona. Dejarlo fuera obligaría a H10 a inventar un canal falso.
 */
export type IdentityChannel = ChannelType | 'web';

/** Etapa del ciclo de vida. Es del CONTACTO; la etapa del EMBUDO es otra cosa. */
export type Lifecycle = 'lead' | 'prospect' | 'customer' | 'churned' | 'unknown';

/**
 * Tipos de evento de la línea de tiempo.
 *
 * El servicio acepta cualquier string para no obligar a H6/H8/H9 a esperar una
 * migración mía por cada evento nuevo, pero éstos son los que la UI sabe
 * pintar con icono propio. Los demás caen al icono genérico.
 */
export type ContactEventType =
  | 'contact_created'
  | 'identity_added'
  | 'stage_changed'
  | 'tag_added'
  | 'tag_removed'
  | 'owner_assigned'
  | 'lifecycle_changed'
  | 'note'
  | 'message_in'
  | 'message_out'
  | 'merged'
  | 'field_changed';

/** Quién escribió el evento. */
export type EventSource = 'crm' | 'inbox' | 'flow' | 'import';

// ════════════════════════════════════════════════════════════════════════════
// Formas
// ════════════════════════════════════════════════════════════════════════════

export interface ContactIdentity {
  id: string;
  channel: IdentityChannel;
  /** Ya normalizado: E.164 sin separadores, correo en minúsculas, sin arroba. */
  identifier: string;
  /** Lo que llegó del canal, sin tocar. */
  raw: string | null;
  display: string | null;
  verified: boolean;
  isPrimary: boolean;
  createdAt: string;
}

export interface Contact {
  id: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  ownerEmail: string | null;
  lifecycle: Lifecycle;
  source: string | null;
  locale: string | null;
  custom: Record<string, unknown>;
  /** `null` salvo que este contacto haya sido absorbido por otro. */
  mergedInto: string | null;
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
  identities: ContactIdentity[];
  tags: string[];
  /** Dónde está en cada embudo. Vacío si nadie lo ha puesto en ninguno. */
  placements: ContactPlacement[];
}

export interface ContactPlacement {
  pipelineId: string;
  pipelineSlug: string;
  pipelineName: string;
  stageId: string;
  stageSlug: string;
  stageName: string;
  stagePosition: number;
  probability: number;
  isWon: boolean;
  isLost: boolean;
  amount: number | null;
  currency: string;
  enteredAt: string;
}

export interface PipelineStage {
  id: string;
  slug: string;
  name: string;
  position: number;
  probability: number;
  isWon: boolean;
  isLost: boolean;
}

export interface Pipeline {
  id: string;
  slug: string;
  name: string;
  isDefault: boolean;
  position: number;
  stages: PipelineStage[];
}

export interface ContactEvent {
  id: string;
  contactId: string;
  type: ContactEventType | (string & Record<never, never>);
  summary: string;
  payload: Record<string, unknown>;
  actor: string | null;
  source: EventSource | (string & Record<never, never>);
  externalId: string | null;
  occurredAt: string;
}

// ════════════════════════════════════════════════════════════════════════════
// Entradas
// ════════════════════════════════════════════════════════════════════════════

export interface IdentityInput {
  channel: IdentityChannel;
  /** Sin normalizar. El port lo normaliza; no lo hagas tú. */
  identifier: string;
  display?: string;
  verified?: boolean;
  isPrimary?: boolean;
}

export interface CreateContactInput {
  displayName?: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  ownerEmail?: string;
  lifecycle?: Lifecycle;
  source?: string;
  locale?: string;
  custom?: Record<string, unknown>;
  identities?: IdentityInput[];
  tags?: string[];
  /** Quién lo pidió. Cae en la línea de tiempo. */
  actor?: string;
}

export type UpdateContactInput = Omit<CreateContactInput, 'identities' | 'tags'>;

export interface ResolveInput {
  channel: IdentityChannel;
  /** La dirección tal cual llegó del canal. */
  identifier: string;
  /** Nombre que reporta el canal. Sólo se usa si el contacto se CREA aquí. */
  name?: string;
  /** Etiqueta de origen para el contacto nuevo: 'whatsapp', 'formulario'… */
  source?: string;
  actor?: string;
}

export interface ListContactsInput {
  /** Texto libre contra nombre, empresa e identificadores. */
  search?: string;
  ownerEmail?: string;
  lifecycle?: Lifecycle;
  tag?: string;
  stageId?: string;
  pipelineId?: string;
  limit?: number;
  offset?: number;
  /** Por defecto los fusionados NO salen: son duplicados que ya no existen. */
  includeMerged?: boolean;
}

export interface ListContactsResult {
  contacts: Contact[];
  total: number;
  /**
   * `true` si el filtro por etiqueta o por etapa tocó más contactos de los que
   * caben en una sola URL de PostgREST y se acotó. La lista es correcta pero
   * PARCIAL: quien la pinta tiene que decirlo. Callarlo cambiaría un error
   * visible por un dato falso.
   */
  filterTruncated?: boolean;
}

export interface RecordEventInput {
  contactId: string;
  type: ContactEventType | (string & Record<never, never>);
  summary: string;
  payload?: Record<string, unknown>;
  actor?: string;
  source?: EventSource;
  /** Llave de idempotencia. Un webhook reenviado no duplica la línea de tiempo. */
  externalId?: string;
  occurredAt?: string;
}

// ════════════════════════════════════════════════════════════════════════════
// El port
// ════════════════════════════════════════════════════════════════════════════

export interface ContactsPort {
  // ── Lo que H6 necesita ───────────────────────────────────────────────────

  /**
   * Identidad de canal → contacto. **Lo crea si no existe.**
   *
   * Es la primera llamada del puente de H6: llega un webhook con
   * `{ channelType, address }` y esto devuelve a quién pertenece.
   *
   * Tres garantías que importan:
   *
   *   · IDEMPOTENTE Y SEGURA ANTE CONCURRENCIA. Dos webhooks simultáneos del
   *     mismo número devuelven el MISMO `contactId`. El árbitro no es un
   *     `SELECT` previo —que pierde la carrera— sino el índice único
   *     `(tenant_id, channel, identifier)`: el segundo INSERT choca con 23505
   *     y el servicio relee al ganador.
   *   · SIGUE LA CADENA DE FUSIÓN. Si la identidad pertenece a un contacto que
   *     luego se fusionó, devuelve el SUPERVIVIENTE. Un hilo viejo nunca
   *     apunta a una tarjeta que el emprendedor ya no ve.
   *   · NORMALIZA. `+52 81 4681 1675`, `528146811675@s.whatsapp.net` y
   *     `5281-4681-1675` son la misma identidad.
   */
  resolveByIdentity(
    ctx: TenantContext,
    i: ResolveInput,
  ): Promise<{ contactId: string; created: boolean }>;

  /** El contacto completo con identidades, etiquetas y posición en los embudos. */
  get(ctx: TenantContext, contactId: string): Promise<Contact | null>;

  /**
   * Registra algo en la línea de tiempo. H6 escribe `message_in` /
   * `message_out` aquí para que el perfil del contacto se lea de un tirón.
   *
   * BEST EFFORT DEL LADO DEL LLAMADOR: si esto falla, no mates el mensaje.
   * Una línea de tiempo incompleta es un problema; un WhatsApp sin contestar
   * porque no se pudo registrar el evento es otro mucho peor.
   */
  recordEvent(ctx: TenantContext, i: RecordEventInput): Promise<{ eventId: string | null }>;

  /** Toca `last_activity_at` sin escribir un evento. Para acuses y ecos. */
  touch(ctx: TenantContext, contactId: string, at?: string): Promise<void>;

  // ── Lo que H8 necesita — los tres nodos ──────────────────────────────────

  /**
   * Nodo `move_stage`. `stage` acepta el slug o el id de la etapa: el
   * asistente en español de H8 propone `'contactado'` y el builder visual
   * manda un uuid. Resolver los dos aquí evita que H8 tenga que saber cuál es.
   *
   * Emite `stage_changed` por `FlowPort` — el disparador que enrola otros
   * flujos. Si mover a la etapa en la que YA está, no emite nada: un flujo que
   * mueve a "Contactado" no puede dispararse a sí mismo en bucle.
   */
  moveStage(
    ctx: TenantContext,
    i: {
      contactId: string;
      stage: string;
      /** Slug o id. Ausente = el embudo por defecto del tenant. */
      pipeline?: string;
      amount?: number;
      /**
       * ISO-4217 (`MXN`, `USD`…). Ausente = se conserva lo que ya tuviera la
       * fila, o el DEFAULT `'MXN'` de la columna si es nueva.
       *
       * Existe porque sin él `ContactPlacement.currency` prometía una capacidad
       * que ninguna ruta podía ejercer: un trato de 5,000 USD se guardaba como
       * MXN y se pintaba como pesos.
       */
      currency?: string;
      actor?: string;
    },
  ): Promise<{ moved: boolean; stageId: string; previousStageId: string | null }>;

  /** Nodo `assign_owner`. `ownerEmail: null` lo desasigna. */
  assignOwner(
    ctx: TenantContext,
    i: { contactId: string; ownerEmail: string | null; actor?: string },
  ): Promise<void>;

  /** Nodo `add_tag`. Idempotente: etiquetar dos veces no emite dos eventos. */
  addTag(
    ctx: TenantContext,
    i: { contactId: string; tag: string; actor?: string },
  ): Promise<{ added: boolean }>;

  removeTag(
    ctx: TenantContext,
    i: { contactId: string; tag: string; actor?: string },
  ): Promise<{ removed: boolean }>;

  // ── CRM propiamente dicho ────────────────────────────────────────────────

  create(ctx: TenantContext, i: CreateContactInput): Promise<{ contactId: string }>;
  update(ctx: TenantContext, contactId: string, i: UpdateContactInput): Promise<void>;
  list(ctx: TenantContext, i?: ListContactsInput): Promise<ListContactsResult>;

  addIdentity(
    ctx: TenantContext,
    i: { contactId: string; identity: IdentityInput; actor?: string },
  ): Promise<{ identityId: string; alreadyOwnedBy: string | null }>;

  /**
   * Fusiona dos contactos. `loserId` deja de existir para la UI y todas sus
   * identidades, etiquetas, eventos y posiciones pasan al ganador.
   *
   * NO BORRA la fila del perdedor: la apunta con `merged_into`. Borrarla
   * rompería `threads.contact_id` de H6 y los enrolamientos de H8, y dejaría
   * huecos en un historial que el negocio necesita. Un contacto fusionado
   * sigue resolviendo al superviviente para siempre.
   */
  merge(
    ctx: TenantContext,
    i: { winnerId: string; loserId: string; actor?: string },
  ): Promise<{ winnerId: string; movedIdentities: number; movedEvents: number }>;

  /** Pares que probablemente son la misma persona. No fusiona: propone. */
  findDuplicates(
    ctx: TenantContext,
    i?: { limit?: number },
  ): Promise<Array<{ aId: string; bId: string; reason: string; score: number }>>;

  timeline(
    ctx: TenantContext,
    i: { contactId: string; limit?: number; before?: string },
  ): Promise<ContactEvent[]>;

  // ── Embudo ──────────────────────────────────────────────────────────────

  listPipelines(ctx: TenantContext): Promise<Pipeline[]>;

  /**
   * Siembra el embudo por defecto si el tenant no tiene ninguno.
   * Lo llama H7 al final del Ritual de Fundación, y es idempotente: correrlo
   * dos veces no duplica etapas.
   */
  ensureDefaultPipeline(ctx: TenantContext): Promise<{ pipelineId: string; created: boolean }>;

  /**
   * Cuántos contactos y cuánto dinero hay en cada etapa. Es el tablero.
   *
   * El dinero viene DESGLOSADO POR MONEDA (`amounts`), no como un total. Sumar
   * `amount` a través de monedas distintas produce un número que no significa
   * nada, y la UI lo pintaba con `MXN` duro. `currency` dice cuál es la moneda
   * mayoritaria del embudo —la que la UI debe pintar— y `amount` es el total de
   * ESA moneda, nunca una mezcla.
   */
  pipelineStats(
    ctx: TenantContext,
    i?: { pipeline?: string },
  ): Promise<{
    pipelineId: string;
    currency: string;
    stages: Array<{
      stageId: string;
      slug: string;
      name: string;
      count: number;
      amount: number;
      amounts: Record<string, number>;
    }>;
  }>;
}
