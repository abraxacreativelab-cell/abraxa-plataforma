import { describe, expect, it } from 'vitest';
import { extraerMedia, extraerTexto, nombreEvento, parsearEventos, parsearMensajes } from './parse';

const CANAL = 'canal-1';

function upsert(...mensajes: unknown[]): unknown {
  return { event: 'MESSAGES_UPSERT', data: mensajes.length === 1 ? mensajes[0] : mensajes };
}

const mensajeSimple = {
  key: { id: 'WA-1', remoteJid: '5215512345678@s.whatsapp.net', fromMe: false },
  pushName: 'Ana',
  messageTimestamp: 1_785_000_000,
  message: { conversation: '¿a qué hora abren?' },
};

describe('nombreEvento', () => {
  it('normaliza el nombre del evento', () => {
    expect(nombreEvento({ event: 'MESSAGES_UPSERT' })).toBe('messages.upsert');
    expect(nombreEvento({ event: 'connection.update' })).toBe('connection.update');
    expect(nombreEvento(null)).toBe('');
  });
});

describe('extraerTexto', () => {
  it('lee las cinco formas en que WhatsApp manda texto', () => {
    expect(extraerTexto({ message: { conversation: 'hola' } })).toBe('hola');
    expect(extraerTexto({ message: { extendedTextMessage: { text: 'con enlace' } } })).toBe(
      'con enlace',
    );
    expect(extraerTexto({ message: { imageMessage: { caption: 'mira' } } })).toBe('mira');
    expect(extraerTexto({ message: { videoMessage: { caption: 'video' } } })).toBe('video');
    expect(extraerTexto({ message: { documentMessage: { caption: 'doc' } } })).toBe('doc');
  });

  it('devuelve null cuando no hay texto', () => {
    expect(extraerTexto({ message: { reactionMessage: {} } })).toBeNull();
    expect(extraerTexto({})).toBeNull();
  });
});

describe('extraerMedia', () => {
  it('saca los adjuntos con su tipo', () => {
    const media = extraerMedia({
      message: {
        imageMessage: { url: 'https://x/1.jpg', mimetype: 'image/jpeg' },
        documentMessage: { url: 'https://x/a.pdf', fileName: 'cotizacion.pdf' },
      },
    });
    expect(media).toEqual([
      { type: 'image', url: 'https://x/1.jpg', mime: 'image/jpeg' },
      { type: 'document', url: 'https://x/a.pdf', name: 'cotizacion.pdf' },
    ]);
  });
});

describe('parsearMensajes', () => {
  it('normaliza un mensaje entrante a la forma del port', () => {
    const [m] = parsearMensajes(CANAL, upsert(mensajeSimple));
    expect(m).toEqual({
      channelType: 'whatsapp',
      channelId: CANAL,
      // ← La dirección es E.164, NO el JID. Es el cambio transversal del handoff.
      address: '+525512345678',
      body: '¿a qué hora abren?',
      media: [],
      externalId: 'WA-1',
      fromMe: false,
      contactName: 'Ana',
      receivedAt: new Date(1_785_000_000_000).toISOString(),
    });
  });

  it('acepta un lote de mensajes', () => {
    const lote = parsearMensajes(
      CANAL,
      upsert(mensajeSimple, {
        ...mensajeSimple,
        key: { ...mensajeSimple.key, id: 'WA-2' },
        message: { conversation: 'segundo' },
      }),
    );
    expect(lote.map((m) => m.externalId)).toEqual(['WA-1', 'WA-2']);
  });

  it('marca el eco de un saliente nuestro', () => {
    const [m] = parsearMensajes(
      CANAL,
      upsert({ ...mensajeSimple, key: { ...mensajeSimple.key, fromMe: true } }),
    );
    expect(m?.fromMe).toBe(true);
  });

  it('ignora grupos y estados', () => {
    expect(
      parsearMensajes(CANAL, upsert({ ...mensajeSimple, key: { ...mensajeSimple.key, remoteJid: '1@g.us' } })),
    ).toEqual([]);
    expect(
      parsearMensajes(
        CANAL,
        upsert({ ...mensajeSimple, key: { ...mensajeSimple.key, remoteJid: 'status@broadcast' } }),
      ),
    ).toEqual([]);
  });

  it('descarta un mensaje SIN id del proveedor', () => {
    // Sin llave de idempotencia no hay forma de evitar que un reintento lo
    // duplique, y un duplicado dispara al agente dos veces.
    const sinId = { ...mensajeSimple, key: { remoteJid: mensajeSimple.key.remoteJid } };
    expect(parsearMensajes(CANAL, upsert(sinId))).toEqual([]);
  });

  it('descarta reacciones y protocolo (sin texto ni media)', () => {
    expect(
      parsearMensajes(CANAL, upsert({ ...mensajeSimple, message: { reactionMessage: { text: '👍' } } })),
    ).toEqual([]);
  });

  it('ignora eventos que no son mensajes', () => {
    expect(parsearMensajes(CANAL, { event: 'CONNECTION_UPDATE', data: { state: 'open' } })).toEqual([]);
    expect(parsearMensajes(CANAL, null)).toEqual([]);
  });

  it('acepta marcas de tiempo en segundos y en milisegundos', () => {
    const [enSegundos] = parsearMensajes(CANAL, upsert({ ...mensajeSimple, messageTimestamp: 1_785_000_000 }));
    const [enMilis] = parsearMensajes(
      CANAL,
      upsert({ ...mensajeSimple, messageTimestamp: 1_785_000_000_000 }),
    );
    expect(enSegundos?.receivedAt).toBe(enMilis?.receivedAt);
  });
});

describe('parsearEventos', () => {
  it('traduce los acuses de entrega', () => {
    const eventos = parsearEventos({
      event: 'MESSAGES_UPDATE',
      data: [
        { keyId: 'WA-1', status: 'DELIVERY_ACK' },
        { key: { id: 'WA-2' }, status: 'READ' },
        { keyId: 'WA-3', status: 'ALGO_RARO' },
      ],
    });
    expect(eventos).toEqual([
      { kind: 'acuse', externalId: 'WA-1', status: 'delivered' },
      { kind: 'acuse', externalId: 'WA-2', status: 'read' },
    ]);
  });

  it('traduce el estado de la línea', () => {
    expect(parsearEventos({ event: 'CONNECTION_UPDATE', data: { state: 'open', number: '5215512345678' } })).toEqual(
      [{ kind: 'conexion', status: 'active', externalId: '5215512345678' }],
    );
    expect(parsearEventos({ event: 'CONNECTION_UPDATE', data: { state: 'close' } })).toEqual([
      { kind: 'conexion', status: 'disconnected' },
    ]);
    // `connecting` es un estado transitorio: no se persiste nada.
    expect(parsearEventos({ event: 'CONNECTION_UPDATE', data: { state: 'connecting' } })).toEqual([]);
  });

  it('no confunde un lote de mensajes con acuses', () => {
    expect(parsearEventos(upsert(mensajeSimple))).toEqual([]);
  });
});
