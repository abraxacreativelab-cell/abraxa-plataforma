'use client';

import * as React from 'react';
import { Button, Icon, Input, cn } from '@abraxa/ui';
import {
  CARD_PROPS,
  CARD_PROP_META,
  GROUPABLE,
  GROUP_META,
  VIEW_META,
  countActiveFilters,
  isQuickFilterOn,
  quickFilters,
  type CardProp,
  type GroupBy,
  type QuickFilter,
  type ViewConfig,
  type ViewKind,
} from '@abraxa/work/domain';
import { Chip, Menu, type MenuItem } from './primitives';

/**
 * La barra de la pantalla.
 *
 * ── Las pestañas son las CUATRO vistas, no siete ───────────────────────────
 *
 * Cada una lleva su pregunta como título accesible: "¿quién trae qué?" dice
 * mucho más que "agrupado por responsable", y es la pregunta la que hace que
 * alguien sepa a cuál ir.
 *
 * ── La agrupación es de cada vista ─────────────────────────────────────────
 *
 * El selector de jerarquía cambia SÓLO la vista activa. Es lo que separa
 * "jerarquía configurable por vista" de "una agrupación global disfrazada de
 * cuatro pestañas".
 */
export function Toolbar({
  kind,
  kindsVisibles,
  config,
  userEmail,
  onKind,
  onSearch,
  onQuick,
  onGroupBy,
  onProps,
  onAbrirFiltros,
  onLimpiar,
  onNueva,
  onProyectos,
  children,
}: {
  kind: ViewKind;
  kindsVisibles: ViewKind[];
  config: ViewConfig;
  userEmail: string | null;
  onKind: (k: ViewKind) => void;
  onSearch: (v: string) => void;
  onQuick: (q: QuickFilter) => void;
  onGroupBy: (g: GroupBy) => void;
  onProps: (p: CardProp[]) => void;
  onAbrirFiltros: () => void;
  onLimpiar: () => void;
  onNueva: () => void;
  onProyectos: () => void;
  /** Las vistas guardadas. Se pasan como hijo para que la barra no dependa de
   *  cómo se persisten. */
  children?: React.ReactNode;
}) {
  const rapidos = React.useMemo(() => quickFilters(userEmail), [userEmail]);
  const activos = countActiveFilters(config.filters);

  // La búsqueda se escribe en un estado local y se propaga con retraso: cada
  // tecla vuelve a filtrar, agrupar y pintar el tablero entero.
  const [busqueda, setBusqueda] = React.useState(config.search);
  React.useEffect(() => setBusqueda(config.search), [config.search]);
  React.useEffect(() => {
    if (busqueda === config.search) return;
    const t = setTimeout(() => onSearch(busqueda), 200);
    return () => clearTimeout(t);
  }, [busqueda, config.search, onSearch]);

  const opcionesJerarquia: MenuItem[] = [
    ...GROUPABLE.map((g) => ({
      label: GROUP_META[g],
      active: config.groupBy === g,
      onSelect: () => onGroupBy(g),
    })),
    { label: 'Sin agrupar', active: config.groupBy === null, onSelect: () => onGroupBy(null) },
  ];

  const opcionesTarjeta: MenuItem[] = CARD_PROPS.map((p) => ({
    label: CARD_PROP_META[p],
    active: config.props.includes(p),
    onSelect: () =>
      onProps(config.props.includes(p) ? config.props.filter((x) => x !== p) : [...config.props, p]),
  }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Vistas" className="flex flex-wrap gap-1">
          {kindsVisibles.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => onKind(k)}
              aria-current={k === kind ? 'page' : undefined}
              title={VIEW_META[k].question}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                k === kind
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
              )}
            >
              <Icon name={VIEW_META[k].icon} className="h-3.5 w-3.5" />
              {VIEW_META[k].label}
            </button>
          ))}
        </nav>

        <span className="flex-1" />

        <Button variant="outline" size="sm" onClick={onProyectos}>
          <Icon name="kanban" className="h-3.5 w-3.5" />
          Proyectos
        </Button>

        <Button size="sm" onClick={onNueva}>
          <Icon name="plus" className="h-3.5 w-3.5" />
          Nueva tarea
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">{VIEW_META[kind].question}</p>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Icon
            name="compass"
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar…"
            aria-label="Buscar en las tareas"
            className="h-8 w-52 pl-8 text-xs"
          />
        </div>

        {rapidos.map((q) => (
          <Chip key={q.id} active={isQuickFilterOn(config, q)} onClick={() => onQuick(q)}>
            {q.label}
          </Chip>
        ))}

        <Button variant="ghost" size="sm" onClick={onAbrirFiltros}>
          <Icon name="settings" className="h-3.5 w-3.5" />
          Filtros{activos > 0 && ` · ${activos}`}
        </Button>

        <Menu
          label="Agrupar por"
          items={opcionesJerarquia}
          trigger={
            <span className="inline-flex items-center gap-1 text-xs">
              <Icon name="panel" className="h-3.5 w-3.5" />
              {config.groupBy ? GROUP_META[config.groupBy] : 'Sin agrupar'}
              <Icon name="chevron-down" className="h-3 w-3" />
            </span>
          }
        />

        <Menu
          label="Qué se ve en la tarjeta"
          items={opcionesTarjeta}
          align="end"
          trigger={
            <span className="inline-flex items-center gap-1 text-xs">
              <Icon name="file" className="h-3.5 w-3.5" />
              Tarjeta
              <Icon name="chevron-down" className="h-3 w-3" />
            </span>
          }
        />

        {(activos > 0 || config.search) && (
          <Button variant="ghost" size="sm" onClick={onLimpiar}>
            Limpiar
          </Button>
        )}
      </div>

      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
