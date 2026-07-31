/**
 * El agent loop, portado de GARDEN con cuatro cambios.
 *
 * Lo que se prueba aquí es sobre todo el cambio #1: el consumo se ACUMULA en
 * todas las iteraciones. Un loop que sólo cuenta la última vuelta subestima el
 * gasto justo en las conversaciones más caras, que son las que más tools usan.
 */
import { describe, expect, it } from 'vitest';
import type { TenantContext } from '@abraxa/db';
import { agentLoop } from './agent-loop';
import { ToolExecutor } from '../tools/executor';
import { ToolRegistry } from '../tools/registry';
import { createFakeAdapter, usage } from '../testing/fakes';
import { MAX_ITERACIONES } from '../config';

const ctx: TenantContext = {
  tenantId: 'T1',
  tenantSlug: 'x',
  userEmail: 'a@b.mx',
  role: 'owner',
  areas: {},
};

function opciones(adapter: ReturnType<typeof createFakeAdapter>, registry = new ToolRegistry()) {
  return {
    ctx,
    adapter,
    model: 'claude-haiku-4-5',
    apiKey: 'k',
    system: 'eres un agente',
    messages: [{ role: 'user' as const, content: 'hola' }],
    tools: [],
    maxOutputTokens: 4096,
    cachePrefix: false,
    executor: new ToolExecutor(registry),
  };
}

