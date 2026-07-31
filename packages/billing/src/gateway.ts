/**
 * ════════════════════════════════════════════════════════════════════════════
 *  La frontera con Stripe.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Todo lo que sabe de Stripe vive aquí. El resto del paquete habla de
 *  `SesionDePago` y `EventoDeStripe`, no de `Stripe.Checkout.Session`, para
 *  que un cambio de versión de la API se arregle en un archivo.
 *
 *  ── Sin llaves, pero no sin pruebas ────────────────────────────────────────
 *
 *  Cuando no hay `STRIPE_SECRET_KEY` se usa un doble en memoria. El doble
 *  finge la RED —crear una sesión, recuperarla— y NADA MÁS.
 *
 *  La verificación de firma NUNCA se finge: la hace el `stripe` de verdad, con
 *  su criptografía de verdad, incluso en el doble. Un doble que dijera "firma
 *  válida ✔" convertiría la prueba de seguridad más importante del webhook en
 *  una prueba de que el doble devuelve `true`. Construir el cliente de Stripe
 *  no toca la red, así que no hay ninguna razón para no usar el real.
 */
import Stripe from 'stripe';
import { env } from '@abraxa/config';
import { PlatformError } from '@abraxa/db';
import { MONEDA, MONTO, type PlanId, getPlan } from './catalog';

// ────────────────────────────────────────────────────────────────────────────
// El vocabulario propio — lo que el resto del paquete conoce
// ────────────────────────────────────────────────────────────────────────────

export interface CrearCheckoutInput {
  /** El nombre del negocio que capturó antes de pagar. De aquí sale el slug. */
  businessName: string;
  planId: PlanId;
  /** Si ya se conoce (vino de una sesión), Stripe lo prellena. */
  ownerEmail?: string;
  successUrl: string;
  cancelUrl: string;
}

export interface SesionDeCheckout {
  id: string;
  /** A dónde mandar al navegador. `null` si Stripe no la devolvió. */
  url: string | null;
}

/** Una sesión de Stripe ya normalizada a lo que el alta necesita. */
export interface SesionDePago {
  id: string;
  /** `paid` es el único valor con el que se da de alta. */
  paymentStatus: string;
  /**
   * El `amount_total` de Stripe, tal cual: un entero en la UNIDAD MÍNIMA de
   * `currency`, no necesariamente centavos. En yenes la unidad mínima es el
   * yen y en dinares kuwaitíes la milésima — por eso el nombre miente un poco
   * y por eso `montoDecimal()` (catalog.ts) exige la moneda para convertirlo.
   * Nunca lo dividas entre 100 aquí.
   */
  amountTotalCentavos: number | null;
  /** ISO-4217 en minúsculas. Se PERSISTE junto a la cifra: ver el hallazgo B. */
  currency: string | null;
  customerEmail: string | null;
  customerId: string | null;
  subscriptionId: string | null;
  businessName: string | null;
  planId: string | null;
}

/** Lo mínimo de un evento de Stripe que este paquete usa. */
export interface EventoDeStripe {
  id: string;
  type: string;
  /** El evento completo, tal cual, para la bitácora. */
  raw: unknown;
  /** El id de la sesión de checkout, si el evento la trae. */
  sessionId: string | null;
}

export interface StripeGateway {
  /** `stripe` = llaves reales · `doble` = en memoria, sin red. */
  readonly modo: 'stripe' | 'doble';
  crearCheckout(i: CrearCheckoutInput): Promise<SesionDeCheckout>;
  recuperarSesion(sessionId: string): Promise<SesionDePago>;
  /**
   * Verifica la firma y devuelve el evento. LANZA si la firma no cuadra.
   * `cuerpo` tiene que ser el cuerpo CRUDO: si Express ya lo parseó a objeto,
   * el HMAC se calcula sobre bytes distintos a los que firmó Stripe y todo
   * evento legítimo se rechaza.
   */
  verificarEvento(cuerpo: Buffer | string, firma: string): EventoDeStripe;
}

