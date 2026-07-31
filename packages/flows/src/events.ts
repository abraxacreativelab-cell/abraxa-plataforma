/**
 * ════════════════════════════════════════════════════════════════════════════
 *  `FlowPort.emit` — de un evento del negocio a una corrida.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Cualquier paquete publica un evento; los flujos ACTIVOS que lo escuchan se
 *  enrolan solos. Es el único camino por el que una automatización arranca.
 *
 *  ── Los filtros se comparan contra las llaves REALES de quien emite ────────
 *
 *  `stage_changed` llega de H15 con `{contactId, pipelineId, pipelineSlug,
 *  stageId, stageSlug, previousStageId}` (packages/crm/src/pipeline/
 *  service.ts:351). Por eso el filtro `stage` se compara contra el slug **y**
 *  contra el id: el asistente propone `"contactado"` y el builder manda un
 *  uuid, y ninguno de los dos debería tener que saber cuál guardó el otro.
 *  Comparar sólo contra uno haría que la mitad de los flujos nunca dispararan
 *  — en silencio, que es la peor forma de no funcionar.
 *
 *  ── Nunca lanza hacia arriba lo que no deba ────────────────────────────────
 *
 *  H15 llama a esto con `tryPort` dentro de un `try`, porque un contacto que
 *  se crea vale más que la automatización que no se disparó. Aquí se sostiene
 *  esa promesa: un flujo roto no puede impedir que otro corra, así que cada
 *  enrolamiento se aísla. Lo que sí se propaga es un fallo de lectura de la
 *  tabla de flujos: eso no es "no había nada que disparar", es "no se pudo
 *  saber", y callarlo convertiría una base caída en un sistema que parece
 *  funcionar.
 */
import type { TenantContext, TriggerType } from '@abraxa/db';
import { primerNodo } from './engine/decision';
import type { Encolar } from './engine/step';
import * as store from './store';
import type { Flow, RunContext } from './types';

const texto = (v: unknown): string => (v === null || v === undefined ? '' : String(v)).trim();

/**
 * ¿Este flujo escucha este evento concreto?
 *
 * Un filtro vacío significa "cualquiera". Función pura: se prueba sin base.
 */
export function disparadorCalza(flujo: Flow, payload: Record<string, unknown>): boolean {
  const cfg = flujo.triggerConfig;

  /** El filtro `clave` contra cualquiera de los campos que puede traer el evento. */
  const calza = (clave: string, candidatos: unknown[]): boolean => {
    const esperado = texto(cfg[clave]);
    if (!esperado) return true;
    return candidatos.some((c) => texto(c).toLowerCase() === esperado.toLowerCase());
  };

  switch (flujo.triggerType) {
    case 'stage_changed':
      return (
        calza('stage', [payload.stageSlug, payload.stageId, payload.stage]) &&
        calza('pipeline', [payload.pipelineSlug, payload.pipelineId, payload.pipeline])
      );
    case 'tag_added':
      return calza('tag', [payload.tag, payload.tagName]);
    case 'contact_created':
      return calza('source', [payload.source, payload.channel]);
    case 'form_submitted':
      return calza('form_id', [payload.formId, payload.form_id]);
    case 'message_in':
      return calza('channel', [payload.channel, payload.channelType]);
    case 'appointment_created':
    case 'appointment_cancelled':
      return calza('calendar_id', [payload.calendarId, payload.calendar_id]);
    case 'manual':
      return true;
    default:
      return true;
  }
}

export interface ResumenDeEmision {
  /** Cuántas corridas nacieron. */
  enroladas: number;
  /** Flujos que calzaron pero ya tenían a ese contacto adentro. */
  duplicadas: number;
  /** Flujos que calzaron y no se pudieron enrolar, con su porqué. */
  fallidas: Array<{ flowId: string; razon: string }>;
}

export interface OpcionesDeEmision {
  encolar: Encolar;
  /** Marca las corridas como prueba, para que la UI las separe del historial. */
  esPrueba?: boolean;
}

/**
 * Publica un evento y enrola lo que corresponda.
 *
 * Esto es SÓLO para eventos de verdad. El botón "Probar" no pasa por aquí:
 * llama a `enrolar()` sobre su flujo y nada más. Emitir un disparador real
 * para probar arrastraría a todos los demás flujos que lo escuchan sobre el
 * contacto de prueba — mensajes reales de automatizaciones que nadie quiso
 * probar. Ver `service.probar()`.
 */
export async function emitirEvento(
  ctx: TenantContext,
  evento: { type: TriggerType; payload: unknown },
  opciones: OpcionesDeEmision,
): Promise<ResumenDeEmision> {
  const payload =
    evento.payload && typeof evento.payload === 'object' && !Array.isArray(evento.payload)
      ? (evento.payload as Record<string, unknown>)
      : {};

  const resumen: ResumenDeEmision = { enroladas: 0, duplicadas: 0, fallidas: [] };

  const flujos = await store.flujosActivosPara(ctx, evento.type);

  for (const flujo of flujos) {
    if (!disparadorCalza(flujo, payload)) continue;
    try {
      const enrolada = await enrolar(ctx, flujo, payload, evento.type, opciones);
      if (enrolada) resumen.enroladas += 1;
      else resumen.duplicadas += 1;
    } catch (err) {
      // Un flujo que revienta no puede llevarse a los demás: son
      // automatizaciones independientes del mismo negocio.
      resumen.fallidas.push({
        flowId: flujo.id,
        razon: err instanceof Error ? err.message : 'no se pudo enrolar',
      });
    }
  }

  return resumen;
}

/**
 * Enrola un contacto en UN flujo. `false` si ya estaba dentro.
 *
 * El primer nodo se encola ANTES de devolver; si la cola no lo acepta, la
 * corrida se marca como pausada en vez de quedarse `running` sin job
 * pendiente. Una corrida activa que nadie va a mover es peor que una pausada:
 * la pausada la rescata el barrido y se ve en el panel.
 */
export async function enrolar(
  ctx: TenantContext,
  flujo: Flow,
  payload: Record<string, unknown>,
  trigger: TriggerType,
  opciones: OpcionesDeEmision,
): Promise<boolean> {
  const contactId = typeof payload.contactId === 'string' ? payload.contactId : null;
  const contexto: RunContext = { ...payload, event: trigger, contactId };
  const arranque = primerNodo(flujo.definition);

  const corrida = await store.crearCorrida(ctx, {
    flowId: flujo.id,
    version: flujo.version,
    contactId,
    triggerType: trigger,
    context: contexto,
    currentNode: arranque,
    isTest: opciones.esPrueba === true,
  });

  // `null` = el índice parcial `flow_runs_viva_idx` la rechazó: ese contacto
  // ya va corriendo este flujo. No es un error.
  if (!corrida) return false;

  if (!arranque) {
    // Un flujo cuyo disparador no lleva a ningún lado. Se cierra de inmediato
    // en vez de dejar una corrida apuntando a la nada.
    await store.terminarCorrida(ctx, corrida.id, 'completed', 'el flujo no tiene pasos');
    return true;
  }

  const encolado = await opciones.encolar({
    tenantId: ctx.tenantId,
    tenantSlug: ctx.tenantSlug,
    runId: corrida.id,
    nodeId: arranque,
  });

  if (!encolado) {
    await store.pausarCorrida(
      ctx,
      corrida.id,
      'no se pudo encolar el primer paso; se reintentará al reanudar',
    );
  }
  return true;
}
