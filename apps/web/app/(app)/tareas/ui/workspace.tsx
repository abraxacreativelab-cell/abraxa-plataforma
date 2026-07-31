'use client';

import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Icon } from '@abraxa/ui';
import {
  GROUP_META,
  SIN_VALOR,
  buildSurfaces,
  configOf,
  dropPatch,
  initWorkspace,
  locationOf,
  locationToParams,
  normalizeViewConfig,
  planDrop,
  progressOf,
  visibleViewKinds,
  workspaceReducer,
  type Member,
  type Project,
  type SavedView,
  type Task,
  type ViewLocation,
} from '@abraxa/work/domain';
import type { Fallo } from '../action-types';
import { apiReal, esFallo, type WorkApi } from './api';
import { crearApiDemo, type SemillaDemo } from './demo-api';
import { Aviso, Progress } from './primitives';
import { Board, TableroVacio, type DestinoSoltado } from './board';
import { Calendar } from './calendar';
import { FilterBuilder } from './filter-builder';
import {
  GuardarVistaDialog,
  NuevaTareaDialog,
  ProyectosDialog,
  SubtareasAbiertasDialog,
  VistasGuardadas,
  type BorradorTarea,
} from './dialogs';
import { TaskDetail } from './task-detail';
import { Toolbar } from './toolbar';
import type { MenuItem } from './primitives';
// Registra la herramienta de H9 en el registro de H5. Al importarse aquí, se
// da de alta en cuanto la pantalla entra al paquete del cliente.
import './register';

