/**
 * ════════════════════════════════════════════════════════════════════════════
 *  packages/db/ports.ts — LOS CONTRATOS CRUZADOS
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Este archivo es la razón por la que 14 conversaciones pueden construir en
 *  paralelo sin esperarse. Aquí se declara QUÉ expone cada handoff; el CÓMO
 *  vive en su propio paquete y a nadie más le importa.
 *
 *  ── Tres reglas ────────────────────────────────────────────────────────────
 *
 *  1. SÓLO TIPOS. Ni una línea de implementación, ni una constante en runtime.
 *     Este archivo no puede importar nada que no sea `type`.
 *
 *  2. Programa contra el port, no contra el paquete. H8 (flows) manda WhatsApp
 *     sin esperar a H6: pide `usePort('inbox')` y en sus pruebas mete un doble.
 *     Se encuentran en el merge.
 *
 *  3. Es de H1 y ya está hecho. Si te falta algo aquí, NO lo edites en tu rama:
 *     el gate de propiedad va a fallar tu PR. Anótalo en el PR y el orquestador
 *     lo agrega en una pasada de H1. Un tipo que cambia debajo de cuatro
 *     conversaciones vivas cuesta más que esperar.
 *
 *  Implementación registrada en runtime: `registerPort()` / `usePort()` de
 *  `@abraxa/db`. Ver packages/db/src/port-registry.ts.
 *
 *  Mapa de quién implementa qué:
 *
 *    TenancyPort  → H2   packages/tenancy      InboxPort    → H6   packages/inbox
 *    AgentPort    → H3   packages/agents       FlowPort     → H8   packages/flows
 *    VaultPort    → H4   packages/vault        WorkPort     → H9   packages/work
 *    BillingPort  → H10  packages/billing      AreasPort    → H11  packages/areas
 *    ChannelDriver→ H6 (whatsapp) · H12 (meta) · H13 (email, sms)
 */

// ════════════════════════════════════════════════════════════════════════════
// Vocabulario común
// ════════════════════════════════════════════════════════════════════════════

/** Acceso a un área del negocio. Orden: view < edit < admin. */
export type AreaAccess = 'view' | 'edit' | 'admin';

/** Rol dentro del tenant. `owner` es único por tenant. */
export type MembershipRole = 'owner' | 'admin' | 'member' | 'viewer';

/** Canales por los que entra y sale un mensaje. */
export type ChannelType = 'whatsapp' | 'instagram' | 'messenger' | 'email' | 'sms';

/** Roles de agente. `master` es el que bautiza el emprendedor; el resto son suyos. */
export type AgentRole = 'master' | 'sales' | 'service' | 'social' | 'analyst';

/** Proveedor de modelo. `local` está declarado a propósito: migrar un agente a
 *  un modelo propio tiene que ser UNA FILA de base de datos, no un refactor. */
export type ProviderName = 'anthropic' | 'openrouter' | 'local';

/** Los 8 disparadores de una automatización (H8). */
export type TriggerType =
  | 'contact_created'
  | 'stage_changed'
  | 'form_submitted'
  | 'appointment_created'
  | 'appointment_cancelled'
  | 'tag_added'
  | 'message_in'
  | 'manual';

/** Estado de un área en el mapa del emprendedor (H11). Las bloqueadas se
 *  MUESTRAN con candado y su promesa: la curiosidad es el motor del producto. */
export type AreaState = 'bloqueada' | 'disponible' | 'en_progreso' | 'activa';

/**
 * Quién pide, de qué empresa, y qué puede tocar.
 *
 * Se construye SIEMPRE server-side desde una sesión verificada
 * (`TenancyPort.contextFor`). Nunca desde un header que mandó el navegador:
 * ese 403 es lo único que impide que el cliente A lea los datos del cliente B.
 */
export interface TenantContext {
  tenantId: string;
  tenantSlug: string;
  userEmail: string | null;
  role: MembershipRole | null;
  /** slug de área → acceso. Ausente = sin acceso. Deny por defecto. */
  areas: Record<string, AreaAccess>;
}

/** Consumo real de una llamada a un modelo. Se LEE de la respuesta de la API,
 *  no se estima: en GARDEN el costo estimado estuvo roto meses sin que nadie
 *  lo notara. */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens: number;
  cachedWriteTokens: number;
  costUsd: number;
}

