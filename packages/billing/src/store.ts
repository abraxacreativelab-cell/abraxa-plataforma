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
 *    · `app.tenants.plan`, y SÓLO esa columna, por la misma razón que la
 *      anterior: es una decisión de cobro escrita desde el webhook. Está aquí
 *      porque el `TenancyPort` no deja pasar el plan en el alta —ver
 *      `asegurarPlanDelTenant()` abajo—, y se va el día que lo deje.
 *
 *  Los tres primeros son los que `client.ts` enumera como legítimos. El cuarto
 *  no está en esa lista, y por eso lleva escrito arriba por qué existe y
 *  cuándo se va — que es lo que `client.ts` pide de cualquier uso fuera de
 *  ella. Los cuatro quedan encerrados en este archivo para que se puedan
 *  contar con la mano: ninguna ruta ni servicio de este paquete toca la base
 *  directamente.
 */
import { adminDb, PlatformError } from '@abraxa/db';
import { isSellablePlan, PLAN_CATALOG } from './catalog';

/** Postgres: violación de unicidad. Es el mecanismo de idempotencia, no un error. */
const UNIQUE_VIOLATION = '23505';

// ────────────────────────────────────────────────────────────────────────────
// Bitácora de eventos
// ────────────────────────────────────────────────────────────────────────────

export interface EventoRegistrado {
  /** `true` si Stripe ya nos había mandado este evento. */
  duplicado: boolean;
  /**
   * `true` sólo si una pasada anterior lo terminó (`processed_at` puesto).
   *
   * La distinción es la que evita el peor error de este archivo. Ver abajo.
   */
  yaProcesado: boolean;
}

/**
 * Registra el evento y dice si ya lo habíamos visto Y si ya lo terminamos.
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
 *
 * ── Por qué "duplicado" NO basta, y esto casi sale mal ─────────────────────
 *
 * La versión obvia devuelve sólo `duplicado` y el webhook contesta 200 en
 * cuanto lo ve. Pero el evento se registra ANTES de procesarlo, así que un
 * primer intento que falla a la mitad —`provision()` bien y el `INSERT` de la
 * suscripción mal— deja la fila escrita y sin terminar. El reintento de
 * Stripe entra, ve "duplicado", contesta 200 y **el alta nunca se completa**:
 * queda una empresa sin su registro de cobro y Stripe convencido de que todo
 * salió bien. Es exactamente el estado que la regla 4 del handoff quiere
 * evitar, colándose por la puerta de la regla 2.
 *
 * Por eso se distingue: sólo se corta el paso si la pasada anterior TERMINÓ.
 * Si no terminó, el reintento vuelve a procesar — y puede hacerlo sin miedo
 * porque `provision()` es idempotente por slug (H2) y la suscripción entra
 * por `upsert` contra `UNIQUE (tenant_id)`.
 */
