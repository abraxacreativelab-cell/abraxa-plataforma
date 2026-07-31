import { describe, expect, it } from 'vitest';
import { vistaGuardada } from '../testing/factories';
import {
  configOf,
  initWorkspace,
  locationOf,
  visibleViewKinds,
  workspaceReducer,
  type WorkspaceAction,
  type WorkspaceState,
} from './workspace-state';
import {
  VIEW_KINDS,
  locationFromParams,
  locationToParams,
  presetFor,
  quickFilters,
  type ViewKind,
} from './view';

const arrancar = (kind: ViewKind = 'progreso'): WorkspaceState =>
  initWorkspace({ kind, config: presetFor(kind) });

const correr = (state: WorkspaceState, ...acciones: WorkspaceAction[]): WorkspaceState =>
  acciones.reduce(workspaceReducer, state);

const URGENTES = quickFilters(null).find((q) => q.id === 'urgentes');
if (!URGENTES) throw new Error('falta el filtro rápido de urgentes');

describe('criterio 1 — el filtro sobrevive al cambio de vista', () => {
  it('filtrar en una vista y cambiar de vista conserva el filtro', () => {
    const filtrada = correr(arrancar('progreso'), { type: 'quick', quick: URGENTES }, { type: 'search', value: 'panadería' });
    const antes = configOf(filtrada);

    let estado = filtrada;
    for (const kind of VIEW_KINDS) {
      estado = workspaceReducer(estado, { type: 'kind', kind });
      const ahora = configOf(estado);
      expect(ahora.filters).toEqual(antes.filters);
      expect(ahora.search).toBe('panadería');
    }
  });

  it('el orden también viaja entre vistas', () => {
    const ordenada = correr(arrancar(), { type: 'sorts', sorts: [{ prop: 'due_date', dir: 'asc' }] });
    const enCalendario = workspaceReducer(ordenada, { type: 'kind', kind: 'calendario' });
    expect(configOf(enCalendario).sorts).toEqual([{ prop: 'due_date', dir: 'asc' }]);
  });

  it('dar la vuelta completa y volver deja todo como estaba', () => {
    const inicial = correr(arrancar('progreso'), { type: 'quick', quick: URGENTES });
    const vuelta = correr(
      inicial,
      { type: 'kind', kind: 'proyecto' },
      { type: 'kind', kind: 'calendario' },
      { type: 'kind', kind: 'responsable' },
      { type: 'kind', kind: 'progreso' },
    );
    expect(configOf(vuelta)).toEqual(configOf(inicial));
  });
});

describe('la jerarquía es de cada vista', () => {
  it('cada vista abre agrupada por lo suyo', () => {
    let estado = arrancar('progreso');
    expect(configOf(estado).groupBy).toBe('status');
    estado = workspaceReducer(estado, { type: 'kind', kind: 'proyecto' });
    expect(configOf(estado).groupBy).toBe('project_id');
    estado = workspaceReducer(estado, { type: 'kind', kind: 'responsable' });
    expect(configOf(estado).groupBy).toBe('assigned_to');
  });

  it('cambiar la agrupación de una vista NO se la cambia a las demás', () => {
    // Es lo que separa "jerarquía configurable por vista" de "una agrupación
    // global disfrazada de cuatro pestañas".
    const estado = correr(
      arrancar('proyecto'),
      { type: 'groupBy', groupBy: 'priority' },
      { type: 'kind', kind: 'progreso' },
    );
    expect(configOf(estado).groupBy).toBe('status');

    const deVuelta = workspaceReducer(estado, { type: 'kind', kind: 'proyecto' });
    expect(configOf(deVuelta).groupBy).toBe('priority');
  });

  it('qué se ve en la tarjeta también es de cada vista', () => {
    const estado = correr(
      arrancar('progreso'),
      { type: 'props', props: ['status'] },
      { type: 'kind', kind: 'calendario' },
    );
    expect(configOf(estado).props).toEqual(presetFor('calendario').props);
  });
});

