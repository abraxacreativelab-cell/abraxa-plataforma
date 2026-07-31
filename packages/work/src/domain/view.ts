/**
 * ════════════════════════════════════════════════════════════════════════════
 *  La lógica de las vistas. Pura, sin base de datos y sin React.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Puerto de `GARDEN/garden-os/lib/tasks-view.ts` (482 líneas), que es el
 *  archivo mejor resuelto del módulo y ya venía probado. Lo que cambia:
 *
 *   · **Siete vistas → cuatro.** Fuera `timeline` (Gantt), `gallery` y el
 *     tablero por empresa. Aquí no existe "empresa": el usuario tiene una.
 *   · **`company_id` fuera de todo.** Era una propiedad filtrable, agrupable y
 *     coloreable; las tres desaparecen.
 *   · **`milestone_id` fuera.** Los hitos son del roadmap del negocio (H11).
 *   · **`colorBy` fuera.** Sólo servía para colorear por empresa. El color de
 *     una tarjeta ahora lo da su prioridad, con los tokens semánticos de H5.
 *
 *  Lo que se conserva entero, porque está bien resuelto y se usa a diario:
 *  las diez condiciones de filtro, los grupos AND/OR anidados a dos niveles,
 *  el orden estable, y el ida y vuelta de la configuración a la URL.
 */
import {
  PRIORITY_META,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type Task,
  type TaskPriority,
} from './types';

// ════════════════════════════════════════════════════════════════════════════
// Las cuatro vistas
// ════════════════════════════════════════════════════════════════════════════

/**
 * Los nombres son los del handoff y están en español a propósito: aparecen tal
 * cual en la URL (`/tareas?v=calendario`), y una URL que el emprendedor puede
 * leer es una URL que se atreve a compartir.
 */
export const VIEW_KINDS = ['proyecto', 'responsable', 'calendario', 'progreso'] as const;
export type ViewKind = (typeof VIEW_KINDS)[number];

export const VIEW_META: Record<ViewKind, { label: string; icon: string; question: string }> = {
  proyecto: {
    label: 'Proyecto',
    icon: 'kanban',
    question: '¿Cómo va cada cosa que estoy haciendo?',
  },
  responsable: {
    label: 'Responsable',
    icon: 'users',
    question: '¿Quién trae qué?',
  },
  calendario: {
    label: 'Calendario',
    icon: 'calendar',
    question: '¿Qué se vence esta semana?',
  },
  progreso: {
    label: 'Progreso',
    icon: 'tasks',
    question: 'El tablero de siempre.',
  },
};

// ════════════════════════════════════════════════════════════════════════════
// Configuración de una vista
// ════════════════════════════════════════════════════════════════════════════

/** Por qué se puede agrupar. Es la "jerarquía configurable" del handoff §5. */
export const GROUPABLE = ['status', 'priority', 'assigned_to', 'project_id'] as const;
export type GroupBy = (typeof GROUPABLE)[number] | null;

export const GROUP_META: Record<NonNullable<GroupBy>, string> = {
  status: 'Estado',
  priority: 'Prioridad',
  assigned_to: 'Responsable',
  project_id: 'Proyecto',
};

/** Propiedades sobre las que se puede filtrar y ordenar. */
export const FILTERABLE = [
  'status',
  'priority',
  'assigned_to',
  'project_id',
  'due_date',
  'start_date',
  'title',
  'tags',
] as const;
export type FilterProp = (typeof FILTERABLE)[number];

export const FILTER_PROP_META: Record<FilterProp, { label: string; type: 'enum' | 'text' | 'date' | 'list' }> = {
  status: { label: 'Estado', type: 'enum' },
  priority: { label: 'Prioridad', type: 'enum' },
  assigned_to: { label: 'Responsable', type: 'text' },
  project_id: { label: 'Proyecto', type: 'text' },
  due_date: { label: 'Se vence', type: 'date' },
  start_date: { label: 'Empieza', type: 'date' },
  title: { label: 'Título', type: 'text' },
  tags: { label: 'Etiquetas', type: 'list' },
};

