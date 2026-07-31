'use client';

import * as React from 'react';
import { Badge, Button, EmptyState, Icon, cn } from '@abraxa/ui';
import { progressOf, type CardProp, type Member, type Project, type TaskGroup, type TaskWithSubtasks } from '@abraxa/work/domain';
import { Progress } from './primitives';
import { TaskCard, type AccionesTarjeta } from './task-card';
import type { MenuItem } from './primitives';

export interface DestinoSoltado {
  taskId: string;
  groupKey: string;
  /** Posición dentro de la columna destino. */
  index: number;
}

/**
 * El tablero de columnas — lo comparten tres de las cuatro vistas.
 *
 * "Por proyecto", "por responsable" y "progreso" son EL MISMO componente con
 * otra agrupación. Eso es lo que hace que la jerarquía sea configurable sin
 * escribir código: cambiar `groupBy` en la vista "progreso" a "responsable" da
 * exactamente la vista "por responsable", y nadie tuvo que mantener dos
 * tableros que se fueran separando con el tiempo.
 *
 * ── Arrastrar no puede ser la única manera ─────────────────────────────────
 *
 * `draggable` de HTML5 no existe con el dedo. Toda acción que se puede hacer
 * arrastrando está también en el menú de cada tarjeta (`opcionesMover`). Un
 * tablero que sólo se opera con ratón es un tablero que la mitad de la gente no
 * puede usar — y este producto se usa desde el teléfono.
 */
export function Board({
  grupos,
  props: visibles,
  projects,
  members,
  acciones,
  opcionesMoverPara,
  onSoltar,
  onAgregar,
  now,
  ocupado,
}: {
  grupos: Array<TaskGroup<TaskWithSubtasks>>;
  props: CardProp[];
  projects: Project[];
  members: Member[];
  acciones: AccionesTarjeta;
  opcionesMoverPara: (task: TaskWithSubtasks) => MenuItem[];
  onSoltar: (destino: DestinoSoltado) => void;
  onAgregar: (groupKey: string) => void;
  now: Date;
  ocupado: boolean;
}) {
  const [destino, setDestino] = React.useState<{ key: string; index: number } | null>(null);

  const leerId = (e: React.DragEvent): string | null => e.dataTransfer.getData('text/abraxa-task') || null;

  const soltarEn = (e: React.DragEvent, groupKey: string, indexPorDefecto: number): void => {
    e.preventDefault();
    const taskId = leerId(e);
    const index = destino?.key === groupKey ? destino.index : indexPorDefecto;
    setDestino(null);
    if (taskId) onSoltar({ taskId, groupKey, index });
  };

  if (grupos.length === 0) {
    return (
      <EmptyState
        title="Nada que mostrar con estos filtros"
        description="Apaga alguno de los filtros de arriba para volver a ver tus tareas."
        icon="tasks"
      />
    );
  }

  return (
    <div
      className="scrollbar-thin flex gap-3 overflow-x-auto pb-4"
      aria-busy={ocupado}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDestino(null);
      }}
    >
      {grupos.map((grupo) => {
        const avance = progressOf(grupo.tasks);
        const activa = destino?.key === grupo.key;

        return (
          <section
            key={grupo.key}
            aria-label={grupo.label}
            className={cn(
              'flex w-72 shrink-0 flex-col rounded-lg border border-transparent p-1 transition-colors',
              activa && grupo.droppable && 'border-primary/40 bg-primary/5',
            )}
            onDragOver={(e) => {
              if (!grupo.droppable) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (destino?.key !== grupo.key) setDestino({ key: grupo.key, index: grupo.tasks.length });
            }}
            onDrop={(e) => grupo.droppable && soltarEn(e, grupo.key, grupo.tasks.length)}
          >
            <header className="flex items-center gap-2 px-1.5 py-2">
              <Badge variant={grupo.tone}>{grupo.label}</Badge>
              <span className="tabular text-xs text-muted-foreground">{grupo.tasks.length}</span>
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => onAgregar(grupo.key)}
                aria-label={`Nueva tarea en ${grupo.label}`}
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Icon name="plus" className="h-3.5 w-3.5" />
              </button>
            </header>

            {avance.total > 0 && (
              <div className="px-1.5 pb-2">
                <Progress value={avance.pct} label={`Avance de ${grupo.label}`} />
              </div>
            )}

            <div className="scrollbar-thin flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-1.5 pb-2">
              {grupo.tasks.map((task, i) => (
                <div
                  key={task.id}
                  onDragOver={(e) => {
                    if (!grupo.droppable) return;
                    e.preventDefault();
                    e.stopPropagation();
                    // Antes o después según en qué mitad de la tarjeta esté el
                    // cursor: soltar "a la altura de" algo tiene que significar
                    // lo mismo que en cualquier otra lista.
                    const caja = e.currentTarget.getBoundingClientRect();
                    const antes = e.clientY < caja.top + caja.height / 2;
                    const index = antes ? i : i + 1;
                    if (destino?.key !== grupo.key || destino.index !== index) {
                      setDestino({ key: grupo.key, index });
                    }
                  }}
                  onDrop={(e) => {
                    if (!grupo.droppable) return;
                    e.stopPropagation();
                    soltarEn(e, grupo.key, i);
                  }}
                  className={cn(
                    'rounded-md',
                    activa && destino?.index === i && 'border-t-2 border-primary/60 pt-1',
                  )}
                >
                  <TaskCard
                    task={task}
                    props={visibles}
                    projects={projects}
                    members={members}
                    acciones={acciones}
                    opcionesMover={opcionesMoverPara(task)}
                    now={now}
                  />
                </div>
              ))}

              {grupo.tasks.length === 0 && (
                <button
                  type="button"
                  onClick={() => onAgregar(grupo.key)}
                  className="rounded-md border border-dashed border-border py-6 text-center text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                >
                  {grupo.droppable ? 'Arrastra algo aquí o crea una tarea' : 'Nada aquí'}
                </button>
              )}
            </div>
          </section>
        );
      })}

      <div className="w-1 shrink-0" />
    </div>
  );
}

/** El botón de "nueva tarea" cuando el tablero entero está vacío. */
export function TableroVacio({ onCrear }: { onCrear: () => void }) {
  return (
    <EmptyState
      title="Aún no tienes tareas"
      description="Empieza por lo que tengas que hacer hoy. Los proyectos y los responsables se pueden poner después."
      icon="tasks"
    >
      <Button onClick={onCrear}>
        <Icon name="plus" className="h-4 w-4" />
        Crear la primera
      </Button>
    </EmptyState>
  );
}