// ════════════════════════════════════════════════════════════════════════════
// Errores compartidos
// ════════════════════════════════════════════════════════════════════════════

/**
 * Códigos que cruzan la frontera entre paquetes. Si H6 llama a H3 y el tenant
 * se pasó de presupuesto, H6 tiene que poder distinguirlo de un fallo de red
 * sin acoplarse al código de H3.
 *
 * La clase que se lanza es `PlatformError` de `@abraxa/db`.
 */
export type PlatformErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION'
  | 'BUDGET_EXCEEDED'
  | 'RATE_LIMITED'
  | 'PROVIDER_ERROR'
  | 'CHANNEL_ERROR'
  | 'PORT_NOT_IMPLEMENTED'
  | 'INTERNAL';

export interface PlatformErrorShape {
  readonly code: PlatformErrorCode;
  readonly message: string;
  /** Código HTTP sugerido para la capa de transporte. */
  readonly status: number;
  /** `true` si reintentar tiene sentido (red, 429, 5xx del proveedor). */
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;
}

// ════════════════════════════════════════════════════════════════════════════
// H2 — TenancyPort
// ════════════════════════════════════════════════════════════════════════════

export interface ProvisionInput {
  slug: string;
  name: string;
  ownerEmail: string;
  industryType?: string;
}

export interface TenancyPort {
  /**
   * Alta completa de un cliente en UNA operación transaccional:
   * usuario → tenant → membresía owner → grants totales → plan free.
   *
   * IDEMPOTENTE POR SLUG. H10 puede reintentar un webhook de Stripe y no debe
   * quedar con dos empresas. Si el slug existe, devuelve el mismo tenantId.
   */
  provision(i: ProvisionInput): Promise<{ tenantId: string; created: boolean }>;

  /** Contexto verificado, o lanza FORBIDDEN si no hay membresía. */
  contextFor(i: { userEmail: string; tenantSlug: string }): Promise<TenantContext>;

  /** Doble puerta con FAIL-CLOSED: cualquier error de red o timeout devuelve
   *  `false`, jamás `true`. */
  canSignIn(email: string): Promise<boolean>;

  /** El tenant al que pertenece un correo, si tiene exactamente uno. */
  primaryTenantSlugFor(email: string): Promise<string | null>;

  /** Miembros del tenant. Lo consume H9 para el selector de responsable. */
  listMembers(ctx: TenantContext): Promise<
    Array<{ email: string; name: string | null; role: MembershipRole }>
  >;
}

// ════════════════════════════════════════════════════════════════════════════
// H3 — AgentPort
// ════════════════════════════════════════════════════════════════════════════

export interface AgentRunInput {
  role: AgentRole;
  input: string;
  /** Hilo de la bandeja, si viene de un mensaje real (H6). */
  threadId?: string;
  /** Historial ya resuelto por el llamador. Si se omite, el motor lo carga. */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Se antepone al system prompt de la fila. Lo usa H7 para la entrevista. */
  systemSuffix?: string;
  /** Tools permitidas en esta corrida. Ausente = las de la definición. */
  tools?: string[];
}

export interface AgentRunResult {
  text: string;
  usage: Usage;
  stopReason: 'end_turn' | 'max_tokens' | 'tool_use' | 'error';
  /** Nombre que el emprendedor le puso a su agente. La UI lo muestra. */
  agentName: string;
}

export interface AgentPort {
  /** Corre el agente del rol pedido. Lanza BUDGET_EXCEEDED si el tenant se
   *  pasó del límite de su plan — no degrada a un modelo peor en silencio. */
  run(ctx: TenantContext, i: AgentRunInput): Promise<AgentRunResult>;

  /** Registra una tool para que los agentes la puedan usar. Cada handoff
   *  registra las suyas desde su propio paquete: nadie edita un registro
   *  central. El aislamiento por tenant se aplica DENTRO del handler. */
  registerTool(t: AgentTool): void;

  /** Crea o actualiza la definición de un agente. Lo usa H7 en el bautizo. */
  upsertDefinition(
    ctx: TenantContext,
    d: {
      role: AgentRole;
      name: string;
      systemPrompt: string;
      provider?: ProviderName;
      model?: string;
      tools?: string[];
    },
  ): Promise<{ agentId: string }>;
}

