/**
 * Lo que de verdad se le manda a Anthropic.
 *
 * La prueba central de este archivo NO es qué contestó el modelo: es qué campos
 * llevaba el cuerpo. El 400 de Haiku ocurre por un campo de más, y el
 * sobrecosto de Sonnet 5 por uno de menos. Los dos son invisibles si sólo se
 * afirma sobre la respuesta.
 */
import { describe, expect, it } from 'vitest';
import { createAnthropicAdapter } from './anthropic';
import { createFakeFetch } from '../testing/fakes';
import type { CompletionRequest } from './types';

const RESPUESTA_OK = {
  id: 'msg_abc123',
  model: 'claude-haiku-4-5',
  content: [{ type: 'text', text: 'Abrimos de 9 a 7.' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 1200, output_tokens: 40 },
};

function peticion(model: string, extra: Partial<CompletionRequest> = {}): CompletionRequest {
  return {
    model,
    system: 'Eres el agente de ventas.',
    messages: [{ role: 'user', content: '¿a qué hora abren?' }],
    tools: [],
    maxOutputTokens: 4096,
    cachePrefix: false,
    apiKey: 'llave-de-prueba',
    ...extra,
  };
}

describe('adaptador de Anthropic — armado del cuerpo', () => {
  it('a Haiku 4.5 NO le manda output_config: es el 400 que tumba producción', async () => {
    const f = createFakeFetch(RESPUESTA_OK);
    await createAnthropicAdapter(f.impl).complete(peticion('claude-haiku-4-5'));

    expect(f.cuerpos[0]).not.toHaveProperty('output_config');
  });

  it('a Sonnet 5 sí le manda output_config.effort', async () => {
    const f = createFakeFetch({ ...RESPUESTA_OK, model: 'claude-sonnet-5' });
    await createAnthropicAdapter(f.impl).complete(peticion('claude-sonnet-5'));

    expect(f.cuerpos[0]?.output_config).toEqual({ effort: 'medium' });
  });

  it('a Sonnet 5 le APAGA el thinking, que viene encendido por omisión', async () => {
    const f = createFakeFetch({ ...RESPUESTA_OK, model: 'claude-sonnet-5' });
    await createAnthropicAdapter(f.impl).complete(peticion('claude-sonnet-5'));

    // Sin esta línea, cada mensaje de un cliente final paga razonamiento que
    // nadie pidió y max_tokens cubre thinking + texto, así que además trunca.
    expect(f.cuerpos[0]?.thinking).toEqual({ type: 'disabled' });
  });

  it('a Haiku 4.5 no le manda thinking en absoluto (no entiende el adaptativo)', async () => {
    const f = createFakeFetch(RESPUESTA_OK);
    await createAnthropicAdapter(f.impl).complete(peticion('claude-haiku-4-5'));

    expect(f.cuerpos[0]).not.toHaveProperty('thinking');
  });

  it('recorta max_tokens al techo del modelo: 128k a Haiku es un 400 evitable', async () => {
    const f = createFakeFetch(RESPUESTA_OK);
    await createAnthropicAdapter(f.impl).complete(
      peticion('claude-haiku-4-5', { maxOutputTokens: 128_000 }),
    );

    expect(f.cuerpos[0]?.max_tokens).toBe(64_000);
  });

  it('manda las cabeceras de autenticación de la Messages API', async () => {
    const f = createFakeFetch(RESPUESTA_OK);
    await createAnthropicAdapter(f.impl).complete(peticion('claude-haiku-4-5'));

    const h = f.headers[0] ?? {};
    expect(h['x-api-key']).toBe('llave-de-prueba');
    expect(h['anthropic-version']).toBe('2023-06-01');
  });
});

describe('adaptador de Anthropic — caché de prompt', () => {
  it('con cachePrefix, el system va como bloque con cache_control', async () => {
    const f = createFakeFetch(RESPUESTA_OK);
    await createAnthropicAdapter(f.impl).complete(
      peticion('claude-haiku-4-5', { cachePrefix: true }),
    );

    const system = f.cuerpos[0]?.system as Array<Record<string, unknown>>;
    expect(system[0]?.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('sin cachePrefix, el bloque va sin cache_control', async () => {
    const f = createFakeFetch(RESPUESTA_OK);
    await createAnthropicAdapter(f.impl).complete(
      peticion('claude-haiku-4-5', { cachePrefix: false }),
    );

    const system = f.cuerpos[0]?.system as Array<Record<string, unknown>>;
    expect(system[0]).not.toHaveProperty('cache_control');
  });
});

describe('adaptador de Anthropic — lectura del consumo', () => {
  it('lee los cuatro conceptos de tokens, que se cobran distinto', async () => {
    const f = createFakeFetch({
      ...RESPUESTA_OK,
      usage: {
        input_tokens: 300,
        output_tokens: 50,
        cache_read_input_tokens: 4000,
        cache_creation_input_tokens: 0,
      },
    });

    const r = await createAnthropicAdapter(f.impl).complete(peticion('claude-haiku-4-5'));

    expect(r.usage.inputTokens).toBe(300);
    expect(r.usage.outputTokens).toBe(50);
    expect(r.usage.cacheReadTokens).toBe(4000);
    expect(r.usage.requestId).toBe('msg_abc123');
  });

  it('Anthropic NO reporta costo — por eso existe app.model_pricing', async () => {
    const f = createFakeFetch(RESPUESTA_OK);
    const r = await createAnthropicAdapter(f.impl).complete(peticion('claude-haiku-4-5'));

    expect(r.usage.providerCostUsd).toBeNull();
  });

  it('sin desglose por TTL, la escritura de caché se asigna a 5 minutos', async () => {
    const f = createFakeFetch({
      ...RESPUESTA_OK,
      usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 4200 },
    });

    const r = await createAnthropicAdapter(f.impl).complete(peticion('claude-haiku-4-5'));

    expect(r.usage.cacheWrite5mTokens).toBe(4200);
    expect(r.usage.cacheWrite1hTokens).toBe(0);
  });

  it('con desglose por TTL, respeta cada cubo (cuestan 1.25x y 2x)', async () => {
    const f = createFakeFetch({
      ...RESPUESTA_OK,
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_creation_input_tokens: 5000,
        cache_creation: { ephemeral_5m_input_tokens: 1000, ephemeral_1h_input_tokens: 4000 },
      },
    });

    const r = await createAnthropicAdapter(f.impl).complete(peticion('claude-haiku-4-5'));

    expect(r.usage.cacheWrite5mTokens).toBe(1000);
    expect(r.usage.cacheWrite1hTokens).toBe(4000);
  });
});

describe('adaptador de Anthropic — errores', () => {
  it('un 429 se marca reintentable; un 400 no', async () => {
    const f429 = createFakeFetch({ error: 'rate limited' }, 429);
    await expect(
      createAnthropicAdapter(f429.impl).complete(peticion('claude-haiku-4-5')),
    ).rejects.toMatchObject({ code: 'PROVIDER_ERROR', retryable: true });

    const f400 = createFakeFetch({ error: 'bad request' }, 400);
    await expect(
      createAnthropicAdapter(f400.impl).complete(peticion('claude-haiku-4-5')),
    ).rejects.toMatchObject({ code: 'PROVIDER_ERROR', retryable: false });
  });
});
