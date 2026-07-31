/**
 * El cerebro del motor, probado sin base, sin cola y sin red.
 *
 * Aquí viven los criterios #5 (reintentar no duplica) y #6 (pausa y reanuda)
 * en su forma pura: si estas pruebas pasan, la lógica es correcta
 * independientemente de qué haya al otro lado de Postgres.
 */
import { describe, expect, it } from 'vitest';
import { MAX_PASOS, decidirAntes, decidirDespues, primerNodo } from './decision';
import type { EstadoDeCorrida } from './decision';
import type { FlowDefinition, FlowNode } from '../types';

const DEF: FlowDefinition = {
  nodes: [
    { id: 'inicio', type: 'trigger' },
    { id: 'saludo', type: 'send_message' },
    { id: 'si', type: 'condition' },
    { id: 'a', type: 'add_tag' },
    { id: 'b', type: 'add_tag' },
    { id: 'fin', type: 'end' },
  ],
  edges: [
    { source: 'inicio', target: 'saludo' },
    { source: 'saludo', target: 'si' },
    { source: 'si', target: 'a', sourceHandle: 'yes' },
    { source: 'si', target: 'b', sourceHandle: 'no' },
    { source: 'a', target: 'fin' },
  ],
};

const nodo = (id: string): FlowNode => DEF.nodes.find((n) => n.id === id)!;

const estado = (extra: Partial<EstadoDeCorrida> = {}): EstadoDeCorrida => ({
  runId: 'r1',
  status: 'running',
  currentNode: 'saludo',
  nodeId: 'saludo',
  pasosDados: 0,
  definition: DEF,
  nodoYaCompletado: false,
  ...extra,
});

describe('decidirAntes — el fence de idempotencia (criterio #5)', () => {
  it('ejecuta cuando el puntero apunta a este nodo', () => {
    expect(decidirAntes(estado()).accion).toBe('ejecutar');
  });

  it('IGNORA un job cuyo nodo ya fue superado — es el reintento viejo de la cola', () => {
    // El caso real: el mensaje salió, encolar el siguiente falló, pg-boss
    // reintentó el actual. Ejecutarlo mandaría el WhatsApp por segunda vez.
    const r = decidirAntes(estado({ currentNode: 'si', nodeId: 'saludo' }));
    expect(r.accion).toBe('ignorar');
    expect(r.accion === 'ignorar' && r.razon).toContain('obsoleto');
  });

  it('ignora si la corrida ya terminó', () => {
    for (const status of ['completed', 'error', 'exited'] as const) {
      expect(decidirAntes(estado({ status })).accion).toBe('ignorar');
    }
  });

  it('ejecuta una corrida pausada: es la reanudación del criterio #6', () => {
    expect(decidirAntes(estado({ status: 'paused' })).accion).toBe('ejecutar');
  });

  it('mata la corrida al pasar el tope anti-bucle', () => {
    const r = decidirAntes(estado({ pasosDados: MAX_PASOS }));
    expect(r.accion).toBe('terminar');
    expect(r.accion === 'terminar' && r.status).toBe('error');
  });

  it('cierra limpio si el nodo desapareció porque alguien editó el flujo', () => {
    const r = decidirAntes(estado({ nodeId: 'ya-no-existe', currentNode: 'ya-no-existe' }));
    expect(r.accion).toBe('terminar');
    expect(r.accion === 'terminar' && r.status).toBe('completed');
  });

  it('un puntero nulo (corrida recién nacida) deja ejecutar', () => {
    expect(decidirAntes(estado({ currentNode: null })).accion).toBe('ejecutar');
  });
});

describe('decidirDespues — avanzar, ramificar, pausar, morir', () => {
  it('avanza por la única salida', () => {
    const r = decidirDespues(estado(), nodo('saludo'), { status: 'ok' });
    expect(r.accion).toBe('avanzar');
    expect(r.accion === 'avanzar' && r.siguiente).toBe('si');
  });

  it('toma la rama del SÍ y la del NO según nextHandle', () => {
    const e = estado({ nodeId: 'si', currentNode: 'si' });
    const si = decidirDespues(e, nodo('si'), { status: 'ok', nextHandle: 'yes' });
    const no = decidirDespues(e, nodo('si'), { status: 'ok', nextHandle: 'no' });
    expect(si.accion === 'avanzar' && si.siguiente).toBe('a');
    expect(no.accion === 'avanzar' && no.siguiente).toBe('b');
  });

  it('la rama SIN conectar TERMINA la corrida — no cae a la primera salida', () => {
    // El defecto de GARDEN: un contacto que NO cumplía la condición recibía
    // la rama del sí. Mensajes reales al cliente equivocado.
    const def: FlowDefinition = {
      nodes: DEF.nodes,
      edges: [{ source: 'si', target: 'a', sourceHandle: 'yes' }],
    };
    const r = decidirDespues(
      estado({ definition: def, nodeId: 'si', currentNode: 'si' }),
      nodo('si'),
      { status: 'ok', nextHandle: 'no' },
    );
    expect(r.accion).toBe('terminar');
    expect(r.accion === 'terminar' && r.status).toBe('completed');
  });

  it('PAUSA sin escribir paso: al reanudar se re-ejecuta este mismo nodo (criterio #6)', () => {
    const r = decidirDespues(estado(), nodo('saludo'), {
      status: 'paused',
      output: { razon: 'el canal no está disponible' },
    });
    expect(r.accion).toBe('pausar');
    // No hay `paso` que registrar: eso es lo que impide que una espera larga
    // le gaste los 100 pasos a la corrida.
    expect('paso' in r).toBe(false);
  });

  it('un fallo permanente mata la corrida y deja el porqué', () => {
    const r = decidirDespues(estado(), nodo('saludo'), { status: 'failed', error: 'número inválido' });
    expect(r.accion).toBe('terminar');
    expect(r.accion === 'terminar' && r.status).toBe('error');
    expect(r.accion === 'terminar' && r.error).toContain('número inválido');
  });

  it('el nodo de terminar sale con `exited`', () => {
    const r = decidirDespues(estado({ nodeId: 'fin' }), nodo('fin'), { status: 'ok', exit: true });
    expect(r.accion === 'terminar' && r.status).toBe('exited');
  });

  it('un nodo sin salida cierra la corrida como completada', () => {
    const r = decidirDespues(estado({ nodeId: 'b' }), nodo('b'), { status: 'ok' });
    expect(r.accion === 'terminar' && r.status).toBe('completed');
  });

  it('esperar deja la corrida en waiting con su hora de despertar', () => {
    const hasta = '2026-08-01T10:00:00.000Z';
    const r = decidirDespues(estado(), nodo('saludo'), { status: 'waiting', wakeAt: hasta });
    expect(r.accion === 'avanzar' && r.status).toBe('waiting');
    expect(r.accion === 'avanzar' && r.wakeAt).toBe(hasta);
  });

  it('un paso saltado NO mata la corrida: sigue adelante', () => {
    const r = decidirDespues(estado(), nodo('saludo'), {
      status: 'skipped',
      output: { razon: 'el contacto no tiene whatsapp' },
    });
    expect(r.accion).toBe('avanzar');
  });
});

describe('primerNodo', () => {
  it('es lo que sigue después del disparador', () => {
    expect(primerNodo(DEF)).toBe('saludo');
  });

  it('es null si el disparador no lleva a ningún lado', () => {
    expect(primerNodo({ nodes: [{ id: 'inicio', type: 'trigger' }], edges: [] })).toBeNull();
  });
});
