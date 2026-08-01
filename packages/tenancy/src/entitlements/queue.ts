/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Verificar AL EJECUTAR, no sólo al encolar.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * §2.5 del handoff, y es el modo de fallo clásico de todo sistema con cola y
 * con planes:
 *
 *   Un job encolado el martes con plan `pro`, que corre el jueves después de
 *   una baja a `free`, **corre igual**. El único momento en que alguien mira el
 *   plan es al encolar, si es que alguien lo mira.
 *
 * No aparece hasta que hay volumen suficiente para que la cola tenga latencia.
 * Se cierra ahora, cuando la cola está vacía y no cuesta nada.
 *
 * ── Por qué esto es un envoltorio y no un cambio en el worker ───────────────
 *
 * `apps/worker/src/index.ts` es un andamio limpio de H1: `registerQueue()`,
 * `pg-boss`, `batchSize: 1`, y nada de negocio. No debe tenerlo, y además no es
 * de este carril. La verificación se hace donde sí se puede: en el handler de
 * cada cola. Quien registra una cola la envuelve y se acabó.
 *
 *     registerQueue('flows.run', withEntitlement('flows.publish', async (job, ctx) => {
 *       await correrFlujo(ctx, job.data.flowId);
 *     }));
 *
 * ── Por qué NO lanza ────────────────────────────────────────────────────────
 *
 * Un handler que lanza hace que pg-boss reintente. Reintentar un job que no se
 * puede correr porque el cliente no paga es hacer la misma consulta cada pocos
 * minutos hasta agotar los reintentos, y después dejarlo en `failed` — que se
 * lee como "el sistema está roto" cuando lo que pasa es que el sistema
 * funcionó. El job se completa, y el motivo queda en `app.plan_skips`.
 */
import { tenantDb } from '@abraxa/db';
import type { TenantContext } from '@abraxa/db';
import { can } from './can';
import { estadoDeEmpresa } from './gate';
import { log } from './logger';
import type { FeatureKey, SkipReason } from './catalogo';

/**
 * Lo mínimo que un job tiene que traer para poder verificarse.
 *
 * `tenantId` se acepta en tres formas porque los carriles ya encolan de tres
 * maneras distintas y no es este carril quien va a uniformarlas. Lo que no se
 * acepta es que no venga: un job sin empresa no se puede acotar, y correrlo
 * "por si acaso" es justo lo que este archivo existe para impedir.
 */
export interface JobConTenant {
  tenantId?: string;
  tenant_id?: string;
  id?: string;
  name?: string;
  data?: { tenantId?: string; tenant_id?: string };
}

const tenantIdDe = (job: unknown): string | null => {
  const j = (job ?? {}) as JobConTenant;
  const candidato = j.tenantId ?? j.tenant_id ?? j.data?.tenantId ?? j.data?.tenant_id;
  return typeof candidato === 'string' && candidato.length > 0 ? candidato : null;
};

const nombreDe = (job: unknown, porDefecto: string): string => {
  const j = (job ?? {}) as JobConTenant;
  return typeof j.name === 'string' && j.name.length > 0 ? j.name : porDefecto;
};

const idDe = (job: unknown): string | null => {
  const j = (job ?? {}) as JobConTenant;
  return typeof j.id === 'string' && j.id.length > 0 ? j.id : null;
};

/**
 * Deja constancia de que un trabajo NO se corrió, y por qué.
 *
 * Best-effort a propósito: si no se puede escribir el registro, se avisa por el
 * log y el job igual NO se corre. Al revés —correr el trabajo porque no se pudo
 * anotar que no se iba a correr— sería dejar que un fallo de bitácora abra la
 * puerta que la bitácora sólo documenta.
 */
async function registrarOmision(
  ctx: TenantContext,
  i: { feature: string | null; queue: string; jobId: string | null; reason: SkipReason },
): Promise<void> {
  try {
    const { error } = await tenantDb(ctx).from('plan_skips').insert({
      feature_key: i.feature,
      queue: i.queue,
      job_id: i.jobId,
      reason: i.reason,
    });
    if (error) throw error;
  } catch (e) {
    log.warn(
      `no se pudo registrar la omisión del job ${i.queue}/${i.jobId ?? '?'} ` +
        `(${i.reason}): ${String(e)}`,
    );
  }
}

export interface WithEntitlementOptions {
  /** Nombre de la cola, para el registro. Si se omite, se toma del job. */
  queue?: string;
  /**
   * Se llama cuando el trabajo se omite. Es el enganche para métricas y para
   * las pruebas; el registro en base ocurre de todos modos.
   */
  onSkip?: (i: { tenantId: string | null; reason: SkipReason; feature: FeatureKey | string }) => void;
}

