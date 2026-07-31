/**
 * BÓVEDA · Interpolación de plantillas con valores de fuente única.
 *
 * Portado de GARDEN `src/vault/render.ts:13-35`. La parte genérica se lleva
 * tal cual; `loadEntityVars()` (líneas 38-66) NO se porta: leía `crm_socios` y
 * `crm_properties`, las tablas de una inmobiliaria.
 *
 * LA REGLA QUE NO SE NEGOCIA: un token desconocido queda VACÍO, nunca
 * `{algo}` crudo. Un contrato o un WhatsApp que le llega al cliente final con
 * `{precio_base}` a la vista es peor que uno con un hueco — el hueco se ve
 * como un error de captura; la llave se ve como un producto roto.
 *
 * Por eso `renderTemplate` devuelve también `missing`: quien renderiza puede
 * avisar ANTES de mandar. La UI de valores lo usa para decir "esta plantilla
 * pide 3 valores que todavía no defines".
 */
import type { TenantContext, VaultScope } from '@abraxa/db';
import { resolveVault, scopeToContext } from './resolver';
import type { VaultContext } from './types';

/**
 * Tokens `{con.puntos}`, `{acentuados}` y `{con-guiones}`.
 * El rango de acentos es el de GARDEN y está probado contra claves reales en
 * español (`{valor.comision_año}` funciona).
 */
const TOKEN = /\{([\w.áéíóúÁÉÍÓÚñÑüÜ-]+)\}/g;

/** Sustituye tokens. Desconocido → ''. Nunca lanza. */
export function interpolate(template: string, vars: Record<string, string>): string {
  return String(template ?? '').replace(TOKEN, (_m, key: string) => vars[key] ?? '');
}

/** Igual, pero reportando qué faltó. */
export function interpolateVerbose(
  template: string,
  vars: Record<string, string>,
): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const text = String(template ?? '').replace(TOKEN, (_m, key: string) => {
    const v = vars[key];
    if (v == null || v === '') {
      missing.add(key);
      return '';
    }
    return v;
  });
  return { text, missing: [...missing] };
}

/** Qué tokens pide una plantilla, sin resolver nada. Para avisos en la UI. */
export function tokensUsados(template: string): string[] {
  const out = new Set<string>();
  for (const m of String(template ?? '').matchAll(TOKEN)) {
    if (m[1]) out.add(m[1]);
  }
  return [...out];
}

export type RenderExtra = Record<string, string>;

/**
 * Renderiza una plantilla con la bóveda del tenant más variables extra.
 *
 * `extra` gana sobre la bóveda: quien renderiza un contrato concreto sabe
 * cosas de ese contrato que la bóveda no tiene por qué saber.
 */
export async function renderTemplate(
  ctx: TenantContext,
  template: string,
  opts: { extra?: RenderExtra; scope?: VaultScope; vaultContext?: VaultContext } = {},
): Promise<{ text: string; missing: string[] }> {
  const vctx = opts.vaultContext ?? scopeToContext(opts.scope);
  const resolved = await resolveVault(ctx, vctx);
  const vars: Record<string, string> = { ...(resolved?.values ?? {}), ...(opts.extra ?? {}) };
  return interpolateVerbose(template, vars);
}
