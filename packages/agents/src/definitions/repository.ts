/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Las definiciones viven en la BASE DE DATOS.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Éste es el hueco #1 del handoff, cerrado.
 *
 *  En GARDEN cada agente es un YAML del disco que se carga con `readdirSync` al
 *  arrancar (src/bots/bot-factory.ts:39-55). Consecuencia directa: dar de alta
 *  un cliente exige commit, deploy y reinicio del proceso. Con nueve empresas
 *  propias eso se aguanta; con clientes que pagan y se dan de alta solos, no.
 *
 *  Aquí un cliente nuevo es un INSERT. Cambiarle el modelo a su agente de
 *  ventas es un UPDATE. Y como no hay caché de proceso —se lee la fila en cada
 *  corrida— el cambio aplica en la siguiente respuesta, sin redeploy.
 *
 *  Esa decisión cuesta una consulta indexada por mensaje. Es barata al lado de
 *  la alternativa: un caché en memoria significa que dos instancias de la API
 *  pueden estar contestando con definiciones distintas después de un cambio, y
 *  ese bug es de los que no se reproducen en desarrollo.
 */
import { tenantDb, notFound, PlatformError } from '@abraxa/db';
import type { AgentRole, ProviderName, TenantContext } from '@abraxa/db';
import { dialectoValido } from '../capabilities';
import type { AgentDefinition } from '../types';
import { semillasPorDefecto } from './defaults';

interface FilaCruda {
  id: string;
  tenant_id: string;
  role: string;
  name: string;
  provider: string;
  model: string;
  key_ref: string | null;
  system_prompt: string;
  tools: string[] | null;
  enabled: boolean;
}

const COLUMNAS = 'id, tenant_id, role, name, provider, model, key_ref, system_prompt, tools, enabled';

function mapear(f: FilaCruda): AgentDefinition {
  return {
    id: f.id,
    tenantId: f.tenant_id,
    role: f.role as AgentRole,
    name: f.name,
    provider: f.provider as ProviderName,
    model: f.model,
    keyRef: f.key_ref,
    systemPrompt: f.system_prompt,
    tools: f.tools ?? [],
    enabled: f.enabled,
  };
}

/**
 * La definición del agente de un rol.
 *
 * @throws PlatformError('NOT_FOUND') si no existe o está apagado.
 */
export async function obtenerDefinicion(
  ctx: TenantContext,
  role: AgentRole,
): Promise<AgentDefinition> {
  const { data, error } = await tenantDb(ctx)
    .from('agent_definitions')
    .select(COLUMNAS)
    .eq('role', role)
    .limit(1);

  if (error) throw error;

  const fila = (data as FilaCruda[] | null)?.[0];
  if (!fila) {
    throw notFound(
      `Este negocio no tiene agente de '${role}'. Créalo con upsertDefinition() ` +
        `o siembra los de por defecto con sembrarAgentes().`,
    );
  }
  if (!fila.enabled) {
    throw notFound(`El agente de '${role}' está apagado (enabled=false).`);
  }

  return mapear(fila);
}

/** Todos los agentes del tenant, prendidos y apagados. Lo pinta la UI. */
export async function listarDefiniciones(ctx: TenantContext): Promise<AgentDefinition[]> {
  const { data, error } = await tenantDb(ctx)
    .from('agent_definitions')
    .select(COLUMNAS)
    .order('role');

  if (error) throw error;
  return ((data as FilaCruda[] | null) ?? []).map(mapear);
}

export interface EntradaUpsert {
  role: AgentRole;
  name: string;
  systemPrompt: string;
  provider?: ProviderName | undefined;
  model?: string | undefined;
  tools?: string[] | undefined;
  keyRef?: string | null | undefined;
  enabled?: boolean | undefined;
}

/**
 * Crea o actualiza la definición de un agente.
 *
 * Idempotente por `(tenant_id, role)`, que es el UNIQUE de la migración 020.
 * H7 la llama en el bautizo: el emprendedor escribe el nombre de su agente y
 * esto lo persiste sin tener que consultar antes si ya existía.
 *
 * `provider` y `model` son opcionales: al crear caen en la semilla del rol; al
 * actualizar, omitirlos CONSERVA lo que ya había. Cambiar el nombre del agente
 * no debería resetear su modelo.
 *
 * ── La excepción, y por qué existe (auditoría 2026-07-31) ───────────────────
 *
 * Conservar el valor previo es correcto para CADA columna por separado y
 * peligroso para el PAR `(provider, model)`, porque los dos son la misma
 * decisión escrita en dos lugares. Cambiar sólo `provider` heredaba el `model`
 * anterior y fabricaba la combinación rota sin que nadie la escribiera:
 *
 *   provider='openrouter'  +  model='claude-haiku-4-5'   ← ese id no existe en
 *                                                          OpenRouter
 *
 * La fila se guardaba sin una queja. El costo salía en el SIGUIENTE mensaje del
 * cliente final: `400 not a valid model ID`, `PROVIDER_ERROR` no reintentable,
 * y una conversación muerta por cada mensaje de ese rol hasta que alguien
 * leyera el log.
 *
 * Por eso cambiar de proveedor EXIGE `model` explícito. No es una molestia
 * gratuita: es que la respuesta correcta no se puede adivinar —el mismo modelo
 * se llama distinto en cada proveedor— y adivinar mal se paga con silencio.
 *
 * @throws PlatformError('VALIDATION') si se cambia de proveedor sin decir el
 *         modelo, o si el id no pertenece al dialecto del proveedor.
 */
