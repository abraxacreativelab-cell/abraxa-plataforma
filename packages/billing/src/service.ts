/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El alta self-service — de un pago a una empresa que ya puede entrar.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Éste es el `BillingPort`. Recibe el id de una sesión de checkout que ya
 *  pasó por la verificación de firma y termina con el tenant creado.
 *
 *  ── El invariante que manda sobre todos los demás ──────────────────────────
 *
 *  Un pago cobrado sin cuenta creada es el peor estado posible del sistema.
 *  Cuando algo falla después de que Stripe ya cobró, esto LANZA — para que el
 *  webhook devuelva un error y Stripe reintente. Tragarse el error y devolver
 *  200 deja al emprendedor pagado y sin producto, y a nosotros sin forma de
 *  enterarnos hasta que él escriba.
 *
 *  Por eso aquí no hay un solo `catch` que devuelva un valor por defecto.
 */
import { usePort, PlatformError } from '@abraxa/db';
import { centavosADecimal, isSellablePlan, PLAN_DE_PAGO } from './catalog';
import { gateway, type SesionDePago } from './gateway';
import { candidatosDeSlug } from './slug';
import { guardarSuscripcion } from './store';

/** Lo que el webhook necesita saber para mandar el correo, después del 200. */
export interface ResultadoDeAlta {
  tenantId: string;
  slug: string;
  /** `false` si el slug ya existía: es un reintento, no un alta nueva. */
  creado: boolean;
  ownerEmail: string;
  businessName: string;
}

/**
 * Sesión pagada → tenant.
 *
 * Idempotente por partida doble: la bitácora de eventos descarta el reintento
 * antes de llegar aquí, y si aun así llega —porque el intento anterior murió a
 * la mitad y hay que reprocesarlo— `provisionarEmpresa()` vuelve a caer en el
 * MISMO tenant y el upsert de la suscripción choca contra `UNIQUE (tenant_id)`.
 * Ninguna de las dos redes basta sola — la primera no cubre dos eventos
 * distintos del mismo pago, la segunda no cubre el correo duplicado.
 */
export async function altaDesdeSesion(sessionId: string): Promise<ResultadoDeAlta> {
  const sesion = await gateway().recuperarSesion(sessionId);
  return altaDesdeSesionPagada(sesion);
}

