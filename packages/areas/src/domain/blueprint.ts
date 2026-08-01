/**
 * ════════════════════════════════════════════════════════════════════════════
 *  La proyección del Ritual al mapa — PURA
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  El Ritual de Fundación (H7) le pregunta 20 minutos al emprendedor y decide
 *  el mapa de su negocio: qué áreas necesita, en qué estado nace cada una y por
 *  qué. Esa decisión se guarda en `app.onboarding_blueprints` —que es de H7— y
 *  la tabla que este paquete lee es `app.tenant_areas`. Entre las dos hay un
 *  paso, y ese paso es este archivo.
 *
 *  Sin él pasa exactamente lo que se midió en producción el 2026-08-01: la
 *  empresa que terminó el Ritual al 100% tenía su blueprint con 6 áreas y 2
 *  hitos escritos… y `app.tenant_areas` VACÍA. El panel salía genérico porque no
 *  había nada suyo que leer.
 *
 *  ── El hallazgo que obliga a que esto exista, y no sea un INSERT ───────────
 *
 *  Los requisitos que propone el agente NO hablan el vocabulario del evaluador.
 *  Medido contra el blueprint real de producción (`ce22631b…`):
 *
 *      el Ritual escribió        el evaluador entiende
 *      ──────────────────        ─────────────────────
 *      has_pipeline              pipeline_defined
 *      first_sale                deal_won (min 1)
 *      declares_hiring           declared (key va_a_contratar)
 *
 *  Copiar esos requisitos tal cual a `tenant_areas.requirements` habría dejado
 *  tres áreas cerradas PARA SIEMPRE con el candado diciendo «hay un requisito
 *  que este sistema no sabe leer». Peor que la pantalla vacía: una pantalla
 *  vacía se nota; un candado que nunca abre parece producto.
 *
 *  Por eso la traducción vive aquí, es explícita, y lo que no se entiende NO se
 *  escribe: se cae a la regla del catálogo, que sí es evaluable. **Un requisito
 *  que no se entiende no se copia y tampoco se ignora.**
 *
 *  ── Y por qué es puro ──────────────────────────────────────────────────────
 *
 *  Porque la decisión de qué se escribe se tiene que poder probar sin base y
 *  con el blueprint REAL de producción, que es lo que hace `blueprint.test.ts`.
 *  `services/blueprint.ts` sólo ejecuta el plan que sale de aquí.
 */
import { RANGO_ESTADO } from './state';
import type { AreaState, Requirement, TenantAreaRow } from './types';

// ════════════════════════════════════════════════════════════════════════════
// Lo que llega del Ritual
// ════════════════════════════════════════════════════════════════════════════

/**
 * Un área tal como la decidió el Ritual.
 *
 * Se declara aquí, ESTRUCTURALMENTE, en vez de importar `AreaDelMapa` de
 * `@abraxa/onboarding`. No es por gusto: importar el tipo ataría este paquete al
 * árbol de tipos entero de otro carril —y lo arrastraría hasta el programa de
 * `apps/web`, que es donde el `tsc` de Next se rompe con las dependencias
 * cruzadas—. Lo que de verdad cruza la frontera es JSON de una columna `jsonb`,
 * así que lo que hay que declarar es su FORMA, y validarla al entrar.
 */
export interface AreaDelRitual {
  slug: string;
  label: string;
  estado: AreaState;
  blurb: string;
  position: number;
  /** Por qué el agente la puso así, con los datos de SU negocio. */
  razon: string;
  requisitos: unknown[];
}

/** Un hito del roadmap, tal como lo propuso el Ritual. */
export interface HitoDelRitual {
  areaSlug: string | null;
  titulo: string;
  detalle: string | null;
  origen: string;
}

/** El blueprint, reducido a lo que la proyección necesita. */
export interface BlueprintDelRitual {
  id: string;
  industryType: string | null;
  areas: AreaDelRitual[];
  hitos: HitoDelRitual[];
}

const ESTADOS: readonly AreaState[] = ['bloqueada', 'disponible', 'en_progreso', 'activa'];

const esObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const cadena = (v: unknown, max = 200): string =>
  typeof v === 'string' ? v.trim().slice(0, max) : '';

/** Un slug de área: minúsculas, sin espacios, y acotado. Lo que llega de un
 *  modelo de lenguaje pasa por aquí antes de ser una llave primaria. */
export function slugValido(v: unknown): string {
  const s = cadena(v, 60).toLowerCase();
  return /^[a-z][a-z0-9_-]*$/.test(s) ? s : '';
}

