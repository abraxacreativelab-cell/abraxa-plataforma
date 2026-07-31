'use client';

import * as React from 'react';
import { Badge, Button, Icon, cn } from '@abraxa/ui';
import {
  DIAS,
  PRIORITY_META,
  buildMonth,
  overdue,
  shiftMonth,
  type Member,
  type Task,
  type TaskWithSubtasks,
} from '@abraxa/work/domain';
import { Avatar } from './primitives';

/**
 * El calendario — "¿qué se vence esta semana?".
 *
 * ── Tres cosas que el de GARDEN no hacía ───────────────────────────────────
 *
 *  1. **Las vencidas se ven.** Antes quedaban en un mes que ya nadie visita, y
 *     lo vencido es justamente lo que hay que mirar. Aquí van arriba, siempre,
 *     independientemente del mes que se esté viendo.
 *
 *  2. **Las que no tienen fecha se ven.** Son las que se olvidan. Están en una
 *     franja aparte, y arrastrarlas a un día les pone la fecha.
 *
 *  3. **Arrastrar cambia la fecha.** Es el gesto obvio en un calendario y no
 *     estaba; había que abrir la tarea y editar un campo.
 */
export function Calendar({
  tasks,
  members,
  onAbrir,
  onFechar,
  onCrearEn,
  now,
}: {
  tasks: TaskWithSubtasks[];
  members: Member[];
  onAbrir: (id: string) => void;
  onFechar: (id: string, due: string | null) => void;
  onCrearEn: (due: string) => void;
  now: Date;
}) {
  const [ancla, setAncla] = React.useState(() => ({ year: now.getFullYear(), month: now.getMonth() + 1 }));
  const [sobre, setSobre] = React.useState<string | null>(null);

  const mes = React.useMemo(
    () => buildMonth(ancla.year, ancla.month, tasks, now),
    [ancla.year, ancla.month, tasks, now],
  );
  const vencidas = React.useMemo(() => overdue(tasks, now), [tasks, now]);

  const soltar = (e: React.DragEvent, fecha: string | null): void => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/abraxa-task');
    setSobre(null);
    if (id) onFechar(id, fecha);
  };

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Mes anterior"
          onClick={() => setAncla((a) => shiftMonth(a.year, a.month, -1))}
        >
          <Icon name="chevron-right" className="h-4 w-4 rotate-180" />
        </Button>

        <h2 className="min-w-40 text-sm font-medium capitalize">{mes.label}</h2>

        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Mes siguiente"
          onClick={() => setAncla((a) => shiftMonth(a.year, a.month, 1))}
        >
          <Icon name="chevron-right" className="h-4 w-4" />
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setAncla({ year: now.getFullYear(), month: now.getMonth() + 1 })}
        >
          Hoy
        </Button>
      </header>

      {vencidas.length > 0 && (
        <section
          aria-label="Tareas vencidas"
          className="rounded-md border border-[hsl(var(--color-error-border))] bg-[hsl(var(--color-error-bg))] p-2.5"
        >
          <p className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[hsl(var(--color-error-fg))]">
            <Icon name="warning" className="h-3.5 w-3.5" />
            {vencidas.length === 1 ? '1 tarea vencida' : `${vencidas.length} tareas vencidas`}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {vencidas.map((t) => (
              <PastillaTarea key={t.id} task={t} members={members} onAbrir={onAbrir} />
            ))}
          </div>
        </section>
      )}

      <div className="overflow-x-auto">
        <div className="min-w-[42rem]">
          <div className="grid grid-cols-7 gap-px">
            {DIAS.map((d) => (
              <div
                key={d}
                className="px-2 py-1 text-center font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
              >
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-border bg-border">
            {mes.weeks.flat().map((dia) => (
              <div
                key={dia.date}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (sobre !== dia.date) setSobre(dia.date);
                }}
                onDrop={(e) => soltar(e, dia.date)}
                className={cn(
                  'group/dia flex min-h-24 flex-col gap-1 bg-background p-1.5 transition-colors',
                  !dia.inMonth && 'bg-background/40',
                  sobre === dia.date && 'bg-primary/10',
                )}
              >
                <div className="flex items-center gap-1">
                  <span
                    className={cn(
                      'tabular grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px]',
                      dia.isToday && 'bg-primary text-primary-foreground',
                      !dia.isToday && dia.inMonth && 'text-foreground/80',
                      !dia.inMonth && 'text-muted-foreground/50',
                    )}
                  >
                    {dia.dayOfMonth}
                  </span>
                  {dia.isOverdue && (
                    <span
                      aria-label="Con tareas vencidas"
                      className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--color-error))]"
                    />
                  )}
                  <span className="flex-1" />
                  <button
                    type="button"
                    onClick={() => onCrearEn(dia.date)}
                    aria-label={`Nueva tarea para el ${dia.date}`}
                    className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover/dia:opacity-100"
                  >
                    <Icon name="plus" className="h-3 w-3" />
                  </button>
                </div>

                {dia.tasks.map((t) => (
                  <PastillaTarea
                    key={t.id}
                    task={t}
                    members={members}
                    onAbrir={onAbrir}
                    arrastrable
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      <section
        aria-label="Tareas sin fecha"
        onDragOver={(e) => {
          e.preventDefault();
          if (sobre !== 'sin-fecha') setSobre('sin-fecha');
        }}
        onDrop={(e) => soltar(e, null)}
        className={cn(
          'rounded-md border border-dashed border-border p-2.5 transition-colors',
          sobre === 'sin-fecha' && 'border-primary/40 bg-primary/5',
        )}
      >
        <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Sin fecha · {mes.undated.length}
        </p>
        {mes.undated.length === 0 ? (
          <p className="text-xs text-muted-foreground/70">
            Todo lo abierto tiene fecha. Arrastra algo aquí para quitársela.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {mes.undated.map((t) => (
              <PastillaTarea key={t.id} task={t} members={members} onAbrir={onAbrir} arrastrable />
            ))}
          </div>
        )}
      </section>

      <p className="text-xs text-muted-foreground/70">
        Arrastra una tarea a un día para cambiarle la fecha, o a &laquo;sin fecha&raquo; para quitársela.
        {' '}Desde el teléfono, ábrela y cambia la fecha ahí.
      </p>
    </div>
  );
}

function PastillaTarea({
  task,
  members,
  onAbrir,
  arrastrable = false,
}: {
  task: Task;
  members: Member[];
  onAbrir: (id: string) => void;
  arrastrable?: boolean;
}) {
  const responsable = task.assigned_to ? members.find((m) => m.email === task.assigned_to) : null;

  return (
    <button
      type="button"
      draggable={arrastrable}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/abraxa-task', task.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={() => onAbrir(task.id)}
      title={task.title}
      className={cn(
        'flex w-full items-center gap-1 rounded border-l-2 bg-secondary/60 px-1.5 py-0.5 text-left text-[11px] transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        task.status === 'completed' && 'opacity-60 line-through',
        task.priority === 'critica' && 'border-l-[hsl(var(--color-error))]',
        task.priority === 'alta' && 'border-l-[hsl(var(--color-warning))]',
        task.priority === 'media' && 'border-l-border',
        task.priority === 'baja' && 'border-l-transparent',
      )}
    >
      <span className="min-w-0 flex-1 truncate">{task.title}</span>
      {task.assigned_to && <Avatar email={task.assigned_to} name={responsable?.name} className="h-4 w-4 text-[8px]" />}
    </button>
  );
}

/** La leyenda de prioridades. Un color sin leyenda es un color que hay que
 *  adivinar. */
export function LeyendaPrioridad() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {(['critica', 'alta', 'media', 'baja'] as const).map((p) => (
        <Badge key={p} variant={PRIORITY_META[p].tone}>
          {PRIORITY_META[p].label}
        </Badge>
      ))}
    </div>
  );
}
