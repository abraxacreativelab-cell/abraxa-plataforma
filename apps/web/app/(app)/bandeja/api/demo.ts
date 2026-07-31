/**
 * Juego de datos en memoria para VER la bandeja sin H2 y sin WhatsApp.
 *
 * Apagado por partida doble: `NODE_ENV !== 'production'` **y**
 * `ABRAXA_INBOX_DEMO=1`. No es una vía alterna de acceso a datos: no toca la
 * base, no lee la sesión y no existe en producción.
 *
 * Sirve para una cosa concreta y vale la pena por ella: que el envío optimista,
 * el interruptor de IA y los estados de mensaje se puedan ver y probar hoy,
 * sin esperar a que haya un número conectado.
 *
 *     ABRAXA_INBOX_DEMO=1 npm run dev:web   →   http://localhost:3000/bandeja
 */
import type { Conversacion, Hilo, Mensaje } from '../tipos';

let contador = 0;
const id = (p: string): string => `${p}-${(contador += 1)}`;

function haceMinutos(m: number): string {
  return new Date(Date.now() - m * 60_000).toISOString();
}

function mensaje(sobre: Partial<Mensaje> & { thread_id: string }): Mensaje {
  return {
    id: id('msg'),
    direction: 'in',
    body: null,
    media: [],
    ai_generated: false,
    author: 'contact',
    status: 'delivered',
    error: null,
    ai_outcome: null,
    ai_reason: null,
    created_at: haceMinutos(30),
    ...sobre,
  };
}

const HILOS: Hilo[] = [
  {
    id: 'demo-1',
    channelId: 'canal-wa',
    channelType: 'whatsapp',
    channelName: 'Línea principal',
    address: '+525512345678',
    display: 'Ana Robles',
    status: 'open',
    assignedTo: null,
    aiEnabled: true,
    aiPausedUntil: null,
    unread: 0,
    lastMessageAt: haceMinutos(12),
    lastMessage: 'Con mucho gusto. ¿Para cuántas personas sería?',
    lastDirection: 'out',
  },
  {
    id: 'demo-2',
    channelId: 'canal-wa',
    channelType: 'whatsapp',
    channelName: 'Línea principal',
    address: '+525599887766',
    display: 'Miguel Ortiz',
    status: 'open',
    assignedTo: 'santiago@abraxa.club',
    aiEnabled: true,
    aiPausedUntil: null,
    unread: 2,
    lastMessageAt: haceMinutos(45),
    lastMessage: 'Perfecto, mañana te confirmo.',
    lastDirection: 'in',
  },
  {
    id: 'demo-3',
    channelId: 'canal-wa',
    channelType: 'whatsapp',
    channelName: 'Línea principal',
    address: '+525544332211',
    display: 'Lucía Fernández',
    status: 'open',
    assignedTo: null,
    aiEnabled: false,
    aiPausedUntil: null,
    unread: 1,
    lastMessageAt: haceMinutos(180),
    lastMessage: '¿Tienen disponibilidad el sábado?',
    lastDirection: 'in',
  },
];

const MENSAJES: Record<string, Mensaje[]> = {
  'demo-1': [
    mensaje({ thread_id: 'demo-1', body: 'Hola, ¿todavía tienen mesa para hoy?', created_at: haceMinutos(20) }),
    mensaje({
      thread_id: 'demo-1',
      direction: 'out',
      body: 'Con mucho gusto. ¿Para cuántas personas sería?',
      ai_generated: true,
      author: null,
      status: 'read',
      created_at: haceMinutos(12),
    }),
  ],
  'demo-2': [
    mensaje({ thread_id: 'demo-2', body: 'Buenas, quiero cotizar el paquete grande.', created_at: haceMinutos(90) }),
    mensaje({
      thread_id: 'demo-2',
      direction: 'out',
      body: 'Yo te atiendo, Miguel. Te paso la cotización en un momento.',
      author: 'santiago@abraxa.club',
      status: 'delivered',
      created_at: haceMinutos(60),
    }),
    mensaje({
      thread_id: 'demo-2',
      body: 'Perfecto, mañana te confirmo.',
      created_at: haceMinutos(45),
      // El humano tiene el hilo: la IA se calló y quedó dicho por qué.
      ai_outcome: 'skipped',
      ai_reason: 'Tú tomaste esta conversación, así que el agente no se metió.',
    }),
  ],
  'demo-3': [
    mensaje({
      thread_id: 'demo-3',
      body: '¿Tienen disponibilidad el sábado?',
      created_at: haceMinutos(180),
      ai_outcome: 'skipped',
      ai_reason: 'Tienes la IA apagada en esta conversación.',
    }),
  ],
};

export function listar(): { threads: Hilo[]; unread: number } {
  return { threads: HILOS, unread: HILOS.reduce((t, h) => t + h.unread, 0) };
}

export function ver(threadId: string): Conversacion | null {
  const thread = HILOS.find((h) => h.id === threadId);
  if (!thread) return null;
  thread.unread = 0;
  return { thread, messages: MENSAJES[threadId] ?? [] };
}

/** Escribe en el hilo. Como en el servicio real, un humano lo toma. */
export function enviar(threadId: string, body: string): Mensaje | null {
  const thread = HILOS.find((h) => h.id === threadId);
  if (!thread) return null;

  const m = mensaje({
    thread_id: threadId,
    direction: 'out',
    body,
    author: 'santiago@abraxa.club',
    status: 'sent',
    created_at: new Date().toISOString(),
  });

  (MENSAJES[threadId] ??= []).push(m);
  thread.assignedTo = 'santiago@abraxa.club';
  thread.lastMessage = body;
  thread.lastMessageAt = m.created_at;
  thread.lastDirection = 'out';
  thread.unread = 0;
  return m;
}

export function ajustar(
  threadId: string,
  cambios: { aiEnabled?: boolean; assignedTo?: string | null; pauseMinutes?: number },
): Conversacion | null {
  const thread = HILOS.find((h) => h.id === threadId);
  if (!thread) return null;
  if (cambios.aiEnabled !== undefined) {
    thread.aiEnabled = cambios.aiEnabled;
    if (cambios.aiEnabled) thread.aiPausedUntil = null;
  }
  if (cambios.pauseMinutes !== undefined) {
    thread.aiPausedUntil =
      cambios.pauseMinutes === 0
        ? null
        : new Date(Date.now() + cambios.pauseMinutes * 60_000).toISOString();
  }
  if (cambios.assignedTo !== undefined) thread.assignedTo = cambios.assignedTo;
  return ver(threadId);
}
