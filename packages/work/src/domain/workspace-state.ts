/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El estado del espacio de trabajo. Puro, sin React.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Los dos primeros criterios observables del handoff son de comportamiento,
 *  no de pantalla:
 *
 *    1. "filtrar en una vista y cambiar de vista conserva el filtro"
 *    2. "copiar la URL de una vista filtrada y abrirla en otra pestaña muestra
 *        lo mismo"
 *
 *  Si eso vive dentro de un componente, sólo se puede verificar haciendo clic.
 *  Aquí es un reductor puro, y las dos cosas son una aserción.
 *
 *  ── La forma del estado dice la regla ──────────────────────────────────────
 *
 *  Lo que se COMPARTE entre las cuatro vistas (filtros, orden, búsqueda) está
 *  en `shared`. Lo que es PROPIO de cada vista (la jerarquía y qué se ve en la
 *  tarjeta) está en `perKind`. No hace falta acordarse de conservar el filtro
 *  al cambiar de pestaña: está guardado en un lugar donde cambiar de pestaña no
 *  lo toca.
 *
 *  En GARDEN esto era estado suelto dentro de `workspace.tsx` —mil líneas— y
 *  cada vista leía y escribía lo que le tocaba. Por eso el filtro sobrevivía al
 *  cambiar entre unas vistas y no entre otras.
 */
import {
  DEFAULT_GROUP_BY,
  VIEW_KINDS,
  normalizeViewConfig,
  presetFor,
  toggleQuickFilter,
  type CardProp,
  type FilterGroup,
  type GroupBy,
  type QuickFilter,
  type SavedView,
  type Sort,
  type ViewConfig,
  type ViewKind,
  type ViewLocation,
} from './view';

interface PerKind {
  groupBy: GroupBy;
  props: CardProp[];
}

export interface WorkspaceState {
  kind: ViewKind;
  /** Lo que viaja entre vistas. */
  shared: { filters: FilterGroup; sorts: Sort[]; search: string };
  /** Lo que es de cada vista. */
  perKind: Record<ViewKind, PerKind>;
  savedId: string | null;
  /** La clase de la vista guardada activa. Se guarda para poder desmarcarla al
   *  cambiar de pestaña sin tener que consultar la lista de vistas. */
  savedKind: ViewKind | null;
  taskId: string | null;
}

/** La configuración efectiva de la vista activa. Es lo único que consume el
 *  render: el resto del estado no le hace falta a nadie más. */
export function configOf(state: WorkspaceState): ViewConfig {
  const propio = state.perKind[state.kind];
  return {
    filters: state.shared.filters,
    sorts: state.shared.sorts,
    search: state.shared.search,
    groupBy: propio.groupBy,
    props: propio.props,
  };
}

function perKindPorDefecto(): Record<ViewKind, PerKind> {
  const salida = {} as Record<ViewKind, PerKind>;
  for (const kind of VIEW_KINDS) {
    const preset = presetFor(kind);
    salida[kind] = { groupBy: preset.groupBy, props: [...preset.props] };
  }
  return salida;
}

/**
 * Estado inicial desde la URL. Es el otro extremo del criterio 2: la pestaña
 * nueva arranca donde estaba la primera, no en la vista por defecto.
 *
 * La configuración del enlace se aplica SÓLO a la vista que el enlace nombra.
 * Las otras tres conservan su jerarquía natural — heredarle a "Calendario" la
 * agrupación por proyecto de quien mandó el enlace la dejaría rara sin que
 * nadie hubiera pedido nada.
 */
export function initWorkspace(loc: ViewLocation): WorkspaceState {
  const perKind = perKindPorDefecto();
  const config = normalizeViewConfig(loc.config, loc.kind);
  perKind[loc.kind] = { groupBy: config.groupBy, props: [...config.props] };

  return {
    kind: loc.kind,
    shared: { filters: config.filters, sorts: config.sorts, search: config.search },
    perKind,
    savedId: loc.savedId ?? null,
    savedKind: loc.savedId ? loc.kind : null,
    taskId: loc.taskId ?? null,
  };
}

