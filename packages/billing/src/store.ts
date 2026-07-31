/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El acceso a datos del cobro.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  ── Por qué aquí sí va `adminDb()` ─────────────────────────────────────────
 *
 *  La regla del repo es que TODO dato de dominio pasa por `tenantDb(ctx)`, y
 *  ESLint la impone en `routes/` y `services/`. Este archivo no es ninguno de
 *  los dos, y la razón no es de nombre:
 *
 *    · `app.plans` es catálogo global — no tiene `tenant_id` que filtrar.
 *    · `app.billing_events` llega ANTES de que el tenant exista: el pago es lo
 *      que lo crea. No hay contexto que construir.
 *    · `app.subscriptions` SÍ tiene `tenant_id`, pero se escribe dentro del
 *      webhook, donde no hay sesión de nadie: el que "pide" es Stripe.
 *
 *  Los tres casos son exactamente los que `client.ts` enumera como legítimos.
 *  Quedan encerrados en este archivo para que se puedan contar con la mano:
 *  ninguna ruta ni servicio de este paquete toca la base directamente.
 */
import { adminDb, PlatformError } from '@abraxa/db';
import { PLAN_CATALOG } from './catalog';

/** Postgres: violación de unicidad. Es el mecanismo de idempotencia, no un error. */
const UNIQUE_VIOLATION = '23505';

// ────────────────────────────────────────────────────────────────────────────
// Bitácora de eventos
// ────────────────────────────────────────────────────────────────────────────

export interface EventoRegistrado {
  /** `true` si Stripe ya nos había mandado este evento. */
  duplicado: boolean;
}

/**
 * Registra el evento y dice si ya lo habíamos visto.
 *
 * ── La idempotencia vive aquí, en la base ──────────────────────────────────
 *
 * Stripe reintenta. Dos reintentos pueden llegar A LA VEZ —lo hace cuando el
 * primero tarda—, y "SELECT y si no está, INSERT" tiene una ventana entre las
 * dos consultas por la que caben los dos. El `UNIQUE (stripe_event_id)` no
 * tiene esa ventana: uno de los dos INSERT pierde, y perder es la respuesta
 * correcta.
 *
 * Por eso esto inserta primero y pregunta después, en vez de al revés.
 */
export async function registrarEvento(i: {
  stripeEventId: string;
  type: string;
  payload: unknown;
}): Promise<EventoRegistrado> {
  const { error } = await adminDb()
    .from('billing_events')
    .insert({ stripe_event_id: i.stripeEventId, type: i.type, payload: i.payload });

  if (!error) return { duplicado: false };
  if (error.code === UNIQUE_VIOLATION) return { duplicado: true };

  throw new PlatformError('INTERNAL', `No se pudo registrar el evento de Stripe: ${error.message}`, {
    details: { stripeEventId: i.stripeEventId },
    // Si no se puede escribir la bitácora, no se puede garantizar
    // idempotencia. Reintentar es preferible a procesar a ciegas.
    retryable: true,
  });
}

/** Marca el evento como resuelto. Lo que queda sin marcar es lo que se investiga. */
export async function marcarProcesado(stripeEventId: string): Promise<void> {
  const { error } = await adminDb()
    .from('billing_events')
    .update({ processed_at: new Date().toISOString(), error: null })
    .eq('stripe_event_id', stripeEventId);

  if (error) {
    // No se relanza: el alta YA ocurrió. Tumbar la respuesta aquí haría que
    // Stripe reintentara un evento que sí se procesó.
    console.error(`[billing] no se pudo marcar ${stripeEventId} como procesado:`, error.message);
  }
}

/**
 * Anota por qué falló y suma un intento.
 *
 * Se lee `attempts` de vuelta y se escribe +1 en vez de usar un contador
 * atómico porque una carrera aquí sólo desajusta una estadística, y la
 * alternativa —una función en la base— es infraestructura de H2.
 */
export async function marcarError(stripeEventId: string, motivo: string): Promise<void> {
  const db = adminDb();
  const { data } = await db
    .from('billing_events')
    .select('attempts')
    .eq('stripe_event_id', stripeEventId)
    .maybeSingle();

  const { error } = await db
    .from('billing_events')
    .update({ error: motivo.slice(0, 2000), attempts: (data?.attempts ?? 0) + 1 })
    .eq('stripe_event_id', stripeEventId);

  if (error) {
    console.error(`[billing] no se pudo anotar el error de ${stripeEventId}:`, error.message);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Slugs
// ────────────────────────────────────────────────────────────────────────────

/**
 * ¿Ya hay una empresa con este slug?
 *
 * FAIL-CLOSED: si la consulta falla, LANZA en vez de devolver `false`. Un
 * `false` por error de red haría que `derivarSlug` entregara un slug ocupado,
 * y el INSERT moriría contra el UNIQUE después de que Stripe ya cobró.
 */
export async function slugOcupado(slug: string): Promise<boolean> {
  const { data, error } = await adminDb()
    .from('tenants')
    .select('slug')
    .eq('slug', slug)
    .maybeSingle();

  if (error) {
    throw new PlatformError('INTERNAL', `No se pudo verificar el slug '${slug}': ${error.message}`, {
      retryable: true,
    });
  }
  return data !== null;
}

// ────────────────────────────────────────────────────────────────────────────
// Suscripciones
// ────────────────────────────────────────────────────────────────────────────

export interface SuscripcionInput {
  tenantId: string;
  planId: string;
  status: string;
  amountUsd: number | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: string | null;
}

/**
 * Alta o actualización de la suscripción del tenant.
 *
 * `onConflict: 'tenant_id'` es lo que hace seguro el reintento: la segunda
 * pasada del mismo webhook actualiza la misma fila en vez de crear una
 * segunda suscripción para la misma empresa.
 */
export async function guardarSuscripcion(i: SuscripcionInput): Promise<void> {
  const { error } = await adminDb()
    .from('subscriptions')
    .upsert(
      {
        tenant_id: i.tenantId,
        plan_id: i.planId,
        status: i.status,
        amount_usd: i.amountUsd,
        stripe_customer_id: i.stripeCustomerId,
        stripe_subscription_id: i.stripeSubscriptionId,
        current_period_end: i.currentPeriodEnd,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id' },
    );

  if (error) {
    throw new PlatformError('INTERNAL', `No se pudo guardar la suscripción: ${error.message}`, {
      details: { tenantId: i.tenantId },
      retryable: true,
    });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Sync del catálogo
// ────────────────────────────────────────────────────────────────────────────

/**
 * Empuja el catálogo de `catalog.ts` a `app.plans`.
 *
 * Es la mitad de runtime de la decisión que la migración 080 siembra: el
 * código es el original, la tabla es el espejo. Correrlo al arrancar deja la
 * base coherente sin pedir una migración por cada cambio de límites.
 *
 * NO borra planes que no estén en el catálogo: un plan que desaparece de la
 * tabla se lleva por delante el `REFERENCES app.plans(id)` de toda suscripción
 * que lo use. Retirar un plan es desactivarlo (`active = false`), y eso se
 * hace desde el catálogo.
 */
export async function syncPlanCatalog(): Promise<{ sincronizados: number }> {
  const filas = PLAN_CATALOG.map((p) => ({
    id: p.id,
    name: p.name,
    limits: p.limits,
    position: p.position,
    active: p.active,
  }));

  const { error } = await adminDb().from('plans').upsert(filas, { onConflict: 'id' });

  if (error) {
    throw new PlatformError('INTERNAL', `No se pudo sincronizar el catálogo: ${error.message}`);
  }
  return { sincronizados: filas.length };
}
