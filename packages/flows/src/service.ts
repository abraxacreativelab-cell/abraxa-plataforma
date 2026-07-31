/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Lo que el emprendedor puede hacer con sus automatizaciones.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Crear · editar · activar · pausar · volver a una versión · probar.
 *
 *  ── Las dos reglas de seguridad de la §7, aquí y no en la UI ───────────────
 *
 *  1. **Todo flujo nace en pausa.** El DEFAULT de la migración lo garantiza en
 *     el esquema; `crearFlujo` no le pasa `status`; y activar es una llamada
 *     APARTE. Tres capas para lo mismo porque el fallo es caro: un flujo
 *     encendido por accidente le escribe a los clientes de alguien.
 *
 *  2. **Activar y probar exigen rol admin.** Y se comprueba AQUÍ, en el
 *     servicio, no sólo en el botón: el botón deshabilitado es cortesía, esto
 *     es la puerta. El rol sale de `ctx`, que la ruta armó con
 *     `contextoDePeticion(req)` — el único camino en el que ese rol significa
 *     algo.
 */
import { PlatformError, tryPort } from '@abraxa/db';
import type { TenantContext, TriggerType } from '@abraxa/db';
import { contactos } from './crm';
import type { Encolar } from './engine/step';
import { enrolar } from './events';
import * as store from './store';
import type { Flow, FlowDefinition, FlowRun, FlowStep, RunSnapshot } from './types';
import { CATALOGO_VACIO, validar } from './validate';
import type { CatalogoDelTenant, Propuesta } from './validate';

/**
 * Quien activa o prueba tiene que poder responder por lo que el flujo haga.
 *
 * Se lanza `FORBIDDEN` con la razón escrita en español: la UI lo pinta tal
 * cual en el botón deshabilitado, para que nadie se tope con un 403 sorpresa
 * después de armar un flujo completo.
 */
function exigirAdmin(ctx: TenantContext, quehacer: string): void {
  if (ctx.role !== 'admin' && ctx.role !== 'owner') {
    throw new PlatformError(
      'FORBIDDEN',
      `${quehacer} exige rol admin: la automatización va a actuar sobre contactos reales ` +
        'de la empresa, y esa decisión tiene que tener dueño.',
    );
  }
}

// ════════════════════════════════════════════════════════════════════════════
// El catálogo real de la empresa
// ════════════════════════════════════════════════════════════════════════════

/**
 * Lo que existe de verdad en este tenant: sus etapas y su equipo.
 *
 * Alimenta al validador (para rechazar ids inventados) y al prompt del
 * asistente (para que proponga los reales). Es best effort: si el CRM no está
 * registrado, se devuelve vacío y el validador simplemente no valida contra
 * catálogo — mejor que negarse a guardar un flujo correcto.
 *
 * Las ETIQUETAS no vienen: `ContactsPort` no expone un listado de etiquetas
 * (en H15 la etiqueta ES su nombre, y el catálogo se derivaría de un DISTINCT
 * que el port no publica). Queda anotado en el PR como petición a H15; mientras
 * tanto, `add_tag` acepta cualquier etiqueta — que es el comportamiento
 * correcto de todos modos, porque crear una etiqueta nueva desde un flujo es
 * legítimo.
 */
export async function catalogoDelTenant(ctx: TenantContext): Promise<CatalogoDelTenant> {
  const catalogo: CatalogoDelTenant = { etapas: [], etiquetas: [], miembros: [] };

  try {
    const crm = contactos();
    if (crm) {
      for (const embudo of await crm.listPipelines(ctx)) {
        for (const etapa of embudo.stages) {
          catalogo.etapas.push({
            id: etapa.id,
            slug: etapa.slug,
            name: etapa.name,
            pipelineSlug: embudo.slug,
          });
        }
      }
    }
  } catch {
    /* best effort: ver la cabecera */
  }

  try {
    const tenancy = tryPort('tenancy');
    if (tenancy) {
      catalogo.miembros = (await tenancy.listMembers(ctx)).map((m) => ({
        email: m.email,
        name: m.name,
      }));
    }
  } catch {
    /* best effort */
  }

  return catalogo;
}

// ════════════════════════════════════════════════════════════════════════════
// Crear y editar
// ════════════════════════════════════════════════════════════════════════════

/** Un flujo vacío: sólo su disparador. Es con lo que abre el builder. */
export function definicionInicial(): FlowDefinition {
  return {
    nodes: [{ id: 'inicio', type: 'trigger', position: { x: 0, y: 0 }, data: { label: 'Cuando pase esto' } }],
    edges: [],
  };
}

