/**
 * Los diez nodos, contra dobles. Sin base, sin llaves y sin red.
 *
 * La primera prueba es la que sostiene la ley de GARDEN que este carril hereda:
 * **la UI no promete ningún nodo que el worker no corra**. Si alguien agrega un
 * nodo al catálogo y no lo implementa, falla aquí y no en producción.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { __clearPorts } from '@abraxa/db';
import { PlatformError } from '@abraxa/db';
import { CATALOGO } from '../catalog';
import { contextoDePrueba } from '../testing/fake-db';
import { registrarTodo } from '../testing/dobles';
import type { DoblesRegistrados } from '../testing/dobles';
import { ejecutarNodo, esTransitorio } from './nodes';
import type { EntornoDeNodo } from './nodes';
import type { FlowNode } from '../types';

const CONTACTO = 'c-ana';
const WHATSAPP = '+528146811675';
const ctx = contextoDePrueba('t-uno');

let dobles: DoblesRegistrados;

function entorno(extra: Partial<EntornoDeNodo> = {}): EntornoDeNodo {
  return {
    ctx,
    run: { id: 'r1', contactId: CONTACTO, context: { contactId: CONTACTO }, isTest: false },
    vars: { nombre: 'Ana', responsable: 'ana@abraxa.club', etapa: 'nuevo' },
    ahora: new Date('2026-07-31T12:00:00.000Z'),
    fetch: () => Promise.reject(new Error('esta prueba no debería llamar a la red')),
    yaCompletado: false,
    ...extra,
  };
}

const nodo = (type: FlowNode['type'], config: Record<string, unknown> = {}): FlowNode => ({
  id: `n-${type}`,
  type,
  data: { config },
});

beforeEach(() => {
  __clearPorts();
  dobles = registrarTodo({
    contactos: [{ id: CONTACTO, firstName: 'Ana', whatsapp: WHATSAPP, stage: 'nuevo' }],
    equipo: ['ana@abraxa.club', 'beto@abraxa.club'],
    respuestaDelAgente: 'Este lead pinta bien.',
  });
});

// ════════════════════════════════════════════════════════════════════════════

describe('la ley: la UI no promete nada que el worker no corra', () => {
  it('todo nodo del catálogo tiene ejecución de verdad', async () => {
    const sinImplementar: string[] = [];

    for (const def of CATALOGO) {
      // Config mínima válida para cada tipo, sólo para llegar al `case`.
      const configs: Record<string, Record<string, unknown>> = {
        send_message: { channel: 'whatsapp', template: 'hola' },
        wait: { minutes: 5 },
        condition: { field: 'etapa', op: 'eq', value: 'nuevo' },
        assign_owner: { owner_email: 'ana@abraxa.club' },
        move_stage: { stage: 'contactado' },
        add_tag: { tag: 'x' },
        create_task: { title: 'llamar' },
        webhook: { url: 'https://ejemplo.mx/x' },
        ai_step: { prompt: 'resume' },
      };

      const r = await ejecutarNodo(
        nodo(def.tipo, configs[def.tipo] ?? {}),
        entorno({ fetch: () => Promise.resolve(new Response('{}', { status: 200 })) }),
      );

      // Un tipo sin `case` caería al comportamiento por defecto; lo que se
      // exige es que ninguno responda "no sé qué es esto".
      if (String(r.output?.razon ?? '').includes('desconocido')) sinImplementar.push(def.tipo);
    }

    expect(sinImplementar).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════

describe('send_message', () => {
  it('le escribe al contacto por su identidad de ese canal', async () => {
    const r = await ejecutarNodo(
      nodo('send_message', { channel: 'whatsapp', to: 'contact', template: 'Hola {nombre}' }),
      entorno(),
    );
    expect(r.status).toBe('ok');
    expect(dobles.bandeja.envios[0]).toMatchObject({ address: WHATSAPP, body: 'Hola Ana' });
  });

  it('NO manda si el nodo ya se había completado (guard de doble envío)', async () => {
    const r = await ejecutarNodo(
      nodo('send_message', { channel: 'whatsapp', template: 'Hola' }),
      entorno({ yaCompletado: true }),
    );
    expect(r.status).toBe('ok');
    expect(r.output?.reenvioEvitado).toBe(true);
    expect(dobles.bandeja.envios).toHaveLength(0);
  });

  it('se salta —no falla— si el contacto no tiene ese canal', async () => {
    const r = await ejecutarNodo(
      nodo('send_message', { channel: 'sms', template: 'Hola' }),
      entorno(),
    );
    expect(r.status).toBe('skipped');
    expect(String(r.output?.razon)).toContain('sms');
  });

  it('un mensaje que queda vacío no se manda', async () => {
    const r = await ejecutarNodo(
      nodo('send_message', { channel: 'whatsapp', template: '{inventada}' }),
      entorno(),
    );
    expect(r.status).toBe('skipped');
    expect(dobles.bandeja.envios).toHaveLength(0);
  });

  it('acepta una dirección fija con address:', async () => {
    await ejecutarNodo(
      nodo('send_message', { channel: 'whatsapp', to: 'address:+525512345678', template: 'aviso' }),
      entorno(),
    );
    expect(dobles.bandeja.envios[0]?.address).toBe('+525512345678');
  });

  it('canal caído → PAUSA; número inválido → MUERE', async () => {
    dobles.bandeja.fallarSiguiente('transitorio');
    const pausa = await ejecutarNodo(
      nodo('send_message', { channel: 'whatsapp', template: 'Hola' }),
      entorno(),
    );
    expect(pausa.status).toBe('paused');

    dobles.bandeja.sanar();
    dobles.bandeja.fallarSiguiente('permanente');
    const muerte = await ejecutarNodo(
      nodo('send_message', { channel: 'whatsapp', template: 'Hola' }),
      entorno(),
    );
    expect(muerte.status).toBe('failed');
  });
});

// ════════════════════════════════════════════════════════════════════════════

describe('condition', () => {
  const casos: Array<[string, Record<string, unknown>, 'yes' | 'no']> = [
    ['igual', { field: 'etapa', op: 'eq', value: 'nuevo' }, 'yes'],
    ['distinto', { field: 'etapa', op: 'eq', value: 'ganado' }, 'no'],
    ['negación', { field: 'etapa', op: 'neq', value: 'ganado' }, 'yes'],
    ['contiene', { field: 'nombre', op: 'contains', value: 'an' }, 'yes'],
    ['en lista', { field: 'etapa', op: 'in', value: 'nuevo, ganado' }, 'yes'],
    ['tiene algo', { field: 'responsable', op: 'not_empty' }, 'yes'],
    ['está vacío', { field: 'inexistente', op: 'empty' }, 'yes'],
  ];

  for (const [que, config, rama] of casos) {
    it(`${que} → rama "${rama}"`, async () => {
      const r = await ejecutarNodo(nodo('condition', config), entorno());
      expect(r.nextHandle).toBe(rama);
    });
  }

  it('un campo que sólo vive en el payload del evento también se puede comparar', async () => {
    const r = await ejecutarNodo(
      nodo('condition', { field: 'origen', op: 'eq', value: 'facebook' }),
      entorno({ run: { id: 'r1', contactId: CONTACTO, context: { origen: 'facebook' }, isTest: false } }),
    );
    expect(r.nextHandle).toBe('yes');
  });
});

// ════════════════════════════════════════════════════════════════════════════

describe('los nodos de CRM', () => {
  it('add_tag etiqueta, y dos veces no vuelve a contar como nueva', async () => {
    const primera = await ejecutarNodo(nodo('add_tag', { tag: 'vip' }), entorno());
    expect(primera.output?.nueva).toBe(true);
    expect(dobles.crm.etiquetasDe(CONTACTO)).toContain('vip');

    const segunda = await ejecutarNodo(nodo('add_tag', { tag: 'vip' }), entorno());
    // `nueva: false` es lo que impide la cascada infinita entre dos flujos que
    // se etiquetan mutuamente.
    expect(segunda.output?.nueva).toBe(false);
  });

  it('move_stage mueve, y avisa cuando ya estaba ahí', async () => {
    const r = await ejecutarNodo(nodo('move_stage', { stage: 'contactado' }), entorno());
    expect(r.status).toBe('ok');
    expect(r.output?.movido).toBe(true);

    const otra = await ejecutarNodo(nodo('move_stage', { stage: 'contactado' }), entorno());
    expect(otra.output?.movido).toBe(false);
  });

  it('move_stage a una etapa que no existe falla con su razón', async () => {
    const r = await ejecutarNodo(nodo('move_stage', { stage: 'inventada' }), entorno());
    expect(r.status).toBe('failed');
    expect(r.error).toContain('inventada');
  });

  it('assign_owner asigna a quien se le diga', async () => {
    await ejecutarNodo(nodo('assign_owner', { owner_email: 'beto@abraxa.club' }), entorno());
    expect(dobles.crm.responsableDe(CONTACTO)).toBe('beto@abraxa.club');
  });

  it('repartir entre el equipo es estable: el mismo contacto, el mismo responsable', async () => {
    await ejecutarNodo(nodo('assign_owner', { pool: 'equipo' }), entorno());
    const primero = dobles.crm.responsableDe(CONTACTO);
    await ejecutarNodo(nodo('assign_owner', { pool: 'equipo' }), entorno());
    expect(dobles.crm.responsableDe(CONTACTO)).toBe(primero);
    expect(['ana@abraxa.club', 'beto@abraxa.club']).toContain(primero);
  });

  it('sin contacto, los nodos de CRM se saltan en vez de reventar', async () => {
    const sinContacto = entorno({ run: { id: 'r1', contactId: null, context: {}, isTest: false } });
    for (const tipo of ['add_tag', 'move_stage', 'assign_owner'] as const) {
      const r = await ejecutarNodo(nodo(tipo, { tag: 'x', stage: 'contactado', owner_email: 'a@b.c' }), sinContacto);
      expect(r.status).toBe('skipped');
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════

describe('create_task y ai_step', () => {
  it('create_task resuelve las variables del título', async () => {
    const r = await ejecutarNodo(
      nodo('create_task', { title: 'Llamar a {nombre}', assign_to: 'owner', due_in_min: 120 }),
      entorno(),
    );
    expect(r.status).toBe('ok');
    expect(dobles.tareas.creadas[0]).toMatchObject({
      title: 'Llamar a Ana',
      assignedTo: 'ana@abraxa.club',
    });
  });

  it('ai_step deja la respuesta en la ficha del contacto', async () => {
    const r = await ejecutarNodo(nodo('ai_step', { prompt: 'Resume a {nombre}' }), entorno());
    expect(r.status).toBe('ok');
    expect(r.output?.texto).toContain('pinta bien');
    expect(dobles.crm.eventos.some((e) => e.summary.includes('pinta bien'))).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════

describe('webhook', () => {
  it('llama y da por bueno un 2xx', async () => {
    let llamada: { url: string; init?: RequestInit } | null = null;
    const r = await ejecutarNodo(
      nodo('webhook', { url: 'https://ejemplo.mx/hook', method: 'POST' }),
      entorno({
        fetch: ((url: string, init?: RequestInit) => {
          llamada = { url, init };
          return Promise.resolve(new Response('{}', { status: 200 }));
        }) as unknown as typeof globalThis.fetch,
      }),
    );
    expect(r.status).toBe('ok');
    expect(llamada!.url).toBe('https://ejemplo.mx/hook');
    // No sigue redirecciones: es la forma barata de terminar apuntando adentro.
    expect(llamada!.init?.redirect).toBe('error');
  });

  it('BLOQUEA la red interna aunque el flujo se haya guardado antes de la regla', async () => {
    let seLlamo = false;
    const r = await ejecutarNodo(
      nodo('webhook', { url: 'http://169.254.169.254/latest/meta-data/' }),
      entorno({
        fetch: (() => {
          seLlamo = true;
          return Promise.resolve(new Response('{}'));
        }) as unknown as typeof globalThis.fetch,
      }),
    );
    expect(r.status).toBe('failed');
    expect(r.error).toContain('interna o privada');
    expect(seLlamo).toBe(false); // ni siquiera se intentó
  });

  it('un 5xx del sistema del cliente PAUSA; un 4xx MATA', async () => {
    const con = (status: number) =>
      ejecutarNodo(
        nodo('webhook', { url: 'https://ejemplo.mx/hook' }),
        entorno({
          fetch: (() =>
            Promise.resolve(new Response('', { status }))) as unknown as typeof globalThis.fetch,
        }),
      );
    expect((await con(503)).status).toBe('paused');
    expect((await con(429)).status).toBe('paused');
    expect((await con(400)).status).toBe('failed');
    expect((await con(404)).status).toBe('failed');
  });
});

// ════════════════════════════════════════════════════════════════════════════

describe('wait, trigger y end', () => {
  it('wait duerme lo que se le pide', async () => {
    const r = await ejecutarNodo(nodo('wait', { minutes: 90 }), entorno());
    expect(r.status).toBe('waiting');
    expect(r.wakeAt).toBe('2026-07-31T13:30:00.000Z');
  });

  it('wait de cero sigue de largo', async () => {
    expect((await ejecutarNodo(nodo('wait', { minutes: 0 }), entorno())).status).toBe('ok');
  });

  it('end termina la corrida', async () => {
    expect((await ejecutarNodo(nodo('end'), entorno())).exit).toBe(true);
  });

  it('trigger no hace nada', async () => {
    expect((await ejecutarNodo(nodo('trigger'), entorno())).status).toBe('ok');
  });
});

// ════════════════════════════════════════════════════════════════════════════

describe('esTransitorio — esperar o morir', () => {
  it('lo marcado como reintentable espera', () => {
    expect(esTransitorio(new PlatformError('RATE_LIMITED', 'calma', { retryable: true }))).toBe(true);
  });

  it('lo permanente muere', () => {
    expect(esTransitorio(new PlatformError('VALIDATION', 'mal', { retryable: false }))).toBe(false);
  });

  it('un port que falta espera: es un merge pendiente, no un flujo roto', () => {
    expect(esTransitorio(new PlatformError('PORT_NOT_IMPLEMENTED', 'falta H6'))).toBe(true);
  });

  it('un tropiezo de red espera', () => {
    expect(esTransitorio(new Error('fetch failed'))).toBe(true);
    expect(esTransitorio(new Error('The operation was aborted due to timeout'))).toBe(true);
  });

  it('un error cualquiera NO se asume transitorio', () => {
    expect(esTransitorio(new Error('undefined is not a function'))).toBe(false);
  });
});
