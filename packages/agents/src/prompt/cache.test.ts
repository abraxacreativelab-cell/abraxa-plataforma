/**
 * Criterio #4, la mitad que se puede verificar sin llave.
 *
 * La otra mitad —`cache_read_input_tokens > 0` contra la API real— vive en
 * `src/bin/measure-cache.ts` y necesita `ANTHROPIC_API_KEY`. Estimar y medir
 * son cosas distintas y confundirlas es justo el error que este handoff viene a
 * no repetir: aquí se decide si vale la pena PEDIR el caché; allá se comprueba
 * si de verdad ocurrió.
 */
import { describe, expect, it } from 'vitest';
import { decidirCache, estimarTokens, estimarTokensPrefijo } from './cache';
import type { ToolSpec } from '../providers/types';

const texto = (tokens: number): string => 'a'.repeat(Math.ceil(tokens * 3.5));

const tool = (nombre: string, campos: number): ToolSpec => ({
  name: nombre,
  description: `Herramienta ${nombre} para el agente`,
  inputSchema: {
    type: 'object',
    properties: Object.fromEntries(
      Array.from({ length: campos }, (_, i) => [
        `campo_${i}`,
        { type: 'string', description: `Descripción del campo ${i} de la herramienta` },
      ]),
    ),
  },
});

describe('estimación de tokens', () => {
  it('estima por caracteres, sobreestimando a propósito', () => {
    // Sobreestimar cuesta 1.25x una vez; subestimar tira el 90% de ahorro en
    // todas las llamadas siguientes.
    expect(estimarTokens('a'.repeat(3500))).toBe(1000);
  });

  it('un texto vacío es cero', () => {
    expect(estimarTokens('')).toBe(0);
  });
});

describe('el mínimo cubre el PREFIJO COMPLETO, no sólo el system prompt', () => {
  it('las tools cuentan para el mínimo', () => {
    const system = texto(2000);
    const soloSystem = estimarTokensPrefijo(system, []);
    const conTools = estimarTokensPrefijo(system, [tool('a', 8), tool('b', 8)]);

    expect(conTools).toBeGreaterThan(soloSystem);
  });

  it('un sub-agente de Haiku puede cruzar los 4,096 con tools, sin alargar el prompt', () => {
    // Éste es el hallazgo práctico: la reacción natural al criterio #4 es
    // inflar el prompt. No siempre hace falta.
    const system = texto(2000);

    const sinTools = decidirCache(system, [], 'claude-haiku-4-5');
    expect(sinTools.pedirCache).toBe(false);

    const muchasTools = Array.from({ length: 10 }, (_, i) => tool(`t${i}`, 12));
    const conTools = decidirCache(system, muchasTools, 'claude-haiku-4-5');
    expect(conTools.pedirCache).toBe(true);
    expect(conTools.tokensEstimados).toBeGreaterThanOrEqual(4096);
  });
});

describe('decisión de caché por modelo', () => {
  it('un prompt de ~2,000 tokens SÍ cachea en Sonnet 5 y NO en Haiku 4.5', () => {
    const system = texto(2000);

    // El mismo prompt, distinto resultado. Por eso el mínimo está tabulado por
    // modelo y no es una constante del paquete.
    expect(decidirCache(system, [], 'claude-sonnet-5').pedirCache).toBe(true);
    expect(decidirCache(system, [], 'claude-haiku-4-5').pedirCache).toBe(false);
  });

  it('un prompt de ~700 tokens cachea en Opus 5 (mínimo 512) y en nada más', () => {
    const system = texto(700);

    expect(decidirCache(system, [], 'claude-opus-5').pedirCache).toBe(true);
    expect(decidirCache(system, [], 'claude-sonnet-5').pedirCache).toBe(false);
    expect(decidirCache(system, [], 'claude-haiku-4-5').pedirCache).toBe(false);
  });

  it('cuando no alcanza, la razón dice qué hacer', () => {
    const d = decidirCache(texto(100), [], 'claude-haiku-4-5');

    expect(d.pedirCache).toBe(false);
    expect(d.minimoDelModelo).toBe(4096);
    // El mensaje tiene que servirle a quien lo lea en el log a las 3 a.m.
    expect(d.razon).toContain('4096');
    expect(d.razon).toContain('tools');
  });

  it('un modelo desconocido no promete caché', () => {
    // Falla hacia "no cachea": si el prefijo no llega al mínimo más alto que
    // conocemos, no se promete nada.
    expect(decidirCache(texto(2000), [], 'modelo-inventado').pedirCache).toBe(false);
  });

  it('reporta los números para poder auditarlos, no sólo el sí/no', () => {
    const d = decidirCache(texto(5000), [], 'claude-haiku-4-5');
    expect(d.pedirCache).toBe(true);
    expect(d.tokensEstimados).toBeGreaterThan(4096);
    expect(d.minimoDelModelo).toBe(4096);
  });
});