export interface DatosIniciales {
  tasks: Task[];
  projects: Project[];
  views: SavedView[];
  members: Member[];
  truncated: boolean;
  teamDegraded: boolean;
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  La pantalla de tareas.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Las cuatro vistas se alimentan del MISMO conjunto y se derivan en memoria:
 *  filtrar → armar el árbol → agrupar. Por eso cambiar de pestaña es
 *  instantáneo y por eso el filtro sobrevive al cambio (criterio 1): no hay una
 *  petición por vista que pueda volver con otra cosa.
 *
 *  El estado no vive aquí: vive en `workspaceReducer`, que es puro y está
 *  probado. Este componente sólo lo conecta con la URL, con la API y con el
 *  render — que es lo único que no se puede verificar en una aserción.
 *
 *  ── Optimista, pero honesto ────────────────────────────────────────────────
 *
 *  Toda escritura se aplica en pantalla antes de que el servidor conteste. Si
 *  el servidor dice que no, se DESHACE y se dice por qué. Una interfaz
 *  optimista que se traga el error es peor que una lenta: el usuario cree que
 *  quedó y se entera al recargar.
 */
export function Workspace({
  inicial,
  ubicacion,
  userEmail,
  ahoraISO,
  demo,
}: {
  inicial: DatosIniciales;
  ubicacion: ViewLocation;
  userEmail: string | null;
  /** La hora del servidor. Evita que el primer render del cliente difiera del
   *  de la hidratación por unos milisegundos de diferencia de reloj. */
  ahoraISO: string;
  /** Semilla del modo demostración. `null` en producción, siempre. */
  demo: SemillaDemo | null;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [datos, setDatos] = React.useState(inicial);
  const [state, dispatch] = React.useReducer(workspaceReducer, ubicacion, initWorkspace);

  const [now, setNow] = React.useState(() => new Date(ahoraISO));
  React.useEffect(() => setNow(new Date()), []);

  const [aviso, setAviso] = React.useState<{ tone: 'error' | 'warning' | 'info'; texto: string } | null>(null);
  const [trabajando, setTrabajando] = React.useState(false);

  const [filtrosAbiertos, setFiltrosAbiertos] = React.useState(false);
  const [proyectosAbierto, setProyectosAbierto] = React.useState(false);
  const [guardarAbierto, setGuardarAbierto] = React.useState(false);
  const [nueva, setNueva] = React.useState<Partial<BorradorTarea> | null>(null);
  const [conflicto, setConflicto] = React.useState<{ taskId: string; abiertas: Task[] } | null>(null);

  const api: WorkApi = React.useMemo(() => (demo ? crearApiDemo(demo) : apiReal), [demo]);

  // ── URL ───────────────────────────────────────────────────────────────────
  // `configOf` arma un objeto nuevo cada vez, así que sin memo TODOS los
  // derivados de abajo se recalcularían en cada render, incluido filtrar y
  // agrupar dos mil tareas al mover el cursor.
  const config = React.useMemo(() => configOf(state), [state]);

  React.useEffect(() => {
    const query = locationToParams(locationOf(state)).toString();
    const actual = window.location.search.replace(/^\?/, '');
    if (query === actual) return;
    // `replace` y no `push`: cada filtro que se prende no puede ser una entrada
    // en el historial, o el botón "atrás" tardaría veinte clics en salir.
    router.replace(`${pathname}?${query}`, { scroll: false });
  }, [state, router, pathname]);

  // ── Derivados ─────────────────────────────────────────────────────────────

  /**
   * Qué le toca a cada vista, en una sola pasada y en el dominio.
   *
   * Está junto a propósito: las columnas quieren el árbol (subtareas colgadas
   * de su padre, contadores contando TODO aunque el filtro esconda partes) y el
   * calendario quiere tarjetas planas (un padre y su subtarea pueden vencer
   * días distintos). Cuando cada vista se servía sola, el calendario acabó
   * recibiendo el árbol y NINGUNA subtarea aparecía en él. Ver
   * `domain/surfaces.ts`.
   */
  const { visible: filtradas, groups: grupos, calendar: delCalendario } = React.useMemo(
    () => buildSurfaces(datos.tasks, config, { projects: datos.projects, members: datos.members }, now),
    [datos.tasks, config, datos.projects, datos.members, now],
  );

  const kindsVisibles = visibleViewKinds(state, datos.members.length);
  const avanceTotal = React.useMemo(() => progressOf(datos.tasks), [datos.tasks]);

  // ¿Lo que se está viendo ya no es lo que dice la vista guardada? Entonces el
  // botón de al lado guarda los cambios en vez de borrarla.
  const vistaActiva = datos.views.find((v) => v.id === state.savedId) ?? null;
  const hayCambios =
    vistaActiva != null &&
    (vistaActiva.kind !== state.kind ||
      JSON.stringify(normalizeViewConfig(vistaActiva.config, vistaActiva.kind)) !==
        JSON.stringify(normalizeViewConfig(config, state.kind)));

  // ── Utilidades de estado ──────────────────────────────────────────────────
  const reemplazar = (task: Task): void =>
    setDatos((d) => ({ ...d, tasks: d.tasks.map((t) => (t.id === task.id ? task : t)) }));

  const fallar = (f: Fallo): void => setAviso({ tone: 'error', texto: f.message });

  /** Ejecuta, muestra el error si lo hay y devuelve si salió bien. */
  async function correr<T>(
    accion: () => Promise<T | Fallo>,
    alSalirBien?: (data: T) => void,
    alFallar?: (f: Fallo) => boolean,
  ): Promise<boolean> {
    setTrabajando(true);
    setAviso(null);
    const r = await accion();
    setTrabajando(false);

    if (esFallo(r)) {
      // `alFallar` devuelve `true` si ya se hizo cargo (por ejemplo, el 409
      // que abre su propio modal en vez de pintar un banner rojo).
      if (!alFallar?.(r)) fallar(r);
      return false;
    }
    alSalirBien?.(r as T);
    return true;
  }

  // ── Acciones ──────────────────────────────────────────────────────────────

  const abrirTarea = (id: string): void => dispatch({ type: 'openTask', taskId: id });

  const parchar = async (id: string, patch: Record<string, unknown>): Promise<void> => {
    const previo = datos.tasks.find((t) => t.id === id);
    if (previo) reemplazar({ ...previo, ...patch } as Task); // optimista
    await correr(
      () => api.actualizarTarea(id, patch),
      (t) => reemplazar(t),
      (f) => {
        if (previo) reemplazar(previo); // deshacer
        if (f.code === 'CONFLICT' && f.openSubtasks) {
          setConflicto({ taskId: id, abiertas: f.openSubtasks });
          return true;
        }
        return false;
      },
    );
  };

  const borrar = async (id: string): Promise<boolean> => {
    const antes = datos.tasks;
    setDatos((d) => ({ ...d, tasks: d.tasks.filter((t) => t.id !== id && t.parent_id !== id) }));
    return correr(
      () => api.borrarTarea(id),
      undefined,
      () => {
        setDatos((d) => ({ ...d, tasks: antes }));
        return false;
      },
    );
  };

  const alSoltar = async ({ taskId, groupKey, index }: DestinoSoltado): Promise<void> => {
    const patch = dropPatch(config.groupBy, groupKey);
    if (!patch) return;

    const grupo = grupos.find((g) => g.key === groupKey);
    const posicionActual = grupo?.tasks.findIndex((t) => t.id === taskId) ?? -1;
    const vecinos = (grupo?.tasks ?? []).filter((t) => t.id !== taskId);
    // Al mover dentro de la misma columna, quitarse a uno mismo corre los
    // índices posteriores: sin esto, arrastrar una tarjeta un lugar hacia
    // abajo la deja donde estaba.
    const destino = posicionActual >= 0 && posicionActual < index ? index - 1 : index;
    // `renumber` viene vacío salvo cuando entre los dos vecinos ya no cabía
    // ningún número —una columna heredada empatada en 0, o un hueco agotado a
    // fuerza de promedios—. Entonces trae la columna con posiciones enteras y
    // viaja en el MISMO lote: el RPC de la 070 lo aplica en una transacción, así
    // que renumerar N tarjetas sigue siendo una escritura y no N oportunidades
    // de pisarse.
    const { sort_order, renumber } = planDrop(vecinos, destino);
    const reposicionados = new Map<string, number>(renumber.map((r) => [r.id, r.sort_order]));

    const antes = datos.tasks;
    setDatos((d) => ({
      ...d,
      tasks: d.tasks.map((t) => {
        if (t.id === taskId) return { ...t, ...patch, sort_order } as Task;
        const nuevo = reposicionados.get(t.id);
        return nuevo === undefined ? t : { ...t, sort_order: nuevo };
      }),
    }));

    await correr(
      () => api.reordenar([{ id: taskId, sort_order, ...patch }, ...renumber]),
      undefined,
      (f) => {
        setDatos((d) => ({ ...d, tasks: antes }));
        if (f.code === 'CONFLICT' && f.openSubtasks) {
          setConflicto({ taskId, abiertas: f.openSubtasks });
          return true;
        }
        return false;
      },
    );
  };

  const crear = async (borrador: BorradorTarea): Promise<void> => {
    const ok = await correr(
      () => api.crearTarea({ ...borrador }),
      (t) => setDatos((d) => ({ ...d, tasks: [...d.tasks, t] })),
    );
    if (ok) setNueva(null);
  };

  const completarTodas = async (): Promise<void> => {
    if (!conflicto) return;
    const ok = await correr(() => api.completarTodas(conflicto.taskId));
    if (!ok) return;

    const cerradas = new Set([conflicto.taskId, ...conflicto.abiertas.map((t) => t.id)]);
    setDatos((d) => ({
      ...d,
      tasks: d.tasks.map((t) => (cerradas.has(t.id) ? { ...t, status: 'completed' as const } : t)),
    }));
    setConflicto(null);
  };

  // ── Menú "mover a" — la alternativa a arrastrar ───────────────────────────
  const opcionesMoverPara = (task: Task): MenuItem[] => {
    const groupBy = config.groupBy;
    if (!groupBy) return [];
    const actual = task[groupBy] ?? SIN_VALOR;

    return grupos
      .filter((g) => g.droppable && g.key !== actual)
      .map((g) => ({
        label: `Mover a ${g.label}`,
        icon: 'arrow-right',
        onSelect: () => void alSoltar({ taskId: task.id, groupKey: g.key, index: g.tasks.length }),
      }));
  };

  const conteoPorProyecto = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const t of datos.tasks) if (t.project_id) m.set(t.project_id, (m.get(t.project_id) ?? 0) + 1);
    return m;
  }, [datos.tasks]);

  // ══════════════════════════════════════════════════════════════════════════
  return (
    <main className="mx-auto w-full max-w-[110rem] space-y-4 px-4 py-6 sm:px-6">
      <header className="space-y-1">
        <p className="eyebrow text-muted-foreground">Tareas</p>
        <h1 className="text-2xl font-semibold tracking-tight">Qué hay que hacer</h1>
        {avanceTotal.total > 0 && (
          <div className="flex max-w-md items-center gap-2 pt-1">
            <Progress value={avanceTotal.pct} label="Avance general" />
            <span className="tabular shrink-0 text-xs text-muted-foreground">
              {avanceTotal.done}/{avanceTotal.total}
            </span>
          </div>
        )}
      </header>

      {demo && (
        <Aviso tone="warning">
          <strong>Modo demostración.</strong> Nada de lo que hagas aquí se guarda: los datos viven en la
          memoria de esta pestaña. Se activa sólo en desarrollo, mientras el módulo de sesión y empresa
          (H2) no está cableado.
        </Aviso>
      )}

      {datos.truncated && (
        <Aviso tone="warning">
          Se están mostrando las primeras 2000 tareas y hay más. Filtra o archiva lo que ya no siga vivo.
        </Aviso>
      )}

      {datos.teamDegraded && datos.members.length <= 1 && (
        <Aviso tone="info">
          Todavía no podemos leer tu equipo, así que sólo apareces tú como responsable posible.
        </Aviso>
      )}

      {aviso && (
        <Aviso tone={aviso.tone} onDismiss={() => setAviso(null)}>
          {aviso.texto}
        </Aviso>
      )}

      <Toolbar
        kind={state.kind}
        kindsVisibles={kindsVisibles}
        config={config}
        userEmail={userEmail}
        onKind={(k) => dispatch({ type: 'kind', kind: k })}
        onSearch={(v) => dispatch({ type: 'search', value: v })}
        onQuick={(q) => dispatch({ type: 'quick', quick: q })}
        onGroupBy={(g) => dispatch({ type: 'groupBy', groupBy: g })}
        onProps={(p) => dispatch({ type: 'props', props: p })}
        onAbrirFiltros={() => setFiltrosAbiertos(true)}
        onLimpiar={() => dispatch({ type: 'resetFilters' })}
        onNueva={() => setNueva({})}
        onProyectos={() => setProyectosAbierto(true)}
      >
        <VistasGuardadas
          views={datos.views}
          activa={state.savedId}
          userEmail={userEmail}
          hayCambios={hayCambios}
          onAplicar={(v) => dispatch({ type: 'applySaved', view: v })}
          onGuardarNueva={() => setGuardarAbierto(true)}
          onActualizar={(v) =>
            void correr(
              () => api.actualizarVista(v.id, { config, kind: state.kind }),
              (actualizada) =>
                setDatos((d) => ({ ...d, views: d.views.map((x) => (x.id === v.id ? actualizada : x)) })),
            )
          }
          onBorrar={(v) =>
            void correr(
              () => api.borrarVista(v.id),
              () => {
                setDatos((d) => ({ ...d, views: d.views.filter((x) => x.id !== v.id) }));
                dispatch({ type: 'clearSaved' });
              },
            )
          }
        />
      </Toolbar>

      {datos.tasks.length === 0 ? (
        <TableroVacio onCrear={() => setNueva({})} />
      ) : state.kind === 'calendario' ? (
        <Calendar
          tasks={delCalendario}
          members={datos.members}
          now={now}
          onAbrir={abrirTarea}
          onFechar={(id, due) => void parchar(id, { due_date: due })}
          onCrearEn={(due) => setNueva({ due_date: due })}
        />
      ) : (
        <Board
          grupos={grupos}
          props={config.props}
          projects={datos.projects}
          members={datos.members}
          now={now}
          ocupado={trabajando}
          acciones={{
            abrir: abrirTarea,
            completar: (id) => void parchar(id, { status: 'completed' }),
            borrar: (id) => void borrar(id),
          }}
          opcionesMoverPara={opcionesMoverPara}
          onSoltar={(d) => void alSoltar(d)}
          onAgregar={(groupKey) => {
            // Crear desde la columna "En progreso" y tener que elegir el estado
            // otra vez es pedir dos veces lo mismo.
            const patch = dropPatch(config.groupBy, groupKey) ?? {};
            setNueva({
              ...(patch.status ? { status: patch.status } : {}),
              ...(patch.priority ? { priority: patch.priority } : {}),
              ...('assigned_to' in patch ? { assigned_to: patch.assigned_to ?? null } : {}),
              ...('project_id' in patch ? { project_id: patch.project_id ?? null } : {}),
            });
          }}
        />
      )}

      {/* ── Capas ────────────────────────────────────────────────────────── */}

      <FilterBuilder
        open={filtrosAbiertos}
        onClose={() => setFiltrosAbiertos(false)}
        filters={config.filters}
        onChange={(filters) => dispatch({ type: 'filters', filters })}
        projects={datos.projects}
        members={datos.members}
      />

      {state.taskId && (
        <TaskDetail
          taskId={state.taskId}
          members={datos.members}
          projects={datos.projects}
          now={now}
          cargar={(id) => api.cargarDetalle(id)}
          guardar={async (id, patch) => {
            const r = await api.actualizarTarea(id, patch);
            if (!esFallo(r)) reemplazar(r);
            return r;
          }}
          crearSubtarea={async (parentId, title) => {
            const r = await api.crearTarea({ title, parent_id: parentId });
            if (!esFallo(r)) setDatos((d) => ({ ...d, tasks: [...d.tasks, r] }));
            return r;
          }}
          comentar={async (id, body) => !esFallo(await api.comentar(id, body))}
          borrar={borrar}
          onConflicto={(taskId, abiertas) => setConflicto({ taskId, abiertas })}
          onClose={() => dispatch({ type: 'openTask', taskId: null })}
        />
      )}

      {conflicto && (
        <SubtareasAbiertasDialog
          abiertas={conflicto.abiertas}
          trabajando={trabajando}
          onCompletarTodas={() => void completarTodas()}
          onAbrir={(id) => {
            setConflicto(null);
            abrirTarea(id);
          }}
          onClose={() => setConflicto(null)}
        />
      )}

      {nueva && (
        <NuevaTareaDialog
          inicial={nueva}
          members={datos.members}
          projects={datos.projects}
          trabajando={trabajando}
          error={aviso?.tone === 'error' ? aviso.texto : null}
          onCrear={(b) => void crear(b)}
          onClose={() => setNueva(null)}
        />
      )}

      {guardarAbierto && (
        <GuardarVistaDialog
          kind={state.kind}
          trabajando={trabajando}
          error={aviso?.tone === 'error' ? aviso.texto : null}
          onClose={() => setGuardarAbierto(false)}
          onGuardar={(nombre, compartida) =>
            void correr(
              () => api.guardarVista({ name: nombre, kind: state.kind, config, shared: compartida }),
              (v) => {
                setDatos((d) => ({ ...d, views: [...d.views, v] }));
                dispatch({ type: 'applySaved', view: v });
                setGuardarAbierto(false);
              },
            )
          }
        />
      )}

      {proyectosAbierto && (
        <ProyectosDialog
          projects={datos.projects}
          conteoPorProyecto={conteoPorProyecto}
          trabajando={trabajando}
          error={aviso?.tone === 'error' ? aviso.texto : null}
          onClose={() => setProyectosAbierto(false)}
          onCrear={(name) =>
            void correr(
              () => api.crearProyecto(name),
              (p) => setDatos((d) => ({ ...d, projects: [...d.projects, p] })),
            )
          }
          onActualizar={(id, patch) =>
            void correr(
              () => api.actualizarProyecto(id, patch),
              (p) => setDatos((d) => ({ ...d, projects: d.projects.map((x) => (x.id === id ? p : x)) })),
            )
          }
          onBorrar={(id) =>
            void correr(
              () => api.borrarProyecto(id),
              ({ orphaned }) => {
                setDatos((d) => ({
                  ...d,
                  projects: d.projects.filter((p) => p.id !== id),
                  tasks: d.tasks.map((t) => (t.project_id === id ? { ...t, project_id: null } : t)),
                }));
                if (orphaned > 0) {
                  setAviso({
                    tone: 'info',
                    texto: `Se borró el proyecto. Sus ${orphaned} tareas siguen aquí, ahora sin proyecto.`,
                  });
                }
              },
            )
          }
        />
      )}

      <footer className="flex items-center gap-2 pt-2 text-xs text-muted-foreground/70">
        <Icon name="tasks" className="h-3.5 w-3.5" />
        {filtradas.length === datos.tasks.length
          ? `${datos.tasks.length} tareas`
          : `${filtradas.length} de ${datos.tasks.length} tareas con los filtros puestos`}
        {config.groupBy && ` · agrupadas por ${GROUP_META[config.groupBy].toLowerCase()}`}
      </footer>
    </main>
  );
}
