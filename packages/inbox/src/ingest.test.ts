/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Los criterios observables de H6, de punta a punta y sin base viva.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Lo único que NO se puede verificar aquí es el criterio #1 con un WhatsApp de
 *  verdad y una llave de Anthropic de verdad — eso necesita a Santiago
 *  despierto. Todo lo demás corre en CI: la cadena completa desde el webhook
 *  hasta el saliente, con dobles en las dos puntas.
 *
 *  El driver de estas pruebas NO es WhatsApp a propósito (criterio #6): si algo
 *  del núcleo asumiera JIDs o instancias de Evolution, este archivo se caería.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __setClientForTests, PlatformError } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import { contextoDeCanal } from './context';
import { __clearDrivers, registerDriver } from './drivers/registry';
import { ingerirWebhook } from './ingest';
import { verHilo, listarHilos } from './inbox/queries';
import { createFakeDb, type FakeDb } from './testing/fake-db';
import { createFakeAgents, createFakeDriver, type DriverFalso } from './testing/fake-driver';
import type { ChannelRow, MessageRow, ThreadRow } from './types';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

/**
 * Un canal — y SU FILA en la base.
 *
 * Las dos cosas, porque el webhook trae el canal como objeto pero la respuesta
 * del agente sale por `enviarEnHilo`, que vuelve a LEER la fila para saber por
 * qué driver despacharla. Un canal que sólo existe como objeto de JavaScript
 * hace que el puente falle con `NOT_FOUND` — que es exactamente lo que pasaría
 * en producción con una fila borrada, y no lo que estas pruebas quieren medir.
 */
function canal(sobre: Partial<ChannelRow> = {}): ChannelRow {
  const fila: ChannelRow = {
    id: 'canal-a',
    tenant_id: TENANT_A,
    type: 'sms',
    driver: 'falso',
    name: 'Línea principal',
    config: { webhook_token: 'secreto' },
    external_id: null,
    status: 'active',
    agent_role: 'sales',
    ai_enabled: true,
    business_hours: {},
    ai_outside_hours: true,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    ...sobre,
  };

  const otras = db.tabla('channels').filter((f) => f.id !== fila.id);
  db.sembrar('channels', [...otras, fila as unknown as Record<string, unknown>]);
  return fila;
}

function sobreCon(mensajes: Array<Record<string, unknown>>, channelId = 'canal-a'): {
  channelId: string;
  payload: unknown;
} {
  return { channelId, payload: { mensajes } };
}

let db: FakeDb;
let restaurar: () => void;
let driver: DriverFalso;

beforeEach(() => {
  db = createFakeDb();
  restaurar = __setClientForTests(db.client);
  __clearDrivers();
  driver = createFakeDriver({ type: 'sms' });
  registerDriver(driver);
});

afterEach(() => {
  restaurar();
  __clearDrivers();
});

/** El `_ctx` se pasa en las llamadas sólo para que se lea de qué empresa se
 *  está hablando; el doble guarda todo junto y el aislamiento lo prueban las
 *  consultas reales (`listarHilos`, `verHilo`), no este helper. */
const mensajes = (_ctx?: TenantContext): MessageRow[] =>
  db.tabla('messages') as unknown as MessageRow[];
const hilos = (): ThreadRow[] => db.tabla('threads') as unknown as ThreadRow[];