function estadoValido(v: unknown): AreaState {
  const s = cadena(v);
  return (ESTADOS as readonly string[]).includes(s) ? (s as AreaState) : 'bloqueada';
}

function entero(v: unknown, porDefecto: number): number {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : porDefecto;
}

/**
 * Lee el blueprint que llega de H7 y lo deja en la forma de arriba.
 *
 * Nada de lo que entra aquí se da por bueno: `areas` y `milestones` son columnas
 * `jsonb` que escribió la síntesis de un modelo de lenguaje. Un slug con un
 * espacio, un `estado` inventado o un `position` en texto no pueden convertirse
 * en una fila de `tenant_areas` — la llave primaria de esa tabla es
 * `(tenant_id, area_slug)`.
 *
 * Las áreas sin slug legible se DESCARTAN, no se rellenan con un slug supuesto:
 * inventarle un identificador a un área es peor que no tenerla.
 */
export function leerBlueprint(raw: unknown): BlueprintDelRitual | null {
  if (!esObjeto(raw)) return null;

  const id = cadena(raw.id, 64);
  if (!id) return null;

  const areasCrudas = Array.isArray(raw.areas) ? raw.areas : [];
  const areas: AreaDelRitual[] = [];
  const vistos = new Set<string>();

  for (const [i, cruda] of areasCrudas.entries()) {
    if (!esObjeto(cruda)) continue;
    const slug = slugValido(cruda.slug);
    if (!slug || vistos.has(slug)) continue;
    vistos.add(slug);

    areas.push({
      slug,
      label: cadena(cruda.label, 80),
      estado: estadoValido(cruda.estado),
      blurb: cadena(cruda.blurb, 400),
      position: entero(cruda.position, i + 1),
      razon: cadena(cruda.razon, 400),
      requisitos: Array.isArray(cruda.requisitos) ? cruda.requisitos : [],
    });
  }

  const hitosCrudos = Array.isArray(raw.hitos) ? raw.hitos : [];
  const hitos: HitoDelRitual[] = [];

  for (const cruda of hitosCrudos) {
    if (!esObjeto(cruda)) continue;
    // 200 es el tope que valida `createMilestone`; recortar aquí evita que un
    // título largo del modelo tumbe la proyección entera por un VALIDATION.
    const titulo = cadena(cruda.titulo, 200);
    if (!titulo) continue;
    hitos.push({
      areaSlug: slugValido(cruda.areaSlug) || null,
      titulo,
      detalle: cadena(cruda.detalle, 500) || null,
      origen: cadena(cruda.origen, 40),
    });
  }

  return {
    id,
    industryType: cadena(raw.industryType, 60) || null,
    areas,
    hitos,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// La traducción de requisitos
// ════════════════════════════════════════════════════════════════════════════

/**
 * Los nombres que el Ritual usa para las mismas condiciones.
 *
 * No es una lista defensiva por si acaso: los tres primeros salieron del
 * blueprint que produjo el Ritual en producción, y sin ellos ese negocio se
 * queda con tres áreas que no abren nunca. El resto son variantes del mismo
 * concepto que el guion del agente puede escoger sin avisar — el prompt le pide
 * "condiciones evaluables", no una enumeración cerrada.
 *
 * `declares_hiring` cae en la clave `va_a_contratar`, que es la que evalúa
 * `progress.declared` y la que siembra la 090 para RH. Traducirlo a otra clave
 * dejaría el área cerrada aunque el emprendedor apretara el botón.
 */
const ALIAS: Record<string, string> = {
  // Vistos en producción (blueprint ce22631b, 2026-08-01).
  has_pipeline: 'pipeline_defined',
  first_sale: 'deal_won',
  declares_hiring: 'declared:va_a_contratar',
  // Variantes razonables del mismo concepto.
  pipeline: 'pipeline_defined',
  has_funnel: 'pipeline_defined',
  funnel_defined: 'pipeline_defined',
  channel_connected: 'has_channel',
  has_channels: 'has_channel',
  deal_closed: 'deal_won',
  first_deal: 'deal_won',
  values_defined: 'value_count',
  has_values: 'value_count',
  has_documents: 'document_count',
  documents_count: 'document_count',
  contacts_count: 'contact_count',
  has_contacts: 'contact_count',
  months_active: 'months_operating',
  declares_team: 'declared:va_a_contratar',
  wants_to_hire: 'declared:va_a_contratar',
};

/**
 * Un requisito del Ritual, en el vocabulario del evaluador. `null` si no se
 * puede traducir.
 *
 * `null` NO significa "se cumple" ni "se ignora": el llamador se queda con la
 * regla del catálogo, que sí es evaluable. Ver `planDeArea`.
 */
export function traducirRequisito(raw: unknown): Requirement | null {
  if (!esObjeto(raw)) return null;

  const crudo = cadena(raw.type, 60);
  if (!crudo) return null;

  const resuelto = ALIAS[crudo] ?? crudo;

  // Los alias con clave: `declared:va_a_contratar`.
  if (resuelto.startsWith('declared:')) {
    const key = resuelto.slice('declared:'.length);
    return key ? { type: 'declared', key } : null;
  }

  // `min` ausente significa "al menos uno", igual que en `parseRequirement`.
  const min = Math.max(entero(raw.min, 1), 0);

  switch (resuelto) {
    case 'always':
    case 'manual':
    case 'pipeline_defined':
      return { type: resuelto };

    case 'has_channel':
    case 'value_count':
    case 'document_count':
    case 'contact_count':
    case 'deal_won':
    case 'months_operating':
      return { type: resuelto, min };

    case 'declared': {
      const key = cadena(raw.key, 60);
      return key ? { type: 'declared', key } : null;
    }

    case 'any_of': {
      if (!Array.isArray(raw.of)) return null;
      const of = raw.of.map(traducirRequisito);
      // Una alternativa ilegible invalida el `any_of` entero: quedarse con las
      // que sí se leyeron podría abrir el área por el camino equivocado, que es
      // justo el que la alternativa rota impedía. Misma regla que
      // `parseRequirement`.
      if (of.some((r) => r === null)) return null;
      return of.length ? { type: 'any_of', of: of as Requirement[] } : null;
    }

    default:
      return null;
  }
}

/**
 * La lista entera, o `null` si UNA sola condición no se entiende.
 *
 * Todo o nada, y a propósito. Escribir las que sí se tradujeron y tirar las
 * otras AFLOJA la puerta: el área abriría con menos condiciones de las que el
 * agente le puso, sin que nadie se entere. Prefiero quedarme con la regla del
 * catálogo entera —que es coherente— que con media regla del Ritual.
 */
export function traducirRequisitos(crudos: readonly unknown[]): Requirement[] | null {
  if (crudos.length === 0) return [];
  const salida = crudos.map(traducirRequisito);
  return salida.some((r) => r === null) ? null : (salida as Requirement[]);
}

// ════════════════════════════════════════════════════════════════════════════
// El plan
// ════════════════════════════════════════════════════════════════════════════

/** La regla del catálogo para un área, cuando la hay. */
export interface ReglaDeCatalogo {
  requirements: unknown[];
  tools: unknown[];
  icon: string;
}

/** Una escritura sobre `app.tenant_areas`, ya decidida. */
export interface PlanDeArea {
  slug: string;
  /** `true` si hay que INSERTAR; `false` si hay que ACTUALIZAR la que existe. */
  nueva: boolean;
  /** Las columnas a escribir. Vacío = no hay nada que hacer con esta área. */
  patch: Record<string, unknown>;
}

/**
 * Qué escribir para UN área del blueprint.
 *
 * ── Las cuatro reglas ──────────────────────────────────────────────────────
 *
 *  1. EL ESTADO NUNCA RETROCEDE. Si el área ya estaba `activa` y el blueprint
 *     dice `disponible`, se queda `activa`. Es la misma decisión de producto que
 *     `domain/state.ts`: en ningún juego te quitan un nivel. Y además hace la
 *     proyección segura de repetir, que es lo que exige `BlueprintSink`.
 *
 *  2. LAS PALABRAS SON LAS DEL AGENTE. `label`, `blurb` y `position` los pisa el
 *     blueprint sobre los del catálogo: «Ventas y marketing» con la promesa
 *     escrita para SU negocio le gana a «Ventas» genérico. Es literalmente lo
 *     que el Ritual le prometió en el último turno, y verlo distinto en el panel
 *     es su propia mentira pequeña.
 *
 *  3. LOS REQUISITOS SÓLO SE PISAN SI SE ENTIENDEN ENTEROS. Si no, manda el
 *     catálogo. Ver la cabecera.
 *
 *  4. `unlocked_at` SE PONE UNA VEZ. Es la fecha en que se lo ganó.
 */
export function planDeArea(
  area: AreaDelRitual,
  fila: TenantAreaRow | undefined,
  regla: ReglaDeCatalogo | null,
  ahora: string,
): PlanDeArea {
  const patch: Record<string, unknown> = {};

  // ── 1. El estado, sin retroceder ──────────────────────────────────────────
  const actual: AreaState = fila?.state ?? 'bloqueada';
  const estado: AreaState =
    RANGO_ESTADO[area.estado] > RANGO_ESTADO[actual] ? area.estado : actual;

  // ── 2. Las palabras del agente ────────────────────────────────────────────
  if (area.label) patch.label = area.label;
  if (area.blurb) patch.blurb = area.blurb;
  patch.position = area.position;

  // ── 3. Los requisitos ─────────────────────────────────────────────────────
  const traducidos = traducirRequisitos(area.requisitos);
  if (traducidos !== null && traducidos.length > 0) {
    patch.requirements = traducidos;
  } else if (!fila) {
    // Fila nueva: hay que darle ALGO evaluable. La regla del catálogo si existe;
    // si tampoco, `manual` — que deja el área cerrada pero con una salida que el
    // emprendedor puede tomar («la abres tú cuando quieras»), en vez de `[]`,
    // que se cumple solo y le regalaría un área que nadie decidió abrirle.
    patch.requirements = regla?.requirements ?? [{ type: 'manual' }];
  }

  if (!fila) {
    patch.area_slug = area.slug;
    patch.icon = regla?.icon || 'wrench';
    patch.tools = regla?.tools ?? [];
  }

  // ── 4. El estado y su fecha ───────────────────────────────────────────────
  if (!fila || estado !== actual) patch.state = estado;
  if (estado !== 'bloqueada' && !fila?.unlocked_at) patch.unlocked_at = ahora;

  return { slug: area.slug, nueva: !fila, patch };
}

/**
 * El plan completo: una escritura por área del blueprint.
 *
 * Las áreas que el catálogo sembró y el blueprint NO menciona se dejan
 * exactamente como están. El Ritual decide lo que decide; no borra lo demás —
 * `seed_always` existe justo para que Dirección y Finanzas estén ahí aunque el
 * agente no las nombre.
 */
export function planDeProyeccion(
  blueprint: BlueprintDelRitual,
  filas: readonly TenantAreaRow[],
  reglas: ReadonlyMap<string, ReglaDeCatalogo>,
  ahora: string,
): PlanDeArea[] {
  const porSlug = new Map(filas.map((f) => [f.area_slug, f]));
  return blueprint.areas.map((a) =>
    planDeArea(a, porSlug.get(a.slug), reglas.get(a.slug) ?? null, ahora),
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Los hitos
// ════════════════════════════════════════════════════════════════════════════

/** De dónde salió el hito, en el vocabulario de la 090. */
const ORIGEN: Record<string, 'master_agent' | 'user' | 'seed'> = {
  emprendedor: 'user',
  abogado_del_diablo: 'master_agent',
  catalogo: 'seed',
};

/** Una fila de `app.tenant_milestones` lista para insertar. */
export interface HitoNuevo {
  area_slug: string | null;
  title: string;
  description: string | null;
  position: number;
  generated_by: 'master_agent' | 'user' | 'seed';
}

/**
 * Los hitos que FALTAN, y sólo ésos.
 *
 * La llave de idempotencia es el título normalizado, no un id: el blueprint no
 * le pone id a sus hitos y `tenant_milestones` los genera al insertar. Sin esta
 * comparación, cada re-proyección —y el barrido la va a llamar más de una vez—
 * le duplicaría el roadmap al negocio, que es el fallo explícito que
 * `BlueprintSink` prohíbe.
 *
 * Se compara sin acentos ni mayúsculas porque el que ya está guardado pasó por
 * un `trim()` y el que llega, no.
 */
export function hitosQueFaltan(
  blueprint: BlueprintDelRitual,
  existentes: ReadonlyArray<{ title: string }>,
  desde: number,
): HitoNuevo[] {
  const clave = (s: string): string =>
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // los acentos, ya separados por NFD
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();

  const ya = new Set(existentes.map((h) => clave(h.title)));
  const salida: HitoNuevo[] = [];

  for (const hito of blueprint.hitos) {
    const k = clave(hito.titulo);
    if (ya.has(k)) continue;
    ya.add(k);
    salida.push({
      area_slug: hito.areaSlug,
      title: hito.titulo,
      description: hito.detalle,
      position: desde + salida.length + 1,
      generated_by: ORIGEN[hito.origen] ?? 'master_agent',
    });
  }

  return salida;
}