/** Las diez condiciones de GARDEN, tal cual. */
export const FILTER_CONDITIONS = [
  'is',
  'is_not',
  'is_any',
  'is_empty',
  'is_not_empty',
  'contains',
  'before',
  'after',
  'on',
  'next_n_days',
] as const;
export type FilterCondition = (typeof FILTER_CONDITIONS)[number];

export const CONDITION_META: Record<FilterCondition, string> = {
  is: 'es',
  is_not: 'no es',
  is_any: 'es alguno de',
  is_empty: 'está vacío',
  is_not_empty: 'tiene valor',
  contains: 'contiene',
  before: 'antes de',
  after: 'después de',
  on: 'el día',
  next_n_days: 'en los próximos N días',
};

/** Qué condiciones tienen sentido para cada tipo de propiedad. Sin esto el
 *  constructor ofrece "antes de" para un título, que no filtra nada útil. */
export const CONDITIONS_BY_TYPE: Record<'enum' | 'text' | 'date' | 'list', readonly FilterCondition[]> = {
  enum: ['is', 'is_not', 'is_any', 'is_empty', 'is_not_empty'],
  text: ['is', 'is_not', 'contains', 'is_empty', 'is_not_empty'],
  date: ['on', 'before', 'after', 'next_n_days', 'is_empty', 'is_not_empty'],
  list: ['contains', 'is_empty', 'is_not_empty'],
};

export type FilterOperator = 'and' | 'or';
export type SortDirection = 'asc' | 'desc';

export interface FilterRule {
  prop: FilterProp;
  cond: FilterCondition;
  value?: unknown;
  /** Un filtro apagado se conserva en la configuración pero no filtra. Es el
   *  "se prenden y apagan" del handoff §2.3: apagar un filtro para mirar y
   *  volverlo a prender no debería costar volver a escribirlo. */
  off?: boolean;
}

export interface FilterGroup {
  op: FilterOperator;
  rules: Array<FilterRule | FilterGroup>;
  off?: boolean;
}

export interface Sort {
  prop: FilterProp | 'sort_order' | 'created_at' | 'updated_at';
  dir: SortDirection;
}

/** Qué se ve en cada tarjeta. */
export const CARD_PROPS = ['status', 'priority', 'assignee', 'due', 'project', 'subtasks', 'tags'] as const;
export type CardProp = (typeof CARD_PROPS)[number];

export const CARD_PROP_META: Record<CardProp, string> = {
  status: 'Estado',
  priority: 'Prioridad',
  assignee: 'Responsable',
  due: 'Fecha',
  project: 'Proyecto',
  subtasks: 'Subtareas',
  tags: 'Etiquetas',
};

export interface ViewConfig {
  filters: FilterGroup;
  sorts: Sort[];
  groupBy: GroupBy;
  props: CardProp[];
  search: string;
}

export interface SavedView {
  id: string;
  owner_email: string;
  name: string;
  kind: ViewKind;
  config: ViewConfig;
  shared: boolean;
  position: number;
  created_at: string;
  updated_at: string;
}

// ════════════════════════════════════════════════════════════════════════════
// Presets — las cuatro vistas, ya configuradas
// ════════════════════════════════════════════════════════════════════════════

/** El filtro con el que abre el producto: lo que falta por hacer. */
export const abiertasFilter = (): FilterGroup => ({
  op: 'and',
  rules: [{ prop: 'status', cond: 'is_any', value: ['pending', 'in_progress', 'blocked'] }],
});

const BASE_PROPS: CardProp[] = ['status', 'priority', 'assignee', 'due', 'project', 'subtasks'];

/** La agrupación natural de cada vista. Es sólo el punto de partida: el usuario
 *  la cambia por vista y se le respeta (handoff §5, "jerarquía configurable"). */
export const DEFAULT_GROUP_BY: Record<ViewKind, GroupBy> = {
  proyecto: 'project_id',
  responsable: 'assigned_to',
  calendario: 'priority',
  progreso: 'status',
};