/**
 * Envuelve el handler de una cola con la verificación de plan **en el momento
 * de correr**, que es todo el punto de §2.5.
 *
 * Tres puertas, en este orden, y el orden importa:
 *
 *   1. ¿el job trae empresa?      no → omitido `tenant_unknown`
 *   2. ¿la empresa está viva?     no → omitido `tenant_suspended`/`tenant_archived`
 *   3. ¿tiene la función?         no → omitido `feature_not_in_plan`
 *
 * La 2 va antes que la 3 porque son dos preguntas distintas con dos respuestas
 * distintas para el cliente: "estás suspendido" no es "no contrataste esto", y
 * confundirlas manda al emprendedor a la pantalla equivocada. Además, un tenant
 * suspendido da `false` en TODAS las funciones (regla 3 de §6), así que sin este
 * orden toda suspensión se reportaría como una función no contratada.
 */
export function withEntitlement<T>(
  feature: FeatureKey | string,
  handler: (job: T, ctx: TenantContext) => Promise<void>,
  opciones: WithEntitlementOptions = {},
): (job: T) => Promise<void> {
  return async (job: T): Promise<void> => {
    const cola = opciones.queue ?? nombreDe(job, String(feature));
    const jobId = idDe(job);
    const tenantId = tenantIdDe(job);

    const omitir = async (reason: SkipReason, ctx: TenantContext | null): Promise<void> => {
      if (ctx) await registrarOmision(ctx, { feature: String(feature), queue: cola, jobId, reason });
      opciones.onSkip?.({ tenantId, reason, feature });
      log.warn(
        `job omitido: cola=${cola} job=${jobId ?? '?'} tenant=${tenantId ?? '?'} ` +
          `funcion=${String(feature)} motivo=${reason}`,
      );
    };

    // 1 · ¿de quién es este trabajo?
    if (!tenantId) {
      await omitir('tenant_unknown', null);
      return;
    }

    // Una sola lectura para las puertas 2 y 3: este código corre en bucle, y
    // dos consultas por job es el doble de carga en el único punto del sistema
    // que se ejecuta miles de veces.
    const { liveness, contexto } = await estadoDeEmpresa(tenantId);

    // 2 · ¿la empresa puede consumir recursos AHORA?
    if (!liveness.live) {
      // El contexto viene aunque esté suspendida: hay que poder ESCRIBIR el
      // registro de omisión. Guardar es gratis; actuar cuesta.
      await omitir(
        liveness.reason === 'archived'
          ? 'tenant_archived'
          : liveness.reason === 'suspended'
            ? 'tenant_suspended'
            : 'tenant_unknown',
        contexto,
      );
      return;
    }

    if (!contexto) {
      await omitir('tenant_unknown', null);
      return;
    }

    // 3 · ¿su plan incluye esto, con el plan de AHORA y no el de cuando se encoló?
    if (!(await can(contexto, feature))) {
      await omitir('feature_not_in_plan', contexto);
      return;
    }

    await handler(job, contexto);
  };
}

/**
 * Igual, pero sin exigir una función concreta: sólo comprueba que la empresa
 * esté viva. Para las colas que no cuelgan de ninguna función del catálogo pero
 * que igual gastan (un resumen nocturno, un recordatorio).
 */
export function withLiveTenant<T>(
  handler: (job: T, ctx: TenantContext) => Promise<void>,
  opciones: WithEntitlementOptions = {},
): (job: T) => Promise<void> {
  return async (job: T): Promise<void> => {
    const cola = opciones.queue ?? nombreDe(job, 'sin-nombre');
    const jobId = idDe(job);
    const tenantId = tenantIdDe(job);

    if (!tenantId) {
      opciones.onSkip?.({ tenantId: null, reason: 'tenant_unknown', feature: '' });
      log.warn(`job omitido: cola=${cola} job=${jobId ?? '?'} motivo=tenant_unknown`);
      return;
    }

    const { liveness, contexto } = await estadoDeEmpresa(tenantId);

    if (!liveness.live) {
      const reason: SkipReason =
        liveness.reason === 'archived'
          ? 'tenant_archived'
          : liveness.reason === 'suspended'
            ? 'tenant_suspended'
            : 'tenant_unknown';
      if (contexto) await registrarOmision(contexto, { feature: null, queue: cola, jobId, reason });
      opciones.onSkip?.({ tenantId, reason, feature: '' });
      log.warn(`job omitido: cola=${cola} job=${jobId ?? '?'} tenant=${tenantId} motivo=${reason}`);
      return;
    }

    if (!contexto) return;

    await handler(job, contexto);
  };
}
