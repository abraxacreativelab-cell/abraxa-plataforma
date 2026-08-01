/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El giro, resuelto contra el catálogo real. No inventado.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  ── El defecto que cierra este archivo (auditoría PR #8) ──────────────────
 *
 *  `tenants.industry_type` NO es texto libre: la migración 033 dice, con todas
 *  sus letras, que apunta a `app.industry_templates.id` — y esa tabla ya trae
 *  cinco filas sembradas. H7 estaba escribiendo ahí un slug inventado a partir
 *  de lo que dijo el emprendedor: `panaderia-artesanal`, `taller-mecanico`.
 *
 *  Nada explota, y ése es el problema. La columna no tiene FK, así que el slug
 *  entra sin queja. Lo que se rompe está río abajo y en silencio:
 *  `packages/vault/src/industry/gaps.ts` busca la plantilla por ese id, no
 *  encuentra nada, y `detectGaps()` devuelve vacío. El agente maestro deja de
 *  poder decir "todavía no me has dicho cuánto cobras" — que es la razón por la
 *  que la tabla existe. Un dato que apunta a una fila inexistente se ve idéntico
 *  a un dato correcto hasta que alguien lo sigue.
 *
 *  ── Por qué se lee el catálogo en vez de traer la lista aquí ─────────────
 *
 *  Porque el punto de la 033 es que "un giro nuevo es una fila, no un deploy".
 *  Copiar los cinco ids a una constante de H7 los volvería dos fuentes de
 *  verdad, y la de aquí siempre iría atrasada. Se leen los que HAY.
 *
 *  ── Y por qué `null` cuando no se reconoce ────────────────────────────────
 *
 *  Porque `null` es honesto y visible: se puede consultar quién quedó sin
 *  clasificar (`industry_type IS NULL` con un giro escrito en la sesión) y
 *  arreglarlo después con un UPDATE. Un id inventado no se puede distinguir de
 *  uno bueno, y un `general` puesto por resignación no se puede distinguir de
 *  un negocio que de verdad es de otro giro. Nada se pierde: el giro literal
 *  del emprendedor sigue en `onboarding_sessions.state`, en el resumen del
 *  blueprint y en la bóveda.
 */
// `adminDb` y no `tenantDb`: `app.industry_templates` es un catálogo de la
// plataforma, sin `tenant_id`. Es el mismo caso que `app.tenants` en entrega.ts
// y está nombrado como tal en el propio mensaje de la regla de lint.
import { adminDb } from '@abraxa/db';
import { log } from '../logger';
import type { EstadoNegocio } from '../types';

/** Lo único que hace falta de una fila de `app.industry_templates`. */
export interface PlantillaDeGiro {
  id: string;
  name: string;
  blurb: string;
}

/**
 * La fila comodín: describe a cualquier negocio, así que sus palabras no
 * distinguen a ninguno. Se excluye del emparejamiento por texto — elegirla
 * tendría que ser una decisión, no un parecido accidental con la frase "todo
 * negocio necesita tener claro…".
 */
const COMODIN = 'general';

// ════════════════════════════════════════════════════════════════════════════
// Normalización
// ════════════════════════════════════════════════════════════════════════════

/** Minúsculas, sin acentos y sin puntuación. */
function plano(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * El giro tal cual, normalizado a slug.
 *
 * Ya NO se escribe en `tenants.industry_type` —para eso está la resolución
 * contra el catálogo— pero sigue sirviendo para el paso 1: si el emprendedor
 * dijo literalmente "restaurante" y existe la plantilla `restaurante`, es ella.
 */
export function slugDelGiro(giro: string): string {
  return plano(giro).replace(/ +/g, '-').slice(0, 48).replace(/^-+|-+$/g, '');
}

/**
 * Singular aproximado, para español.
 *
 * Las dos formas del plural que importan aquí: `-es` tras consonante
 * ("talleres" → "taller", "salones" → "salón") y `-s` tras vocal ("despachos" →
 * "despacho"). Sin lo primero, el blurb del catálogo dice "talleres" y el
 * emprendedor dice "taller mecánico" y no se reconocen — que es justo el caso
 * que hay que resolver.
 *
 * Es un stemmer de tres líneas a propósito: uno de verdad traería una
 * dependencia y un idioma configurable para desempatar una entrevista de cada
 * mil, y las dependencias del repo son de H1.
 */
function singular(p: string): string {
  if (p.length >= 6 && p.endsWith('es')) return p.slice(0, -2);
  if (p.length >= 5 && p.endsWith('s')) return p.slice(0, -1);
  return p;
}

/**
 * Palabras con las que vale la pena comparar.
 *
 * Corta en 4 letras porque abajo de ahí casi todo es preposición o artículo.
 */
function palabras(texto: string): Set<string> {
  return new Set(
    plano(texto)
      .split(' ')
      .filter((p) => p.length >= 4)
      .map(singular),
  );
}

// ════════════════════════════════════════════════════════════════════════════
// La resolución
// ════════════════════════════════════════════════════════════════════════════

export interface GiroResuelto {
  /** El `app.industry_templates.id`, o `null` si el catálogo no lo reconoce. */
  id: string | null;
  /** Por qué salió eso. Va al log cuando no hay match; es lo que se "anota". */
  razon: string;
}

/**
 * Elige la plantilla del catálogo que corresponde a un giro dicho en voz alta.
 *
 * Función pura: entra el texto libre y las filas que HAY, sale un id del
 * catálogo o `null`. Así el criterio se prueba sin base y sin tokens.
 *
 *   1. **El id exacto.** "restaurante" → `restaurante`.
 *   2. **Palabras distintivas.** Se comparan las palabras del giro contra el
 *      nombre y el blurb de cada plantilla, pero SÓLO cuentan las que aparecen
 *      en una sola plantilla: "local" está en comercio y en restaurante, así
 *      que no distingue nada y no vota. Tiene que haber un ganador único.
 *   3. **Nada.** `null`, con su razón escrita.
 */
export function elegirPlantilla(giro: string, plantillas: PlantillaDeGiro[]): GiroResuelto {
  const limpio = giro.trim();
  if (!limpio) return { id: null, razon: 'sin giro' };
  if (plantillas.length === 0) {
    return { id: null, razon: 'el catálogo de giros vino vacío (app.industry_templates)' };
  }

  // ── 1. El id exacto ───────────────────────────────────────────────────────
  const slug = slugDelGiro(limpio);
  const directa = plantillas.find((p) => p.id === slug);
  if (directa) return { id: directa.id, razon: `id exacto del catálogo: ${directa.id}` };

  // ── 2. Palabras distintivas ───────────────────────────────────────────────
  const candidatas = plantillas.filter((p) => p.id !== COMODIN);
  const vocabulario = new Map<string, Set<string>>(
    candidatas.map((p) => [p.id, palabras(`${p.id} ${p.name} ${p.blurb}`)]),
  );

  // Cuántas plantillas usan cada palabra. Las que usan dos o más no distinguen.
  const cuantas = new Map<string, number>();
  for (const set of vocabulario.values()) {
    for (const p of set) cuantas.set(p, (cuantas.get(p) ?? 0) + 1);
  }

  const dichas = palabras(limpio);
  const puntajes = candidatas.map((p) => {
    const suyas = vocabulario.get(p.id) ?? new Set<string>();
    let puntos = 0;
    for (const palabra of dichas) {
      if (suyas.has(palabra) && cuantas.get(palabra) === 1) puntos++;
    }
    return { id: p.id, puntos };
  });

  const mejor = Math.max(...puntajes.map((p) => p.puntos));
  const ganadoras = puntajes.filter((p) => p.puntos === mejor);

  if (mejor > 0 && ganadoras.length === 1 && ganadoras[0]) {
    return { id: ganadoras[0].id, razon: `palabras del giro: ${ganadoras[0].id}` };
  }

  // ── 3. Nada ───────────────────────────────────────────────────────────────
  const empate = mejor > 0 ? ` (empataron ${ganadoras.map((g) => g.id).join(', ')})` : '';
  return {
    id: null,
    razon:
      `"${limpio}" no corresponde a ninguna plantilla de app.industry_templates` +
      `${empate}. Disponibles: ${plantillas.map((p) => p.id).join(', ')}`,
  };
}

/**
 * El giro del negocio como id del catálogo, o `null`.
 *
 * Deja el motivo en el log cuando no reconoce: un tenant sin `industry_type`
 * pero con giro escrito es un giro que le falta al catálogo, y eso hay que
 * poder verlo sin abrir la base.
 */
export function tipoDeIndustria(e: EstadoNegocio, plantillas: PlantillaDeGiro[]): string | null {
  const r = elegirPlantilla(e.giro ?? '', plantillas);
  if (!r.id && (e.giro ?? '').trim()) log.warn(`giro sin plantilla — ${r.razon}`);
  return r.id;
}

// ════════════════════════════════════════════════════════════════════════════
// El catálogo
// ════════════════════════════════════════════════════════════════════════════

/**
 * Las plantillas de giro que hay hoy.
 *
 * Best-effort: si la tabla no responde, se devuelve vacío y el mapa sale con
 * `industryType: null`. Que el catálogo esté caído no puede tumbar el último
 * turno del Ritual — es la misma regla que rige todo `synthesis/entrega.ts`.
 */
export async function plantillasDeGiro(): Promise<PlantillaDeGiro[]> {
  try {
    const { data, error } = await adminDb()
      .from('industry_templates')
      .select('id, name, blurb')
      .order('position', { ascending: true });

    if (error) throw error;

    // Se lee defensivo: una fila sin `id` no es una plantilla, es ruido, y
    // dejarla pasar convertiría un `undefined` en un `industry_type` inválido —
    // que es exactamente el defecto que este archivo existe para cerrar.
    const filas = (data ?? []) as Array<{ id?: unknown; name?: unknown; blurb?: unknown }>;

    return filas
      .filter((f) => typeof f.id === 'string' && f.id.length > 0)
      .map((f) => ({
        id: String(f.id),
        name: typeof f.name === 'string' ? f.name : '',
        blurb: typeof f.blurb === 'string' ? f.blurb : '',
      }));
  } catch (err) {
    log.warn(`no se pudo leer el catálogo de giros: ${String(err)}`);
    return [];
  }
}
