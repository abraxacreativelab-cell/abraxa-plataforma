/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El prompt efectivo se compone en CADA mensaje.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Orden, portado de GARDEN (src/bots/base-bot.ts:143-235):
 *
 *      system_prompt de la fila
 *        + inyección de la BÓVEDA          ← VaultPort.injectIntoPrompt()
 *        + contexto del tenant (giro, etapa)
 *
 *  El bloque de la bóveda es lo que le mete al agente los NÚMEROS REALES del
 *  negocio con la instrucción de citarlos exactos. Sin él, un agente de ventas
 *  se inventa un precio y el emprendedor se entera cuando un cliente llega a
 *  reclamarlo. Es 33 líneas en GARDEN (src/vault/agent-inject.ts) y es patrón
 *  oro; lo que se copia es la forma, no el código, porque aquí se habla con
 *  `VaultPort` en vez de con el resolver de GARDEN.
 *
 *  ── Por qué el orden importa para el caché ─────────────────────────────────
 *
 *  De lo más estable a lo más volátil. El caché de prompt es una coincidencia
 *  de PREFIJO: cualquier byte que cambie invalida todo lo que venga después. La
 *  fila cambia casi nunca, la bóveda cambia cuando el emprendedor aprueba un
 *  valor, y el contexto del tenant cambia con su etapa.
 *
 *  Y por eso mismo aquí NO se interpola una fecha ni la hora ni el nombre del
 *  contacto: eso reventaría el caché en cada llamada sin que nadie lo note,
 *  hasta que la factura no cuadre. Ese dato va en el turno del usuario.
 */
// `adminDb` y no `tenantDb`: `app.tenants` se filtra por `id`, que ES su llave
// de aislamiento. No hay `tenant_id` por el que acotar.
import { adminDb, tryPort } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import { log } from '../logger';

export interface EntradaComposicion {
  /** `system_prompt` de la fila de `app.agent_definitions`. */
  base: string;
  /** Lo que H7 antepone durante la entrevista (`AgentRunInput.systemSuffix`). */
  systemSuffix?: string | undefined;
}

/**
 * Arma el prompt de sistema completo.
 *
 * NUNCA lanza. Un fallo de la bóveda o del contexto degrada a un prompt más
 * pobre, jamás a un agente caído: entre que el agente conteste sin las cifras y
 * que no conteste, lo primero es mucho menos malo.
 */
export async function componerPrompt(
  ctx: TenantContext,
  entrada: EntradaComposicion,
): Promise<string> {
  let prompt = entrada.base.trim();

  if (entrada.systemSuffix && entrada.systemSuffix.trim().length > 0) {
    prompt = `${prompt}\n\n${entrada.systemSuffix.trim()}`;
  }

  prompt = await conBoveda(ctx, prompt);
  prompt = await conContextoDelTenant(ctx, prompt);

  return prompt;
}

/**
 * Inyecta el bloque de datos vigentes del negocio.
 *
 * `tryPort` en vez de `usePort` es la regla 5 hecha código: si H4 todavía no
 * aterriza, esto devuelve `null` y el agente corre SIN bóveda en vez de
 * reventar. H1 documentó ese caso con este nombre exacto.
 *
 * El `catch` es el patrón oro de GARDEN, conservado tal cual: la bóveda es
 * best-effort y bajo ninguna circunstancia rompe al agente.
 */
async function conBoveda(ctx: TenantContext, prompt: string): Promise<string> {
  const vault = tryPort('vault');
  if (!vault) {
    log.debug('VaultPort no registrado (H4 pendiente): el agente corre sin bóveda');
    return prompt;
  }

  try {
    const conDatos = await vault.injectIntoPrompt(ctx, prompt);
    return typeof conDatos === 'string' && conDatos.length > 0 ? conDatos : prompt;
  } catch (err) {
    log.warn(`la bóveda falló, se sigue con el prompt intacto: ${String(err)}`);
    return prompt;
  }
}

/**
 * Quién es la empresa. Va al final: es lo que más cambia de los tres.
 *
 * Sólo giro y etapa. La tentación es meter aquí todo `settings`, y es una mala
 * idea: son datos que cambian seguido y cada cambio invalida el caché del
 * prompt entero.
 */
async function conContextoDelTenant(ctx: TenantContext, prompt: string): Promise<string> {
  try {
    const { data } = await adminDb()
      .from('tenants')
      .select('name, industry_type, stage')
      .eq('id', ctx.tenantId)
      .maybeSingle();

    const t = data as { name?: string; industry_type?: string | null; stage?: string | null } | null;
    if (!t?.name) return prompt;

    const lineas = [`- Empresa: ${t.name}`];
    if (t.industry_type) lineas.push(`- Giro: ${t.industry_type}`);
    if (t.stage) lineas.push(`- Etapa: ${t.stage}`);

    return `${prompt}\n\n--- LA EMPRESA ---\n${lineas.join('\n')}`;
  } catch (err) {
    log.debug(`no se pudo leer el contexto del tenant: ${String(err)}`);
    return prompt;
  }
}