export interface AgentTool {
  name: string;
  description: string;
  /** JSON Schema de los parámetros. */
  inputSchema: Record<string, unknown>;
  /** El handler recibe el contexto del tenant. Todo acceso a datos va por
   *  `tenantDb(ctx)`: una tool corrida con el contexto de A no puede leer B. */
  handler(ctx: TenantContext, input: Record<string, unknown>): Promise<unknown>;
}

// ════════════════════════════════════════════════════════════════════════════
// H4 — VaultPort
// ════════════════════════════════════════════════════════════════════════════

/** Alcance de un valor canónico. Gana el más específico: `area` > `tenant`.
 *  (GARDEN tenía `socio` y `propiedad`; son de una inmobiliaria y no se heredan.) */
export interface VaultScope {
  type: 'tenant' | 'area';
  /** slug del área cuando `type === 'area'`. */
  id?: string;
}

export interface VaultPort {
  /**
   * Mapa de valores vigentes YA FORMATEADO, listo para interpolar.
   * Claves con namespace: `valor.*`, `precio.*`, `empresa.*`, `marca.*`.
   * Sólo incluye valores con `active = true`.
   */
  resolve(ctx: TenantContext, scope?: VaultScope): Promise<Record<string, string>>;

  /**
   * Anexa al prompt el bloque de datos vigentes del negocio con la instrucción
   * de citarlos exactos y no inventar. Es lo que evita que el agente alucine
   * cifras.
   *
   * BEST EFFORT: si la bóveda falla, devuelve el prompt INTACTO. Jamás rompe
   * al agente.
   */
  injectIntoPrompt(ctx: TenantContext, prompt: string, scope?: VaultScope): Promise<string>;

  /** Sustituye `{valor.x}` / `{precio.x}` / `{empresa.x}` / `{marca.x}`.
   *  Un token desconocido queda VACÍO, nunca `{...}` crudo en la cara del
   *  cliente final. */
  render(ctx: TenantContext, template: string, scope?: VaultScope): Promise<string>;

  /** Documento pegado → clasificado, indexado, y valores extraídos en BORRADOR
   *  (`active = false`). Nada se activa solo. Lo llama H7 durante la entrevista. */
  ingestDocument(
    ctx: TenantContext,
    i: { title?: string; content: string; areaSlug?: string },
  ): Promise<{ documentId: string; valueIds: string[] }>;

  /** Qué le falta al negocio por área, contra lo esperado de su giro. Es lo que
   *  le permite al agente maestro decir "todavía no me has dicho cuánto cobras". */
  detectGaps(ctx: TenantContext): Promise<Array<{ areaSlug: string; missing: string[] }>>;
}

// ════════════════════════════════════════════════════════════════════════════
// H6 — InboxPort y ChannelDriver
// ════════════════════════════════════════════════════════════════════════════

export interface OutboundMessage {
  threadId: string;
  body: string;
  media?: string[];
  /** Quién manda. `null` = la IA. Llenar apaga la IA del hilo (ver abajo). */
  author?: string | null;
  /** `true` cuando la escribió un agente. Marca la burbuja en la UI. */
  aiGenerated?: boolean;
}

export interface InboundMessage {
  channelType: ChannelType;
  /** Identificador del canal en nuestro lado (`app.channels.id`). */
  channelId: string;
  /** Dirección del contacto en el canal: teléfono, correo, id de IG.
   *  GENÉRICO — no un JID de WhatsApp. */
  address: string;
  body: string;
  media?: string[];
  /** Id del mensaje en el proveedor. Es la llave de idempotencia: un webhook
   *  reenviado dos veces NO duplica el mensaje ni dispara dos respuestas. */
  externalId: string;
  /** Eco de un mensaje que mandamos nosotros. */
  fromMe?: boolean;
  receivedAt?: string;
  contactName?: string;
}

export interface InboxPort {
  /** Encola y manda. Anti-duplicado: registra `queued` ANTES de salir al canal. */
  send(ctx: TenantContext, i: OutboundMessage): Promise<{ messageId: string }>;

  startThread(
    ctx: TenantContext,
    i: { contactId?: string; channelType: ChannelType; address: string },
  ): Promise<{ threadId: string }>;

  /** El control que el emprendedor tiene que poder accionar en un clic para
   *  callar a su agente y meterse él. */
  setAiEnabled(ctx: TenantContext, i: { threadId: string; enabled: boolean }): Promise<void>;

