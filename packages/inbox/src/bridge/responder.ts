/**
 * ════════════════════════════════════════════════════════════════════════════
 *  EL PUENTE. Lo único de este handoff que, si no existe, deja al producto
 *  siendo una demo bonita.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *      mensaje entrante ya guardado
 *         ↓
 *      ¿debe contestar la IA?          ← decidirSiContesta(), función pura
 *         ↓ sí
 *      AgentPort.run({ role, input, threadId })
 *         ↓
 *      se guarda la respuesta con ai_generated = true
 *         ↓
 *      driver.send() → sale por el mismo canal por el que entró
 *         ↓
 *      usage_ledger ya lo registró H3
 *
 *  ── Tres decisiones que no se negocian ─────────────────────────────────────
 *
 *  **`threadId` SIEMPRE.** Es lo que ata el costo al hilo en `usage_ledger` y
 *  lo que le da memoria al agente (`app.agent_messages`, de H3). Sin él, la
 *  respuesta sale igual pero nadie puede decir cuánto costó atender a este
 *  cliente ni el agente se acuerda de qué venían hablando. Es una línea, y es
 *  la diferencia entre un producto que se puede cobrar y uno que no.
 *
 *  **Si el agente falla, silencio.** Nada de "disculpa, tuve un problema". Un
 *  texto genérico de disculpa le dice al cliente final que del otro lado hay un
 *  robot roto, y eso no se olvida. El mensaje queda MARCADO
 *  (`ai_outcome = 'failed'`) con su motivo, y el emprendedor lo ve en la
 *  bandeja como lo que es: una conversación que le toca a él.
 *
 *  **El puente nunca lanza.** Lo llama la ingesta de un webhook. Si reventara,
 *  Evolution reintentaría la entrega y volveríamos a pasar por aquí — con el
 *  mensaje ya guardado, sí, pero con el agente corriendo (y cobrando) otra vez.
 *  Todo error se atrapa y se anota.
 */
import { PlatformError, usePort } from '@abraxa/db';
import type { AgentPort, AgentRole, TenantContext } from '@abraxa/db';
import { MAX_ENTRADA_AGENTE } from '../config';
import { enviarEnHilo } from '../inbox/service';
import { log } from '../logger';
import type { AiOutcome, ChannelRow, MessageRow, ThreadRow } from '../types';
import { decidirSiContesta, EXPLICACION, type RazonSilencio } from './decide';

export interface ResultadoPuente {
  outcome: AiOutcome;
  /** Por qué se calló, o qué falló. */
  reason: string | null;
  /** El id del saliente que generó el agente, si contestó. */
  replyMessageId?: string;
  /** El texto con el que contestó. Útil en pruebas y en el log de depuración. */
  replyText?: string;
}

/**
 * Lo único que el puente le pide al motor de agentes.
 *
 * Se pide `Pick<AgentPort,'run'>` y no `AgentPort` entero porque un doble de
 * pruebas no tiene por qué implementar `registerTool` ni `upsertDefinition`
 * para verificar que el agente contesta un WhatsApp.
 */
export type CorredorDeAgentes = Pick<AgentPort, 'run'>;

export interface OpcionesPuente {
  ahora?: Date;
  /** Para pruebas: el port de agentes sin pasar por el registro global. */
  agents?: CorredorDeAgentes;
}

/**
 * Corre el agente del canal para un mensaje entrante y manda su respuesta.
 *
 * Devuelve qué pasó SIEMPRE — nunca lanza. Quien llama guarda el resultado en
 * `messages.ai_outcome` / `ai_reason`.
 */