/**
 * Valida y guarda. Es la ÚNICA puerta de escritura: por aquí pasa la propuesta
 * del asistente y también lo que el builder edita a mano. El cliente no es más
 * confiable que el modelo.
 */
export async function crear(ctx: TenantContext, propuesta: unknown): Promise<Flow> {
  const catalogo = await catalogoDelTenant(ctx);
  const r = validar(propuesta, catalogo);
  if (!r.ok || !r.propuesta) {
    throw new PlatformError('VALIDATION', 'la automatización no se puede ejecutar así', {
      details: { errores: r.errores },
    });
  }
  const p: Propuesta = r.propuesta;

  return store.crearFlujo(ctx, {
    name: p.name,
    description: p.description ?? null,
    triggerType: p.trigger_type as TriggerType,
    triggerConfig: p.trigger_config,
    definition: p.definition as FlowDefinition,
    createdBy: ctx.userEmail,
  });
}

/**
 * Guarda una edición y crea una versión nueva.
 *
 * NO cambia el estado: editar un flujo activo lo deja activo, y las corridas
 * en vuelo siguen con la versión con la que arrancaron (`flow_runs.version`).
 * Cambiar el guion a media obra es cómo un contacto recibe el mensaje 3 de la
 * versión vieja y el 4 de la nueva.
 */
export async function guardar(
  ctx: TenantContext,
  flujoId: string,
  propuesta: unknown,
  nota?: string,
): Promise<Flow> {
  const flujo = await store.exigirFlujo(ctx, flujoId);
  const catalogo = await catalogoDelTenant(ctx);
  const r = validar(propuesta, catalogo);
  if (!r.ok || !r.propuesta) {
    throw new PlatformError('VALIDATION', 'la automatización no se puede ejecutar así', {
      details: { errores: r.errores },
    });
  }
  const p = r.propuesta;

  return store.guardarFlujo(ctx, flujo, {
    name: p.name,
    description: p.description ?? null,
    triggerType: p.trigger_type as TriggerType,
    triggerConfig: p.trigger_config,
    definition: p.definition as FlowDefinition,
    note: nota ?? 'edición a mano',
    actor: ctx.userEmail,
  });
}

// ════════════════════════════════════════════════════════════════════════════
// Encender, apagar, volver atrás
// ════════════════════════════════════════════════════════════════════════════

/**
 * Enciende el flujo. Exige admin y vuelve a validar contra el catálogo actual.
 *
 * Revalidar no es paranoia: entre que se guardó y se activa pudo borrarse la
 * etapa a la que mueve. Activar un flujo que va a fallar en su tercer paso es
 * peor que no dejar activarlo y decir por qué.
 */
export async function activar(ctx: TenantContext, flujoId: string): Promise<Flow> {
  exigirAdmin(ctx, 'activar una automatización');
  const flujo = await store.exigirFlujo(ctx, flujoId);

  const r = validar(aPropuesta(flujo), await catalogoDelTenant(ctx));
  if (!r.ok) {
    throw new PlatformError('VALIDATION', 'no se puede activar: la automatización tiene problemas', {
      details: { errores: r.errores },
    });
  }

  await store.cambiarEstado(ctx, flujoId, 'active', ctx.userEmail);
  return { ...flujo, status: 'active', activatedBy: ctx.userEmail, activatedAt: new Date().toISOString() };
}

/** Apaga el flujo. NO exige admin: parar algo siempre puede hacerlo cualquiera. */
export async function pausar(ctx: TenantContext, flujoId: string): Promise<Flow> {
  const flujo = await store.exigirFlujo(ctx, flujoId);
  await store.cambiarEstado(ctx, flujoId, 'paused', ctx.userEmail);
  return { ...flujo, status: 'paused' };
}

export async function archivar(ctx: TenantContext, flujoId: string): Promise<void> {
  exigirAdmin(ctx, 'archivar una automatización');
  await store.exigirFlujo(ctx, flujoId);
  await store.cambiarEstado(ctx, flujoId, 'archived', ctx.userEmail);
}

/**
 * Vuelve a una versión anterior.
 *
 * No "revierte": COPIA esa versión encima como una versión nueva. El historial
 * es hacia adelante, así que volver a la v2 desde la v5 produce una v6 igual a
 * la v2 — y la v5 sigue ahí por si la vuelta atrás fue el error.
 *
 * Ésta es la función que hace que `flow_versions` no sea la tabla muerta que
 * fue en GARDEN.
 */
