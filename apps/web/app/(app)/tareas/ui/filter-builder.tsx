'use client';

import * as React from 'react';
import { Button, Icon, Input, Select, cn } from '@abraxa/ui';
import {
  CONDITIONS_BY_TYPE,
  CONDITION_META,
  FILTERABLE,
  FILTER_PROP_META,
  PRIORITY_META,
  STATUS_META,
  TASK_PRIORITIES,
  TASK_STATUSES,
  countActiveFilters,
  type FilterCondition,
  type FilterGroup,
  type FilterProp,
  type FilterRule,
  type Member,
  type Project,
} from '@abraxa/work/domain';
import { Modal } from './primitives';

/**
 * El constructor de filtros — portado de `filter-builder.tsx` de GARDEN.
 *
 * Se conservan las diez condiciones y los grupos AND/OR anidados a dos
 * niveles, que es lo que hace falta para "abiertas Y (mías O sin responsable)".
 *
 * ── Lo que se agrega ───────────────────────────────────────────────────────
 *
 * El interruptor por regla. En GARDEN una regla que estorbaba había que
 * borrarla y volver a escribirla; aquí se apaga y se prende. Es la diferencia
 * entre un filtro que se usa para mirar y uno que sólo se usa una vez.
 *
 * ── Y lo que se quita ──────────────────────────────────────────────────────
 *
 * `company_id` como propiedad filtrable: aquí no hay empresas. Y `milestone_id`:
 * los hitos son del roadmap del negocio (H11), no de las tareas.
 */
export function FilterBuilder({
  open,
  onClose,
  filters,
  onChange,
  projects,
  members,
}: {
  open: boolean;
  onClose: () => void;
  filters: FilterGroup;
  onChange: (filters: FilterGroup) => void;
  projects: Project[];
  members: Member[];
}) {
  // Se edita sobre una copia y se aplica al cerrar con "Aplicar". Editar en
  // vivo repinta el tablero entero con cada tecla del campo de texto.
  const [borrador, setBorrador] = React.useState(filters);
  React.useEffect(() => {
    if (open) setBorrador(filters);
  }, [open, filters]);

  const activos = countActiveFilters(borrador);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Filtros"
      description="Las reglas del mismo grupo se combinan con Y o con O. Puedes anidar un grupo dentro de otro."
      footer={
        <>
          <Button variant="ghost" onClick={() => setBorrador({ op: 'and', rules: [] })}>
            Quitar todos
          </Button>
          <span className="flex-1" />
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={() => {
              onChange(borrador);
              onClose();
            }}
          >
            Aplicar {activos > 0 && `(${activos})`}
          </Button>
        </>
      }
    >
      <GrupoEditor
        grupo={borrador}
        onChange={setBorrador}
        projects={projects}
        members={members}
        profundidad={0}
      />
    </Modal>
  );
}