export async function responderConAgente(
  ctx: TenantContext,
  canal: ChannelRow,
  hilo: ThreadRow,
  mensaje: Pick<MessageRow, 'id' | 'body'> & { fromMe?: boolean },
  opts: OpcionesPuente = {},
): Promise<ResultadoPuente> {
  const ahora = opts.ahora ?? new Date();

  const decision = decidirSiContesta(
    {
      canal: {
        ai_enabled: canal.ai_enabled,
        agent_role: canal.agent_role,
        business_hours: canal.business_hours,
        ai_outside_hours: canal.ai_outside_hours,
      },
      hilo: {
        ai_enabled: hilo.ai_enabled,
        assigned_to: hilo.assigned_to,
        ai_paused_until: hilo.ai_paused_until,
      },
      mensaje: { body: mensaje.body, ...(mensaje.fromMe ? { fromMe: true } : {}) },
    },
    ahora,
  );

  if (!decision.responde) {
    log.debug(`hilo ${hilo.id}: la IA no contesta (${decision.razon})`);
    return { outcome: 'skipped', reason: razonLegible(decision.razon) };
  }

  // ── El agente ─────────────────────────────────────────────────────────────
  let texto: string;
  try {
    const agents = opts.agents ?? usePort('agents');
    const r = await agents.run(ctx, {
      role: canal.agent_role as AgentRole,
      input: recortarEntrada(mensaje.body ?? ''),
      // SIEMPRE. Ver arriba: sin esto se pierde la trazabilidad hilo↔costo.
      threadId: hilo.id,
    });
    texto = (r.text ?? '').trim();
  } catch (err) {
    const motivo = describir(err);
    log.warn(`el agente no pudo contestar el hilo ${hilo.id}: ${motivo}`);
    return { outcome: 'failed', reason: motivo };
  }

  if (!texto) {
    // El agente corrió, no falló, y no dijo nada. Pasa cuando la respuesta se
    // corta por `max_tokens` en la primera vuelta. Mandar una burbuja vacía es
    // peor que no mandar nada.
    log.warn(`el agente devolvió texto vacío para el hilo ${hilo.id}`);
    return { outcome: 'failed', reason: 'El agente no generó texto.' };
  }

  // ── La respuesta, por el mismo canal por el que entró ─────────────────────
  try {
    const { message } = await enviarEnHilo(ctx, {
      threadId: hilo.id,
      body: texto,
      // `author: null` es lo que significa "lo escribió la IA" en el contrato
      // del port — y es también lo que evita que el hilo se marque como tomado
      // por un humano. Un agente no puede robarle el hilo a su dueño.
      author: null,
      aiGenerated: true,
    });
    return { outcome: 'answered', reason: null, replyMessageId: message.id, replyText: texto };
  } catch (err) {
    const motivo = describir(err);
    log.error(`el agente contestó pero el envío falló en el hilo ${hilo.id}: ${motivo}`);
    // La respuesta ya quedó en el historial como `failed` (lo hace
    // `enviarEnHilo`), así que el emprendedor puede leerla y reenviarla a mano.
    return { outcome: 'failed', reason: `No se pudo entregar la respuesta: ${motivo}` };
  }
}

function razonLegible(r: RazonSilencio): string {
  return EXPLICACION[r] ?? r;
}

/**
 * Un mensaje absurdamente largo no debería poder inflar la factura de tokens de
 * un cliente. Se recorta y queda anotado.
 */
export function recortarEntrada(texto: string): string {
  if (texto.length <= MAX_ENTRADA_AGENTE) return texto;
  log.warn(`entrada de ${texto.length} caracteres recortada a ${MAX_ENTRADA_AGENTE}`);
  return `${texto.slice(0, MAX_ENTRADA_AGENTE)}…`;
}

/**
 * El motivo, con el código del error cuando lo trae.
 *
 * `PlatformError` viaja intacto desde H3, así que aquí se puede distinguir
 * BUDGET_EXCEEDED —"a este cliente hay que llamarlo"— de un 503 del proveedor
 * —"se arregla solo"— sin acoplarse a nada de H3. Es justo para lo que H1
 * escribió esa clase.
 */
export function describir(err: unknown): string {
  if (PlatformError.is(err)) return `${err.code}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}