export async function volverAVersion(
  ctx: TenantContext,
  flujoId: string,
  version: number,
): Promise<Flow> {
  exigirAdmin(ctx, 'volver a una versión anterior');
  const flujo = await store.exigirFlujo(ctx, flujoId);
  const v = await store.obtenerVersion(ctx, flujoId, version);
  if (!v) throw new PlatformError('NOT_FOUND', `no existe la versión ${version} de esta automatización`);

  return store.guardarFlujo(ctx, flujo, {
    name: v.name,
    triggerType: v.triggerType,
    triggerConfig: v.triggerConfig,
    definition: v.definition,
    note: `restaurada de la versión ${version}`,
    actor: ctx.userEmail,
  });
}

// ════════════════════════════════════════════════════════════════════════════
// Probar
// ════════════════════════════════════════════════════════════════════════════

/**
 * Enrola UN contacto en ESTE flujo y sólo en éste.
 *
 * ── Por qué NO pasa por `emitirEvento` ─────────────────────────────────────
 *
 * Emitir el disparador de verdad haría dos daños. El primero es el que GARDEN
 * cometió y corrigió: arrastraría a TODOS los flujos activos con ese mismo
 * disparador sobre el contacto de prueba — mensajes reales de automatizaciones
 * que nadie quiso probar. El segundo es más callado: `emitirEvento` respeta
 * los FILTROS del disparador, así que probar un flujo que escucha "cambia a la
 * etapa Contactado" no enrolaría nada, y el botón se vería roto sin decir por
 * qué.
 *
 * Probar es un acto humano dirigido a UN flujo. Se enrola ese flujo, punto —
 * corra o no corra su disparador, esté activo o en pausa (para eso es probar).
 * La corrida queda marcada con `is_test`, y la UI la separa del historial real.
 */
export async function probar(
  ctx: TenantContext,
  flujoId: string,
  i: { contactId?: string; encolar: Encolar },
): Promise<{ corridas: number; razon?: string }> {
  exigirAdmin(ctx, 'probar una automatización');
  const flujo = await store.exigirFlujo(ctx, flujoId);

  const enrolada = await enrolar(
    ctx,
    flujo,
    { contactId: i.contactId ?? null, prueba: true },
    flujo.triggerType,
    { encolar: i.encolar, esPrueba: true },
  );

  return enrolada
    ? { corridas: 1 }
    : { corridas: 0, razon: 'ese contacto ya va corriendo esta automatización' };
}

// ════════════════════════════════════════════════════════════════════════════
// Lectura
// ════════════════════════════════════════════════════════════════════════════

export const listar = (ctx: TenantContext): Promise<Flow[]> => store.listarFlujos(ctx);
export const obtener = (ctx: TenantContext, id: string): Promise<Flow> => store.exigirFlujo(ctx, id);
export const versiones = (ctx: TenantContext, id: string) => store.listarVersiones(ctx, id);

export const corridas = (ctx: TenantContext, i: { flowId?: string; limit?: number }): Promise<FlowRun[]> =>
  store.listarCorridas(ctx, i);

/**
 * La foto de una corrida: es EXACTAMENTE lo que devuelve `GET /flows/runs/:id`
 * y lo que el panel en vivo pinta cada segundo.
 */
export async function corrida(ctx: TenantContext, runId: string): Promise<RunSnapshot> {
  const run = await store.obtenerCorrida(ctx, runId);
  if (!run) throw new PlatformError('NOT_FOUND', 'no existe esa corrida');
  const steps: FlowStep[] = await store.listarPasos(ctx, runId);
  return { run, steps };
}

/** Un flujo guardado, en la forma que come el validador. */
export function aPropuesta(flujo: Flow): Propuesta {
  return {
    name: flujo.name,
    description: flujo.description,
    trigger_type: flujo.triggerType,
    trigger_config: flujo.triggerConfig,
    definition: flujo.definition,
    notes: null,
  } as Propuesta;
}

/** Revisa un flujo sin guardarlo. Lo usa el builder para avisar mientras editas. */
export async function revisar(
  ctx: TenantContext,
  propuesta: unknown,
): Promise<{ ok: boolean; errores: string[] }> {
  const r = validar(propuesta, await catalogoDelTenant(ctx).catch(() => CATALOGO_VACIO));
  return { ok: r.ok, errores: r.errores };
}
