/**
 * @abraxa/billing — Stripe, alta self-service y suscripciones. Handoff H10.
 *
 * La puerta de entrada del producto: un emprendedor llega a la landing, paga
 * lo que quiera, y del otro lado del webhook ya tiene empresa, plan y un
 * correo con su enlace. Sin que nadie meta la mano.
 *
 * ── El mapa ───────────────────────────────────────────────────────────────
 *
 *   catalog.ts   qué planes existen y qué incluyen (la decisión es de aquí)
 *   slug.ts      del nombre del negocio a la URL, cumpliendo los CHECK de H2
 *   gateway.ts   la única frontera con Stripe · doble sin llaves
 *   store.ts     el único lugar con acceso a datos (`adminDb`, y por qué)
 *   service.ts   el BillingPort: sesión pagada → tenant
 *   correo.ts    la bienvenida, que nunca puede tumbar el webhook
 *   http.ts      las rutas
 *
 * ── Lo que NO es de este carril ───────────────────────────────────────────
 *
 *   · El login con Google es de H18. Aquí se programa contra la sesión como
 *     si existiera: `alta-gratis` lee el contrato de cabeceras de H2 y falla
 *     cerrado mientras nadie las mande.
 *   · `app.plans` la CREA H2 (migración 010). Aquí se decide su contenido y
 *     se sincroniza — un dueño de la decisión, varios consumidores.
 *   · El provisioning es `TenancyPort.provision()` de H2. Aquí sólo se llama.
 *   · Los planes intermedios y las banderas de features son de H16.
 */
import { registerPort } from '@abraxa/db';
import { router } from './http';
import { altaDesdeSesion } from './service';

export { router };
export { meta } from './meta';

// El contrato cruzado. H14 (panel de agencia) y cualquier reproceso manual
// entran por aquí, no por las rutas HTTP.
registerPort('billing', {
  async onCheckoutCompleted({ sessionId }) {
    const { tenantId, slug } = await altaDesdeSesion(sessionId);
    return { tenantId, slug };
  },
});

// ── Superficie pública del paquete ─────────────────────────────────────────

export {
  PLAN_CATALOG,
  PLAN_DE_PAGO,
  PLAN_POR_DEFECTO,
  MONEDA,
  MONTO,
  getPlan,
  isSellablePlan,
  montoDecimal,
  type Plan,
  type PlanId,
  type PlanLimits,
} from './catalog';

export {
  candidatosDeSlug,
  slugify,
  esSlugValido,
  MAX_CANDIDATOS,
  SLUGS_RESERVADOS,
  SLUG_PATRON,
  SLUG_LARGO_MAX,
  SLUG_LARGO_MIN,
} from './slug';

export {
  gateway,
  firmarComoStripe,
  GatewayDoble,
  __setGatewayForTests,
  type StripeGateway,
  type SesionDePago,
  type SesionDeCheckout,
  type EventoDeStripe,
} from './gateway';

/**
 * Empuja el catálogo de `catalog.ts` a `app.plans`.
 *
 * La migración 080 ya lo siembra, así que una base recién migrada arranca
 * coherente. Esto existe para cambiar límites sin pedir una migración: lo
 * llama el orquestador tras un deploy, o H14 desde el panel.
 */
export { syncPlanCatalog } from './store';

export { enlaceDeEntrada } from './correo';
export {
  altaDesdeSesion,
  altaDesdeSesionPagada,
  provisionarEmpresa,
  type ResultadoDeAlta,
} from './service';
