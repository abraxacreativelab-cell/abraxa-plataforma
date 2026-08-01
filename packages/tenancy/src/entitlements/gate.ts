/**
 * ════════════════════════════════════════════════════════════════════════════
 *  La puerta que hoy no existe: el camino SIN SESIÓN.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Ésta es la entrega que se puede medir en pesos.
 *
 * ── El hueco, con archivo y línea ───────────────────────────────────────────
 *
 * `contextFor()` (`services/context.ts:63-79`) SÍ niega la entrada a un tenant
 * cuyo `status` no es `active`. Está bien hecho y no hay nada que corregirle.
 *
 * Pero el webhook entrante no pasa por ahí. Pasa por `contextoDeCanal()`
 * (`packages/inbox/src/context.ts`, rama h6-inbox), que arma el `TenantContext`
 * con la fila del canal y nada más:
 *
 *     return { tenantId, tenantSlug: canal.tenant_slug ?? '', userEmail: null,
 *              role: null, areas: {} };
 *
 * No mira `app.tenants.status`. No PUEDE: la fila del canal no lo trae. Es un
 * atajo correcto para lo que fue diseñado —acotar a un tenant sin sesión— y su
 * archivo lo explica con honestidad. Lo que nadie escribió es el paso siguiente.
 *
 * Consecuencia hoy: suspendes una empresa por falta de pago, esa empresa se
 * queda fuera del producto… y su WhatsApp sigue recibiendo mensajes, su agente
 * sigue contestando, y cada respuesta carga tokens a nuestra cuenta. **El
 * cliente que dejó de pagar es el que más nos cuesta.**
 *
 * ── Dónde se corta, y dónde NO ──────────────────────────────────────────────
 *
 * Se corta en la línea del GASTO, no antes:
 *
 *   · guardar el mensaje entrante es gratis y no pierde información del cliente
 *     final — cuando la empresa vuelva, ahí está;
 *   · contestarlo cuesta tokens.
 *
 * Un sistema que tira los mensajes de una empresa suspendida le hace perder
 * ventas a alguien que a lo mejor paga mañana. Por eso `tenantIsLive()`
 * devuelve el motivo en vez de lanzar: quien llama decide qué hacer con cada
 * mitad, y puede REGISTRAR por qué no hizo nada.
 */
// `adminDb` y no `tenantDb` a propósito, y con la razón escrita como pide
// CONTRIBUTING.md: esto se llama ANTES de que exista un contexto de empresa —
// es lo que decide si se puede construir uno. Acotarlo al contexto sería
// circular, exactamente por lo mismo que `findTenantBySlug` vive en `db/`
// (ver el encabezado de `db/queries.ts`). `app.tenants` se filtra por `id`,
// que ES su llave de aislamiento.
import { adminDb } from '@abraxa/db';
import type { MembershipRole, TenantContext } from '@abraxa/db';
import { mapPgError } from '../errors';
import { empresaNoActiva } from './errores';
import type { TenantLiveness } from './catalogo';

interface FilaTenant {
  id: string;
  slug: string;
  status: string;
  plan: string;
}

async function filaDe(tenantId: string): Promise<FilaTenant | null> {
  if (typeof tenantId !== 'string' || tenantId.length === 0) return null;

  const { data, error } = await adminDb()
    .from('tenants')
    .select('id, slug, status, plan')
    .eq('id', tenantId)
    .maybeSingle();

  if (error) throw mapPgError(error, 'No se pudo leer el estado de la empresa');
  return (data as FilaTenant | null) ?? null;
}

/**
 * ¿Esta empresa puede consumir recursos ahora mismo?
 *
 * Es lo que `contextFor()` hace para una persona, pero para un camino sin
 * sesión: webhook, job del worker, cron. Devuelve el motivo para que quien
 * llama pueda registrar POR QUÉ no hizo nada.
 *
 * ── Fail-closed ────────────────────────────────────────────────────────────
 *
 * Un error de red o de base devuelve `{ live: false, reason: 'unknown' }`,
 * nunca `live: true`. La regla es la misma que la de `canSignIn()`
 * (`services/context.ts:167-175`): la única forma de pasar es que algo diga
 * explícitamente que sí.
 *
 * Aquí importa el doble, porque el costo de los dos errores no es simétrico:
 * dejar pasar a un suspendido cuesta tokens en cada mensaje, durante días, sin
 * que nadie lo note. Frenar a uno activo por un timeout se nota en minutos.
 *
 * | Camino           | Qué hace quien llama si `live:false`                    |
 * |------------------|---------------------------------------------------------|
 * | Webhook entrante | GUARDA el mensaje y no contesta. No se pierde nada       |
 * | Job del worker   | Marca el job omitido con motivo. No reintenta en bucle   |
 * | Envío saliente   | Rechaza con FORBIDDEN y lo registra                      |
 */