export function locationOf(state: WorkspaceState): ViewLocation {
  return {
    kind: state.kind,
    config: configOf(state),
    savedId: state.savedId,
    taskId: state.taskId,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Acciones
// ════════════════════════════════════════════════════════════════════════════

export type WorkspaceAction =
  | { type: 'kind'; kind: ViewKind }
  | { type: 'search'; value: string }
  | { type: 'filters'; filters: FilterGroup }
  | { type: 'quick'; quick: QuickFilter }
  | { type: 'sorts'; sorts: Sort[] }
  | { type: 'groupBy'; groupBy: GroupBy }
  | { type: 'props'; props: CardProp[] }
  | { type: 'applySaved'; view: SavedView }
  | { type: 'clearSaved' }
  | { type: 'openTask'; taskId: string | null }
  | { type: 'resetFilters' };

/**
 * Toda modificación de filtros suelta la vista guardada activa.
 *
 * Es la corrección al defecto que GARDEN tenía en `view-tabs.tsx`: allá se
 * podía editar los filtros con una vista guardada seleccionada y la pestaña
 * seguía marcada como esa vista, así que la pantalla decía "Mi semana" mientras
 * mostraba otra cosa. Aquí en cuanto se toca un filtro la pestaña se
 * desmarca — y guardar los cambios es un botón explícito.
 */
const SOLTAR_GUARDADA = { savedId: null, savedKind: null } as const;

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case 'kind':
      // Aquí NO se toca `shared`. Ése es el criterio 1, y es una omisión
      // deliberada: el filtro sobrevive porque cambiar de vista no lo alcanza.
      //
      // La vista guardada sí se suelta cuando su CLASE deja de ser la que se
      // está viendo: si no, la pestaña seguiría diciendo "Mi semana" (que es un
      // calendario) mientras la pantalla enseña un tablero — el mismo defecto de
      // `view-tabs.tsx` de GARDEN, sólo que por el otro lado.
      return action.kind === state.savedKind
        ? { ...state, kind: action.kind }
        : { ...state, kind: action.kind, ...SOLTAR_GUARDADA };

    case 'search':
      return { ...state, ...SOLTAR_GUARDADA, shared: { ...state.shared, search: action.value } };

    case 'filters':
      return { ...state, ...SOLTAR_GUARDADA, shared: { ...state.shared, filters: action.filters } };

    case 'quick': {
      const config = toggleQuickFilter(configOf(state), action.quick);
      return { ...state, ...SOLTAR_GUARDADA, shared: { ...state.shared, filters: config.filters } };
    }

    case 'sorts':
      return { ...state, ...SOLTAR_GUARDADA, shared: { ...state.shared, sorts: action.sorts } };

    case 'groupBy':
      return {
        ...state,
        ...SOLTAR_GUARDADA,
        perKind: {
          ...state.perKind,
          [state.kind]: { ...state.perKind[state.kind], groupBy: action.groupBy },
        },
      };

    case 'props':
      return {
        ...state,
        perKind: {
          ...state.perKind,
          [state.kind]: { ...state.perKind[state.kind], props: action.props },
        },
      };

    case 'applySaved': {
      const kind = action.view.kind;
      const config = normalizeViewConfig(action.view.config, kind);
      return {
        ...state,
        kind,
        shared: { filters: config.filters, sorts: config.sorts, search: config.search },
        perKind: {
          ...state.perKind,
          [kind]: { groupBy: config.groupBy, props: [...config.props] },
        },
        savedId: action.view.id,
        savedKind: kind,
      };
    }

    case 'clearSaved':
      return { ...state, ...SOLTAR_GUARDADA };

    case 'openTask':
      // Abrir una tarea no cambia lo que se está mirando detrás. Cerrar el
      // panel tiene que devolver a la misma lista, con los mismos filtros.
      return { ...state, taskId: action.taskId };

    case 'resetFilters': {
      const preset = presetFor(state.kind);
      return {
        ...state,
        ...SOLTAR_GUARDADA,
        shared: { filters: preset.filters, sorts: [], search: '' },
        perKind: {
          ...state.perKind,
          [state.kind]: { groupBy: DEFAULT_GROUP_BY[state.kind], props: [...preset.props] },
        },
      };
    }
  }
}

/**
 * ¿Vale la pena ofrecer la vista "por responsable"?
 *
 * Criterio 7 del handoff: *"sin equipo, la vista por responsable no estorba —
 * se degrada con elegancia"*. Un emprendedor solo no necesita una pestaña que
 * siempre muestra una columna con su nombre.
 *
 * Se esconde, no se deshabilita: una pestaña gris que no hace nada es peor que
 * no tenerla. Y si un enlace apunta a ella, aparece de todos modos — un enlace
 * compartido no puede llevar a una pantalla que no existe.
 */
export function visibleViewKinds(state: WorkspaceState, memberCount: number): ViewKind[] {
  const hayEquipo = memberCount > 1;
  return VIEW_KINDS.filter((k) => k !== 'responsable' || hayEquipo || state.kind === 'responsable');
}
