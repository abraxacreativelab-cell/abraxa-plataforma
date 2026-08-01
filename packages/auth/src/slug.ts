/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El slug de la empresa de un invitado. **Aquí vive el aislamiento.**
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Diez personas entran con diez cuentas de Google en el mismo minuto y cada
 *  una tiene que quedar en SU empresa. El slug es lo que las separa, porque es
 *  la llave por la que `app.provision_tenant()` decide si crea una empresa
 *  nueva o devuelve una que ya existe.
 *
 *  ── Por qué el correo COMPLETO y no el nombre ──────────────────────────────
 *
 *  La versión ingenua —y la primera que se escribe siempre— saca el slug del
 *  nombre de Google o de la parte local del correo:
 *
 *      ana@gmail.com    → "ana"
 *      ana@outlook.com  → "ana"      ← la misma empresa para dos personas
 *
 *  En un evento con invitados reales eso pasa a la primera: dos Marías, dos
 *  Juanes, dos "info@". Y `provision()` es idempotente **por slug para el mismo
 *  dueño**, así que el segundo no entra a la empresa del primero —recibe
 *  CONFLICT— pero se queda sin empresa, delante de todos.
 *
 *  Por eso el slug lleva una huella del correo entero. Dos correos distintos
 *  dan slugs distintos SIEMPRE, aunque la parte local sea idéntica. Y el mismo
 *  correo da el mismo slug SIEMPRE, que es lo que hace que volver a entrar
 *  mañana caiga en la misma empresa y no en una nueva.
 *
 *  ── Por qué la huella no es SHA-256 ────────────────────────────────────────
 *
 *  Porque esto también corre en el runtime Edge, donde `node:crypto` no existe
 *  y `crypto.subtle` es asíncrono. FNV-1a de 64 bits es diez líneas, síncrono,
 *  determinista y sin dependencias. No es criptográfico y no hace falta que lo
 *  sea: el slug no es un secreto —aparece en la URL— y lo único que se le pide
 *  es que dos correos distintos no coincidan. Con 8 caracteres en base 36 el
 *  espacio es ~2^41; para diez invitados, o para diez mil, la probabilidad de
 *  choque es indistinguible de cero.
 *
 *  Y aun así no se confía en ella: `empresaDe()` reintenta con un
 *  discriminador si la API responde CONFLICT. Una improbabilidad no es una
 *  garantía, y el día del evento no se depura una colisión.
 *
 *  ── El formato tiene que cuadrar con la base ───────────────────────────────
 *
 *  `SLUG_RE` de H2 (packages/tenancy/src/schemas.ts) y el CHECK
 *  `tenants_slug_formato` de la migración 010 exigen lo mismo:
 *
 *      /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/      · de 3 a 40 caracteres
 *
 *  Se replica aquí como `FORMATO_SLUG` en vez de importarse de `@abraxa/tenancy`
 *  a propósito: este módulo lo carga el BFF de Next, y arrastrar el paquete de
 *  tenancy —con `adminDb()`, `pg` y el registro de ports dentro— al bundle del
 *  navegador para leer una expresión regular sería mucho peor que copiarla.
 *  `slug.test.ts` compara las dos y falla si alguien mueve una sin la otra.
 */

/** Debe ser idéntica a `SLUG_RE` de packages/tenancy/src/schemas.ts. */
export const FORMATO_SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

/** Cuánto del correo cabe antes de la huella. Deja sitio de sobra para ella. */
const MAX_BASE = 24;

/** Longitud de la huella en base 36. */
const LARGO_HUELLA = 8;

const OFFSET_FNV = 0xcbf29ce484222325n;
const PRIMO_FNV = 0x100000001b3n;
const MASCARA_64 = 0xffffffffffffffffn;

/**
 * FNV-1a de 64 bits, en base 36. Determinista y sin dependencias.
 *
 * Se recorre por BYTES y no por caracteres (`TextEncoder`) para que un correo
 * con acentos o con un dominio internacionalizado dé la misma huella aquí que
 * en cualquier otro runtime — `charCodeAt` sobre un par sustituto habría dado
 * resultados distintos según cómo llegara normalizada la cadena.
 */
export function huella(texto: string, largo = LARGO_HUELLA): string {
  let h = OFFSET_FNV;
  for (const byte of new TextEncoder().encode(texto)) {
    h = ((h ^ BigInt(byte)) * PRIMO_FNV) & MASCARA_64;
  }
  return h.toString(36).padStart(13, '0').slice(-largo);
}

/** El correo, normalizado igual que en `app.users`: minúsculas y sin espacios. */
const normalizar = (correo: string): string => correo.trim().toLowerCase();

/**
 * El slug determinista de la empresa de este correo.
 *
 * Mismo correo → mismo slug, siempre. Correos distintos → slugs distintos,
 * siempre. Ésas son las dos propiedades de las que cuelga el aislamiento.
 */
export function slugDeCorreo(correo: string): string {
  const limpio = normalizar(correo);

  const local = (limpio.split('@')[0] ?? '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_BASE)
    .replace(/-+$/g, '');

  // Sin base utilizable —"@ejemplo.com", "____@x.com"— la huella sola no
  // cumpliría el formato si empezara por un dígito seguido de nada más, así
  // que se antepone una palabra. "equipo" no está en RESERVED_SLUGS y el
  // sufijo la hace única de todos modos.
  const base = local.length > 0 ? local : 'equipo';

  return `${base}-${huella(limpio)}`;
}

/**
 * El mismo slug con un discriminador, para el caso que no debería ocurrir.
 *
 * `intento` empieza en 2 porque el 1 es el slug sin sufijo. Se usa sólo cuando
 * la API responde CONFLICT: el slug existe y es de otra persona.
 */
export function slugAlternativo(correo: string, intento: number): string {
  const base = slugDeCorreo(correo);
  const sufijo = `-${intento}`;
  // Recortar por la izquierda rompería la huella; se recorta la parte legible.
  const recorte = Math.max(0, base.length + sufijo.length - 40);
  return `${base.slice(0, base.length - recorte).replace(/-+$/g, '')}${sufijo}`;
}

/**
 * Cómo se va a llamar la empresa mientras el Ritual de Fundación no la bautice.
 *
 * Se prefiere el nombre de Google porque es lo que la persona reconoce en la
 * pantalla: ver "Ana Ruiz" arriba a la izquierda dos segundos después de haber
 * apretado un botón es la señal de que entró de verdad. Si Google no manda
 * nombre —pasa con cuentas de Workspace restringidas— se cae a la parte local
 * del correo, capitalizada.
 *
 * El mínimo de 2 caracteres es de `provisionInputSchema` (H2). Un nombre de
 * una sola letra se rellena en vez de reventar el alta con un 422 delante del
 * invitado.
 */
export function nombreDeEmpresa(correo: string, nombreDeGoogle?: string | null): string {
  const deGoogle = (nombreDeGoogle ?? '').trim();
  if (deGoogle.length >= 2) return deGoogle.slice(0, 120);

  const local = (normalizar(correo).split('@')[0] ?? '').replace(/[._-]+/g, ' ').trim();
  const legible = local
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => (p[0] ?? '').toUpperCase() + p.slice(1))
    .join(' ');

  return legible.length >= 2 ? legible.slice(0, 120) : 'Mi empresa';
}