function GrupoEditor({
  grupo,
  onChange,
  projects,
  members,
  profundidad,
}: {
  grupo: FilterGroup;
  onChange: (g: FilterGroup) => void;
  projects: Project[];
  members: Member[];
  profundidad: number;
}) {
  const reemplazar = (i: number, valor: FilterRule | FilterGroup): void => {
    const rules = [...grupo.rules];
    rules[i] = valor;
    onChange({ ...grupo, rules });
  };

  const quitar = (i: number): void => {
    onChange({ ...grupo, rules: grupo.rules.filter((_, j) => j !== i) });
  };

  return (
    <div
      className={cn(
        'space-y-2',
        profundidad > 0 && 'rounded-md border border-dashed border-border p-2.5',
      )}
    >
      {grupo.rules.map((regla, i) => (
        <div key={i} className="flex items-start gap-2">
          <div className="w-14 shrink-0 pt-1.5">
            {i === 0 ? (
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">donde</span>
            ) : i === 1 ? (
              <Select
                aria-label="Combinar con"
                value={grupo.op}
                onChange={(e) => onChange({ ...grupo, op: e.target.value === 'or' ? 'or' : 'and' })}
                className="h-7 w-full px-1 text-xs"
              >
                <option value="and">Y</option>
                <option value="or">O</option>
              </Select>
            ) : (
              <span className="block pt-1 text-xs text-muted-foreground">{grupo.op === 'and' ? 'Y' : 'O'}</span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            {'rules' in regla ? (
              <GrupoEditor
                grupo={regla}
                onChange={(g) => reemplazar(i, g)}
                projects={projects}
                members={members}
                profundidad={profundidad + 1}
              />
            ) : (
              <ReglaEditor
                regla={regla}
                onChange={(r) => reemplazar(i, r)}
                projects={projects}
                members={members}
              />
            )}
          </div>

          <button
            type="button"
            onClick={() => quitar(i)}
            aria-label="Quitar esta regla"
            className="mt-1 rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <Icon name="x" className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}

      {grupo.rules.length === 0 && (
        <p className="py-2 text-sm text-muted-foreground">
          Sin filtros: se ven todas las tareas.
        </p>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            onChange({
              ...grupo,
              rules: [...grupo.rules, { prop: 'status', cond: 'is_any', value: ['pending'] }],
            })
          }
        >
          <Icon name="plus" className="h-3.5 w-3.5" />
          Regla
        </Button>

        {/* Dos niveles y no más: un tercero ya no se puede leer, y el
            normalizador lo descartaría al guardar la vista. */}
        {profundidad === 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              onChange({
                ...grupo,
                rules: [
                  ...grupo.rules,
                  { op: 'or', rules: [{ prop: 'priority', cond: 'is_any', value: ['critica', 'alta'] }] },
                ],
              })
            }
          >
            <Icon name="plus" className="h-3.5 w-3.5" />
            Grupo
          </Button>
        )}
      </div>
    </div>
  );
}

function ReglaEditor({
  regla,
  onChange,
  projects,
  members,
}: {
  regla: FilterRule;
  onChange: (r: FilterRule) => void;
  projects: Project[];
  members: Member[];
}) {
  const tipo = FILTER_PROP_META[regla.prop].type;
  const condiciones = CONDITIONS_BY_TYPE[tipo];
  const apagada = regla.off === true;

  return (
    <div className={cn('flex flex-wrap items-center gap-2', apagada && 'opacity-50')}>
      <Select
        aria-label="Propiedad"
        value={regla.prop}
        onChange={(e) => {
          const prop = e.target.value as FilterProp;
          const nuevasCond = CONDITIONS_BY_TYPE[FILTER_PROP_META[prop].type];
          // Al cambiar de propiedad, la condición anterior puede no aplicar:
          // "antes de" sobre un título no filtra nada. Se ajusta sola.
          const cond = nuevasCond.includes(regla.cond) ? regla.cond : (nuevasCond[0] as FilterCondition);
          onChange({ prop, cond, ...(regla.off ? { off: true } : {}) });
        }}
        className="h-8 text-xs"
      >
        {FILTERABLE.map((p) => (
          <option key={p} value={p}>
            {FILTER_PROP_META[p].label}
          </option>
        ))}
      </Select>

      <Select
        aria-label="Condición"
        value={regla.cond}
        onChange={(e) => onChange({ ...regla, cond: e.target.value as FilterCondition, value: undefined })}
        className="h-8 text-xs"
      >
        {condiciones.map((c) => (
          <option key={c} value={c}>
            {CONDITION_META[c]}
          </option>
        ))}
      </Select>

      <ValorEditor regla={regla} onChange={onChange} projects={projects} members={members} />

      <button
        type="button"
        onClick={() => {
          const siguiente = { ...regla };
          if (apagada) delete siguiente.off;
          else siguiente.off = true;
          onChange(siguiente);
        }}
        aria-pressed={!apagada}
        title={apagada ? 'Prender esta regla' : 'Apagar esta regla sin borrarla'}
        className={cn(
          'rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors',
          apagada ? 'border-border text-muted-foreground' : 'border-primary/50 bg-primary/10 text-primary',
        )}
      >
        {apagada ? 'apagada' : 'activa'}
      </button>
    </div>
  );
}

function ValorEditor({
  regla,
  onChange,
  projects,
  members,
}: {
  regla: FilterRule;
  onChange: (r: FilterRule) => void;
  projects: Project[];
  members: Member[];
}) {
  const set = (value: unknown): void => onChange({ ...regla, value });

  if (regla.cond === 'is_empty' || regla.cond === 'is_not_empty') return null;

  if (regla.cond === 'next_n_days') {
    return (
      <Input
        type="number"
        min={0}
        aria-label="Número de días"
        className="h-8 w-24 text-xs"
        value={typeof regla.value === 'number' ? regla.value : ''}
        onChange={(e) => set(e.target.value === '' ? undefined : Number(e.target.value))}
      />
    );
  }

  if (regla.prop === 'due_date' || regla.prop === 'start_date') {
    return (
      <Input
        type="date"
        aria-label="Fecha"
        className="h-8 w-40 text-xs"
        value={typeof regla.value === 'string' ? regla.value : ''}
        onChange={(e) => set(e.target.value || undefined)}
      />
    );
  }

  const opciones =
    regla.prop === 'status'
      ? TASK_STATUSES.map((s) => ({ value: s, label: STATUS_META[s].label }))
      : regla.prop === 'priority'
        ? TASK_PRIORITIES.map((p) => ({ value: p, label: PRIORITY_META[p].label }))
        : regla.prop === 'project_id'
          ? projects.map((p) => ({ value: p.id, label: p.name }))
          : regla.prop === 'assigned_to'
            ? members.map((m) => ({ value: m.email, label: m.name ?? m.email }))
            : null;

  if (regla.cond === 'is_any') {
    const puestos = Array.isArray(regla.value) ? (regla.value as string[]) : [];
    if (!opciones) {
      return (
        <Input
          aria-label="Valores separados por coma"
          className="h-8 w-48 text-xs"
          placeholder="uno, otro"
          value={puestos.join(', ')}
          onChange={(e) => set(e.target.value.split(',').map((v) => v.trim()).filter(Boolean))}
        />
      );
    }
    return (
      <div className="flex flex-wrap gap-1">
        {opciones.map((o) => {
          const activo = puestos.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={activo}
              onClick={() =>
                set(activo ? puestos.filter((v) => v !== o.value) : [...puestos, o.value])
              }
              className={cn(
                'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                activo
                  ? 'border-primary/50 bg-primary/15 text-primary'
                  : 'border-border text-muted-foreground hover:bg-secondary',
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    );
  }

  if (opciones) {
    return (
      <Select
        aria-label="Valor"
        className="h-8 text-xs"
        value={typeof regla.value === 'string' ? regla.value : ''}
        onChange={(e) => set(e.target.value || undefined)}
      >
        <option value="">Elige…</option>
        {opciones.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    );
  }

  return (
    <Input
      aria-label="Valor"
      className="h-8 w-48 text-xs"
      placeholder="Escribe…"
      value={typeof regla.value === 'string' ? regla.value : ''}
      onChange={(e) => set(e.target.value || undefined)}
    />
  );
}
