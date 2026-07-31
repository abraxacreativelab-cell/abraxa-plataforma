/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Del nombre del negocio al slug de la URL.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  `mi.abraxa.club/panaderia-lupita`, no `mi.abraxa.club/7f3a9c1e-…`. El slug
 *  lo va a leer el emprendedor, lo va a dictar por teléfono y lo va a escribir
 *  en su perfil de Instagram. Que sea legible no es estética.
 *
 *  ── El contrato que hay que cumplir ────────────────────────────────────────
 *
 *  `app.tenants` tiene dos CHECK que H2 escribió (010_tenancy.sql):
 *
 *    slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'   → 3 a 40, sin guion en las
 *                                                    puntas, sólo a-z 0-9 y -
 *    slug NOT IN (…lista de rutas del producto…)
 *
 *  Un slug inválido no es un 422 bonito: es una `provision()` que revienta
 *  DESPUÉS de que Stripe ya cobró. Por eso esto se valida aquí y la base es la
 *  segunda red, no la primera.
 */

/**
 * Rutas del producto que no pueden ser el slug de nadie.
 *
 * Espeja el CHECK `tenants_slug_no_reservado` de H2. Está duplicado a
 * propósito: no se puede importar un CHECK de Postgres desde TypeScript, y la
 * alternativa —descubrirlo cuando la base rechaza el INSERT— pasa con el pago
 * ya cobrado.
 *
 * Si divergen, la base gana y aquí sólo se pierde una vuelta: el nombre
 * reservado se trata como "ocupado" y sale con sufijo, que es exactamente lo
 * que uno quiere.
 */
export const SLUGS_RESERVADOS: ReadonlySet<string> = new Set([
  'api', 'admin', 'app', 'auth', 'www', 'static', 'assets', 'public',
  'login', 'logout', 'signin', 'signup', 'health', 'internal', 'webhook',
  'webhooks', 'stripe', 'tenants', 'tenant', 'invitations', 'invite',
  'onboarding', 'ritual', 'bandeja', 'mapa', 'tareas', 'automatizaciones',
  'direccion', 'settings', 'ajustes', 'billing', 'cobro', 'support',
  'soporte', 'docs', 'blog', 'status', 'null', 'undefined',
]);

export const SLUG_LARGO_MIN = 3;
export const SLUG_LARGO_MAX = 40;

/** El mismo patrón que el CHECK de la base, para poder afirmarlo en pruebas. */
export const SLUG_PATRON = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

/**
 * Normaliza un nombre de negocio a la forma del slug, SIN resolver colisiones.
 *
 * "Panadería Lupita" → "panaderia-lupita"
 * "CAFÉ  &  Té  ☕"  → "cafe-te"
 * "Ñoño's"           → "nonos"
 */
export function slugify(nombre: string): string {
  const base = (nombre ?? '')
    .normalize('NFD')
    // Quita los diacríticos que la descomposición dejó sueltos. Sin esto,
    // "panadería" se vuelve "panaderi-a": la tilde es su propio carácter.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // La ñ no se descompone en NFD como las vocales acentuadas.
    .replace(/ñ/g, 'n')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return recortar(base, SLUG_LARGO_MAX);
}

/** Recorta a `max` sin dejar un guion colgando en la punta. */
function recortar(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max).replace(/-+$/, '');
}

/**
 * Rellena un slug demasiado corto hasta el mínimo de la base.
 *
 * Un negocio llamado "Ya" da "ya", que la base rechaza por corto. Devolver un
 * error ahí sería absurdo: el nombre es válido, el problema es nuestro.
 */
function alargar(s: string): string {
  if (s.length >= SLUG_LARGO_MIN) return s;
  if (s.length === 0) return 'negocio';
  return `${s}-negocio`.slice(0, SLUG_LARGO_MAX);
}

/** `true` si el slug pasaría los dos CHECK de `app.tenants`. */
export function esSlugValido(slug: string): boolean {
  return SLUG_PATRON.test(slug) && !SLUGS_RESERVADOS.has(slug);
}

/** Tope de candidatos. Cada uno cuesta un viaje a la base en el peor caso. */
export const MAX_CANDIDATOS = 100;

/**
 * Los slugs que este nombre puede tener, en orden de preferencia.
 *
 * `panaderia-lupita`, `panaderia-lupita-2`, `panaderia-lupita-3`… Todos
 * legibles — que es el criterio #5 del handoff — y todos válidos contra los
 * CHECK de `app.tenants`. Los reservados y los que no pasarían el patrón se
 * saltan en silencio: "Stripe" (el negocio de alguien) empieza en `stripe-2`.
 *
 * ── Por qué esto ya NO pregunta "¿está ocupado?" ───────────────────────────
 *
 * La versión anterior recibía un `estaOcupado(slug)` y devolvía el primer
 * libre. Parecía correcta y tenía prueba, y creaba una SEGUNDA empresa por
 * cada reproceso de un pago:
 *
 *   1er intento del webhook: `panaderia-lupita` libre → se crea el tenant →
 *   falla el paso siguiente (un blip de red al guardar la suscripción) → 500.
 *   Stripe reintenta EL MISMO evento → `panaderia-lupita` ahora está ocupado
 *   (lo ocupó él mismo) → `panaderia-lupita-2` → segunda empresa, con un solo
 *   pago. Si el fallo se repite N veces, N empresas.
 *
 * El árbitro de "ocupado" no puede ser la existencia de la fila: tiene que ser
 * el DUEÑO. Y eso ya lo sabe `app.provision_tenant` (migración 011), que
 * devuelve el mismo tenant si el dueño coincide y ABX01 si es de otro. Así que
 * esta función se quedó pura —sólo genera candidatos— y quien da de alta
 * prueba en orden hasta que la base acepte uno: ver `provisionarEmpresa()` en
 * `service.ts`.
 *
 * @param maxIntentos cuántos candidatos generar. Es el tope de reintentos del
 *   alta; sin él, un nombre absurdamente colisionado se volvería un bucle
 *   dentro de un webhook de pago.
 */
export function candidatosDeSlug(nombre: string, maxIntentos = MAX_CANDIDATOS): string[] {
  const base = alargar(slugify(nombre));
  const candidatos: string[] = [];

  for (let n = 1; n <= maxIntentos; n++) {
    const candidato = n === 1 ? base : conSufijo(base, n);
    // Un nombre reservado se trata como ocupado: sale con sufijo en vez de
    // reventar. "Stripe" (el negocio de alguien) → "stripe-2".
    if (SLUGS_RESERVADOS.has(candidato)) continue;
    if (!esSlugValido(candidato)) continue;
    candidatos.push(candidato);
  }

  return candidatos;
}

/** `panaderia-lupita` + 2 → `panaderia-lupita-2`, respetando el largo máximo. */
function conSufijo(base: string, n: number): string {
  const sufijo = `-${n}`;
  const espacio = SLUG_LARGO_MAX - sufijo.length;
  return `${recortar(base, espacio)}${sufijo}`;
}