export function presetFor(kind: ViewKind): ViewConfig {
  return {
    filters: abiertasFilter(),
    sorts: [],
    groupBy: DEFAULT_GROUP_BY[kind],
    // En calendario el proyecto ya no cabe en una celda de día.
    props: kind === 'calendario' ? ['priority', 'assignee', 'status'] : [...BASE_PROPS],
    search: '',
  };
}

export const DEFAULT_VIEW_CONFIG: ViewConfig = presetFor('progreso');

// ════════════════════════════════════════════════════════════════════════════
// Normalización — todo lo que entra por la red o por la URL pasa por aquí
// ════════════════════════════════════════════════════════════════════════════

const KINDS = new Set<string>(VIEW_KINDS);
const CONDS = new Set<string>(FILTER_CONDITIONS);
const PROPS = new Set<string>(FILTERABLE);
const GROUPS = new Set<string>(GROUPABLE);
const CARDS = new Set<string>(CARD_PROPS);
const SORTABLE = new Set<string>([...FILTERABLE, 'sort_order', 'created_at', 'updated_at']);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function isRule(v: unknown): v is FilterRule {
  return isRecord(v) && PROPS.has(String(v.prop)) && CONDS.has(String(v.cond));
}

/**
 * DOS NIVELES, no más. Un grupo dentro de un grupo es lo que hace falta para
 * "abiertas Y (mías O sin responsable)"; un tercer nivel ya no se puede leer en
 * una barra de filtros y nadie lo usó nunca en GARDEN.
 *
 * Lo que viene más hondo no se rechaza: se descarta. Una configuración vieja o
 * un enlace mal armado tienen que abrir la pantalla con menos filtros, no con
 * un error en la cara.
 */
function normalizeGroup(value: unknown, depth = 0): FilterGroup {
  if (!isRecord(value)) return { op: 'and', rules: [] };
  const op: FilterOperator = value.op === 'or' ? 'or' : 'and';
  const rawRules = Array.isArray(value.rules) ? value.rules : [];
  const rules: Array<FilterRule | FilterGroup> = [];

  for (const candidate of rawRules) {
    if (isRule(candidate)) {
      const rule: FilterRule = { prop: candidate.prop, cond: candidate.cond };
      if ('value' in candidate) rule.value = candidate.value;
      if (candidate.off === true) rule.off = true;
      rules.push(rule);
      continue;
    }
    if (depth === 0 && isRecord(candidate) && ('op' in candidate || 'rules' in candidate)) {
      rules.push(normalizeGroup(candidate, 1));
    }
  }

  const grupo: FilterGroup = { op, rules };
  if (value.off === true) grupo.off = true;
  return grupo;
}

export function normalizeViewConfig(value: unknown, kind: ViewKind = 'progreso'): ViewConfig {
  const preset = presetFor(kind);
  if (!isRecord(value)) return preset;

  const sorts: Sort[] = Array.isArray(value.sorts)
    ? value.sorts.flatMap((s): Sort[] =>
        isRecord(s) && SORTABLE.has(String(s.prop)) && (s.dir === 'asc' || s.dir === 'desc')
          ? [{ prop: s.prop as Sort['prop'], dir: s.dir }]
          : [],
      )
    : [];

  const props = Array.isArray(value.props)
    ? value.props.filter((p): p is CardProp => typeof p === 'string' && CARDS.has(p))
    : [];

  const rawGroup = typeof value.groupBy === 'string' ? value.groupBy : null;

  return {
    filters: normalizeGroup(value.filters),
    sorts,
    // `groupBy: null` es una elección legítima ("no agrupes"), así que sólo se
    // cae al preset cuando la clave falta del todo.
    groupBy: rawGroup && GROUPS.has(rawGroup) ? (rawGroup as GroupBy) : 'groupBy' in value ? null : preset.groupBy,
    props: props.length ? props : preset.props,
    search: typeof value.search === 'string' ? value.search : '',
  };
}

