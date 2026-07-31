/**
 * ════════════════════════════════════════════════════════════════════════════
 *  BÓVEDA · Inyección de los datos vigentes al prompt de un agente.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Sin esto, un agente al que le preguntan "¿cuánto cuesta?" contesta con una
 *  cifra plausible. Plausible es exactamente el problema: nadie la detecta y
 *  el cliente final se queda con un precio que el negocio nunca cobró.
 *
 *  Hace dos cosas, en este orden:
 *    1. Renderiza los tokens {valor.*} / {precio.*} / {marca.*} que el prompt
 *       ya use, para que el emprendedor pueda escribir su prompt con
 *       referencias en vez de números pegados.
 *    2. Anexa un bloque con TODAS las cifras vigentes y la instrucción de
 *       citarlas exactas — porque el prompt casi nunca tokeniza todo lo que el
 *       agente va a necesitar.
 *
 *  ── BEST EFFORT, Y ES LO MÁS IMPORTANTE DEL ARCHIVO ────────────────────────
 *
 *  Si la bóveda falla —red caída, tenant sin valores, lo que sea— esto
 *  devuelve el prompt INTACTO. Nunca lanza.
 *
 *  El razonamiento: un agente sin bóveda contesta peor; un agente que no
 *  contesta porque la bóveda tosió deja al emprendedor sin atender a su
 *  cliente. Degradar la calidad es aceptable. Tirar la conversación no.
 *
 *  Portado de GARDEN `src/vault/agent-inject.ts` (33 líneas). El `try/catch`
 *  que envuelve todo se conserva exacto y a propósito.
 */
import type { TenantContext, VaultScope } from '@abraxa/db';
import { formatVault } from './format';
import { interpolate } from './render';
import { resolveVault, scopeToContext } from './resolver';

const ENCABEZADO = '--- DATOS VIGENTES DE LA BÓVEDA ---';
const CIERRE = '--- FIN BÓVEDA ---';

const INSTRUCCION =
  'Estas son las cifras y políticas oficiales y actuales del negocio. ' +
  'Cítalas EXACTAS; no las inventes ni las redondees. ' +
  'Si te preguntan algo cuyo dato no está en esta lista, dilo con claridad ' +
  'en vez de estimarlo.';

const PIE =
  'Si necesitas el valor específico de un área, usa la herramienta `vault_value`.';

/**
 * El prompt del agente + el bloque de datos vigentes.
 * Devuelve el prompt sin tocar si no hay nada que inyectar.
 */
export async function injectIntoPrompt(
  ctx: TenantContext,
  prompt: string,
  scope?: VaultScope,
): Promise<string> {
  try {
    const resolved = await resolveVault(ctx, scopeToContext(scope));
    if (!resolved) return prompt;

    const renderizado = interpolate(prompt, resolved.values);

    // Una fila sin valor legible no aporta nada al agente y gasta tokens.
    const filas = Object.values(resolved.rows).filter((r) => formatVault(r) !== '');
    if (filas.length === 0) return renderizado;

    const lineas = filas
      .sort((a, b) => a.key.localeCompare(b.key, 'es'))
      .map((r) => {
        const alcance = r.scope_type === 'area' ? ` [sólo en ${r.scope_id}]` : '';
        const nota = r.note ? ` — ${r.note}` : '';
        return `- ${r.label} (${r.key}): ${formatVault(r)}${alcance}${nota}`;
      });

    const bloque = ['', ENCABEZADO, INSTRUCCION, '', ...lineas, '', PIE, CIERRE].join('\n');
    return `${renderizado}\n${bloque}`;
  } catch {
    // Intacto. Un agente sin bóveda es peor; un agente caído es inaceptable.
    return prompt;
  }
}
