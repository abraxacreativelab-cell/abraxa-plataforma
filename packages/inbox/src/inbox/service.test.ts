/**
 * El anti-duplicado del envío, portado de GARDEN y probado de verdad.
 *
 * Las tres ramas que importan:
 *   1. `queued` ANTES de salir al canal → si el INSERT falla, no se envió nada.
 *   2. Si el canal falla, el intento queda VISIBLE como fallido.
 *   3. Si el eco `fromMe` del webhook llegó primero, el 23505 al confirmar es
 *      ÉXITO idempotente — no un 500 que provocaría un reenvío real.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __setClientForTests, PlatformError } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import { __clearDrivers, registerDriver } from '../drivers/registry';
import { createFakeDb, type FakeDb } from '../testing/fake-db';
import { createFakeDriver, type DriverFalso } from '../testing/fake-driver';
import type { MessageRow } from '../types';
import { asegurarHilo, canalParaTipo, createInboxService, enviarEnHilo, pausarIA } from './service';

const TENANT = '11111111-1111-1111-1111-111111111111';

const ctx: TenantContext = {
  tenantId: TENANT,
  tenantSlug: 'acme',
  userEmail: 'santiago@abraxa.club',
  role: 'owner',
  areas: { ventas: 'admin' },
};

const CANAL = {
  id: 'canal-a',
  tenant_id: TENANT,
  type: 'sms',
  driver: 'falso',
  name: 'Línea',
  config: {},
  external_id: null,
  status: 'active',
  agent_role: 'sales',
  ai_enabled: true,
  business_hours: {},
  ai_outside_hours: true,
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
};

let db: FakeDb;
let restaurar: () => void;
let driver: DriverFalso;

beforeEach(() => {
  db = createFakeDb({ channels: [CANAL] });
  restaurar = __setClientForTests(db.client);
  __clearDrivers();
  driver = createFakeDriver({ type: 'sms' });
  registerDriver(driver);
});

afterEach(() => {
  restaurar();
  __clearDrivers();
});

const msgs = (): MessageRow[] => db.tabla('messages') as unknown as MessageRow[];

async function hiloDePrueba(): Promise<string> {
  const canal = await canalParaTipo(ctx, 'sms');
  const hilo = await asegurarHilo(ctx, canal, { address: '+525512345678' });
  return hilo.id;
}

describe('enviarEnHilo', () => {
  it('registra `queued` antes de salir y lo confirma como `sent`', async () => {
    const threadId = await hiloDePrueba();
    const { message } = await enviarEnHilo(ctx, { threadId, body: 'hola' });

    expect(message.status).toBe('sent');
    expect(message.external_id).toBe('falso-out-1');
    expect(driver.enviados).toHaveLength(1);
    expect(msgs()).toHaveLength(1);
  });

  it('si el canal falla, el mensaje queda visible como fallido con su motivo', async () => {
    const threadId = await hiloDePrueba();
    driver.fallarSiguienteEnvio(new PlatformError('CHANNEL_ERROR', 'línea caída'));

    await expect(enviarEnHilo(ctx, { threadId, body: 'hola' })).rejects.toThrow(/línea caída/);

    const [fila] = msgs();
    expect(fila?.status).toBe('failed');
    expect(fila?.error).toContain('línea caída');
    expect(fila?.body).toBe('hola');
  });

  it('cuando el eco del webhook se adelantó, el 23505 es éxito y se devuelve el eco', async () => {
    const threadId = await hiloDePrueba();

    // El eco `fromMe` ya guardó el mensaje con el id que el driver va a
    // devolver. Confirmar el marcador chocará con el índice único.
    db.sembrar('messages', [
      {
        id: 'eco-1',
        tenant_id: TENANT,
        thread_id: threadId,
        direction: 'out',
        body: 'hola',
        media: [],
        ai_generated: false,
        author: 'phone',
        external_id: 'falso-out-1',
        status: 'sent',
        error: null,
        ai_outcome: null,
        ai_reason: null,
        created_at: '2026-07-31T00:00:00Z',
      },
    ]);

    const { message } = await enviarEnHilo(ctx, { threadId, body: 'hola' });

    // Se devuelve el eco y el marcador se quitó: un solo mensaje en el hilo.
    expect(message.id).toBe('eco-1');
    expect(msgs()).toHaveLength(1);
  });

  it('rechaza un mensaje vacío antes de tocar el canal', async () => {
    const threadId = await hiloDePrueba();
    await expect(enviarEnHilo(ctx, { threadId, body: '   ' })).rejects.toThrow(/vacío/i);
    expect(driver.enviados).toHaveLength(0);
    expect(msgs()).toHaveLength(0);
  });

  it('un hilo que no existe da 404, no un 500', async () => {
    await expect(enviarEnHilo(ctx, { threadId: 'no-existe', body: 'hola' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  // ── El contrato del port: `author` no nulo apaga la IA ────────────────────
  it('un autor humano toma el hilo', async () => {
    const threadId = await hiloDePrueba();
    await enviarEnHilo(ctx, { threadId, body: 'yo te atiendo', author: 'ana@empresa.mx' });
    expect(db.tabla('threads')[0]?.assigned_to).toBe('ana@empresa.mx');
  });

  it('un mensaje de la IA (author null) NO toma el hilo', async () => {
    const threadId = await hiloDePrueba();
    await enviarEnHilo(ctx, { threadId, body: 'respuesta', author: null, aiGenerated: true });
    expect(db.tabla('threads')[0]?.assigned_to).toBeNull();
    expect(msgs()[0]?.ai_generated).toBe(true);
  });

  it('un author vacío tampoco toma el hilo', async () => {
    const threadId = await hiloDePrueba();
    await enviarEnHilo(ctx, { threadId, body: 'x', author: '  ' });
    expect(db.tabla('threads')[0]?.assigned_to).toBeNull();
  });

  it('toma el hilo ANTES de mandar, para que un envío fallido no deje la ventana abierta', async () => {
    const threadId = await hiloDePrueba();
    driver.fallarSiguienteEnvio(new Error('se cayó'));
    await expect(
      enviarEnHilo(ctx, { threadId, body: 'yo sigo', author: 'ana@empresa.mx' }),
    ).rejects.toThrow();
    expect(db.tabla('threads')[0]?.assigned_to).toBe('ana@empresa.mx');
  });

  it('actualiza la vista previa del hilo y limpia los no leídos', async () => {
    const threadId = await hiloDePrueba();
    await enviarEnHilo(ctx, { threadId, body: 'nos vemos el martes' });
    const hilo = db.tabla('threads')[0];
    expect(hilo?.last_message).toBe('nos vemos el martes');
    expect(hilo?.last_direction).toBe('out');
    expect(hilo?.unread).toBe(0);
  });
});

describe('asegurarHilo', () => {
  it('reutiliza el hilo de la misma dirección en el mismo canal', async () => {
    const canal = await canalParaTipo(ctx, 'sms');
    const a = await asegurarHilo(ctx, canal, { address: '+525512345678' });
    const b = await asegurarHilo(ctx, canal, { address: '+525512345678' });
    expect(b.id).toBe(a.id);
    expect(db.tabla('threads')).toHaveLength(1);
  });

  it('completa el nombre del contacto cuando llega, sin pisar uno ya puesto', async () => {
    const canal = await canalParaTipo(ctx, 'sms');
    await asegurarHilo(ctx, canal, { address: '+525512345678' });
    await asegurarHilo(ctx, canal, { address: '+525512345678', contactName: 'Ana' });
    expect(db.tabla('threads')[0]?.contact_name).toBe('Ana');

    await asegurarHilo(ctx, canal, { address: '+525512345678', contactName: 'Otro' });
    expect(db.tabla('threads')[0]?.contact_name).toBe('Ana');
  });

  it('rechaza una dirección vacía', async () => {
    const canal = await canalParaTipo(ctx, 'sms');
    await expect(asegurarHilo(ctx, canal, { address: '   ' })).rejects.toThrow(/vacía/i);
  });
});

describe('canalParaTipo', () => {
  it('prefiere el canal activo', async () => {
    db.sembrar('channels', [
      { ...CANAL, id: 'caido', status: 'disconnected', created_at: '2026-01-01T00:00:00Z' },
      { ...CANAL, id: 'vivo', status: 'active', created_at: '2026-02-01T00:00:00Z' },
    ]);
    expect((await canalParaTipo(ctx, 'sms')).id).toBe('vivo');
  });

  it('sin ninguno activo devuelve el caído: el error del canal dice más', async () => {
    db.sembrar('channels', [{ ...CANAL, id: 'caido', status: 'disconnected' }]);
    expect((await canalParaTipo(ctx, 'sms')).id).toBe('caido');
  });

  it('sin ningún canal del tipo, un 409 que dice qué hacer', async () => {
    db.sembrar('channels', []);
    await expect(canalParaTipo(ctx, 'sms')).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('InboxPort', () => {
  it('startThread crea el hilo y devuelve su id', async () => {
    const inbox = createInboxService();
    const { threadId } = await inbox.startThread(ctx, {
      channelType: 'sms',
      address: '+525512345678',
    });
    expect(threadId).toBeTruthy();
    expect(db.tabla('threads')).toHaveLength(1);
  });

  it('send devuelve el id del mensaje', async () => {
    const inbox = createInboxService();
    const { threadId } = await inbox.startThread(ctx, {
      channelType: 'sms',
      address: '+525512345678',
    });
    const { messageId } = await inbox.send(ctx, { threadId, body: 'hola' });
    expect(msgs().find((m) => m.id === messageId)).toBeTruthy();
  });

  it('pausarIA pone una fecha futura y el 0 la quita', async () => {
    const threadId = await hiloDePrueba();

    const { hasta } = await pausarIA(ctx, { threadId, minutos: 60 });
    expect(Date.parse(hasta!)).toBeGreaterThan(Date.now());
    expect(db.tabla('threads')[0]?.ai_paused_until).toBe(hasta);

    await pausarIA(ctx, { threadId, minutos: 0 });
    expect(db.tabla('threads')[0]?.ai_paused_until).toBeNull();
  });

  it('pausarIA rechaza minutos que no son un número', async () => {
    const threadId = await hiloDePrueba();
    await expect(pausarIA(ctx, { threadId, minutos: -5 })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(
      pausarIA(ctx, { threadId, minutos: Number.NaN }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('encender la IA limpia la pausa; apagarla no la toca', async () => {
    const inbox = createInboxService();
    const threadId = await hiloDePrueba();

    await pausarIA(ctx, { threadId, minutos: 60 });
    await inbox.setAiEnabled(ctx, { threadId, enabled: false });
    // Apagar no borra la pausa: son dos controles distintos.
    expect(db.tabla('threads')[0]?.ai_paused_until).not.toBeNull();

    await inbox.setAiEnabled(ctx, { threadId, enabled: true });
    expect(db.tabla('threads')[0]?.ai_paused_until).toBeNull();
  });

  it('assign(null) suelta el hilo', async () => {
    const inbox = createInboxService();
    const threadId = await hiloDePrueba();
    await inbox.assign(ctx, { threadId, userEmail: 'ana@empresa.mx' });
    expect(db.tabla('threads')[0]?.assigned_to).toBe('ana@empresa.mx');
    await inbox.assign(ctx, { threadId, userEmail: null });
    expect(db.tabla('threads')[0]?.assigned_to).toBeNull();
  });
});