export function normalizeViewKind(value: unknown): ViewKind {
  return typeof value === 'string' && KINDS.has(value) ? (value as ViewKind) : 'progreso';
}

// ════════════════════════════════════════════════════════════════════════════
// Evaluación de filtros
// ════════════════════════════════════════════════════════════════════════════

/** `YYYY-MM-DD` en la zona horaria LOCAL. `toISOString()` daría UTC, y en
 *  México eso adelanta el día seis horas: "vence hoy" empezaría a las 18:00. */
export function localDate(value: Date): string {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-');
}

function valorDe(task: Task, prop: FilterProp): unknown {
  return task[prop];
}

const vacio = (raw: unknown): boolean =>
  raw == null || raw === '' || (Array.isArray(raw) && raw.length === 0);

export function applyFilterRule(task: Task, rule: FilterRule, now = new Date()): boolean {
  if (rule.off) return true;

  const raw = valorDe(task, rule.prop);
  const value = rule.value;

  switch (rule.cond) {
    case 'is':
    case 'on':
      return raw === value;
    case 'is_not':
      return raw !== value;
    case 'is_any':
      return Array.isArray(value) ? value.includes(raw) : raw === value;
    case 'is_empty':
      return vacio(raw);
    case 'is_not_empty':
      return !vacio(raw);
    case 'contains': {
      if (Array.isArray(raw)) return raw.includes(value);
      return (
        typeof raw === 'string' &&
        typeof value === 'string' &&
        raw.toLocaleLowerCase('es').includes(value.toLocaleLowerCase('es'))
      );
    }
    case 'before':
      return typeof raw === 'string' && typeof value === 'string' && raw < value;
    case 'after':
      return typeof raw === 'string' && typeof value === 'string' && raw > value;
    case 'next_n_days': {
      const days = typeof value === 'number' ? value : Number(value);
      if (typeof raw !== 'string' || !Number.isFinite(days) || days < 0) return false;
      const end = new Date(now);
      end.setDate(end.getDate() + days);
      return raw >= localDate(now) && raw <= localDate(end);
    }
  }
}

export function matchesFilter(task: Task, group: FilterGroup, now = new Date()): boolean {
  if (group.off) return true;

  // Una regla apagada no debe volver `or` trivialmente verdadero, así que se
  // descarta ANTES de decidir, no se evalúa como `true`.
  const activas = group.rules.filter((r) => r.off !== true);
  if (activas.length === 0) return true;

  const valores = activas.map((r) =>
    'rules' in r ? matchesFilter(task, r, now) : applyFilterRule(task, r, now),
  );
  return group.op === 'and' ? valores.every(Boolean) : valores.some(Boolean);
}

// ════════════════════════════════════════════════════════════════════════════
// Orden
// ════════════════════════════════════════════════════════════════════════════

const rankStatus = (v: unknown): number => {
  const i = (TASK_STATUSES as readonly string[]).indexOf(String(v));
  return i < 0 ? 99 : i;
};

const rankPriority = (v: unknown): number => {
  const p = String(v) as TaskPriority;
  return (TASK_PRIORITIES as readonly string[]).includes(p) ? PRIORITY_META[p].rank : 99;
};

/**
 * Comparación de dos valores presentes. Los nulos NO se resuelven aquí: los
 * resuelve `applyView` antes de aplicar la dirección.
 *
 * La distinción importa. Si el "nulo al final" se decidiera aquí dentro, la
 * negación que hace descendente el orden lo invertiría también, y las tareas
 * sin fecha aparecerían PRIMERO al ordenar por fecha descendente — justo
 * delante de todo lo que sí vence. Una tarea sin fecha no es la más urgente ni
 * la menos: es la que no tiene fecha, y va al final en los dos sentidos.
 */
function compare(prop: Sort['prop'], left: unknown, right: unknown): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  if (prop === 'priority') return rankPriority(left) - rankPriority(right);
  if (prop === 'status') return rankStatus(left) - rankStatus(right);
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right), 'es', { sensitivity: 'base' });
}