  /** Toma el hilo un humano. La IA se calla. Sin excepción: nada peor que el
   *  agente contestando encima de su dueño. */
  assign(ctx: TenantContext, i: { threadId: string; userEmail: string | null }): Promise<void>;
}

/**
 * El enchufe por el que H12 (Meta) y H13 (email + SMS) conectan sus canales sin
 * tocar el código de H6.
 *
 * Cada driver vive en `packages/inbox/src/drivers/<canal>/` y se auto-registra
 * con `registerDriver()`. El registro NO puede asumir nada de WhatsApp.
 */
export interface ChannelDriver {
  readonly type: ChannelType;
  send(i: {
    channelId: string;
    address: string;
    body: string;
    media?: string[];
  }): Promise<{ externalId: string }>;
  parseWebhook(raw: unknown): Promise<InboundMessage[]>;
  /** Alta del canal: instancia, QR, token de webhook, lo que pida el proveedor. */
  provisionChannel?(i: {
    tenantId: string;
    name: string;
    config: Record<string, unknown>;
  }): Promise<{ externalId: string; status: string; qr?: string }>;
}

// ════════════════════════════════════════════════════════════════════════════
// H8 — FlowPort
// ════════════════════════════════════════════════════════════════════════════

export interface FlowPort {
  /** Publica un evento de dominio. Las automatizaciones que lo escuchan se
   *  enrolan solas. Cualquier paquete puede emitir. */
  emit(ctx: TenantContext, e: { type: TriggerType; payload: unknown }): Promise<void>;
}

// ════════════════════════════════════════════════════════════════════════════
// H9 — WorkPort
// ════════════════════════════════════════════════════════════════════════════

export interface WorkPort {
  /** Lo consume el nodo `create_task` de H8 y las tools del agente maestro. */
  createTask(
    ctx: TenantContext,
    i: {
      title: string;
      description?: string;
      assignedTo?: string;
      dueDate?: string;
      projectId?: string;
      parentId?: string;
    },
  ): Promise<{ taskId: string }>;
}

// ════════════════════════════════════════════════════════════════════════════
// H10 — BillingPort
// ════════════════════════════════════════════════════════════════════════════

export interface BillingPort {
  /**
   * Webhook de Stripe ya verificado y deduplicado → alta del tenant.
   *
   * Si `provision()` falla, esto LANZA: el webhook no debe devolver 200 y
   * Stripe tiene que reintentar. Un pago cobrado sin cuenta creada es el peor
   * estado posible del sistema.
   */
  onCheckoutCompleted(i: { sessionId: string }): Promise<{ tenantId: string; slug: string }>;
}

// ════════════════════════════════════════════════════════════════════════════
// H11 — AreasPort
// ════════════════════════════════════════════════════════════════════════════

export interface AreaSummary {
  slug: string;
  label: string;
  /** Nombre de icono lucide. Viene de la DB porque el sidebar no está en el código. */
  icon: string;
  position: number;
  state: AreaState;
  /** Acceso del usuario actual. `null` = no tiene. */
  access: AreaAccess | null;
  /** Qué le promete al emprendedor. Se muestra INCLUSO si está bloqueada. */
  blurb: string;
  /** Claves `"area:herramienta"` que resuelve el tool-registry del front. */
  tools: string[];
}

export interface AreasPort {
  /** Lo que pinta el sidebar. H5 lo consume; mientras H11 no exista usa un mock. */
  listAreas(ctx: TenantContext): Promise<AreaSummary[]>;
  unlockArea(ctx: TenantContext, areaSlug: string): Promise<{ state: AreaState }>;
}

// ════════════════════════════════════════════════════════════════════════════
// El registro
// ════════════════════════════════════════════════════════════════════════════

/**
 * Todos los ports en un mapa. `usePort('inbox')` devuelve la implementación
 * registrada, o lanza PORT_NOT_IMPLEMENTED diciendo qué handoff falta.
 */
export interface PortRegistry {
  tenancy: TenancyPort;
  agents: AgentPort;
  vault: VaultPort;
  inbox: InboxPort;
  flows: FlowPort;
  work: WorkPort;
  billing: BillingPort;
  areas: AreasPort;
}

export type PortName = keyof PortRegistry;
