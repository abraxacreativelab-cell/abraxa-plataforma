/**
 * Las filas de H6, tal como salen de la migración 040.
 *
 * Se declaran aquí y no en un `Database` generado central por la razón que
 * explica `packages/db/src/client.ts`: ese archivo sería el punto de colisión
 * número uno entre 14 conversaciones. Cada paquete tipa las suyas.
 */
import type { AgentRole, ChannelType } from '@abraxa/db';

/** Estado de la línea. `pending` = creada pero todavía sin vincular. */
export type ChannelStatus = 'pending' | 'active' | 'disconnected' | 'error';

export type ThreadStatus = 'open' | 'pending' | 'closed' | 'snoozed';

export type MessageStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed';

export type Direction = 'in' | 'out';

/** Qué hizo la IA con un mensaje entrante. `null` en los salientes. */
export type AiOutcome = 'answered' | 'skipped' | 'failed';

export interface MediaItem {
  type: string;
  url: string;
  mime?: string;
  name?: string;
}

/**
 * Horario de atención de un canal.
 *
 * Vacío = 24/7, y ése es el default: la promesa que vende el producto es que el
 * agente contesta mientras el dueño duerme.
 */
export interface BusinessHours {
  /** Zona IANA. Sin ella se interpreta en UTC, que casi nunca es lo que se
   *  quiere — por eso `crearCanal()` la exige al configurar horario. */
  tz?: string;
  /** Día → tramos `[["09:00","14:00"],["16:00","19:00"]]`. Un día ausente o con
   *  lista vacía es un día cerrado. */
  semana?: Partial<Record<DiaSemana, Array<[string, string]>>>;
}

export type DiaSemana = 'dom' | 'lun' | 'mar' | 'mie' | 'jue' | 'vie' | 'sab';

export interface ChannelRow {
  id: string;
  tenant_id: string;
  type: ChannelType;
  driver: string;
  name: string;
  config: Record<string, unknown>;
  external_id: string | null;
  status: ChannelStatus;
  agent_role: AgentRole;
  ai_enabled: boolean;
  business_hours: BusinessHours;
  ai_outside_hours: boolean;
  created_at: string;
  updated_at: string;
}

export interface ThreadRow {
  id: string;
  tenant_id: string;
  contact_id: string | null;
  contact_name: string | null;
  channel_id: string;
  channel_type: ChannelType;
  /** GENÉRICO: E.164, correo o id de red social. Nunca un JID. */
  external_address: string;
  status: ThreadStatus;
  assigned_to: string | null;
  ai_enabled: boolean;
  ai_paused_until: string | null;
  unread: number;
  last_message_at: string | null;
  last_message: string | null;
  last_direction: Direction | null;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  tenant_id: string;
  thread_id: string;
  direction: Direction;
  body: string | null;
  media: MediaItem[];
  ai_generated: boolean;
  author: string | null;
  external_id: string | null;
  status: MessageStatus;
  error: string | null;
  ai_outcome: AiOutcome | null;
  ai_reason: string | null;
  created_at: string;
}

/** Lo que necesita la lista de la bandeja. */
export interface ThreadResumen {
  id: string;
  channelId: string;
  channelType: ChannelType;
  channelName: string | null;
  address: string;
  display: string;
  status: ThreadStatus;
  assignedTo: string | null;
  aiEnabled: boolean;
  aiPausedUntil: string | null;
  unread: number;
  lastMessageAt: string | null;
  lastMessage: string | null;
  lastDirection: Direction | null;
}

/** Lo que necesita el panel de conversación. */
export interface ConversacionVista {
  thread: ThreadResumen;
  messages: MessageRow[];
}
