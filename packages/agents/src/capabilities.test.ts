/**
 * La matriz por modelo, y la prueba que evita el 400 de Haiku.
 *
 * Esta suite no verifica un criterio del handoff: verifica que el motor no se
 * caiga en la primera llamada de producción. `sales`, `service` y `social`
 * corren en Haiku 4.5, que rechaza `output_config.effort` con un 400.
 */
import { describe, expect, it } from 'vitest';
import {
  CAPS_CONSERVADORAS,
  canonizarModelo,
  capsFor,
  dialectoValido,
  esConocido,
  modelosConocidos,
} from './capabilities';
import { modeloPermitido } from './providers/allowlist';

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

  // ══════════════════════════════════════════════════════════════════════════
  //  El proveedor no es decorativo (hallazgo 2026-07-31)
  // ══════════════════════════════════════════════════════════════════════════

  it('un id de Anthropic bajo openrouter NO es conocido: ese modelo no existe ahí', () => {
    // Ésta es la línea del hallazgo. `capsFor` hacía hit directo en
    // CATALOGO[model] ignorando el proveedor, así que la pareja rota respondía
    // `esConocido() === true` y ninguna señal se encendía — mientras OpenRouter
    // devolvía `400 not a valid model ID` en CADA mensaje de ese rol.
    expect(esConocido('claude-haiku-4-5', 'openrouter')).toBe(false);
    expect(capsFor('claude-haiku-4-5', 'openrouter')).toBe(CAPS_CONSERVADORAS);
  });

  it('y al revés: un id de OpenRouter bajo anthropic tampoco', () => {
    expect(esConocido('anthropic/claude-haiku-4.5', 'anthropic')).toBe(false);
    expect(capsFor('anthropic/claude-haiku-4.5', 'anthropic')).toBe(CAPS_CONSERVADORAS);
  });

  it('el par válido sí resuelve al mismo modelo por los dos caminos', () => {
    expect(esConocido('claude-haiku-4-5', 'anthropic')).toBe(true);
    expect(esConocido('anthropic/claude-haiku-4.5', 'openrouter')).toBe(true);
  });

  describe('dialectoValido — más laxo que esConocido, y a propósito', () => {
    it('acepta un modelo de OpenRouter que NO está en el catálogo', () => {
      // El dialecto valida la FORMA del id, no que el modelo esté tabulado. Si
      // la validación de escritura exigiera `esConocido`, estrenar un modelo
      // pediría un deploy — que es exactamente lo que H3 vino a matar.
      expect(dialectoValido('anthropic/claude-opus-6', 'openrouter')).toBe(true);
      expect(esConocido('anthropic/claude-opus-6', 'openrouter')).toBe(false);
    });

    it('el dialecto NO opina sobre el proveedor: para eso está la lista blanca', () => {
      // `deepseek/deepseek-chat` es un id de OpenRouter perfectamente formado, y
      // `dialectoValido` dice que sí — correctamente. Lo que lo detiene es la
      // lista blanca de `providers/allowlist.ts`, que es una frontera de DATOS
      // (dónde se procesa la conversación), no de sintaxis. Confundir las dos
      // puertas es lo que dejó entrar esas corridas al ledger.
      expect(dialectoValido('deepseek/deepseek-chat', 'openrouter')).toBe(true);
      expect(modeloPermitido('deepseek/deepseek-chat', 'openrouter')).toBe(false);
    });

    it('rechaza el par que el proveedor contesta con 400', () => {
      expect(dialectoValido('claude-haiku-4-5', 'openrouter')).toBe(false);
      expect(dialectoValido('anthropic/claude-haiku-4.5', 'anthropic')).toBe(false);
    });

    it('acepta un modelo de Anthropic que todavía no conocemos', () => {
      // La fila de DB manda: un modelo nuevo tiene que poder configurarse el
      // día que sale, sin tocar este archivo.
      expect(dialectoValido('claude-opus-6', 'anthropic')).toBe(true);
    });

    it("no opina sobre 'local': ese runtime todavía no existe", () => {
      expect(dialectoValido('llama-propio', 'local')).toBe(true);
      expect(dialectoValido('meta-llama/Llama-3-8B', 'local')).toBe(true);
    });

    it('rechaza los ids degenerados que pasaban por la puerta de atrás', () => {
      // `''` no trae barra, así que pasaba como id válido de Anthropic; `'x/'`
      // sí la trae, así que pasaba como id válido de OpenRouter. Los dos son un
      // 400 del proveedor en el siguiente mensaje del cliente final.
      for (const p of ['anthropic', 'openrouter', 'local'] as const) {
        expect(dialectoValido('', p), `'' con ${p}`).toBe(false);
        expect(dialectoValido('   ', p), `espacios con ${p}`).toBe(false);
      }
      expect(dialectoValido('x/', 'openrouter')).toBe(false);
      expect(dialectoValido('/x', 'openrouter')).toBe(false);
      expect(dialectoValido('/', 'openrouter')).toBe(false);
    });
  });

  it('canonizarModelo traduce el id de OpenRouter y rechaza el que no es suyo', () => {
    expect(canonizarModelo('anthropic/claude-haiku-4.5', 'openrouter')).toBe('claude-haiku-4-5');
    expect(canonizarModelo('claude-haiku-4-5', 'anthropic')).toBe('claude-haiku-4-5');
    expect(canonizarModelo('claude-haiku-4-5', 'openrouter')).toBeNull();
    expect(canonizarModelo('anthropic/claude-haiku-4.5', 'anthropic')).toBeNull();
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
