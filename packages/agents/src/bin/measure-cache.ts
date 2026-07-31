#!/usr/bin/env tsx
/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Criterio #4 — MEDIR el caché contra la API real. No asumirlo.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  El handoff es explícito: "Mídelo, no lo asumas". Esto es la medición.
 *
 *  Qué hace, por modelo:
 *    1. Cuenta los tokens EXACTOS del prefijo con `messages.count_tokens`
 *       (no la estimación por caracteres de prompt/cache.ts).
 *    2. Manda la MISMA petición dos veces.
 *    3. Reporta `cache_creation_input_tokens` de la primera y
 *       `cache_read_input_tokens` de la segunda.
 *
 *  La segunda llamada con `cache_read_input_tokens > 0` es la evidencia. Cero
 *  significa que el prefijo no llegó al mínimo del modelo — y entonces el
 *  reporte dice cuántos tokens faltaron, para poder decidir con el número en la
 *  mano si conviene alargar el prompt o registrarle tools al agente.
 *
 *  Uso:
 *    ANTHROPIC_API_KEY=sk-... npx tsx packages/agents/src/bin/measure-cache.ts
 *
 *  Sin llave no corre. La de GARDEN NO se toma prestada: el §9.1 del plan dice
 *  "cero variables compartidas con Garden, incluida la key de Anthropic", y una
 *  medición no es excusa para cruzar esa frontera.
 */
/* eslint-disable no-console -- guion de línea de comandos: su salida ES el reporte. */
import { ANTHROPIC_BASE_URL, ANTHROPIC_VERSION } from '../config';
import { capsFor } from '../capabilities';
import { semillasPorDefecto } from '../definitions/defaults';
import { estimarTokensPrefijo } from '../prompt/cache';

const LLAVE = process.env.ANTHROPIC_API_KEY;

if (!LLAVE) {
  console.error(`
✖ Falta ANTHROPIC_API_KEY.

  Este guion mide el caché contra la API real; sin llave no hay nada que medir.
  Usa la llave de la PLATAFORMA (console.anthropic.com → 'plataforma-prod'),
  no la de GARDEN: el §9.1 del plan exige cero variables compartidas.

    ANTHROPIC_API_KEY=sk-... npx tsx packages/agents/src/bin/measure-cache.ts
`);
  process.exit(1);
}

const MODELOS = ['claude-haiku-4-5', 'claude-sonnet-5'] as const;

interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

async function contarTokens(model: string, system: unknown[], mensaje: string): Promise<number> {
  const res = await fetch(`${ANTHROPIC_BASE_URL}/v1/messages/count_tokens`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': LLAVE as string,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({ model, system, messages: [{ role: 'user', content: mensaje }] }),
  });
  if (!res.ok) throw new Error(`count_tokens ${res.status}: ${await res.text()}`);
  const d = (await res.json()) as { input_tokens: number };
  return d.input_tokens;
}

async function llamar(model: string, system: unknown[], mensaje: string): Promise<Usage> {
  const res = await fetch(`${ANTHROPIC_BASE_URL}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': LLAVE as string,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: 64,
      system,
      messages: [{ role: 'user', content: mensaje }],
      // Haiku 4.5 revienta con output_config; aquí no se manda ninguno de los
      // dos porque lo que se mide es el caché, no el razonamiento.
    }),
  });
  if (!res.ok) throw new Error(`messages ${res.status}: ${await res.text()}`);
  const d = (await res.json()) as { usage?: Usage };
  return d.usage ?? {};
}

async function medir(model: string): Promise<boolean> {
  const caps = capsFor(model);
  const semilla = semillasPorDefecto().find((s) => s.model === model) ?? semillasPorDefecto()[1];
  const prompt = semilla?.systemPrompt ?? 'Eres un agente de ventas.';

  const system = [{ type: 'text', text: prompt, cache_control: { type: 'ephemeral' } }];
  const mensaje = 'Hola, ¿a qué hora abren?';

  console.log(`\n━━━ ${model} ━━━`);
  console.log(`  mínimo cacheable del modelo : ${caps.cacheMinTokens} tokens`);

  const estimados = estimarTokensPrefijo(prompt, []);
  const exactos = await contarTokens(model, system, mensaje);
  console.log(`  estimación de prompt/cache.ts: ${estimados} tokens`);
  console.log(`  conteo EXACTO (count_tokens) : ${exactos} tokens`);
  console.log(
    `  desvío de la estimación      : ${(((estimados - exactos) / exactos) * 100).toFixed(1)}%`,
  );

  const u1 = await llamar(model, system, mensaje);
  const u2 = await llamar(model, system, mensaje);

  const escritos = u1.cache_creation_input_tokens ?? 0;
  const leidos = u2.cache_read_input_tokens ?? 0;

  console.log(`\n  1ª llamada · cache_creation_input_tokens = ${escritos}`);
  console.log(`  2ª llamada · cache_read_input_tokens     = ${leidos}`);

  if (leidos > 0) {
    console.log(`\n  ✔ EL CACHÉ FUNCIONA. ${leidos} tokens servidos a ~0.1x.`);
    return true;
  }

  const faltan = Math.max(0, caps.cacheMinTokens - exactos);
  console.log(`\n  ✖ NO CACHEÓ. El prefijo se quedó ${faltan} tokens corto.`);
  console.log(`
    Recuerda que el mínimo cubre el PREFIJO COMPLETO en orden de render
    (tools → system → messages), así que hay dos salidas y conviene medir
    antes de elegir:

      a) registrarle tools a este agente — suelen pesar más que unas líneas
         de prompt, y aportan capacidad además de tokens;
      b) alargar el system prompt hasta cruzar el mínimo.

    Y para dimensionarlo: fallar el caché no "triplica" el costo. Sin caché se
    paga 1.0x de input en CADA llamada; con caché, 1.25x una vez y 0.1x las
    siguientes. Lo que se pierde es el ahorro de ~90%.`);
  return false;
}

async function main(): Promise<void> {
  console.log('Midiendo el caché de prompt contra la API real de Anthropic.\n');
  console.log('Los sub-agentes de cara al cliente (sales/service/social) corren en');
  console.log('Haiku 4.5, cuyo mínimo cacheable es 4,096 — el más alto del catálogo.');

  const resultados: Array<[string, boolean]> = [];
  for (const m of MODELOS) {
    try {
      resultados.push([m, await medir(m)]);
    } catch (err) {
      console.error(`\n  ✖ ${m}: ${String(err)}`);
      resultados.push([m, false]);
    }
  }

  console.log('\n━━━ resumen ━━━');
  for (const [m, ok] of resultados) {
    console.log(`  ${ok ? '✔' : '✖'} ${m}`);
  }

  process.exit(resultados.every(([, ok]) => ok) ? 0 : 1);
}

void main();
