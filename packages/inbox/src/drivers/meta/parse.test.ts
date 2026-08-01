/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El webhook de Meta, leído bien.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Las tres pruebas que justifican el archivo:
 *
 *    · «en un eco, el cliente está en `recipient`» — la inversión que abre un
 *      hilo del emprendedor consigo mismo si se lee mal.
 *    · «una entrada de otra página se DESCARTA» — el guardia que impide que los
 *      DMs de una empresa acaben en la bandeja de otra.
 *    · «sin `mid` no entra» — sin llave de idempotencia, un reintento duplica la
 *      respuesta del agente.
 */
import { describe, expect, it } from 'vitest';
import { leerConfigMeta } from './ajustes';
import { entrantesParaVentana, guardiaDeEntrada, midsDeEcos, parsearEventos, parsearMensajes } from './parse';

const IG_ID = '17841400000000000';
const PAGE_ID = '102938475600000';
const CLIENTE = '6072012345678901';

const cfgIg = leerConfigMeta('instagram', { ig_user_id: IG_ID, page_id: PAGE_ID });
const cfgFb = leerConfigMeta('messenger', { page_id: PAGE_ID });

function webhookIg(messaging: unknown[], entryId = IG_ID): unknown {
  return { object: 'instagram', entry: [{ id: entryId, time: 1_780_000_000_000, messaging }] };
}

function webhookFb(messaging: unknown[], entryId = PAGE_ID): unknown {
  return { object: 'page', entry: [{ id: entryId, time: 1_780_000_000_000, messaging }] };
}

const dm = (over: Record<string, unknown> = {}): unknown => ({
  sender: { id: CLIENTE },
  recipient: { id: IG_ID },
  timestamp: 1_780_000_000_000,
  message: { mid: 'mid-1', text: '¿cuánto cuesta?' },
  ...over,
});

describe('parsearMensajes · lo básico', () => {
  it('lee un DM de Instagram', () => {
    const [m] = parsearMensajes({ channelId: 'c1', cfg: cfgIg, payload: webhookIg([dm()]) });
    expect(m).toMatchObject({
      channelType: 'instagram',
      channelId: 'c1',
      address: CLIENTE,
      body: '¿cuánto cuesta?',
      externalId: 'mid-1',
    });
    expect(m?.fromMe).toBeUndefined();
    expect(m?.receivedAt).toBe(new Date(1_780_000_000_000).toISOString());
  });

  it('lee un mensaje de Messenger con la misma forma', () => {
    const ev = { ...(dm() as object), recipient: { id: PAGE_ID } };
    const [m] = parsearMensajes({ channelId: 'c2', cfg: cfgFb, payload: webhookFb([ev]) });
    expect(m).toMatchObject({ channelType: 'messenger', address: CLIENTE, externalId: 'mid-1' });
  });

  it('discrimina por `object`: un canal de IG no procesa una página', () => {
    expect(parsearMensajes({ channelId: 'c1', cfg: cfgIg, payload: webhookFb([dm()]) })).toEqual([]);
    expect(parsearMensajes({ channelId: 'c2', cfg: cfgFb, payload: webhookIg([dm()]) })).toEqual([]);
  });

  it('un cuerpo vacío, nulo o raro no revienta', () => {
    for (const basura of [null, undefined, {}, { object: 'instagram' }, 'texto', 42]) {
      expect(parsearMensajes({ channelId: 'c1', cfg: cfgIg, payload: basura })).toEqual([]);
    }
  });
});