// ────────────────────────────────────────────────────────────────────────────
// Normalización — un solo lugar que conoce la forma de Stripe
// ────────────────────────────────────────────────────────────────────────────

function normalizarSesion(s: Stripe.Checkout.Session): SesionDePago {
  const meta = s.metadata ?? {};
  return {
    id: s.id,
    paymentStatus: s.payment_status ?? 'unpaid',
    amountTotalCentavos: s.amount_total ?? null,
    currency: s.currency ?? null,
    // `customer_details.email` es el que de verdad escribió el comprador.
    // `customer_email` sólo viene si nosotros lo prellenamos.
    customerEmail: s.customer_details?.email ?? s.customer_email ?? null,
    customerId: typeof s.customer === 'string' ? s.customer : (s.customer?.id ?? null),
    subscriptionId:
      typeof s.subscription === 'string' ? s.subscription : (s.subscription?.id ?? null),
    businessName: meta.businessName ?? null,
    planId: meta.planId ?? null,
  };
}

function normalizarEvento(e: Stripe.Event): EventoDeStripe {
  const obj = e.data?.object as { id?: string; object?: string } | undefined;
  return {
    id: e.id,
    type: e.type,
    raw: e,
    sessionId: obj?.object === 'checkout.session' ? (obj.id ?? null) : null,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Verificación de firma — compartida por el real y el doble
// ────────────────────────────────────────────────────────────────────────────

/**
 * Construir el cliente NO toca la red, así que el doble usa este mismo camino.
 * La llave de aquí sólo sirve para instanciar; la firma se verifica con el
 * signing secret, que es otra cosa.
 */
const CLAVE_INERTE = 'sk_test_sin_llaves_solo_para_construir_el_cliente';

function verificarCon(
  stripe: Stripe,
  cuerpo: Buffer | string,
  firma: string,
  secreto: string | undefined,
): EventoDeStripe {
  if (!secreto) {
    // Fail-closed. Sin signing secret NO se puede distinguir un webhook de
    // Stripe de uno que mandó cualquiera con la URL — y esa URL es pública.
    // Aceptar "por ahora" es regalar un endpoint que crea empresas gratis.
    throw new PlatformError(
      'INTERNAL',
      'STRIPE_WEBHOOK_SECRET no está configurado. Sin él no se puede verificar ' +
        'la firma, y un webhook sin verificar es un endpoint público que da de ' +
        'alta empresas. Se rechaza todo hasta que exista.',
    );
  }

  if (!firma) {
    throw new PlatformError('UNAUTHENTICATED', 'Falta la cabecera stripe-signature.');
  }

  try {
    return normalizarEvento(stripe.webhooks.constructEvent(cuerpo, firma, secreto));
  } catch (causa) {
    throw new PlatformError('UNAUTHENTICATED', 'Firma de Stripe inválida.', {
      cause: causa,
      details: { motivo: causa instanceof Error ? causa.message : String(causa) },
    });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// El gateway real
// ────────────────────────────────────────────────────────────────────────────

/**
 * Se exporta para poder probarlo con un doble de `Stripe`.
 *
 * Lo que hay que probar aquí no es que Stripe funcione —eso es su trabajo—,
 * sino que NO se cree un `Price` nuevo por cada visita a la landing. Ese es un
 * fallo que no se nota: el checkout funciona perfecto y la cuenta de Stripe se
 * llena de precios huérfanos hasta que alguien abre el panel meses después.
 */
export class GatewayStripe implements StripeGateway {
  readonly modo = 'stripe' as const;

  constructor(
    private readonly stripe: Stripe,
    private readonly signingSecret: string | undefined,
  ) {}

  /**
   * El precio de monto libre de cada plan, memorizado por proceso.
   *
   * No es un caché de rendimiento: es lo que evita crear un `Price` nuevo en
   * la cuenta de Stripe por cada visita a la landing.
   */
  private readonly precios = new Map<PlanId, string>();

  /**
   * ── Dónde vive de verdad el "monto libre" ─────────────────────────────────
   *
   * `custom_unit_amount` NO existe en el `price_data` que se escribe en línea
   * dentro de `line_items`: es de la API de **Prices**. Escribirlo en el
   * checkout compila con `as any` y después falla en la llamada real, que es
   * la peor forma de descubrirlo — con un cliente enfrente. Así que el precio
   * se crea aparte y el checkout sólo lo referencia.
   *
   * Se busca por `lookup_key` antes de crear. Sin eso, cada reinicio del
   * proceso dejaría un `Price` huérfano más en la cuenta, y a los seis meses
   * nadie sabe cuál es el bueno.
   */
  private async precioDeMontoLibre(planId: PlanId): Promise<string> {
    const memorizado = this.precios.get(planId);
    if (memorizado) return memorizado;

    const plan = getPlan(planId);
    if (!plan) {
      throw new PlatformError('VALIDATION', `El plan '${planId}' no está en el catálogo.`);
    }

    // La llave incluye la moneda y los topes: si mañana cambian, se crea un
    // precio nuevo en vez de reusar uno que ya no dice lo mismo.
    const lookupKey =
      `abraxa_${planId}_libre_${MONEDA}_` +
      `${MONTO.MINIMO_CENTAVOS}_${MONTO.MAXIMO_CENTAVOS}_${MONTO.PRESET_CENTAVOS}`;

    const existentes = await this.stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 });
    const yaEsta = existentes.data[0];
    if (yaEsta) {
      this.precios.set(planId, yaEsta.id);
      return yaEsta.id;
    }

    const precio = await this.stripe.prices.create({
      currency: MONEDA,
      product_data: { name: `ABRAXA ${plan.name}` },
      // Esto ES el monto libre: Stripe le pinta un campo para que escriba
      // cuánto quiere dar, con el preset ya puesto.
      custom_unit_amount: {
        enabled: true,
        minimum: MONTO.MINIMO_CENTAVOS,
        maximum: MONTO.MAXIMO_CENTAVOS,
        preset: MONTO.PRESET_CENTAVOS,
      },
      lookup_key: lookupKey,
      metadata: { planId },
    });

    this.precios.set(planId, precio.id);
    return precio.id;
  }

  async crearCheckout(i: CrearCheckoutInput): Promise<SesionDeCheckout> {
    if (!getPlan(i.planId)) {
      throw new PlatformError('VALIDATION', `El plan '${i.planId}' no está en el catálogo.`);
    }

    const price = await this.precioDeMontoLibre(i.planId);

    const s = await this.stripe.checkout.sessions.create({
      // `custom_unit_amount` sólo funciona en pagos de una vez. El día que
      // esto sea suscripción recurrente no basta con cambiar el `mode`: hay
      // que cambiar de enfoque (precios fijos o por tramos).
      mode: 'payment',
      line_items: [{ price, quantity: 1 }],
      success_url: i.successUrl,
      cancel_url: i.cancelUrl,
      ...(i.ownerEmail ? { customer_email: i.ownerEmail } : {}),
      // El nombre del negocio viaja en la metadata porque el webhook llega
      // sin nuestro formulario: es la ÚNICA forma de saber a qué negocio
      // corresponde el pago cuando Stripe nos habla de vuelta.
      metadata: { businessName: i.businessName, planId: i.planId },
    });

    return { id: s.id, url: s.url ?? null };
  }

  async recuperarSesion(sessionId: string): Promise<SesionDePago> {
    const s = await this.stripe.checkout.sessions.retrieve(sessionId);
    return normalizarSesion(s);
  }

  verificarEvento(cuerpo: Buffer | string, firma: string): EventoDeStripe {
    return verificarCon(this.stripe, cuerpo, firma, this.signingSecret);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// El doble — finge la red, no la criptografía
// ────────────────────────────────────────────────────────────────────────────

export class GatewayDoble implements StripeGateway {
  readonly modo = 'doble' as const;
  private readonly stripe = new Stripe(CLAVE_INERTE);
  private readonly sesiones = new Map<string, SesionDePago>();
  private n = 0;

  constructor(private readonly signingSecret: string | undefined) {}

  async crearCheckout(i: CrearCheckoutInput): Promise<SesionDeCheckout> {
    const plan = getPlan(i.planId);
    if (!plan) {
      throw new PlatformError('VALIDATION', `El plan '${i.planId}' no está en el catálogo.`);
    }

    const id = `cs_test_doble_${++this.n}`;
    this.sesiones.set(id, {
      id,
      paymentStatus: 'paid',
      amountTotalCentavos: MONTO.PRESET_CENTAVOS,
      currency: MONEDA,
      customerEmail: i.ownerEmail ?? `pagador${this.n}@ejemplo.mx`,
      customerId: `cus_test_doble_${this.n}`,
      subscriptionId: null,
      businessName: i.businessName,
      planId: i.planId,
    });

    // La URL apunta a nuestro propio success_url: sin llaves no hay pasarela a
    // dónde mandar a nadie, y un `null` aquí rompería el redirect del front
    // por una razón que no tiene nada que ver con el front.
    return { id, url: `${i.successUrl}${i.successUrl.includes('?') ? '&' : '?'}doble=1` };
  }

  async recuperarSesion(sessionId: string): Promise<SesionDePago> {
    const s = this.sesiones.get(sessionId);
    if (!s) {
      throw new PlatformError('NOT_FOUND', `El doble no conoce la sesión '${sessionId}'.`);
    }
    return s;
  }

  verificarEvento(cuerpo: Buffer | string, firma: string): EventoDeStripe {
    return verificarCon(this.stripe, cuerpo, firma, this.signingSecret);
  }

  /** Sólo para pruebas: siembra una sesión con la forma que se quiera probar. */
  sembrarSesion(s: SesionDePago): void {
    this.sesiones.set(s.id, s);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Selección
// ────────────────────────────────────────────────────────────────────────────

let cache: StripeGateway | null = null;

/**
 * El gateway del proceso. Con llaves, el real; sin llaves, el doble.
 *
 * Se avisa por consola una sola vez y con todas sus letras: un despliegue que
 * arranca en modo doble cobra $0 y da de alta a cualquiera que llame al
 * webhook con una firma válida de un secreto de prueba. Enterarse por los
 * logs el primer día es mucho mejor que enterarse por un cliente.
 */
export function gateway(): StripeGateway {
  if (cache) return cache;
  const e = env();

  if (e.STRIPE_SECRET_KEY) {
    cache = new GatewayStripe(new Stripe(e.STRIPE_SECRET_KEY), e.STRIPE_WEBHOOK_SECRET);
  } else {
    console.warn(
      '[billing] Sin STRIPE_SECRET_KEY: gateway en modo DOBLE. No se cobra nada real. ' +
        'El checkout devuelve una URL falsa y la verificación de firma sigue siendo real.',
    );
    cache = new GatewayDoble(e.STRIPE_WEBHOOK_SECRET);
  }
  return cache;
}

/** Sólo para pruebas: inyecta un gateway y devuelve cómo quitarlo. */
export function __setGatewayForTests(g: StripeGateway | null): () => void {
  const previo = cache;
  cache = g;
  return () => {
    cache = previo;
  };
}

/**
 * Firma un payload como lo haría Stripe. Es para PRUEBAS y para el
 * `stripe-cli` casero: permite ejercitar el webhook de punta a punta con
 * payloads de ejemplo cuando todavía no hay llaves.
 */
export function firmarComoStripe(payload: string, secreto: string, ahora?: number): string {
  return new Stripe(CLAVE_INERTE).webhooks.generateTestHeaderString({
    payload,
    secret: secreto,
    ...(ahora !== undefined ? { timestamp: ahora } : {}),
  });
}
