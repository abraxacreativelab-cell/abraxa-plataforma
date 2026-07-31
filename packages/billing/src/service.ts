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
import { derivarSlug } from './slug';
import { guardarSuscripcion, slugOcupado } from './store';

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
 * antes de llegar aquí, y si aun así llega, `provision()` es idempotente por
 * slug (H2) y el upsert de la suscripción choca contra `UNIQUE (tenant_id)`.
 * Ninguna de las dos redes basta sola — la primera no cubre dos eventos
 * distintos del mismo pago, la segunda no cubre el correo duplicado.
 */
export async function altaDesdeSesion(sessionId: string): Promise<ResultadoDeAlta> {
  const sesion = await gateway().recuperarSesion(sessionId);
  return altaDesdeSesionPagada(sesion);
}

export async function altaDesdeSesionPagada(sesion: SesionDePago): Promise<ResultadoDeAlta> {
  const { ownerEmail, businessName, planId } = validarSesion(sesion);

  // El slug se deriva ANTES de llamar a provision() porque `slugOcupado` es
  // fail-closed: si la base no contesta, esto lanza aquí y Stripe reintenta,
  // en vez de mandar un slug inventado a una función transaccional.
  const slug = await derivarSlug(businessName, slugOcupado);

  const { tenantId, created } = await usePort('tenancy').provision({
    slug,
    name: businessName,
    ownerEmail,
  });

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