describe('parsearMensajes · el eco', () => {
  /**
   * LA trampa. En un eco, `sender` es la página y el cliente está en
   * `recipient`. Leer siempre `sender.id` abriría un hilo cuya dirección es el
   * id de la propia cuenta: el emprendedor ve una conversación consigo mismo.
   */
  it('en un eco, el cliente está en `recipient` y no en `sender`', () => {
    const eco = {
      sender: { id: IG_ID },
      recipient: { id: CLIENTE },
      timestamp: 1_780_000_000_000,
      message: { mid: 'mid-eco', text: 'con gusto, son $500', is_echo: true },
    };
    const [m] = parsearMensajes({ channelId: 'c1', cfg: cfgIg, payload: webhookIg([eco]) });
    expect(m?.address).toBe(CLIENTE);
    expect(m?.fromMe).toBe(true);
  });

  it('el eco de un envío NUESTRO no vuelve a entrar', () => {
    const eco = {
      sender: { id: IG_ID },
      recipient: { id: CLIENTE },
      message: { mid: 'mid-nuestro', text: 'lo mandó el agente', is_echo: true },
    };
    const salida = parsearMensajes({
      channelId: 'c1',
      cfg: cfgIg,
      payload: webhookIg([eco]),
      midsPropios: new Set(['mid-nuestro']),
    });
    expect(salida).toEqual([]);
  });

  it('el eco de lo que el dueño escribió DESDE SU TELÉFONO sí entra', () => {
    // Éste es el caso que justifica suscribirse a los ecos: es lo único que le
    // avisa al sistema de que un humano tomó el hilo. Su mid no es nuestro.
    const eco = {
      sender: { id: IG_ID },
      recipient: { id: CLIENTE },
      message: { mid: 'mid-del-telefono', text: 'yo te lo dejo en 450', is_echo: true },
    };
    const [m] = parsearMensajes({
      channelId: 'c1',
      cfg: cfgIg,
      payload: webhookIg([eco]),
      midsPropios: new Set(['otro-mid']),
    });
    expect(m?.fromMe).toBe(true);
    expect(m?.externalId).toBe('mid-del-telefono');
  });

  it('`midsDeEcos` sólo recoge los ecos, y antes de construir nada', () => {
    const payload = webhookIg([
      dm(),
      { sender: { id: IG_ID }, recipient: { id: CLIENTE }, message: { mid: 'e1', text: 'a', is_echo: true } },
      { sender: { id: IG_ID }, recipient: { id: CLIENTE }, message: { mid: 'e2', text: 'b', is_echo: true } },
    ]);
    expect(midsDeEcos(payload)).toEqual(['e1', 'e2']);
  });
});

describe('parsearMensajes · lo que se descarta', () => {
  it('sin `mid` no entra: sin llave de idempotencia se duplicaría', () => {
    const sinMid = dm({ message: { text: 'hola' } });
    expect(parsearMensajes({ channelId: 'c1', cfg: cfgIg, payload: webhookIg([sinMid]) })).toEqual([]);
  });

  it('sin texto ni adjuntos no entra — reacciones y acuses de protocolo', () => {
    const vacio = dm({ message: { mid: 'm', text: '' } });
    const reaccion = { sender: { id: CLIENTE }, reaction: { mid: 'm', action: 'react', emoji: '❤' } };
    expect(
      parsearMensajes({ channelId: 'c1', cfg: cfgIg, payload: webhookIg([vacio, reaccion]) }),
    ).toEqual([]);
  });

  it('un mensaje borrado no entra', () => {
    const borrado = dm({ message: { mid: 'm', text: 'ups', is_deleted: true } });
    expect(parsearMensajes({ channelId: 'c1', cfg: cfgIg, payload: webhookIg([borrado]) })).toEqual([]);
  });

  it('`standby` no es nuestro: el hilo lo tiene otra app', () => {
    const payload = {
      object: 'instagram',
      entry: [{ id: IG_ID, standby: [dm()] }],
    };
    expect(parsearMensajes({ channelId: 'c1', cfg: cfgIg, payload })).toEqual([]);
  });

  it('`changes` tampoco: comentarios y menciones no son mensajería', () => {
    const payload = { object: 'instagram', entry: [{ id: IG_ID, changes: [{ field: 'comments' }] }] };
    expect(parsearMensajes({ channelId: 'c1', cfg: cfgIg, payload })).toEqual([]);
  });
});

describe('parsearMensajes · adjuntos y postbacks', () => {
  it('recoge las URLs de los adjuntos conocidos', () => {
    const conFoto = dm({
      message: {
        mid: 'm-foto',
        attachments: [
          { type: 'image', payload: { url: 'https://cdn.meta/a.jpg' } },
          { type: 'template', payload: {} },
          { type: 'fallback', payload: { url: 'https://ejemplo.com' } },
        ],
      },
    });
    const [m] = parsearMensajes({ channelId: 'c1', cfg: cfgIg, payload: webhookIg([conFoto]) });
    expect(m?.media).toEqual(['https://cdn.meta/a.jpg']);
    expect(m?.body).toBe('');
  });

  it('un postback entra como mensaje, con lo que el usuario VIO', () => {
    const tap = {
      sender: { id: CLIENTE },
      recipient: { id: IG_ID },
      postback: { mid: 'mid-pb', title: 'Ver precios', payload: 'MENU_PRECIOS' },
    };
    const [m] = parsearMensajes({ channelId: 'c1', cfg: cfgIg, payload: webhookIg([tap]) });
    // El `title`, no el `payload`: mandarle `MENU_PRECIOS` al agente le haría
    // contestar sobre una cadena que el cliente nunca escribió.
    expect(m?.body).toBe('Ver precios');
    expect(m?.externalId).toBe('mid-pb');
  });
});