export async function upsertDefinicion(
  ctx: TenantContext,
  entrada: EntradaUpsert,
): Promise<{ agentId: string }> {
  const semilla = semillasPorDefecto().find((s) => s.role === entrada.role);

  const existente = await tenantDb(ctx)
    .from('agent_definitions')
    .select(COLUMNAS)
    .eq('role', entrada.role)
    .limit(1);

  // Esta lectura se tragaba su error, y las otras dos del archivo no. No era
  // simetría: si la SELECT falla de forma transitoria, `previa` queda undefined
  // y las líneas de abajo caen en la SEMILLA — o sea, un parpadeo de la base
  // le resetea al cliente el proveedor y el modelo que él había elegido, en
  // silencio y sin que nadie escribiera un cambio. Es la misma familia del
  // hallazgo: una fila rota que nadie fabricó a propósito.
  if (existente.error) throw existente.error;

  const previa = (existente.data as FilaCruda[] | null)?.[0];

  const provider = (entrada.provider ??
    previa?.provider ??
    semilla?.provider ??
    'anthropic') as ProviderName;

  // Cambio de proveedor sin modelo: se rechaza en vez de heredar el previo.
  if (
    entrada.provider !== undefined &&
    previa !== undefined &&
    entrada.provider !== previa.provider &&
    entrada.model === undefined
  ) {
    throw new PlatformError(
      'VALIDATION',
      `Para mover el agente '${entrada.role}' de ${previa.provider} a ${entrada.provider} ` +
        `hay que decir también el modelo: el mismo modelo se llama distinto en cada ` +
        `proveedor y heredar '${previa.model}' dejaría la fila en una combinación que el ` +
        `proveedor rechaza con 400 en cada mensaje.`,
      { details: { role: entrada.role, de: previa.provider, a: entrada.provider } },
    );
  }

  const model = entrada.model ?? previa?.model ?? semilla?.model ?? 'claude-haiku-4-5';

  // El par, validado. Se comprueba el DIALECTO del id, no que el modelo esté en
  // el catálogo: `deepseek/deepseek-chat` no está tabulado en capabilities.ts y
  // aun así es un id legítimo de OpenRouter con precio desde la 021. Exigir
  // catálogo aquí devolvería a H3 al problema que vino a matar — estrenar un
  // modelo pediría un deploy. El riesgo de dinero de un modelo desconocido lo
  // cubre el piso de `pricing/compute.ts`, no esta validación.
  if (!dialectoValido(model, provider)) {
    throw new PlatformError(
      'VALIDATION',
      `El modelo '${model}' no corresponde al proveedor '${provider}'. ` +
        (provider === 'openrouter'
          ? `OpenRouter nombra sus modelos 'vendor/modelo' (p. ej. 'anthropic/claude-haiku-4.5').`
          : `Anthropic los nombra sin prefijo de vendor (p. ej. 'claude-haiku-4-5').`),
      { details: { role: entrada.role, provider, model } },
    );
  }

  const fila = {
    role: entrada.role,
    name: entrada.name,
    system_prompt: entrada.systemPrompt,
    provider,
    model,
    tools: entrada.tools ?? previa?.tools ?? semilla?.tools ?? [],
    key_ref: entrada.keyRef !== undefined ? entrada.keyRef : (previa?.key_ref ?? null),
    enabled: entrada.enabled ?? previa?.enabled ?? true,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await tenantDb(ctx)
    .from('agent_definitions')
    .upsert(fila, { onConflict: 'tenant_id,role' })
    .select('id');

  if (error) throw error;

  const id = (data as Array<{ id: string }> | null)?.[0]?.id;
  if (!id) throw notFound('El upsert no devolvió id del agente.');
  return { agentId: id };
}

/**
 * Siembra los cinco agentes de un cliente nuevo.
 *
 * Lo llama H2 al aprovisionar y H7 al terminar el bautizo.
 *
 * **Crea sólo lo que falta.** No es un `upsert` de los cinco: si un rol ya
 * existe, se deja como está. Sembrar significa "asegúrate de que este cliente
 * tenga sus cinco agentes", no "devuélvelos a como venían de fábrica".
 *
 * La diferencia importa porque esto se corre más de una vez —H2 al dar de alta,
 * H7 al cerrar el Ritual— y un emprendedor que ya bautizó a su agente, le
 * cambió el modelo o le ajustó el prompt no debería perderlo porque alguien
 * volvió a llamar a la siembra. Para cambiar una definición a propósito está
 * `upsertDefinicion`, que es lo que usa H7.
 */
export async function sembrarAgentes(
  ctx: TenantContext,
  opts?: { nombreDelMaestro?: string },
): Promise<{ creados: number; existentes: number }> {
  const semillas = semillasPorDefecto(opts?.nombreDelMaestro);
  const yaEstan = new Set((await listarDefiniciones(ctx)).map((d) => d.role));

  let creados = 0;
  for (const s of semillas) {
    if (yaEstan.has(s.role)) continue;
    await upsertDefinicion(ctx, {
      role: s.role,
      name: s.name,
      systemPrompt: s.systemPrompt,
      provider: s.provider,
      model: s.model,
      tools: s.tools,
    });
    creados++;
  }

  return { creados, existentes: yaEstan.size };
}
