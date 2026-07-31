/**
 * La forma de los datos de la bandeja, del lado del navegador.
 *
 * Se declaran aquí y no se importan de `@abraxa/inbox` a propósito: ese paquete
 * es de backend —arrastra Express y el cliente de Supabase— y `apps/web` no lo
 * declara como dependencia. La frontera entre el BFF y la pantalla es JSON, y
 * este archivo es su contrato.
 */
import type { ChannelType } from '@abraxa/db/ports';

export type Direccion = 'in' | 'out';
export type EstadoMensaje = 'queued' | 'sent' | 'delivered' | 'read' | 'failed';

export interface Hilo {
  id: string;
  channelId: string;
  channelType: ChannelType;
  channelName: string | null;
  address: string;
  display: string;
  status: string;
  assignedTo: string | null;
  aiEnabled: boolean;
  aiPausedUntil: string | null;
  unread: number;
  lastMessageAt: string | null;
  lastMessage: string | null;
  lastDirection: Direccion | null;
}

export interface Mensaje {
  id: string;
  thread_id: string;
  direction: Direccion;
  body: string | null;
  media: Array<{ type: string; url: string }>;
  ai_generated: boolean;
  author: string | null;
  status: EstadoMensaje;
  error: string | null;
  ai_outcome: 'answered' | 'skipped' | 'failed' | null;
  ai_reason: string | null;
  created_at: string;
}

export interface Conversacion {
  thread: Hilo;
  messages: Mensaje[];
}

/** Etiqueta corta del canal para la lista. */
export const ETIQUETA_CANAL: Record<ChannelType, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  messenger: 'Messenger',
  email: 'Correo',
  sms: 'SMS',
};

export const ICONO_CANAL: Record<ChannelType, string> = {
  whatsapp: 'messages',
  instagram: 'megaphone',
  messenger: 'messages',
  email: 'file',
  sms: 'messages',
};

/** Hora corta para la lista; hora con día para las burbujas. */
export function hora(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

export function fechaCorta(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hoy = new Date();
  const mismoDia =
    d.getFullYear() === hoy.getFullYear() &&
    d.getMonth() === hoy.getMonth() &&
    d.getDate() === hoy.getDate();
  return mismoDia ? hora(iso) : d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
}

/**
 * Los hilos como los quiere la lista: el más reciente arriba, y los que
 * esperan respuesta primero dentro del mismo instante.
 */
export function ordenarHilos(hilos: Hilo[]): Hilo[] {
  return [...hilos].sort((a, b) => {
    const ta = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
    const tb = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
    if (tb !== ta) return tb - ta;
    return b.unread - a.unread;
  });
}