export async function altaDesdeSesionPagada(sesion: SesionDePago): Promise<ResultadoDeAlta> {
  const { ownerEmail, businessName, planId } = validarSesion(sesion);

  const { tenantId, slug, created } = await provisionarEmpresa({ businessName, ownerEmail });

  // Después del alta. Si esto truena, el webhook no devuelve 200 y Stripe
  // reintenta: `provision()` devolverá el mismo tenant y el upsert cerrará el
  // hueco. El orden importa — la empresa primero, el cobro después.
  await guardarSuscripcion({
    tenantId,
    planId,
    status: 'active',
    amountUsd:
      sesion.amountTotalCentavos !== null ? centavosADecimal(sesion.amountTotalCentavos) : null,
    stripeCustomerId: sesion.customerId,
    stripeSubscriptionId: sesion.subscriptionId,
    currentPeriodEnd: null,
  });

  return { tenantId, slug, creado: created, ownerEmail, businessName };
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Nombre del negocio → empresa creada, con el primer slug que la base acepte.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  ── El bug que esta función existe para no volver a tener ──────────────────
 *
 *  Antes esto eran dos pasos: preguntarle a la base si el slug estaba ocupado
 *  y luego llamar a `provision()` con el que estuviera libre. Pasaba typecheck,
 *  lint y una prueba que afirmaba justo lo contrario de lo que hacía en
 *  producción, y creaba una empresa de más por cada reproceso de un pago:
 *
 *    Lupita paga $25 · Stripe manda `evt_1`.
 *    1er intento → `panaderia-lupita` libre → se CREA el tenant → falla el
 *      upsert de la suscripción (un blip de red) → 500. Correcto: Stripe
 *      tiene que reintentar.
 *    Stripe reintenta el MISMO `evt_1` → `panaderia-lupita` ahora está
 *      OCUPADO, porque lo ocupó el intento anterior → `panaderia-lupita-2` →
 *      SEGUNDA empresa. Un pago, dos empresas, la suscripción colgada de la
 *      segunda y la primera huérfana pero funcional. Si falla N veces, N
 *      empresas.
 *
 *  ── Por qué así sí ─────────────────────────────────────────────────────────
 *
 *  El árbitro de "ocupado" es el DUEÑO, no la existencia de la fila, y quien
 *  sabe distinguirlo es `app.provision_tenant` (migración 011), que además lo
 *  hace dentro de la transacción:
 *
 *    · slug libre                     → lo crea, `created: true`
 *    · slug MÍO (mismo owner)         → devuelve el MISMO tenant, `created: false`
 *    · slug de OTRO (ABX01)           → CONFLICT (409)
 *
 *  Así que aquí no se pregunta nada de antemano: se intenta el candidato y sólo
 *  se avanza al siguiente sufijo cuando la base dice que ese slug es de otra
 *  persona. Un reintento del mismo pago vuelve a caer en el mismo tenant con
 *  `created: false`, que es exactamente lo que el contrato del port promete.
 *
 *  Y de paso desaparece la ventana entre el "¿está libre?" y el INSERT: dos
 *  altas simultáneas del mismo nombre ya no dependen de que el SELECT las vea.
 *
 *  Cualquier error que NO sea CONFLICT se relanza tal cual: un fallo de red no
 *  puede disfrazarse de colisión y mandarnos a crear `panaderia-lupita-2`.
 */
export async function provisionarEmpresa(i: {
  businessName: string;
  ownerEmail: string;
}): Promise<{ tenantId: string; slug: string; created: boolean }> {
  const candidatos = candidatosDeSlug(i.businessName);
  const tenancy = usePort('tenancy');

  let ultimoConflicto: PlatformError | null = null;

  for (const slug of candidatos) {
    try {
      const { tenantId, created } = await tenancy.provision({
        slug,
        name: i.businessName,
        ownerEmail: i.ownerEmail,
      });
      return { tenantId, slug, created };
    } catch (e) {
      if (!esSlugDeOtroDueno(e)) throw e;
      ultimoConflicto = e;
    }
  }

  // Todos los candidatos son de otra gente. Es un caso absurdo (101 negocios
  // llamados igual) y lanzar es lo correcto: Stripe reintenta, el evento queda
  // en la bitácora con el motivo y esto lo termina un humano. Inventar un slug
  // con uuid rompería el criterio #5 del handoff sin avisarle a nadie.
  throw new PlatformError(
    'CONFLICT',
    `No quedó ningún slug libre para "${i.businessName}": los ${candidatos.length} ` +
      'candidatos ya son de otras empresas. El alta necesita ojos humanos.',
    {
      details: { businessName: i.businessName, candidatos: candidatos.length },
      // El último rechazo de la base, para no perder el mensaje real detrás
      // del resumen.
      ...(ultimoConflicto ? { cause: ultimoConflicto } : {}),
    },
  );
}

/**
 * `true` si `provision()` rechazó el slug porque ya es de OTRO dueño.
 *
 * Es el contrato del port —"si el slug existe y pertenece a otra persona,
 * lanza CONFLICT"—, no un detalle de la implementación de H2: se mira el
 * `code` compartido, no el SQLSTATE `ABX01` que vive del otro lado.
 */
function esSlugDeOtroDueno(e: unknown): e is PlatformError {
  return PlatformError.is(e) && e.code === 'CONFLICT';
}

/**
 * Lo que tiene que traer una sesión para poder dar de alta.
 *
 * Todo lo que falte aquí es un incidente, no un caso normal: Stripe Checkout
 * siempre recoge el correo, y el nombre del negocio lo pusimos nosotros en la
 * metadata al crear la sesión. Si algo de esto viene vacío, alguien creó una
 * sesión por fuera de nuestro checkout — y ese pago necesita ojos humanos, no
 * un alta automática con datos inventados.
 */
function validarSesion(s: SesionDePago): {
  ownerEmail: string;
  businessName: string;
  planId: string;
} {
  if (s.paymentStatus !== 'paid') {
    throw new PlatformError(
      'VALIDATION',
      `La sesión ${s.id} no está pagada (payment_status='${s.paymentStatus}'). No se da de alta.`,
      { details: { sessionId: s.id } },
    );
  }

  const ownerEmail = (s.customerEmail ?? '').trim().toLowerCase();
  if (!ownerEmail) {
    throw new PlatformError(
      'VALIDATION',
      `La sesión ${s.id} está pagada pero no trae correo. Hay un pago cobrado sin ` +
        'a quién darle la cuenta: revísalo a mano en el panel de Stripe.',
      { details: { sessionId: s.id } },
    );
  }

  const businessName = (s.businessName ?? '').trim();
  if (!businessName) {
    throw new PlatformError(
      'VALIDATION',
      `La sesión ${s.id} no trae 'businessName' en la metadata. Sin nombre de negocio ` +
        'no hay slug, y sin slug no hay empresa.',
      { details: { sessionId: s.id } },
    );
  }

  // Un plan desconocido se trata como el plan de pago en vez de reventar: el
  // dinero ya entró y negarle la cuenta por un id de plan raro sería el peor
  // trato posible al que sí pagó. Queda anotado en la bitácora.
  const planId = s.planId && isSellablePlan(s.planId) ? s.planId : PLAN_DE_PAGO;
  if (s.planId && planId !== s.planId) {
    console.warn(
      `[billing] la sesión ${s.id} traía el plan '${s.planId}', que no está en el ` +
        `catálogo de v1. Se da de alta como '${planId}'.`,
    );
  }

  return { ownerEmail, businessName, planId };
}
