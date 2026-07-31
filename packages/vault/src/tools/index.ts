/**
 * Las tools que la bóveda le presta a los agentes.
 *
 * H3 es dueño del motor y del registro; cada handoff registra las suyas desde
 * su propio paquete — así nadie edita un archivo central. Estas dos son de H4.
 *
 * ── Por qué existen si el prompt ya lleva la bóveda inyectada ───────────────
 *
 * `injectIntoPrompt` mete los valores GENERALES. Pero un agente de Ventas
 * hablando de un área concreta necesita el valor de ESA área, y meter todos
 * los alcances en cada prompt sería caro y confuso.
 *
 * Y hay algo más importante: `vault_value` le da al agente una forma de
 * DECIR QUE NO SABE. Cuando la tool devuelve `found: false`, el agente tiene
 * una respuesta honesta a la mano en lugar de la tentación de estimar. Eso es
 * más útil que cualquier instrucción en el prompt.
 */
import { tryPort } from '@abraxa/db';
import type { AgentTool, TenantContext } from '@abraxa/db';
import { buscar } from '../documents/search';
import { getVaultValue } from '../resolver';

export const vaultValueTool: AgentTool = {
  name: 'vault_value',
  description:
    'Consulta un valor oficial del negocio (precio, comisión, plazo, política) por su clave. ' +
    'Úsala SIEMPRE antes de decir una cifra que no esté en el bloque de datos vigentes. ' +
    'Si devuelve found=false, di que no tienes ese dato; NO lo estimes.',
  inputSchema: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description: 'Clave en snake_case. Ej: ticket_promedio, comision_pct, horario_atencion.',
      },
      area: {
        type: 'string',
        description:
          'Área del negocio, si el valor puede cambiar según el área. Opcional.',
      },
    },
    required: ['key'],
  },
  async handler(ctx: TenantContext, input: Record<string, unknown>): Promise<unknown> {
    const key = String(input.key ?? '').trim();
    if (!key) return { found: false, error: 'Falta la clave.' };
    const area = input.area == null ? null : String(input.area);
    return getVaultValue(ctx, key, { area });
  },
};

export const vaultSearchTool: AgentTool = {
  name: 'vault_search',
  description:
    'Busca en los documentos del negocio (procesos, políticas, guiones, contratos) por ' +
    'significado. Úsala cuando te pregunten algo que debería estar escrito en la ' +
    'documentación del negocio y no lo tengas en tu contexto.',
  inputSchema: {
    type: 'object',
    properties: {
      consulta: { type: 'string', description: 'Qué buscar, en lenguaje natural.' },
      limite: { type: 'number', description: 'Máximo de resultados. Por defecto 5.' },
    },
    required: ['consulta'],
  },
  async handler(ctx: TenantContext, input: Record<string, unknown>): Promise<unknown> {
    const consulta = String(input.consulta ?? '').trim();
    if (!consulta) return { hits: [] };
    const limiteCrudo = Number(input.limite);
    const limite = Number.isFinite(limiteCrudo) ? limiteCrudo : 5;

    const r = await buscar(ctx, consulta, { limite });
    return {
      hits: r.hits.map((h) => ({
        documento: h.title || h.documentId,
        fragmento: h.excerpt,
        relevancia: Number(h.score.toFixed(3)),
      })),
      // Si la búsqueda salió degradada, el agente debe saberlo para no afirmar
      // "no existe" cuando en realidad "no se pudo buscar bien".
      nota: r.semanticaDegradada ? r.motivoDegradacion : undefined,
    };
  },
};

export const VAULT_TOOLS: readonly AgentTool[] = [vaultValueTool, vaultSearchTool];

/**
 * Registra las tools si H3 ya aterrizó.
 *
 * `tryPort` en vez de `usePort` a propósito: en la ola 1 H3 y H4 corren en
 * paralelo, así que el motor de agentes puede no existir todavía. Que la
 * bóveda no arranque por eso sería exactamente el acoplamiento que el registro
 * de ports existe para evitar.
 */
export function registrarTools(): { registradas: number; motivo: string } {
  const agents = tryPort('agents');
  if (!agents) {
    return {
      registradas: 0,
      motivo: 'El motor de agentes (H3) todavía no está registrado; se reintenta al arrancar.',
    };
  }
  for (const tool of VAULT_TOOLS) agents.registerTool(tool);
  return { registradas: VAULT_TOOLS.length, motivo: '' };
}
