/**
 * La matriz por modelo, y la prueba que evita el 400 de Haiku.
 *
 * Esta suite no verifica un criterio del handoff: verifica que el motor no se
 * caiga en la primera llamada de producción. `sales`, `service` y `social`
 * corren en Haiku 4.5, que rechaza `output_config.effort` con un 400.
 */
import { describe, expect, it } from 'vitest';
import { CAPS_CONSERVADORAS, capsFor, esConocido, modelosConocidos } from './capabilities';

describe('capacidades por modelo', () => {
  it('Haiku 4.5 NO acepta effort — es el 400 que tumba a los tres sub-agentes', () => {
    expect(capsFor('claude-haiku-4-5').effort).toBe(false);
  });

  it('Sonnet 5 y Opus 5 sí aceptan effort', () => {
    expect(capsFor('claude-sonnet-5').effort).toBe(true);
    expect(capsFor('claude-opus-5').effort).toBe(true);
  });

  it('Sonnet 5 piensa por omisión: hay que apagarlo explícitamente', () => {
    const c = capsFor('claude-sonnet-5');
    expect(c.thinking).toBe('adaptive');
    expect(c.thinkingOnByDefault).toBe(true);
  });

  it('Haiku 4.5 usa el estilo viejo de thinking, no el adaptativo', () => {
    expect(capsFor('claude-haiku-4-5').thinking).toBe('budget');
  });

  it('el mínimo cacheable NO crece con la generación — por eso está tabulado', () => {
    // Si se pudiera inferir del nombre, este archivo no existiría.
    expect(capsFor('claude-opus-5').cacheMinTokens).toBe(512);
    expect(capsFor('claude-sonnet-5').cacheMinTokens).toBe(1024);
    expect(capsFor('claude-haiku-4-5').cacheMinTokens).toBe(4096);

    // El modelo más nuevo tiene el mínimo MÁS BAJO y el de más volumen el más
    // alto: exactamente al revés de lo que uno supondría.
    expect(capsFor('claude-opus-5').cacheMinTokens).toBeLessThan(
      capsFor('claude-haiku-4-5').cacheMinTokens,
    );
  });

  it('Haiku 4.5 tiene ventana y salida más chicas: pedirle 128k es un 400 evitable', () => {
    expect(capsFor('claude-haiku-4-5').contextWindow).toBe(200_000);
    expect(capsFor('claude-haiku-4-5').maxOutputTokens).toBe(64_000);
    expect(capsFor('claude-sonnet-5').maxOutputTokens).toBe(128_000);
  });

  it('un modelo desconocido cae en el perfil conservador, no en suposiciones', () => {
    const c = capsFor('modelo-que-no-existe');
    expect(c).toBe(CAPS_CONSERVADORAS);
    expect(c.effort).toBe(false);
    expect(c.thinking).toBe('none');
    // Falla hacia "no cachea": contar de más, nunca de menos.
    expect(c.cacheMinTokens).toBe(4096);
    expect(esConocido('modelo-que-no-existe')).toBe(false);
  });

  it('normaliza los ids de OpenRouter (prefijo y puntos) al mismo modelo', () => {
    const porOpenRouter = capsFor('anthropic/claude-haiku-4.5', 'openrouter');
    const directo = capsFor('claude-haiku-4-5');
    expect(porOpenRouter).toBe(directo);
    expect(porOpenRouter.effort).toBe(false);
  });

  it('ningún modelo del catálogo se queda sin sus cinco campos críticos', () => {
    for (const m of modelosConocidos()) {
      const c = capsFor(m);
      expect(c.cacheMinTokens, m).toBeGreaterThan(0);
      expect(c.contextWindow, m).toBeGreaterThan(0);
      expect(c.maxOutputTokens, m).toBeGreaterThan(0);
      expect(typeof c.effort, m).toBe('boolean');
      expect(['adaptive', 'budget', 'none'], m).toContain(c.thinking);
    }
  });
});