export async function tenantIsLive(tenantId: string): Promise<TenantLiveness> {
  return (await estadoDeEmpresa(tenantId)).liveness;
}

/**
 * La liveness Y el contexto en UNA sola lectura.
 *
 * Existe porque el camino del worker necesita las dos cosas en cada job, y
 * pedirlas por separado son dos consultas por trabajo — el doble de carga en el
 * único punto del sistema que corre en bucle. Las dos salen de la misma fila.
 *
 * `contexto` viene aunque la empresa NO esté viva: hace falta para poder
 * ESCRIBIR el registro de omisión de una empresa suspendida. Es la misma línea
 * que el handoff traza para el webhook — guardar es gratis, actuar cuesta.
 */
export async function estadoDeEmpresa(
  tenantId: string,
): Promise<{ liveness: TenantLiveness; contexto: TenantContext | null }> {
  let fila: FilaTenant | null;

  try {
    fila = await filaDe(tenantId);
  } catch {
    return { liveness: { live: false, reason: 'unknown' }, contexto: null };
  }

  if (!fila) return { liveness: { live: false, reason: 'unknown' }, contexto: null };

  const contexto: TenantContext = {
    tenantId: fila.id,
    tenantSlug: fila.slug,
    userEmail: null,
    role: null as MembershipRole | null,
    areas: {},
  };

  if (fila.status === 'active') return { liveness: { live: true }, contexto };

  return {
    liveness: { live: false, reason: fila.status === 'suspended' ? 'suspended' : 'archived' },
    contexto,
  };
}

/**
 * Lo mismo, pero lanzando. Para el envío SALIENTE, donde no hay nada que
 * guardar y seguir sería gastar.
 */
export async function assertTenantLive(tenantId: string): Promise<void> {
  const estado = await tenantIsLive(tenantId);
  if (estado.live) return;
  throw empresaNoActiva(estado.reason);
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Un `TenantContext` para un camino sin sesión. NO es para HTTP.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ── Léase esto antes de usarlo ─────────────────────────────────────────────
 *
 * La regla del repo es que un `TenantContext` de una PETICIÓN se arma
 * únicamente con `contextoDePeticion(req)` de `@abraxa/db`, y esa regla no
 * tiene excepciones: cuatro carriles escribieron su propio resolvedor de
 * cabeceras y tres dejaron abierta la suplantación de identidad
 * (CONTRIBUTING.md §"Quién pide"). Esta función **no la toca**, porque no
 * existe petición: un job de pg-boss y un cron no tienen `req`, no tienen
 * cabeceras y no tienen persona.
 *
 * Lo que hace es lo único que se puede hacer con honestidad en ese camino:
 * resolver la empresa por su `id` —que ya venía en el job, puesto por quien lo
 * encoló dentro de un contexto verificado— y dejar la identidad VACÍA:
 *
 *     userEmail: null   no hay persona detrás de un cron
 *     role: null        y por lo tanto tampoco rol
 *     areas: {}         deny por defecto en el RBAC, que es lo correcto
 *
 * El contexto que sale de aquí sirve para acotar datos por empresa. NO sirve
 * para autorizar nada que dependa de quién pide, y `areas: {}` lo garantiza:
 * cualquier `requireArea()` sobre él falla.
 *
 * Y lanza si la empresa no está activa, que es el punto entero del archivo.
 */
export async function contextoDeSistema(tenantId: string): Promise<TenantContext> {
  const fila = await filaDe(tenantId).catch(() => null);

  if (!fila) throw empresaNoActiva('unknown');
  if (fila.status !== 'active') {
    throw empresaNoActiva(fila.status === 'suspended' ? 'suspended' : 'archived');
  }

  return {
    tenantId: fila.id,
    tenantSlug: fila.slug,
    userEmail: null,
    role: null as MembershipRole | null,
    areas: {},
  };
}

/**
 * Contexto de sólo lectura para una empresa que puede NO estar activa.
 *
 * Existe para lo único que se hace con una empresa suspendida: guardar el
 * mensaje entrante que llegó, y enseñarle su propia pantalla de plan. Está
 * separada de `contextoDeSistema()` a propósito — si fuera un parámetro
 * booleano, el camino que gasta dinero y el que no compartirían firma, y
 * alguien acabaría pasando `true` sin pensarlo.
 */
export async function contextoDeSistemaAunSuspendida(
  tenantId: string,
): Promise<TenantContext | null> {
  const fila = await filaDe(tenantId).catch(() => null);
  if (!fila) return null;

  return {
    tenantId: fila.id,
    tenantSlug: fila.slug,
    userEmail: null,
    role: null as MembershipRole | null,
    areas: {},
  };
}
