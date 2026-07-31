/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Los diez nodos que el motor ejecuta de verdad.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  La ley de GARDEN, conservada: **la UI no promete ningún nodo que el worker
 *  no corra**. Si un tipo del catálogo no tiene su `case` aquí, la prueba
 *  `nodes.test.ts` («el catálogo y el motor ejecutan lo mismo») falla.
 *
 *  Todo efecto sale por un PORT: `inbox` para mandar, `contacts` para el CRM,
 *  `work` para las tareas, `agents` para la IA. Este archivo no conoce ni una
 *  tabla de otro paquete, y por eso se prueba entero con dobles, sin base,
 *  sin llaves y sin red — que es como corre CI.
 *
 *  ── Transitorio vs permanente: la decisión que sostiene el criterio #6 ─────
 *
 *  Un 429 o un 5xx del proveedor es TRANSITORIO: la corrida se PAUSA y sigue
 *  cuando el canal vuelva. Un número inválido es PERMANENTE: la corrida muere
 *  con su razón escrita. La distinción viene de `PlatformError.retryable`, que
 *  H1 puso en el contrato justo para esto — no de adivinar por el texto del
 *  mensaje.
 */
import { PlatformError, tryPort, usePort } from '@abraxa/db';
import type { AgentRole, ChannelType, TenantContext } from '@abraxa/db';
import { contactos, exigirContactos } from '../crm';
import { esBloqueadaPorSsrf } from '../ssrf';
import { renderizar } from '../templating';
import type { Variables } from '../templating';
import type { FlowNode, NodeResult, RunContext } from '../types';

/** Cuánto se le da a un webhook del cliente antes de rendirse. */
const TIMEOUT_WEBHOOK_MS = 10_000;

/** Lo que un nodo necesita saber del mundo. Todo inyectable = todo probable. */
export interface EntornoDeNodo {
  ctx: TenantContext;
  run: {
    id: string;
    contactId: string | null;
    context: RunContext;
    isTest: boolean;
  };
  /** Ya construidas por `construirVariables()`. */
  vars: Variables;
  ahora: Date;
  /**
   * Inyectable a propósito: el guard anti-SSRF y la clasificación de errores
   * del nodo `webhook` se prueban enteros sin tocar la red.
   */
  fetch: typeof globalThis.fetch;
  /**
   * `true` si este nodo ya tiene un paso `ok` en esta corrida. Es el guard de
   * doble envío: se consulta ANTES de gastar el mensaje. El árbitro final es
   * el índice único de la migración 061.
   */
  yaCompletado: boolean;
}

const cfgDe = (n: FlowNode): Record<string, unknown> => n.data?.config ?? {};
const texto = (v: unknown): string => (v === null || v === undefined ? '' : String(v)).trim();

/**
 * ¿Este fallo merece esperar, o matar la corrida?
 *
 * Fail-safe hacia PAUSAR en lo desconocido: un error que no sabemos clasificar
 * probablemente es de infraestructura, y perder el seguimiento de un lead por
 * un hipo de red es el peor de los dos desenlaces. Lo que sí se mata es lo que
 * sabemos permanente.
 */
export function esTransitorio(err: unknown): boolean {
  if (PlatformError.is(err)) {
    if (err.code === 'PORT_NOT_IMPLEMENTED') return true; // falta un merge, no es culpa del flujo
    return err.retryable;
  }
  if (err instanceof Error && /abort|timeout|network|fetch failed|ECONN/i.test(err.message)) {
    return true;
  }
  return false;
}

const mensaje = (err: unknown): string =>
  err instanceof Error ? err.message : typeof err === 'string' ? err : 'error desconocido';

/**
 * Ejecuta UN nodo. No escribe pasos, no mueve punteros y no encola nada: sólo
 * dice qué pasó. Quien decide qué hacer con eso es `decidirDespues()`.
 */