/**
 * Filtra, busca y ordena. El orden es ESTABLE: a igualdad de criterios manda
 * `sort_order` (lo que el usuario arrastró) y al final la posición original.
 * Sin ese desempate, dos recargas seguidas pintan el tablero distinto y el
 * usuario cree que algo se movió solo.
 */
export function applyView(tasks: Task[], config: ViewConfig, now = new Date()): Task[] {
  const needle = config.search.trim().toLocaleLowerCase('es');

  return tasks
    .map((task, index) => ({ task, index }))
    .filter(({ task }) => {
      if (needle) {
        const heno = `${task.title} ${task.description ?? ''} ${task.tags.join(' ')}`;
        if (!heno.toLocaleLowerCase('es').includes(needle)) return false;
      }
      return matchesFilter(task, config.filters, now);
    })
    .sort((a, b) => {
      for (const sort of config.sorts) {
        const izq = a.task[sort.prop];
        const der = b.task[sort.prop];

        // Los nulos se resuelven ANTES de aplicar la dirección, o el `-c` de
        // abajo los mandaría al principio en cuanto alguien ordena al revés.
        if (izq == null && der != null) return 1;
        if (izq != null && der == null) return -1;

        const c = compare(sort.prop, izq, der);
        if (c) return sort.dir === 'desc' ? -c : c;
      }
      const c = compare('sort_order', a.task.sort_order, b.task.sort_order);
      if (c) return c;
      return a.index - b.index;
    })
    .map(({ task }) => task);
}

// ════════════════════════════════════════════════════════════════════════════
// Filtros rápidos — el "se prenden y apagan" del handoff
// ════════════════════════════════════════════════════════════════════════════

export interface QuickFilter {
  id: string;
  label: string;
  rule: FilterRule;
}

/**
 * Los cuatro interruptores de la barra. Cubren el 90% de lo que alguien filtra
 * en un día; el constructor anidado queda para el 10% restante en vez de ser la
 * única puerta.
 *
 * `mias` necesita saber quién mira, así que se construye con el correo de la
 * sesión en vez de vivir en una constante.
 */
export function quickFilters(userEmail: string | null): QuickFilter[] {
  const lista: QuickFilter[] = [
    {
      id: 'abiertas',
      label: 'Abiertas',
      rule: { prop: 'status', cond: 'is_any', value: ['pending', 'in_progress', 'blocked'] },
    },
    { id: 'vencen-7', label: 'Vencen en 7 días', rule: { prop: 'due_date', cond: 'next_n_days', value: 7 } },
    { id: 'urgentes', label: 'Urgentes', rule: { prop: 'priority', cond: 'is_any', value: ['critica', 'alta'] } },
    { id: 'sin-responsable', label: 'Sin responsable', rule: { prop: 'assigned_to', cond: 'is_empty' } },
  ];

  if (userEmail) {
    lista.splice(1, 0, {
      id: 'mias',
      label: 'Mías',
      rule: { prop: 'assigned_to', cond: 'is', value: userEmail },
    });
  }
  return lista;
}

const mismaRegla = (a: FilterRule, b: FilterRule): boolean =>
  a.prop === b.prop && a.cond === b.cond && JSON.stringify(a.value ?? null) === JSON.stringify(b.value ?? null);

/** `true` si el filtro rápido está puesto Y encendido en el grupo raíz. */
export function isQuickFilterOn(config: ViewConfig, quick: QuickFilter): boolean {
  return config.filters.rules.some(
    (r) => !('rules' in r) && r.off !== true && mismaRegla(r, quick.rule),
  );
}

/**
 * Prende o apaga un filtro rápido en el grupo raíz.
 *
 * Apagar NO borra la regla: la marca `off`. Volverla a prender es un clic, no
 * volver a escribirla — y ésa es toda la diferencia entre un filtro que se usa
 * y uno que estorba.
 */
