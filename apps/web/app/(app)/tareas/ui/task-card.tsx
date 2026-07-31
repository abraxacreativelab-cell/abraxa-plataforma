'use client';

import * as React from 'react';
import { Badge, Icon, cn } from '@abraxa/ui';
import {
  PRIORITY_META,
  STATUS_META,
  diasHasta,
  isOpen,
  subtaskSummary,
  vencimiento,
  type CardProp,
  type Member,
  type Project,
  type TaskWithSubtasks,
} from '@abraxa/work/domain';
import { Avatar, Menu, type MenuItem } from './primitives';

export interface AccionesTarjeta {
  abrir: (id: string) => void;
  completar: (id: string) => void;
  borrar: (id: string) => void;
}

/**
 * La tarjeta.
 *
 * ── Las dos decisiones que la hacen legible ────────────────────────────────
 *
 *  1. **Qué se ve lo decide la vista** (`props`). En el calendario cabe muy
 *     poco y en el tablero cabe todo; una tarjeta que enseña siempre lo mismo
 *     desperdicia espacio en un lado y miente por omisión en el otro.
 *
 *  2. **Un solo rojo.** El color fuerte se reserva para lo vencido. En GARDEN
 *     la prioridad, el estado y la fecha competían con tres colores saturados
 *     y el resultado era que ninguno significaba nada.
 */
export function TaskCard({
  task,
  props: visibles,
  projects,
  members,
  acciones,
  opcionesMover,
  arrastrable = true,
  compacta = false,
  now,
}: {
  task: TaskWithSubtasks;
  props: CardProp[];
  projects: Project[];
  members: Member[];
  acciones: AccionesTarjeta;
  /** Las columnas a las que se puede mandar, para quien no puede arrastrar. */
  opcionesMover: MenuItem[];
  arrastrable?: boolean;
  compacta?: boolean;
  now: Date;
}) {
  const ve = (p: CardProp): boolean => visibles.includes(p);
  const proyecto = task.project_id ? projects.find((p) => p.id === task.project_id) : null;
  const responsable = task.assigned_to ? members.find((m) => m.email === task.assigned_to) : null;
  const subtareas = subtaskSummary(task.subtasks);
  const vencida = task.due_date != null && isOpen(task.status) && diasHasta(task.due_date, now) < 0;

  const menu: MenuItem[] = [
    { label: 'Abrir', icon: 'arrow-right', onSelect: () => acciones.abrir(task.id) },
    ...opcionesMover,
    ...(task.status === 'completed'
      ? []
      : [{ label: 'Marcar como lista', icon: 'check', onSelect: () => acciones.completar(task.id) }]),
    { label: 'Borrar', icon: 'x', danger: true, onSelect: () => acciones.borrar(task.id) },
  ];

  return (
    <article
      draggable={arrastrable}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/abraxa-task', task.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      className={cn(
        'glass glass-hover group rounded-md border-l-2 p-2.5 text-left transition-shadow',
        arrastrable && 'cursor-grab active:cursor-grabbing',
        task.status === 'completed' && 'opacity-60',
        // El borde izquierdo es el único portador del color de prioridad: un
        // acento de dos píxeles se lee de un vistazo y no compite con nada.
        task.priority === 'critica' && 'border-l-[hsl(var(--color-error))]',
        task.priority === 'alta' && 'border-l-[hsl(var(--color-warning))]',
        task.priority === 'media' && 'border-l-border',
        task.priority === 'baja' && 'border-l-transparent',
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => acciones.abrir(task.id)}
          className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            className={cn(
              'block text-sm leading-snug',
              task.status === 'completed' && 'line-through decoration-muted-foreground',
              compacta && 'truncate text-xs',
            )}
          >
            {task.title}
          </span>
        </button>

        <div className="opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <Menu
            label={`Acciones de ${task.title}`}
            align="end"
            trigger={<Icon name="chevron-down" className="h-3.5 w-3.5" />}
            items={menu}
          />
        </div>
      </div>

      {(ve('status') || ve('priority') || ve('due') || ve('subtasks') || ve('project') || ve('assignee')) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          {ve('status') && (
            <Badge variant={STATUS_META[task.status].tone}>{STATUS_META[task.status].label}</Badge>
          )}

          {ve('priority') && task.priority !== 'media' && (
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {PRIORITY_META[task.priority].label}
            </span>
          )}

          {ve('due') && task.due_date && (
            <span
              className={cn(
                'inline-flex items-center gap-1 text-xs',
                vencida ? 'text-[hsl(var(--color-error-fg))]' : 'text-muted-foreground',
              )}
            >
              <Icon name="calendar" className="h-3 w-3" />
              {vencimiento(task.due_date, now)}
            </span>
          )}

          {ve('subtasks') && subtareas.total > 0 && (
            <span
              className="inline-flex items-center gap-1 text-xs text-muted-foreground"
              title={`${subtareas.done} de ${subtareas.total} subtareas listas`}
            >
              <Icon name="tasks" className="h-3 w-3" />
              {subtareas.done}/{subtareas.total}
            </span>
          )}

          {ve('project') && proyecto && (
            <span className="truncate text-xs text-muted-foreground" title={proyecto.name}>
              {proyecto.name}
            </span>
          )}

          {ve('assignee') && (
            <span className="ml-auto">
              <Avatar email={task.assigned_to} name={responsable?.name} className="h-5 w-5 text-[9px]" />
            </span>
          )}
        </div>
      )}

      {ve('tags') && task.tags.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {task.tags.map((t) => (
            <span key={t} className="rounded-sm bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {t}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}