export async function registrarEvento(i: {
  stripeEventId: string;
  type: string;
  payload: unknown;
}): Promise<EventoRegistrado> {
  const db = adminDb();
  const { error } = await db
    .from('billing_events')
    .insert({ stripe_event_id: i.stripeEventId, type: i.type, payload: i.payload });

  if (!error) return { duplicado: false, yaProcesado: false };

  if (error.code === UNIQUE_VIOLATION) {
    const { data, error: errorLectura } = await db
      .from('billing_events')
      .select('processed_at')
      .eq('stripe_event_id', i.stripeEventId)
      .maybeSingle();

    if (errorLectura) {
      // No se sabe si se terminó. Reintentar es seguro (todo aguas abajo es
      // idempotente); dar por bueno un alta que quizá no ocurrió, no.
      throw new PlatformError(
        'INTERNAL',
        `No se pudo leer el estado del evento ${i.stripeEventId}: ${errorLectura.message}`,
        { retryable: true },
      );
    }

    return { duplicado: true, yaProcesado: Boolean(data?.processed_at) };
  }

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
// Slugs — aquí NO hay nada, y es a propósito
// ────────────────────────────────────────────────────────────────────────────
//
// Aquí vivía `slugOcupado(slug)`: un SELECT sobre `app.tenants` que contestaba
// si la fila existía. Era fail-closed y tenía prueba, y aun así era el defecto
// más caro de este carril: al reprocesar un pago que había quedado a medias,
// encontraba ocupado el slug que ÉL MISMO había creado en el intento anterior
// y mandaba a `provision()` con `panaderia-lupita-2` — una segunda empresa por
// un solo pago.
//
// La existencia de la fila nunca fue la pregunta correcta. La correcta es "¿es
// de otro dueño?", y eso lo contesta `app.provision_tenant` dentro de su propia
// transacción. Ver `provisionarEmpresa()` en `service.ts`.
//
// Si alguien vuelve a necesitar "¿está libre este slug?" para una vista previa
// de la landing: que sea una consulta de LECTURA que no decida nada. La
// decisión es de la base.

// ────────────────────────────────────────────────────────────────────────────
// Suscripciones
// ────────────────────────────────────────────────────────────────────────────

export interface SuscripcionInput {
  tenantId: string;
  planId: string;
  status: string;
  /** La cifra, en la unidad de `moneda`. Va SIEMPRE acompañada de ella. */
  monto: number | null;
  /** ISO-4217 en minúsculas, como la manda Stripe. `null` sólo si `monto` lo es. */
  moneda: string | null;
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
 *
 * ── Por qué la moneda es obligatoria cuando hay cifra ──────────────────────
 *
 * Antes la columna se llamaba `amount_usd` y aquí entraba el monto de la
 * sesión sin mirar en qué moneda estaba: una sesión de $500 MXN quedaba
 * escrita como 500 dólares. La columna es `amount` + `currency` y el CHECK de
 * la migración exige que aparezcan las dos o ninguna. Esto lo comprueba antes
 * de escribir para que el fallo se lea aquí, y no como un mensaje de Postgres
 * con el pago ya cobrado.
 */
export async function guardarSuscripcion(i: SuscripcionInput): Promise<void> {
  const moneda = i.moneda === null ? null : i.moneda.trim().toLowerCase();

  if ((i.monto === null) !== (moneda === null)) {
    throw new PlatformError(
      'VALIDATION',
      `La suscripción del tenant ${i.tenantId} trae ${i.monto === null ? 'moneda sin cifra' : 'cifra sin moneda'}. ` +
        'Una cifra sin su moneda no es un dato, es una suposición: no se guarda.',
      { details: { tenantId: i.tenantId, monto: i.monto, moneda } },
    );
  }

  const { error } = await adminDb()
    .from('subscriptions')
    .upsert(
      {
        tenant_id: i.tenantId,
        plan_id: i.planId,
        status: i.status,
        amount: i.monto,
        currency: moneda,
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
// El plan del tenant
// ────────────────────────────────────────────────────────────────────────────

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Sube a `app.tenants.plan` el plan que la persona acaba de pagar.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  ── El defecto que cierra (hallazgo C del PR #11) ──────────────────────────
 *
 *  `app.provision_tenant` da de alta con `p_plan DEFAULT 'free'`, y el
 *  `TenancyPort` de H2 **no expone `plan` en `ProvisionInput`**. El alta lo
 *  llamaba sin plan, así que quien pagaba terminaba con tres verdades:
 *
 *    app.tenants.plan          = 'free'   ← la que consulta `assertQuota()`
 *    app.subscriptions.plan_id = 'pro'    ← la que dice el cobro
 *    el recibo de Stripe        = "ABRAXA Pro"
 *
 *  Manda la primera. El que pagó por 10 asientos choca contra el límite de 2
 *  del plan gratis y escribe a soporte con su recibo en la mano.
 *
 *  ── Por qué un UPDATE desde aquí y no `provision(plan)` ────────────────────
 *
 *  Porque `provision(plan)` es lo correcto y NO se puede hacer desde este
 *  carril: `ProvisionInput` vive en `packages/db/ports.ts` (H1) y su
 *  implementación en `packages/tenancy/src/port.ts` (H2). El servicio de H2 YA
 *  acepta `plan?: string` —`services/provision.ts`— y `app.provision_tenant`
 *  YA recibe `p_plan`: lo único que falta son dos líneas en dos archivos
 *  ajenos. Queda anotado como deuda en el PR; el día que aterricen, esta
 *  función se borra y el plan viaja dentro de la transacción del alta.
 *
 *  Mientras tanto: el UPDATE es idempotente (el reproceso de un webhook lo
 *  repite sin consecuencia) y LANZA si falla, porque cobrar `pro` y dejar a
 *  alguien en `free` no puede terminar en un 200.
 *
 *  ── Y por qué `adminDb()` sobre una tabla que no es de este paquete ────────
 *
 *  Es el cuarto caso de la lista de arriba y el único que toca `app.tenants`:
 *  ocurre dentro del webhook, donde no hay sesión de nadie —el que "pide" es
 *  Stripe—, y el dato que escribe es una decisión de cobro, que es de H10. No
 *  lo copies para leer o escribir nada más de esa tabla.
 */
export async function asegurarPlanDelTenant(tenantId: string, planId: string): Promise<void> {
  // `app.tenants.plan` tiene FOREIGN KEY contra `app.plans`. Un id fuera del
  // catálogo reventaría el UPDATE con el pago ya cobrado; se corta antes y con
  // un mensaje que dice qué pasó.
  if (!isSellablePlan(planId)) {
    throw new PlatformError(
      'VALIDATION',
      `El plan '${planId}' no está en el catálogo de v1: no se le puede asignar al tenant ${tenantId}.`,
      { details: { tenantId, planId } },
    );
  }

  const { error } = await adminDb().from('tenants').update({ plan: planId }).eq('id', tenantId);

  if (error) {
    throw new PlatformError(
      'INTERNAL',
      `No se pudo poner al tenant ${tenantId} en el plan '${planId}': ${error.message}. ` +
        'Pagó y se quedaría en el plan gratis: mejor que Stripe reintente.',
      { details: { tenantId, planId }, retryable: true },
    );
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
