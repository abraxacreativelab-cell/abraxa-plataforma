/**
 * El adaptador de OpenRouter, y lo único que de verdad lo distingue: sí reporta
 * el costo real de la llamada.
 *
 * Ésa es la razón por la que `usage_ledger.cost_source` existe. Sin esa columna
 * no habría forma de saber, viendo una fila, si el número lo dijo el proveedor
 * o lo calculamos nosotros contra una tabla que pudo quedar vieja.
 */
import { describe, expect, it } from 'vitest';
import { createOpenRouterAdapter } from './openrouter';
import { createFakeFetch } from '../testing/fakes';
import type { CompletionRequest } from './types';

const RESPUESTA = {
  id: 'gen-abc',
  model: 'anthropic/claude-haiku-4.5',
  choices: [{ message: { content: 'Abrimos de 9 a 7.' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1200, completion_tokens: 40, cost: 0.00136 },
};

const peticion = (extra: Partial<CompletionRequest> = {}): CompletionRequest => ({
  model: 'anthropic/claude-haiku-4.5',
  system: 'Eres el agente de ventas.',
  messages: [{ role: 'user', content: '¿a qué hora abren?' }],
  tools: [],
  maxOutputTokens: 4096,
  cachePrefix: false,
  apiKey: 'llave',
  ...extra,
});

describe('adaptador de OpenRouter', () => {
  it('pide el costo con usage.include — una línea, y cambia todo', async () => {
    const f = createFakeFetch(RESPUESTA);
    await createOpenRouterAdapter(f.impl).complete(peticion());

    // Sin esto, la respuesta no trae `usage.cost` y todo cae a 'priced'.
    expect(f.cuerpos[0]?.usage).toEqual({ include: true });
  });

  it('lee el costo REAL reportado por el proveedor', async () => {
    const f = createFakeFetch(RESPUESTA);
    const r = await createOpenRouterAdapter(f.impl).complete(peticion());

    expect(r.usage.providerCostUsd).toBe(0.00136);
  });

  it('separa los tokens cacheados del input, porque se cobran distinto', async () => {
    const f = createFakeFetch({
      ...RESPUESTA,
      usage: {
        prompt_tokens: 1200,
        completion_tokens: 40,
        prompt_tokens_details: { cached_tokens: 1000 },
      },
    });

    const r = await createOpenRouterAdapter(f.impl).complete(peticion());

    // En el dialecto de OpenAI `prompt_tokens` INCLUYE los cacheados. Sumarlos
    // contaría 1,000 tokens dos veces.
    expect(r.usage.inputTokens).toBe(200);
    expect(r.usage.cacheReadTokens).toBe(1000);
  });

  it('el sistema va como primer mensaje, no como campo aparte', async () => {
    const f = createFakeFetch(RESPUESTA);
    await createOpenRouterAdapter(f.impl).complete(peticion());

    const msgs = f.cuerpos[0]?.messages as Array<Record<string, unknown>>;
    expect(msgs[0]).toEqual({ role: 'system', content: 'Eres el agente de ventas.' });
  });

  it('traduce las tools al formato de función de OpenAI', async () => {
    const f = createFakeFetch(RESPUESTA);
    await createOpenRouterAdapter(f.impl).complete(
      peticion({
        tools: [{ name: 'buscar', description: 'busca', inputSchema: { type: 'object' } }],
      }),
    );

    const tools = f.cuerpos[0]?.tools as Array<Record<string, unknown>>;
    expect(tools[0]).toEqual({
      type: 'function',
      function: { name: 'buscar', description: 'busca', parameters: { type: 'object' } },
    });
  });

  it('argumentos de tool mal formados no tumban la corrida', async () => {
    const f = createFakeFetch({
      ...RESPUESTA,
      choices: [
        {
          message: {
            content: null,
            tool_calls: [{ id: 't1', function: { name: 'buscar', arguments: '{roto' } }],
          },
          finish_reason: 'tool_calls',
        },
      ],
    });

    const r = await createOpenRouterAdapter(f.impl).complete(peticion());

    // La tool recibe {} , falla con su propio mensaje, y el modelo se corrige.
    expect(r.toolCalls[0]?.input).toEqual({});
    expect(r.stopReason).toBe('tool_use');
  });

  it('recorta max_tokens al techo del modelo aunque venga con prefijo', async () => {
    const f = createFakeFetch(RESPUESTA);
    await createOpenRouterAdapter(f.impl).complete(peticion({ maxOutputTokens: 128_000 }));

    // `anthropic/claude-haiku-4.5` se normaliza a claude-haiku-4-5 → 64k.
    expect(f.cuerpos[0]?.max_tokens).toBe(64_000);
  });
});