describe('agent loop', () => {
  it('sin tools pedidas, termina en una iteración', async () => {
    const a = createFakeAdapter('anthropic', { text: 'listo' });
    const r = await agentLoop(opciones(a));

    expect(r.text).toBe('listo');
    expect(r.iterations).toBe(1);
    expect(r.toolCalls).toHaveLength(0);
  });

  it('ACUMULA el consumo de todas las iteraciones, no sólo de la última', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'buscar',
      description: 'busca',
      inputSchema: { type: 'object', properties: {} },
      handler: () => Promise.resolve({ ok: true }),
    });

    const a = createFakeAdapter('anthropic', [
      {
        text: '',
        toolCalls: [{ id: '1', name: 'buscar', input: {} }],
        stopReason: 'tool_use',
        usage: usage({ inputTokens: 1000, outputTokens: 50 }),
      },
      { text: 'ya', usage: usage({ inputTokens: 1200, outputTokens: 80 }) },
    ]);

    const r = await agentLoop(opciones(a, registry));

    expect(r.iterations).toBe(2);
    // Si sólo contara la última vuelta, aquí habría 1200 y 80.
    expect(r.usage.inputTokens).toBe(2200);
    expect(r.usage.outputTokens).toBe(130);
  });

  it('ejecuta varias tools de una tanda EN PARALELO y devuelve los resultados juntos', async () => {
    const registry = new ToolRegistry();
    const orden: string[] = [];
    for (const n of ['a', 'b']) {
      registry.register({
        name: n,
        description: n,
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          await new Promise((r) => setTimeout(r, 10));
          orden.push(n);
          return { n };
        },
      });
    }

    const a = createFakeAdapter('anthropic', [
      {
        text: '',
        toolCalls: [
          { id: '1', name: 'a', input: {} },
          { id: '2', name: 'b', input: {} },
        ],
        stopReason: 'tool_use',
        usage: usage({ inputTokens: 10, outputTokens: 5 }),
      },
      { text: 'ya', usage: usage({ inputTokens: 10, outputTokens: 5 }) },
    ]);

    const inicio = Date.now();
    const r = await agentLoop(opciones(a, registry));
    const duracion = Date.now() - inicio;

    expect(r.toolCalls).toHaveLength(2);
    expect(orden).toHaveLength(2);
    // En serie serían ≥20ms; en paralelo, ~10. Con holgura para no ser frágil.
    expect(duracion).toBeLessThan(18);
  });

  it('respeta el tope de iteraciones y cobra TODAS las vueltas', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'ciclo',
      description: 'nunca termina',
      inputSchema: { type: 'object', properties: {} },
      handler: () => Promise.resolve({ sigue: true }),
    });

    // Siempre pide tool: es el agente dándose de topes.
    const a = createFakeAdapter('anthropic', {
      text: '',
      toolCalls: [{ id: '1', name: 'ciclo', input: {} }],
      stopReason: 'tool_use',
      usage: usage({ inputTokens: 100, outputTokens: 10 }),
    });

    const r = await agentLoop(opciones(a, registry));

    expect(r.iterations).toBe(MAX_ITERACIONES);
    // Diez vueltas se pagan aunque no llegaran a nada. El campo `iterations`
    // del ledger es lo que hace visible este caso; en GARDEN sólo dejaba una
    // línea de log.
    expect(r.usage.inputTokens).toBe(100 * MAX_ITERACIONES);
    expect(r.stopReason).toBe('max_tokens');
    expect(r.text).toContain('No pude terminar');
  });

  it('reporta el consumo por vuelta ANTES de que la siguiente pueda reventar', async () => {
    // El acumulado vive en una variable local de `agentLoop`. Si la vuelta 2
    // lanza, la 1 se va con la excepción y quien llama escribe ceros en el
    // ledger. `onUsage` empuja hacia afuera en cuanto la vuelta cierra, que es
    // lo único que sobrevive a un `throw`.
    const registry = new ToolRegistry();
    registry.register({
      name: 'buscar',
      description: 'busca',
      inputSchema: { type: 'object', properties: {} },
      handler: () => Promise.resolve({ ok: true }),
    });

    const a = createFakeAdapter('anthropic', [
      {
        text: '',
        toolCalls: [{ id: '1', name: 'buscar', input: {} }],
        stopReason: 'tool_use',
        usage: usage({ inputTokens: 120_000, outputTokens: 8_000 }),
      },
    ]);
    const original = a.complete.bind(a);
    let n = 0;
    a.complete = (req) => {
      n += 1;
      if (n >= 2) return Promise.reject(new Error('529 overloaded'));
      return original(req);
    };

    let rescatado = { inputTokens: 0, outputTokens: 0 };
    let vueltas = 0;

    await expect(
      agentLoop({
        ...opciones(a, registry),
        onUsage: (delta, acumulado) => {
          vueltas += 1;
          expect(delta.inputTokens).toBe(120_000);
          rescatado = acumulado;
        },
      }),
    ).rejects.toThrow(/529/);

    // La vuelta 1 se contabilizó; la 2 nunca reportó porque nunca respondió.
    expect(vueltas).toBe(1);
    expect(rescatado.inputTokens).toBe(120_000);
    expect(rescatado.outputTokens).toBe(8_000);
  });

  it('en el camino feliz, el acumulado del callback coincide con el que devuelve', async () => {
    // Si divergieran, quien llama tendría dos verdades sobre el mismo consumo.
    const registry = new ToolRegistry();
    registry.register({
      name: 'buscar',
      description: 'busca',
      inputSchema: { type: 'object', properties: {} },
      handler: () => Promise.resolve({ ok: true }),
    });

    const a = createFakeAdapter('anthropic', [
      {
        text: '',
        toolCalls: [{ id: '1', name: 'buscar', input: {} }],
        stopReason: 'tool_use',
        usage: usage({ inputTokens: 1000, outputTokens: 50 }),
      },
      { text: 'ya', usage: usage({ inputTokens: 1200, outputTokens: 80 }) },
    ]);

    let ultimo = usage();
    const r = await agentLoop({
      ...opciones(a, registry),
      onUsage: (_d, acumulado) => {
        ultimo = acumulado;
      },
    });

    expect(ultimo).toEqual(r.usage);
    expect(r.usage.inputTokens).toBe(2200);
  });

  it('una tool que no existe no tumba la corrida', async () => {
    const a = createFakeAdapter('anthropic', [
      {
        text: '',
        toolCalls: [{ id: '1', name: 'fantasma', input: {} }],
        stopReason: 'tool_use',
        usage: usage({ inputTokens: 10, outputTokens: 5 }),
      },
      { text: 'seguimos', usage: usage({ inputTokens: 10, outputTokens: 5 }) },
    ]);

    const r = await agentLoop(opciones(a));

    expect(r.text).toBe('seguimos');
    expect(r.toolCalls[0]?.ok).toBe(false);
  });
});