describe('el guardia de entrada', () => {
  it('descarta una entrada de OTRA cuenta — no la mete en esta bandeja', () => {
    const ajena = webhookIg([dm()], '99999999999999');
    expect(parsearMensajes({ channelId: 'c1', cfg: cfgIg, payload: ajena })).toEqual([]);
  });

  it('deja pasar la de la cuenta correcta', () => {
    expect(guardiaDeEntrada(cfgIg, { id: IG_ID })).toBe(true);
    expect(guardiaDeEntrada(cfgIg, { id: 'otro' })).toBe(false);
  });

  it('un canal a medio conectar (sin id todavía) no se bloquea a sí mismo', () => {
    const sinId = leerConfigMeta('instagram', {});
    expect(guardiaDeEntrada(sinId, { id: 'lo-que-sea' })).toBe(true);
  });

  it('en Messenger el guardia compara contra la PÁGINA, no contra el IG', () => {
    expect(guardiaDeEntrada(cfgFb, { id: PAGE_ID })).toBe(true);
    expect(guardiaDeEntrada(cfgFb, { id: IG_ID })).toBe(false);
  });
});

describe('parsearEventos', () => {
  it('traduce los acuses de entrega y de lectura que traen mids', () => {
    const payload = webhookIg([
      { sender: { id: CLIENTE }, delivery: { mids: ['m1', 'm2'], watermark: 1 } },
      { sender: { id: CLIENTE }, read: { mids: ['m1'], watermark: 1 } },
    ]);
    expect(parsearEventos(payload, cfgIg)).toEqual([
      { kind: 'acuse', externalId: 'm1', status: 'delivered' },
      { kind: 'acuse', externalId: 'm2', status: 'delivered' },
      { kind: 'acuse', externalId: 'm1', status: 'read' },
    ]);
  });

  it('una marca de agua sin mids no inventa acuses', () => {
    const payload = webhookIg([{ sender: { id: CLIENTE }, read: { watermark: 1_780_000_000_000 } }]);
    expect(parsearEventos(payload, cfgIg)).toEqual([]);
  });

  it('respeta el guardia igual que los mensajes', () => {
    const ajena = webhookIg([{ delivery: { mids: ['m1'] } }], '99999999999999');
    expect(parsearEventos(ajena, cfgIg)).toEqual([]);
  });
});

describe('entrantesParaVentana', () => {
  it('un mensaje del cliente abre la ventana', () => {
    const r = entrantesParaVentana({ channelId: 'c1', cfg: cfgIg, payload: webhookIg([dm()]) });
    expect(r).toEqual([{ address: CLIENTE, cuando: new Date(1_780_000_000_000).toISOString() }]);
  });

  it('nuestro propio saliente NO la abre', () => {
    // Es la razón por la que no vale `threads.last_message_at`: esa columna se
    // mueve también con los salientes, y contestar no renueva la ventana.
    const eco = {
      sender: { id: IG_ID },
      recipient: { id: CLIENTE },
      message: { mid: 'e', text: 'ya te contesté', is_echo: true },
    };
    expect(entrantesParaVentana({ channelId: 'c1', cfg: cfgIg, payload: webhookIg([eco]) })).toEqual(
      [],
    );
  });

  it('un postback también la abre: tocar un botón es escribir', () => {
    const tap = { sender: { id: CLIENTE }, postback: { mid: 'p', title: 'Hola' }, timestamp: 1_780_000_000_000 };
    const r = entrantesParaVentana({ channelId: 'c1', cfg: cfgIg, payload: webhookIg([tap]) });
    expect(r).toHaveLength(1);
  });
});