export function toggleQuickFilter(config: ViewConfig, quick: QuickFilter): ViewConfig {
  const rules = [...config.filters.rules];
  const i = rules.findIndex((r) => !('rules' in r) && mismaRegla(r, quick.rule));

  if (i === -1) {
    rules.push({ ...quick.rule });
  } else {
    const actual = rules[i] as FilterRule;
    const apagada = actual.off === true;
    const siguiente: FilterRule = { ...actual };
    if (apagada) delete siguiente.off;
    else siguiente.off = true;
    rules[i] = siguiente;
  }

  return { ...config, filters: { ...config.filters, rules } };
}

/** Cuántos filtros están activos ahora mismo. Va en el botón del constructor:
 *  una pantalla que filtra sin decirlo es una pantalla que miente. */
export function countActiveFilters(group: FilterGroup): number {
  if (group.off) return 0;
  return group.rules.reduce<number>((n, r) => {
    if (r.off === true) return n;
    return n + ('rules' in r ? countActiveFilters(r) : 1);
  }, 0);
}

// ════════════════════════════════════════════════════════════════════════════
// Enlace profundo — criterio observable 2
// ════════════════════════════════════════════════════════════════════════════

/**
 * La configuración cabe en la URL, así que copiar la barra de direcciones y
 * abrirla en otra pestaña muestra exactamente lo mismo.
 *
 * Se serializa la configuración NORMALIZADA para que dos estados equivalentes
 * den la misma cadena, y para que un enlace manipulado a mano no pueda meter
 * una condición que el evaluador no conoce.
 */
export function configToParam(config: ViewConfig): string {
  return encodeURIComponent(JSON.stringify(normalizeViewConfig(config)));
}

export function configFromParam(raw: string | null | undefined, kind: ViewKind = 'progreso'): ViewConfig | null {
  if (!raw) return null;
  try {
    return normalizeViewConfig(JSON.parse(decodeURIComponent(raw)), kind);
  } catch {
    // Un enlace roto abre la vista por defecto. Nunca una pantalla en blanco.
    return null;
  }
}

export interface ViewLocation {
  kind: ViewKind;
  config: ViewConfig;
  /** Vista guardada activa, si el enlace apunta a una. */
  savedId?: string | null;
  /** Tarea abierta en el panel de detalle. Viaja en la URL para que "mira esta
   *  tarea" sea un enlace y no una instrucción. */
  taskId?: string | null;
}

export const PARAM = { kind: 'v', config: 'c', saved: 's', task: 't' } as const;

export function locationToParams(loc: ViewLocation): URLSearchParams {
  const p = new URLSearchParams();
  p.set(PARAM.kind, loc.kind);
  if (loc.savedId) p.set(PARAM.saved, loc.savedId);
  // Sólo se escribe la configuración si difiere del preset: una URL limpia
  // invita a compartirse más que una con 400 caracteres de JSON.
  const preset = JSON.stringify(normalizeViewConfig(presetFor(loc.kind)));
  const actual = JSON.stringify(normalizeViewConfig(loc.config));
  if (actual !== preset) p.set(PARAM.config, configToParam(loc.config));
  if (loc.taskId) p.set(PARAM.task, loc.taskId);
  return p;
}

export function locationFromParams(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
  saved: SavedView[] = [],
): ViewLocation {
  const leer = (k: string): string | null => {
    if (params instanceof URLSearchParams) return params.get(k);
    const v = params[k];
    return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
  };

  const savedId = leer(PARAM.saved);
  const vistaGuardada = savedId ? saved.find((v) => v.id === savedId) : undefined;
  const kind = normalizeViewKind(leer(PARAM.kind) ?? vistaGuardada?.kind);

  // Precedencia: lo que dice la URL gana sobre la vista guardada, y la vista
  // guardada sobre el preset. Si no fuera así, afinar los filtros de una vista
  // guardada y mandar el enlace mandaría la vista sin los ajustes.
  const config =
    configFromParam(leer(PARAM.config), kind) ??
    (vistaGuardada ? normalizeViewConfig(vistaGuardada.config, kind) : presetFor(kind));

  return { kind, config, savedId: vistaGuardada?.id ?? null, taskId: leer(PARAM.task) };
}