// ════════════════════════════════════════════════════════════════════════════
describe('el puente agente↔inbox', () => {
  it('un mensaje entra, el agente contesta y la respuesta sale por el mismo canal', async () => {
    const c = canal();
    const agents = createFakeAgents(() => 'Abrimos de 9 a 6, ¿te ayudo con algo más?');

    const r = await ingerirWebhook(c, sobreCon([{ address: '+525512345678', body: '¿a qué hora abren?', externalId: 'ext-1', contactName: 'Ana' }]), { agents });

    expect(r.mensajes).toHaveLength(1);
    expect(r.mensajes[0]?.ai?.outcome).toBe('answered');
    expect(r.mensajes[0]?.ai?.replyText).toBe('Abrimos de 9 a 6, ¿te ayudo con algo más?');

    // Salió por el driver, a la misma dirección por la que entró.
    expect(driver.enviados).toEqual([
      {
        channelId: 'canal-a',
        address: '+525512345678',
        body: 'Abrimos de 9 a 6, ¿te ayudo con algo más?',
        media: undefined,
      },
    ]);

    // Y quedó en el historial marcada como de la IA.
    const todos = mensajes(contextoDeCanal(c));
    expect(todos).toHaveLength(2);
    const salida = todos.find((m) => m.direction === 'out');
    expect(salida?.ai_generated).toBe(true);
    expect(salida?.author).toBeNull();
    expect(salida?.status).toBe('sent');
  });

  // ── Criterio #2 · trazabilidad hilo ↔ costo ─────────────────────────────
  it('SIEMPRE le pasa threadId al agente — sin eso se pierde el costo por hilo', async () => {
    const agents = createFakeAgents();
    const r = await ingerirWebhook(
      canal(),
      sobreCon([{ address: '+525512345678', body: 'hola', externalId: 'ext-1' }]),
      { agents },
    );

    expect(agents.llamadas).toHaveLength(1);
    expect(agents.llamadas[0]?.threadId).toBe(r.mensajes[0]?.threadId);
    expect(agents.llamadas[0]?.threadId).toBeTruthy();
    expect(agents.llamadas[0]?.role).toBe('sales');
  });

  it('usa el agente que el canal tenga configurado, no uno fijo', async () => {
    const agents = createFakeAgents();
    await ingerirWebhook(
      canal({ agent_role: 'service' }),
      sobreCon([{ address: '+525512345678', body: 'mi pedido llegó roto', externalId: 'ext-1' }]),
      { agents },
    );
    expect(agents.llamadas[0]?.role).toBe('service');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Criterio #4 · un webhook repetido no duplica ni contesta dos veces
// ════════════════════════════════════════════════════════════════════════════
describe('idempotencia', () => {
  it('el mismo webhook dos veces: un mensaje, una respuesta', async () => {
    const c = canal();
    const agents = createFakeAgents();
    const sobre = sobreCon([{ address: '+525512345678', body: 'hola', externalId: 'ext-1' }]);

    const primera = await ingerirWebhook(c, sobre, { agents });
    const segunda = await ingerirWebhook(c, sobre, { agents });

    expect(primera.mensajes[0]?.duplicado).toBe(false);
    expect(segunda.mensajes[0]?.duplicado).toBe(true);

    // Un entrante + una respuesta. Ni uno más.
    expect(mensajes(contextoDeCanal(c))).toHaveLength(2);
    expect(agents.llamadas).toHaveLength(1);
    expect(driver.enviados).toHaveLength(1);
  });

  it('tres entregas del mismo lote dejan el hilo idéntico', async () => {
    const c = canal();
    const agents = createFakeAgents();
    const sobre = sobreCon([
      { address: '+525512345678', body: 'uno', externalId: 'ext-1' },
      { address: '+525512345678', body: 'dos', externalId: 'ext-2' },
    ]);

    await ingerirWebhook(c, sobre, { agents });
    await ingerirWebhook(c, sobre, { agents });
    await ingerirWebhook(c, sobre, { agents });

    const entrantes = mensajes(contextoDeCanal(c)).filter((m) => m.direction === 'in');
    expect(entrantes.map((m) => m.external_id).sort()).toEqual(['ext-1', 'ext-2']);
    expect(agents.llamadas).toHaveLength(2);
  });

  it('dos mensajes del mismo número van al MISMO hilo', async () => {
    const c = canal();
    const agents = createFakeAgents();
    await ingerirWebhook(c, sobreCon([{ address: '+525512345678', body: 'uno', externalId: 'a' }]), { agents });
    await ingerirWebhook(c, sobreCon([{ address: '+525512345678', body: 'dos', externalId: 'b' }]), { agents });
    expect(hilos()).toHaveLength(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Criterio #3 · un humano escribe y la IA se calla. NO SE NEGOCIA.
// ════════════════════════════════════════════════════════════════════════════
describe('cuando un humano toma el hilo', () => {
  it('la IA deja de contestar en ese hilo', async () => {
    const c = canal();
    const agents = createFakeAgents();
    const ctx = contextoDeCanal(c);

    // 1. Llega un mensaje y el agente contesta.
    const r1 = await ingerirWebhook(c, sobreCon([{ address: '+525512345678', body: 'hola', externalId: 'ext-1' }]), { agents });
    expect(r1.mensajes[0]?.ai?.outcome).toBe('answered');

    // 2. El dueño escribe en el hilo desde la bandeja.
    const { enviarEnHilo } = await import('./inbox/service');
    await enviarEnHilo(ctx, {
      threadId: r1.mensajes[0]!.threadId!,
      body: 'Yo te atiendo, Ana.',
      author: 'santiago@abraxa.club',
    });

    // El hilo quedó tomado.
    expect(hilos()[0]?.assigned_to).toBe('santiago@abraxa.club');

    // 3. El cliente responde. La IA ya no se mete.
    const r2 = await ingerirWebhook(c, sobreCon([{ address: '+525512345678', body: '¿y el precio?', externalId: 'ext-2' }]), { agents });

    expect(r2.mensajes[0]?.ai?.outcome).toBe('skipped');
    expect(r2.mensajes[0]?.ai?.reason).toMatch(/tomaste esta conversación/i);
    expect(agents.llamadas).toHaveLength(1); // sólo la primera vez
  });

  it('la respuesta de la IA no marca el hilo como tomado por un humano', async () => {
    const c = canal();
    const agents = createFakeAgents();
    await ingerirWebhook(c, sobreCon([{ address: '+525512345678', body: 'hola', externalId: 'ext-1' }]), { agents });
    expect(hilos()[0]?.assigned_to).toBeNull();
  });

  it('al soltar el hilo, la IA vuelve', async () => {
    const c = canal();
    const agents = createFakeAgents();
    const ctx = contextoDeCanal(c);
    const { createInboxService, enviarEnHilo } = await import('./inbox/service');
    const inbox = createInboxService();

    const r1 = await ingerirWebhook(c, sobreCon([{ address: '+525512345678', body: 'hola', externalId: 'ext-1' }]), { agents });
    const threadId = r1.mensajes[0]!.threadId!;

    await enviarEnHilo(ctx, { threadId, body: 'yo sigo', author: 'santiago@abraxa.club' });
    await inbox.assign(ctx, { threadId, userEmail: null });

    const r2 = await ingerirWebhook(c, sobreCon([{ address: '+525512345678', body: 'sigo aquí', externalId: 'ext-2' }]), { agents });
    expect(r2.mensajes[0]?.ai?.outcome).toBe('answered');
  });

  it('el interruptor de IA por hilo la calla y la vuelve a encender', async () => {
    const c = canal();
    const agents = createFakeAgents();
    const ctx = contextoDeCanal(c);
    const { createInboxService } = await import('./inbox/service');
    const inbox = createInboxService();

    const r1 = await ingerirWebhook(c, sobreCon([{ address: '+525512345678', body: 'hola', externalId: 'ext-1' }]), { agents });
    const threadId = r1.mensajes[0]!.threadId!;

    await inbox.setAiEnabled(ctx, { threadId, enabled: false });
    const r2 = await ingerirWebhook(c, sobreCon([{ address: '+525512345678', body: 'otra', externalId: 'ext-2' }]), { agents });
    expect(r2.mensajes[0]?.ai?.outcome).toBe('skipped');

    await inbox.setAiEnabled(ctx, { threadId, enabled: true });
    const r3 = await ingerirWebhook(c, sobreCon([{ address: '+525512345678', body: 'tercera', externalId: 'ext-3' }]), { agents });
    expect(r3.mensajes[0]?.ai?.outcome).toBe('answered');
  });

  it('encender la IA limpia una pausa vigente', async () => {
    const c = canal();
    const agents = createFakeAgents();
    const ctx = contextoDeCanal(c);
    const { createInboxService, parchearHilo } = await import('./inbox/service');
    const inbox = createInboxService();

    const r1 = await ingerirWebhook(c, sobreCon([{ address: '+525512345678', body: 'hola', externalId: 'ext-1' }]), { agents });
    const threadId = r1.mensajes[0]!.threadId!;

    await parchearHilo(ctx, threadId, {
      ai_enabled: false,
      ai_paused_until: '2099-01-01T00:00:00Z',
    });
    await inbox.setAiEnabled(ctx, { threadId, enabled: true });

    expect(hilos()[0]?.ai_paused_until).toBeNull();
    const r2 = await ingerirWebhook(c, sobreCon([{ address: '+525512345678', body: 'otra', externalId: 'ext-2' }]), { agents });
    expect(r2.mensajes[0]?.ai?.outcome).toBe('answered');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Criterio #5 · si el agente falla, el mensaje queda marcado. Sin disculpas.
// ════════════════════════════════════════════════════════════════════════════
describe('cuando el agente falla', () => {
  it('no manda nada y deja el mensaje marcado con el motivo', async () => {
    const c = canal();
    const agents = {
      async run(): Promise<never> {
        throw new PlatformError('BUDGET_EXCEEDED', 'El tenant se pasó de su tope del mes');
      },
    };

    const r = await ingerirWebhook(
      c,
      sobreCon([{ address: '+525512345678', body: 'hola', externalId: 'ext-1' }]),
      { agents: agents as never },
    );

    expect(r.mensajes[0]?.ai?.outcome).toBe('failed');

    // NADA salió al cliente. Un silencio es mejor que un robot roto.
    expect(driver.enviados).toHaveLength(0);
    const todos = mensajes(contextoDeCanal(c));
    expect(todos).toHaveLength(1);
    expect(todos[0]?.direction).toBe('in');

    // Y quedó marcado, con el código del error para saber a quién llamar.
    expect(todos[0]?.ai_outcome).toBe('failed');
    expect(todos[0]?.ai_reason).toContain('BUDGET_EXCEEDED');
  });

  it('un agente que devuelve texto vacío tampoco manda una burbuja vacía', async () => {
    const c = canal();
    const agents = createFakeAgents(() => '   ');
    const r = await ingerirWebhook(c, sobreCon([{ address: '+525512345678', body: 'hola', externalId: 'ext-1' }]), { agents });

    expect(r.mensajes[0]?.ai?.outcome).toBe('failed');
    expect(driver.enviados).toHaveLength(0);
  });

  it('si el canal se cae al entregar la respuesta, queda visible como fallida', async () => {
    const c = canal();
    const agents = createFakeAgents(() => 'aquí va la respuesta');
    driver.fallarSiguienteEnvio(new PlatformError('CHANNEL_ERROR', 'línea desconectada'));

    const r = await ingerirWebhook(c, sobreCon([{ address: '+525512345678', body: 'hola', externalId: 'ext-1' }]), { agents });

    expect(r.mensajes[0]?.ai?.outcome).toBe('failed');
    const salida = mensajes(contextoDeCanal(c)).find((m) => m.direction === 'out');
    // El texto NO se pierde: el emprendedor puede leerlo y reenviarlo a mano.
    expect(salida?.body).toBe('aquí va la respuesta');
    expect(salida?.status).toBe('failed');
    expect(salida?.error).toContain('línea desconectada');
  });

  it('un mensaje que reventó no tumba a los demás del mismo lote', async () => {
    const c = canal();
    const agents = createFakeAgents();
    const r = await ingerirWebhook(
      c,
      sobreCon([
        { address: '', body: 'sin dirección', externalId: 'ext-malo' },
        { address: '+525512345678', body: 'bueno', externalId: 'ext-bueno' },
      ]),
      { agents },
    );

    expect(r.mensajes).toHaveLength(1);
    expect(r.mensajes[0]?.externalId).toBe('ext-bueno');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Criterio #7 · un tenant no ve nada del otro
// ════════════════════════════════════════════════════════════════════════════
describe('aislamiento entre empresas', () => {
  it('los hilos y mensajes de una empresa no aparecen en la bandeja de la otra', async () => {
    const agents = createFakeAgents();
    const canalA = canal({ id: 'canal-a', tenant_id: TENANT_A });
    const canalB = canal({ id: 'canal-b', tenant_id: TENANT_B, name: 'Línea de la otra empresa' });

    await ingerirWebhook(canalA, sobreCon([{ address: '+525511111111', body: 'soy cliente de A', externalId: 'a-1' }], 'canal-a'), { agents });
    await ingerirWebhook(canalB, sobreCon([{ address: '+525522222222', body: 'soy cliente de B', externalId: 'b-1' }], 'canal-b'), { agents });

    const ctxA = contextoDeCanal(canalA);
    const ctxB = contextoDeCanal(canalB);

    const deA = await listarHilos(ctxA);
    const deB = await listarHilos(ctxB);

    expect(deA).toHaveLength(1);
    expect(deB).toHaveLength(1);
    expect(deA[0]?.address).toBe('+525511111111');
    expect(deB[0]?.address).toBe('+525522222222');
  });

  it('B no puede abrir un hilo de A ni por id', async () => {
    const agents = createFakeAgents();
    const canalA = canal({ id: 'canal-a', tenant_id: TENANT_A });
    const r = await ingerirWebhook(canalA, sobreCon([{ address: '+525511111111', body: 'privado', externalId: 'a-1' }]), { agents });
    const hiloDeA = r.mensajes[0]!.threadId!;

    await expect(verHilo(contextoDeCanal(canal({ tenant_id: TENANT_B })), hiloDeA)).rejects.toThrow(
      /no encontrado/i,
    );
  });

  it('dos empresas con el MISMO número de cliente tienen hilos separados', async () => {
    const agents = createFakeAgents();
    const canalA = canal({ id: 'canal-a', tenant_id: TENANT_A });
    const canalB = canal({ id: 'canal-b', tenant_id: TENANT_B });
    const mismoNumero = [{ address: '+525599999999', body: 'hola', externalId: 'x' }];

    await ingerirWebhook(canalA, sobreCon(mismoNumero, 'canal-a'), { agents });
    await ingerirWebhook(canalB, sobreCon([{ ...mismoNumero[0]!, externalId: 'y' }], 'canal-b'), { agents });

    expect(hilos()).toHaveLength(2);
    expect(await listarHilos(contextoDeCanal(canalA))).toHaveLength(1);
    expect(await listarHilos(contextoDeCanal(canalB))).toHaveLength(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Criterio #8 · horario de atención
// ════════════════════════════════════════════════════════════════════════════
describe('horario de atención', () => {
  const nueveASeis = {
    tz: 'America/Mexico_City',
    semana: { vie: [['09:00', '18:00']] as Array<[string, string]> },
  };

  it('fuera de horario con silencio pedido: se guarda el mensaje pero no contesta', async () => {
    const c = canal({ business_hours: nueveASeis, ai_outside_hours: false });
    const agents = createFakeAgents();

    const r = await ingerirWebhook(
      c,
      sobreCon([{ address: '+525512345678', body: 'hola a medianoche', externalId: 'ext-1' }]),
      { agents, ahora: new Date('2026-07-31T06:00:00Z') }, // viernes 00:00 CDMX
    );

    expect(r.mensajes[0]?.ai?.outcome).toBe('skipped');
    expect(r.mensajes[0]?.ai?.reason).toMatch(/horario/i);
    // El mensaje SÍ está en la bandeja: el emprendedor lo ve al despertar.
    expect(mensajes(contextoDeCanal(c))).toHaveLength(1);
    expect(driver.enviados).toHaveLength(0);
  });

  it('fuera de horario con la IA encendida: contesta — es la promesa del producto', async () => {
    const c = canal({ business_hours: nueveASeis, ai_outside_hours: true });
    const agents = createFakeAgents();

    const r = await ingerirWebhook(
      c,
      sobreCon([{ address: '+525512345678', body: 'hola a medianoche', externalId: 'ext-1' }]),
      { agents, ahora: new Date('2026-07-31T06:00:00Z') },
    );

    expect(r.mensajes[0]?.ai?.outcome).toBe('answered');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('ecos, acuses y estado de la línea', () => {
  it('el eco de un saliente nuestro no dispara al agente', async () => {
    const c = canal();
    const agents = createFakeAgents();
    const r = await ingerirWebhook(
      c,
      sobreCon([{ address: '+525512345678', body: 'esto lo mandamos nosotros', externalId: 'ext-1', fromMe: true }]),
      { agents },
    );

    expect(r.mensajes[0]?.ai?.outcome).toBe('skipped');
    expect(agents.llamadas).toHaveLength(0);
    const guardado = mensajes(contextoDeCanal(c))[0];
    expect(guardado?.direction).toBe('out');
    expect(guardado?.author).toBe('phone');
    // Escribir es leer: un eco propio no deja el hilo con no leídos.
    expect(hilos()[0]?.unread).toBe(0);
  });

  it('un entrante deja el hilo con no leídos y abrirlo los limpia', async () => {
    const c = canal();
    const agents = createFakeAgents();
    await ingerirWebhook(c, sobreCon([{ address: '+525512345678', body: 'hola', externalId: 'ext-1' }]), { agents, responder: false });

    expect(hilos()[0]?.unread).toBe(1);
    const ctx = contextoDeCanal(c);
    const vista = await verHilo(ctx, hilos()[0]!.id);
    expect(vista.thread.unread).toBe(0);
  });

  it('un acuse actualiza el estado del saliente, no del entrante', async () => {
    const c = canal();
    const agents = createFakeAgents();
    await ingerirWebhook(c, sobreCon([{ address: '+525512345678', body: 'hola', externalId: 'ext-1' }]), { agents });

    const salida = mensajes(contextoDeCanal(c)).find((m) => m.direction === 'out');
    await ingerirWebhook(c, {
      channelId: 'canal-a',
      payload: { eventos: [{ kind: 'acuse', externalId: salida!.external_id, status: 'read' }] },
    });

    const despues = mensajes(contextoDeCanal(c));
    expect(despues.find((m) => m.direction === 'out')?.status).toBe('read');
    expect(despues.find((m) => m.direction === 'in')?.status).toBe('delivered');
  });

  it('un cambio de conexión actualiza el canal', async () => {
    const c = canal({ status: 'pending' });
    db.sembrar('channels', [c as unknown as Record<string, unknown>]);

    await ingerirWebhook(c, {
      channelId: 'canal-a',
      payload: { eventos: [{ kind: 'conexion', status: 'active', externalId: '+525500000000' }] },
    });

    const fila = db.tabla('channels')[0];
    expect(fila?.status).toBe('active');
    expect(fila?.external_id).toBe('+525500000000');
  });

  it('con responder:false se reprocesa sin volver a cobrarle al cliente', async () => {
    const c = canal();
    const agents = createFakeAgents();
    const r = await ingerirWebhook(c, sobreCon([{ address: '+525512345678', body: 'hola', externalId: 'ext-1' }]), { agents, responder: false });

    expect(r.mensajes[0]?.duplicado).toBe(false);
    expect(agents.llamadas).toHaveLength(0);
    expect(driver.enviados).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('el contexto sintético del webhook', () => {
  it('sale de la fila del canal y no de nada que mande quien llama', () => {
    const ctx = contextoDeCanal(canal({ tenant_id: TENANT_A }));
    expect(ctx.tenantId).toBe(TENANT_A);
    expect(ctx.userEmail).toBeNull();
    expect(ctx.role).toBeNull();
    // Deny por defecto: este contexto acota a un tenant, no autoriza a nadie.
    expect(ctx.areas).toEqual({});
  });

  it('un canal sin tenant_id no produce contexto', () => {
    expect(() => contextoDeCanal({ tenant_id: '' })).toThrow(/tenant_id/);
  });
});