describe('la vista guardada se suelta al tocar los filtros', () => {
  const guardada = vistaGuardada({ id: 'v1', kind: 'progreso', name: 'Mi semana' });

  it('aplicarla la marca como activa', () => {
    const estado = workspaceReducer(arrancar(), { type: 'applySaved', view: guardada });
    expect(estado.savedId).toBe('v1');
    expect(estado.kind).toBe('progreso');
  });

  it('cambiar un filtro la desmarca: la pantalla no puede decir "Mi semana" mostrando otra cosa', () => {
    const conVista = workspaceReducer(arrancar(), { type: 'applySaved', view: guardada });
    expect(workspaceReducer(conVista, { type: 'quick', quick: URGENTES }).savedId).toBeNull();
    expect(workspaceReducer(conVista, { type: 'search', value: 'x' }).savedId).toBeNull();
    expect(workspaceReducer(conVista, { type: 'groupBy', groupBy: 'priority' }).savedId).toBeNull();
    expect(workspaceReducer(conVista, { type: 'sorts', sorts: [] }).savedId).toBeNull();
  });

  it('abrir una tarea NO la desmarca: el panel no cambia lo de atrás', () => {
    const conVista = workspaceReducer(arrancar(), { type: 'applySaved', view: guardada });
    expect(workspaceReducer(conVista, { type: 'openTask', taskId: 't1' }).savedId).toBe('v1');
  });

  it('cambiar a una pestaña de otra clase SÍ la desmarca', () => {
    // "Mi semana" es una vista de tablero. Si al cambiar a Calendario la
    // pestaña siguiera marcada, la pantalla diría "Mi semana" mostrando otra
    // cosa — el defecto de GARDEN, por el otro lado.
    const conVista = workspaceReducer(arrancar(), { type: 'applySaved', view: guardada });
    expect(workspaceReducer(conVista, { type: 'kind', kind: 'calendario' }).savedId).toBeNull();
  });

  it('volver a la pestaña de su propia clase no la desmarca', () => {
    const conVista = workspaceReducer(arrancar(), { type: 'applySaved', view: guardada });
    expect(workspaceReducer(conVista, { type: 'kind', kind: 'progreso' }).savedId).toBe('v1');
  });

  it('aplicar una vista guardada de otra clase cambia también de pestaña', () => {
    const deCalendario = vistaGuardada({ id: 'v2', kind: 'calendario' });
    const estado = workspaceReducer(arrancar('progreso'), { type: 'applySaved', view: deCalendario });
    expect(estado.kind).toBe('calendario');
    expect(configOf(estado).groupBy).toBe(presetFor('calendario').groupBy);
  });
});

describe('el panel de detalle no altera lo de atrás', () => {
  it('abrir y cerrar una tarea deja los filtros intactos', () => {
    const filtrada = correr(arrancar(), { type: 'quick', quick: URGENTES });
    const conPanel = correr(filtrada, { type: 'openTask', taskId: 't1' }, { type: 'openTask', taskId: null });
    expect(configOf(conPanel)).toEqual(configOf(filtrada));
    expect(conPanel.taskId).toBeNull();
  });
});

describe('criterio 2 — el estado cabe en la URL', () => {
  it('estado → URL → estado da lo mismo', () => {
    const estado = correr(
      arrancar('proyecto'),
      { type: 'quick', quick: URGENTES },
      { type: 'search', value: 'apertura' },
      { type: 'groupBy', groupBy: 'priority' },
      { type: 'openTask', taskId: 't9' },
    );

    const url = locationToParams(locationOf(estado)).toString();
    const otraPestana = initWorkspace(locationFromParams(new URLSearchParams(url)));

    expect(configOf(otraPestana)).toEqual(configOf(estado));
    expect(otraPestana.kind).toBe('proyecto');
    expect(otraPestana.taskId).toBe('t9');
  });

  it('la pestaña nueva no le contagia la agrupación del enlace a las demás vistas', () => {
    const estado = correr(arrancar('proyecto'), { type: 'groupBy', groupBy: 'priority' });
    const otra = initWorkspace(locationFromParams(new URLSearchParams(locationToParams(locationOf(estado)))));

    expect(configOf(otra).groupBy).toBe('priority');
    expect(configOf(workspaceReducer(otra, { type: 'kind', kind: 'calendario' })).groupBy).toBe(
      presetFor('calendario').groupBy,
    );
  });
});

describe('resetFilters', () => {
  it('devuelve la vista a su preset', () => {
    const revuelta = correr(
      arrancar('progreso'),
      { type: 'search', value: 'x' },
      { type: 'groupBy', groupBy: 'priority' },
      { type: 'sorts', sorts: [{ prop: 'title', dir: 'asc' }] },
    );
    const limpia = workspaceReducer(revuelta, { type: 'resetFilters' });
    expect(configOf(limpia)).toEqual(presetFor('progreso'));
  });
});

describe('criterio 7 — sin equipo, "por responsable" no estorba', () => {
  it('con un solo miembro la pestaña no se ofrece', () => {
    expect(visibleViewKinds(arrancar(), 1)).toEqual(['proyecto', 'calendario', 'progreso']);
    expect(visibleViewKinds(arrancar(), 0)).not.toContain('responsable');
  });

  it('en cuanto hay equipo aparece', () => {
    expect(visibleViewKinds(arrancar(), 2)).toEqual([...VIEW_KINDS]);
  });

  it('un enlace que apunta a esa vista la muestra aunque no haya equipo', () => {
    // Un enlace compartido no puede llevar a una pantalla que no existe.
    expect(visibleViewKinds(arrancar('responsable'), 1)).toContain('responsable');
  });
});