export async function ejecutarNodo(nodo: FlowNode, e: EntornoDeNodo): Promise<NodeResult> {
  const cfg = cfgDe(nodo);

  switch (nodo.type) {
    // ── El disparador no hace nada: sólo marca por dónde se entra. ─────────
    case 'trigger':
      return { status: 'ok' };

    case 'end':
      return { status: 'ok', exit: true, output: { razon: 'el flujo llegó a su fin' } };

    // ── Esperar ────────────────────────────────────────────────────────────
    case 'wait': {
      const minutos = Number(cfg.minutes ?? 0);
      if (!Number.isFinite(minutos) || minutos <= 0) return { status: 'ok' };
      const despertar = new Date(e.ahora.getTime() + minutos * 60_000);
      return {
        status: 'waiting',
        output: { minutos, hasta: despertar.toISOString() },
        wakeAt: despertar.toISOString(),
      };
    }

    // ── Bifurcar ───────────────────────────────────────────────────────────
    case 'condition': {
      const campo = texto(cfg.field);
      const crudo = e.vars[campo] ?? valorDelContexto(e.run.context, campo);
      const actual = texto(crudo).toLowerCase();
      const esperado = texto(cfg.value).toLowerCase();
      const op = texto(cfg.op) || 'eq';

      let pasa = false;
      if (op === 'eq') pasa = actual === esperado;
      else if (op === 'neq') pasa = actual !== esperado;
      else if (op === 'contains') pasa = actual.includes(esperado);
      else if (op === 'in') pasa = esperado.split(',').map((s) => s.trim()).includes(actual);
      else if (op === 'not_empty') pasa = actual.length > 0;
      else if (op === 'empty') pasa = actual.length === 0;

      return {
        status: 'ok',
        output: { campo, valor: actual, comparacion: op, resultado: pasa },
        nextHandle: pasa ? 'yes' : 'no',
      };
    }

    // ── Mandar un mensaje ──────────────────────────────────────────────────
    case 'send_message':
      return mandarMensaje(nodo, e, cfg);

    // ── CRM ────────────────────────────────────────────────────────────────
    case 'move_stage': {
      if (!e.run.contactId) return { status: 'skipped', output: { razon: 'la corrida no trae contacto' } };
      const etapa = texto(cfg.stage);
      if (!etapa) return { status: 'failed', error: 'el paso no dice a qué etapa mover' };
      try {
        const r = await exigirContactos().moveStage(e.ctx, {
          contactId: e.run.contactId,
          stage: etapa,
          ...(texto(cfg.pipeline) ? { pipeline: texto(cfg.pipeline) } : {}),
          actor: `flow:${e.run.id}`,
        });
        // `moved: false` = ya estaba ahí. No es un fallo y no vuelve a emitir
        // `stage_changed`: es lo que impide que dos flujos que se mueven
        // mutuamente entren en cascada.
        return { status: 'ok', output: { movido: r.moved, etapa: r.stageId } };
      } catch (err) {
        return desenlaceDeError(err, 'mover de etapa');
      }
    }

    case 'add_tag': {
      if (!e.run.contactId) return { status: 'skipped', output: { razon: 'la corrida no trae contacto' } };
      const etiqueta = texto(cfg.tag);
      if (!etiqueta) return { status: 'failed', error: 'el paso no dice qué etiqueta poner' };
      try {
        const r = await exigirContactos().addTag(e.ctx, {
          contactId: e.run.contactId,
          tag: etiqueta,
          actor: `flow:${e.run.id}`,
        });
        return { status: 'ok', output: { etiqueta, nueva: r.added } };
      } catch (err) {
        return desenlaceDeError(err, 'poner la etiqueta');
      }
    }

    case 'assign_owner': {
      if (!e.run.contactId) return { status: 'skipped', output: { razon: 'la corrida no trae contacto' } };
      let correo = texto(cfg.owner_email);

      if (!correo && texto(cfg.pool)) {
        correo = await repartirEntreElEquipo(e.ctx, e.run.contactId);
        if (!correo) {
          return { status: 'failed', error: 'no hay a quién repartirle: el equipo está vacío' };
        }
      }
      if (!correo) return { status: 'failed', error: 'el paso no dice a quién asignar' };

      try {
        await exigirContactos().assignOwner(e.ctx, {
          contactId: e.run.contactId,
          ownerEmail: correo,
          actor: `flow:${e.run.id}`,
        });
        return { status: 'ok', output: { responsable: correo } };
      } catch (err) {
        return desenlaceDeError(err, 'asignar el responsable');
      }
    }

    // ── Tareas (H9) ────────────────────────────────────────────────────────
    case 'create_task': {
      const titulo = renderizar(texto(cfg.title), e.vars);
      if (!titulo) return { status: 'failed', error: 'la tarea no tiene título' };
      const vence = Number(cfg.due_in_min ?? 0);
      const asignar = texto(cfg.assign_to);
      const responsable =
        asignar === 'owner' ? texto(e.vars.responsable) : asignar.includes('@') ? asignar : '';

      try {
        const r = await usePort('work').createTask(e.ctx, {
          title: titulo,
          ...(texto(cfg.description) ? { description: renderizar(texto(cfg.description), e.vars) } : {}),
          ...(responsable ? { assignedTo: responsable } : {}),
          ...(Number.isFinite(vence) && vence > 0
            ? { dueDate: new Date(e.ahora.getTime() + vence * 60_000).toISOString() }
            : {}),
        });
        return { status: 'ok', output: { tarea: r.taskId, titulo } };
      } catch (err) {
        return desenlaceDeError(err, 'crear la tarea');
      }
    }

    // ── Llamar a otro sistema ──────────────────────────────────────────────
    case 'webhook':
      return llamarWebhook(e, cfg);

    // ── Preguntarle a un agente (H3) ───────────────────────────────────────
    case 'ai_step': {
      const instruccion = renderizar(texto(cfg.prompt), e.vars);
      if (!instruccion) return { status: 'failed', error: 'el paso no tiene instrucción' };
      const rol = (texto(cfg.role) || 'analyst') as AgentRole;

      try {
        const r = await usePort('agents').run(e.ctx, { role: rol, input: instruccion });
        // Queda en la ficha del contacto: una respuesta de IA que sólo vive en
        // un log es trabajo que el emprendedor pagó y no puede leer.
        if (e.run.contactId) {
          await contactosBestEffort(e, r.text);
        }
        return {
          status: 'ok',
          output: {
            agente: r.agentName,
            texto: r.text.slice(0, 500),
            costoUsd: r.usage.costUsd,
          },
        };
      } catch (err) {
        // BUDGET_EXCEEDED viene con `retryable: false`: se queda sin presupuesto
        // y la corrida muere diciendo por qué, en vez de esperar para siempre.
        return desenlaceDeError(err, 'preguntarle al agente');
      }
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Piezas
// ════════════════════════════════════════════════════════════════════════════

/** El fallo, clasificado: esperar o morir. */
function desenlaceDeError(err: unknown, quehacer: string): NodeResult {
  const m = mensaje(err);
  return esTransitorio(err)
    ? { status: 'paused', output: { razon: `no se pudo ${quehacer}: ${m.slice(0, 160)}` } }
    : { status: 'failed', error: `no se pudo ${quehacer}: ${m}` };
}

/** Un campo del payload del evento que no llegó a ser variable. */
function valorDelContexto(contexto: RunContext, campo: string): unknown {
  return (contexto as Record<string, unknown>)[campo];
}

/**
 * Reparte al contacto entre el equipo, sin guardar turno.
 *
 * El reparto por turnos de verdad exige un contador compartido, y un contador
 * bajo dos workers concurrentes es una condición de carrera con nombre propio.
 * Aquí el turno lo decide el propio contacto: mismo contacto, mismo
 * responsable, siempre — que además es lo que un cliente espera cuando vuelve
 * a escribir. Se reparte parejo mientras los ids sean aleatorios, que lo son
 * (`gen_random_uuid()`).
 */
async function repartirEntreElEquipo(ctx: TenantContext, contactId: string): Promise<string> {
  const tenancy = tryPort('tenancy');
  if (!tenancy) return '';
  const miembros = (await tenancy.listMembers(ctx)).filter(
    (m) => m.role === 'owner' || m.role === 'admin' || m.role === 'member',
  );
  if (miembros.length === 0) return '';

  let suma = 0;
  for (const c of contactId) suma = (suma * 31 + c.charCodeAt(0)) >>> 0;
  return miembros[suma % miembros.length]?.email ?? '';
}

/** La nota del `ai_step` en la ficha. Si falla, el paso sigue siendo un éxito. */
async function contactosBestEffort(e: EntornoDeNodo, respuesta: string): Promise<void> {
  try {
    const crm = contactos();
    if (!crm || !e.run.contactId) return;
    await crm.recordEvent(e.ctx, {
      contactId: e.run.contactId,
      type: 'note',
      summary: respuesta.slice(0, 200),
      payload: { flowRunId: e.run.id },
      source: 'flow',
      actor: `flow:${e.run.id}`,
    });
  } catch {
    /* la respuesta ya se produjo: no se tira el paso por no poder anotarla */
  }
}

/**
 * A qué dirección se le escribe.
 *
 * `address:` fija la dirección en el flujo (avisos internos: "avísale al 55…").
 * `owner` le escribe al responsable del contacto. Por defecto, al contacto —
 * buscando su identidad EN ESE CANAL, que es la que H15 garantiza única.
 */
async function destinatario(
  e: EntornoDeNodo,
  canal: ChannelType,
  para: string,
): Promise<{ address: string; contactId: string | null } | { error: string }> {
  if (para.startsWith('address:')) {
    const fija = para.slice('address:'.length).trim();
    return fija ? { address: fija, contactId: null } : { error: 'la dirección fija está vacía' };
  }

  if (!e.run.contactId) return { error: 'la corrida no trae contacto al que escribirle' };

  const crm = exigirContactos();
  const contacto = await crm.get(e.ctx, e.run.contactId);
  if (!contacto) return { error: 'el contacto ya no existe' };

  if (para === 'owner') {
    const correo = contacto.ownerEmail;
    if (!correo) return { error: 'el contacto no tiene responsable a quien avisarle' };
    if (canal !== 'email') {
      // Decir esto en vez de mandarle un WhatsApp al correo del vendedor.
      return { error: `al responsable sólo se le puede escribir por correo, no por ${canal}` };
    }
    return { address: correo, contactId: contacto.id };
  }

  const identidad =
    contacto.identities.find((i) => i.channel === canal && i.isPrimary) ??
    contacto.identities.find((i) => i.channel === canal);
  if (!identidad) {
    return { error: `el contacto no tiene ${canal}: no hay a dónde escribirle` };
  }
  return { address: identidad.identifier, contactId: contacto.id };
}

async function mandarMensaje(
  nodo: FlowNode,
  e: EntornoDeNodo,
  cfg: Record<string, unknown>,
): Promise<NodeResult> {
  // ── El guard de doble envío, ANTES de gastar nada ─────────────────────────
  // El proceso pudo morir entre mandar y registrar; al reintentar, esto evita
  // el segundo mensaje al cliente. El índice único de 061 es el árbitro final.
  if (e.yaCompletado) {
    return { status: 'ok', output: { razon: 'ya se había mandado', reenvioEvitado: true } };
  }

  const cuerpo = renderizar(texto(cfg.template), e.vars);
  if (!cuerpo) return { status: 'skipped', output: { razon: 'el mensaje quedó vacío' } };

  const canal = (texto(cfg.channel) || 'whatsapp') as ChannelType;
  const para = texto(cfg.to) || 'contact';

  let destino: { address: string; contactId: string | null } | { error: string };
  try {
    destino = await destinatario(e, canal, para);
  } catch (err) {
    return desenlaceDeError(err, 'averiguar a quién escribirle');
  }
  if ('error' in destino) return { status: 'skipped', output: { razon: destino.error } };

  try {
    const inbox = usePort('inbox');
    const { threadId } = await inbox.startThread(e.ctx, {
      channelType: canal,
      address: destino.address,
      ...(destino.contactId ? { contactId: destino.contactId } : {}),
    });
    const { messageId } = await inbox.send(e.ctx, {
      threadId,
      body: cuerpo,
      // `author: null` = lo mandó el sistema. Llenarlo apagaría la IA del hilo,
      // y una automatización no es un humano tomando la conversación.
      author: null,
      aiGenerated: false,
    });
    return {
      status: 'ok',
      output: {
        canal,
        para: destino.address,
        mensaje: messageId,
        vistaPrevia: cuerpo.slice(0, 120),
        ...(e.run.isTest ? { prueba: true } : {}),
      },
    };
  } catch (err) {
    // Aquí vive el criterio #6: canal caído → PAUSA (y reanuda), número
    // inválido → muere. La diferencia la da `retryable`, no una heurística.
    return desenlaceDeError(err, `mandar el mensaje por ${canal}`);
  }
}

async function llamarWebhook(e: EntornoDeNodo, cfg: Record<string, unknown>): Promise<NodeResult> {
  const url = renderizar(texto(cfg.url), e.vars);
  if (!/^https?:\/\//i.test(url)) return { status: 'failed', error: 'la URL no es http(s)' };

  // El único nodo donde el cliente escribe una dirección. Se revisa aquí
  // ADEMÁS de al guardar: un flujo guardado antes de esta regla no puede
  // convertirse en una llamada a la red interna sólo por ser viejo.
  if (esBloqueadaPorSsrf(url)) {
    return {
      status: 'failed',
      error: 'esa dirección es interna o privada y está bloqueada por seguridad',
    };
  }

  const metodo = (texto(cfg.method) || 'POST').toUpperCase();
  if (!['GET', 'POST', 'PUT'].includes(metodo)) {
    return { status: 'failed', error: `el método ${metodo} no está permitido` };
  }

  try {
    const res = await e.fetch(url, {
      method: metodo,
      headers: { 'content-type': 'application/json' },
      body:
        metodo === 'GET'
          ? undefined
          : JSON.stringify({
              tenant: e.ctx.tenantSlug,
              runId: e.run.id,
              contactId: e.run.contactId,
              context: e.run.context,
            }),
      signal: AbortSignal.timeout(TIMEOUT_WEBHOOK_MS),
      // No seguir un 302: es la forma barata de que una URL pública termine
      // apuntando hacia dentro. Ver la cabecera de ssrf.ts.
      redirect: 'error',
    });

    if (res.ok) return { status: 'ok', output: { http: res.status } };

    // 5xx y 429 del sistema del cliente son transitorios: su servidor puede
    // estar reiniciándose. Un 4xx es un contrato roto y no mejora esperando.
    const transitorio = res.status >= 500 || res.status === 429 || res.status === 408;
    return transitorio
      ? { status: 'paused', output: { razon: `tu sistema respondió ${res.status}`, http: res.status } }
      : { status: 'failed', error: `tu sistema respondió ${res.status}`, output: { http: res.status } };
  } catch (err) {
    return desenlaceDeError(err, 'llamar a tu sistema');
  }
}
