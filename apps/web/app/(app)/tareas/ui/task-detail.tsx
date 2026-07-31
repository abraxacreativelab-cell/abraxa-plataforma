'use client';

import * as React from 'react';
import { Badge, Button, Input, Select, SkeletonText, Textarea, cn } from '@abraxa/ui';
import {
  PRIORITY_META,
  STATUS_META,
  TASK_PRIORITIES,
  TASK_STATUSES,
  desde,
  isOpen,
  nombreCorto,
  progressOf,
  subtaskSummary,
  suggestedParentStatus,
  vencimiento,
  type Member,
  type Project,
  type Task,
} from '@abraxa/work/domain';
import type { DetalleTarea, Fallo } from '../action-types';
import { Avatar, Aviso, Field, Modal, Progress } from './primitives';

export interface DetalleProps {
  taskId: string;
  members: Member[];
  projects: Project[];
  now: Date;
  cargar: (id: string) => Promise<DetalleTarea | Fallo>;
  /** Devuelve la tarea ya guardada, o el fallo. El 409 se propaga hacia arriba
   *  con `onConflicto` para que el modal viva en un solo lugar. */
  guardar: (id: string, patch: Record<string, unknown>) => Promise<Task | Fallo>;
  crearSubtarea: (parentId: string, title: string) => Promise<Task | Fallo>;
  comentar: (id: string, body: string) => Promise<boolean>;
  borrar: (id: string) => Promise<boolean>;
  onConflicto: (taskId: string, abiertas: Task[]) => void;
  onClose: () => void;
}

/**
 * El panel de detalle — subtareas, comentarios e historial.
 *
 * Portado de `task-detail.tsx` de GARDEN (423 líneas), con dos cambios:
 *
 *  · **Comentarios e historial separados.** Allá los dos salían de
 *    `task_updates` filtrando por `update_type`, y se mezclaban en una sola
 *    lista donde un cambio de estado interrumpía una conversación.
 *  · **Se edita en el sitio.** Sin modo edición ni botón de guardar: cada campo
 *    guarda al cambiar. Un formulario con "Guardar" abajo es una invitación a
 *    perder los cambios al cerrar por error.
 */
export function TaskDetail(props: DetalleProps) {
  const { taskId, members, projects, now, cargar, onClose } = props;

  const [detalle, setDetalle] = React.useState<DetalleTarea | null>(null);
  const [fallo, setFallo] = React.useState<Fallo | null>(null);
  const [guardando, setGuardando] = React.useState(false);

  const recargar = React.useCallback(async () => {
    const r = await cargar(taskId);
    if ('ok' in r && r.ok === false) setFallo(r);
    else setDetalle(r as DetalleTarea);
  }, [cargar, taskId]);

  React.useEffect(() => {
    setDetalle(null);
    setFallo(null);
    void recargar();
  }, [recargar]);

  const aplicar = async (patch: Record<string, unknown>): Promise<void> => {
    setGuardando(true);
    setFallo(null);
    const r = await props.guardar(taskId, patch);
    setGuardando(false);

    if ('ok' in r && r.ok === false) {
      if (r.code === 'CONFLICT' && r.openSubtasks) props.onConflicto(taskId, r.openSubtasks);
      else setFallo(r);
      return;
    }
    await recargar();
  };

  return (
    <Modal
      open
      onClose={onClose}
      variant="lateral"
      title={detalle?.task.title ?? 'Tarea'}
      description={detalle ? `Actualizada ${desde(detalle.task.updated_at, now)}` : undefined}
      footer={
        detalle && (
          <>
            <Button
              variant="destructive"
              size="sm"
              onClick={async () => {
                if (!window.confirm('¿Borrar esta tarea y sus subtareas?')) return;
                if (await props.borrar(taskId)) onClose();
              }}
            >
              Borrar
            </Button>
            <span className="flex-1" />
            <Button variant="outline" size="sm" onClick={onClose}>
              Cerrar
            </Button>
          </>
        )
      }
    >
      {!detalle && !fallo && <SkeletonText lines={8} />}
      {fallo && (
        <Aviso tone="error" onDismiss={() => setFallo(null)}>
          {fallo.message}
        </Aviso>
      )}

      {detalle && (
        <div className={cn('space-y-5', guardando && 'opacity-70')} aria-busy={guardando}>
          <Cabecera detalle={detalle} onAplicar={aplicar} />
          <Propiedades
            detalle={detalle}
            members={members}
            projects={projects}
            now={now}
            onAplicar={aplicar}
          />
          <Subtareas
            detalle={detalle}
            now={now}
            onCrear={async (title) => {
              const r = await props.crearSubtarea(taskId, title);
              if ('ok' in r && r.ok === false) setFallo(r);
              else await recargar();
            }}
            onCambiar={async (id, patch) => {
              const r = await props.guardar(id, patch);
              if ('ok' in r && r.ok === false) setFallo(r);
              else await recargar();
            }}
          />
          <Comentarios
            detalle={detalle}
            members={members}
            now={now}
            onComentar={async (body) => {
              if (await props.comentar(taskId, body)) await recargar();
            }}
          />
          <Historial detalle={detalle} members={members} projects={projects} now={now} />
        </div>
      )}
    </Modal>
  );
}

// ── Título y descripción ────────────────────────────────────────────────────

function Cabecera({
  detalle,
  onAplicar,
}: {
  detalle: DetalleTarea;
  onAplicar: (patch: Record<string, unknown>) => Promise<void>;
}) {
  const [titulo, setTitulo] = React.useState(detalle.task.title);
  const [descripcion, setDescripcion] = React.useState(detalle.task.description ?? '');

  React.useEffect(() => {
    setTitulo(detalle.task.title);
    setDescripcion(detalle.task.description ?? '');
  }, [detalle.task.id, detalle.task.title, detalle.task.description]);

  return (
    <div className="space-y-3">
      <Field label="Título">
        <Input
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          // Se guarda al salir del campo y con Enter. Guardar en cada tecla
          // sería una escritura por letra.
          onBlur={() => {
            const limpio = titulo.trim();
            if (limpio && limpio !== detalle.task.title) void onAplicar({ title: limpio });
            else setTitulo(detalle.task.title);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setTitulo(detalle.task.title);
          }}
        />
      </Field>

      <Field label="Descripción">
        <Textarea
          rows={4}
          placeholder="Lo que haga falta recordar sobre esta tarea."
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          onBlur={() => {
            const valor = descripcion.trim() || null;
            if (valor !== (detalle.task.description ?? null)) void onAplicar({ description: valor });
          }}
        />
      </Field>
    </div>
  );
}

// ── Propiedades ─────────────────────────────────────────────────────────────

function Propiedades({
  detalle,
  members,
  projects,
  now,
  onAplicar,
}: {
  detalle: DetalleTarea;
  members: Member[];
  projects: Project[];
  now: Date;
  onAplicar: (patch: Record<string, unknown>) => Promise<void>;
}) {
  const t = detalle.task;
  const esSubtarea = t.parent_id != null;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Estado">
        <Select value={t.status} onChange={(e) => void onAplicar({ status: e.target.value })}>
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_META[s].label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Prioridad">
        <Select value={t.priority} onChange={(e) => void onAplicar({ priority: e.target.value })}>
          {TASK_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_META[p].label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Responsable">
        <Select
          value={t.assigned_to ?? ''}
          onChange={(e) => void onAplicar({ assigned_to: e.target.value || null })}
        >
          <option value="">Sin responsable</option>
          {members.map((m) => (
            <option key={m.email} value={m.email}>
              {nombreCorto(m.email, m.name)}
            </option>
          ))}
          {/* Un responsable que ya no es miembro no puede desaparecer del
              selector: si lo hiciera, abrir la tarea le borraría el dato. */}
          {t.assigned_to && !members.some((m) => m.email === t.assigned_to) && (
            <option value={t.assigned_to}>{t.assigned_to} (ya no es del equipo)</option>
          )}
        </Select>
      </Field>

      <Field label="Se vence" hint={t.due_date ? vencimiento(t.due_date, now) : undefined}>
        <Input
          type="date"
          value={t.due_date ?? ''}
          onChange={(e) => void onAplicar({ due_date: e.target.value || null })}
        />
      </Field>

      <Field
        label="Proyecto"
        hint={esSubtarea ? 'Una subtarea vive en el proyecto de su tarea padre.' : undefined}
      >
        <Select
          disabled={esSubtarea}
          value={t.project_id ?? ''}
          onChange={(e) => void onAplicar({ project_id: e.target.value || null })}
        >
          <option value="">Sin proyecto</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Estimación (horas)">
        <Input
          type="number"
          min={0}
          step="0.5"
          value={t.estimate_hours ?? ''}
          onChange={(e) =>
            void onAplicar({ estimate_hours: e.target.value === '' ? null : Number(e.target.value) })
          }
        />
      </Field>
    </div>
  );
}

// ── Subtareas ───────────────────────────────────────────────────────────────

function Subtareas({
  detalle,
  now,
  onCrear,
  onCambiar,
}: {
  detalle: DetalleTarea;
  now: Date;
  onCrear: (title: string) => Promise<void>;
  onCambiar: (id: string, patch: Record<string, unknown>) => Promise<void>;
}) {
  const [nueva, setNueva] = React.useState('');
  const resumen = subtaskSummary(detalle.subtasks);
  const avance = progressOf(detalle.subtasks);
  const sugerido = suggestedParentStatus(detalle.subtasks);

  // Una subtarea no puede tener subtareas: lo impone el trigger de la 070 y la
  // pantalla no debe ofrecer lo que la base va a rechazar.
  if (detalle.task.parent_id) {
    return (
      <section className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
        Ésta es una subtarea. La jerarquía es de un solo nivel: proyecto → tarea → subtarea.
      </section>
    );
  }

  return (
    <section className="space-y-2">
      <header className="flex items-center gap-2">
        <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Subtareas</h3>
        {resumen.total > 0 && (
          <span className="tabular text-xs text-muted-foreground">
            {resumen.done}/{resumen.total}
          </span>
        )}
      </header>

      {resumen.total > 0 && <Progress value={avance.pct} label="Avance de las subtareas" />}

      <ul className="space-y-1">
        {detalle.subtasks.map((s) => (
          <li key={s.id} className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5">
            <input
              type="checkbox"
              checked={s.status === 'completed'}
              aria-label={`Marcar "${s.title}" como lista`}
              onChange={(e) => void onCambiar(s.id, { status: e.target.checked ? 'completed' : 'pending' })}
              className="h-3.5 w-3.5 accent-[hsl(var(--primary))]"
            />
            <span className={cn('min-w-0 flex-1 truncate text-sm', s.status === 'completed' && 'line-through opacity-60')}>
              {s.title}
            </span>
            {s.due_date && (
              <span className="shrink-0 text-xs text-muted-foreground">{vencimiento(s.due_date, now)}</span>
            )}
            <Badge variant={STATUS_META[s.status].tone}>{STATUS_META[s.status].label}</Badge>
          </li>
        ))}
      </ul>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const limpio = nueva.trim();
          if (!limpio) return;
          setNueva('');
          void onCrear(limpio);
        }}
        className="flex gap-2"
      >
        <Input
          value={nueva}
          onChange={(e) => setNueva(e.target.value)}
          placeholder="Añadir una subtarea…"
          aria-label="Nueva subtarea"
        />
        <Button type="submit" variant="outline" size="sm" disabled={!nueva.trim()}>
          Añadir
        </Button>
      </form>

      {sugerido && sugerido !== detalle.task.status && (
        <Aviso tone="info">
          {sugerido === 'completed'
            ? 'Ya no falta ninguna subtarea. '
            : 'Ya hay subtareas en marcha. '}
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={() => void onCambiar(detalle.task.id, { status: sugerido })}
          >
            Marcar la tarea como {STATUS_META[sugerido].label.toLowerCase()}
          </button>
          {/* Se ofrece, no se aplica sola: cambiarle el estado al padre por
              debajo cada vez que alguien toca una subtarea hace que el tablero
              se sienta embrujado. */}
        </Aviso>
      )}
    </section>
  );
}

// ── Comentarios ─────────────────────────────────────────────────────────────

function Comentarios({
  detalle,
  members,
  now,
  onComentar,
}: {
  detalle: DetalleTarea;
  members: Member[];
  now: Date;
  onComentar: (body: string) => Promise<void>;
}) {
  const [texto, setTexto] = React.useState('');

  return (
    <section className="space-y-2">
      <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Comentarios</h3>

      {detalle.comments.length === 0 && (
        <p className="text-xs text-muted-foreground/70">Todavía no hay comentarios.</p>
      )}

      <ul className="space-y-2">
        {detalle.comments.map((c) => {
          const quien = members.find((m) => m.email === c.author);
          return (
            <li key={c.id} className="flex gap-2">
              <Avatar email={c.author} name={quien?.name} />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">
                  {nombreCorto(c.author, quien?.name)} · {desde(c.created_at, now)}
                </p>
                <p className="whitespace-pre-wrap break-words text-sm">{c.body}</p>
              </div>
            </li>
          );
        })}
      </ul>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const limpio = texto.trim();
          if (!limpio) return;
          setTexto('');
          void onComentar(limpio);
        }}
        className="space-y-2"
      >
        <Textarea
          rows={2}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Escribe un comentario…"
          aria-label="Nuevo comentario"
        />
        <div className="flex justify-end">
          <Button type="submit" variant="outline" size="sm" disabled={!texto.trim()}>
            Comentar
          </Button>
        </div>
      </form>
    </section>
  );
}

// ── Historial ───────────────────────────────────────────────────────────────

const ETIQUETA_CAMPO: Record<string, string> = {
  created: 'creó la tarea',
  status: 'cambió el estado',
  assigned_to: 'cambió el responsable',
  due_date: 'cambió la fecha',
  priority: 'cambió la prioridad',
  project_id: 'cambió el proyecto',
};

function Historial({
  detalle,
  members,
  projects,
  now,
}: {
  detalle: DetalleTarea;
  members: Member[];
  projects: Project[];
  now: Date;
}) {
  /** Un id de proyecto o un correo no dicen nada en una bitácora. */
  const legible = (campo: string, valor: string | null): string => {
    if (valor == null) return '—';
    if (campo === 'status') return STATUS_META[valor as Task['status']]?.label ?? valor;
    if (campo === 'priority') return PRIORITY_META[valor as Task['priority']]?.label ?? valor;
    if (campo === 'project_id') return projects.find((p) => p.id === valor)?.name ?? 'otro proyecto';
    if (campo === 'assigned_to') {
      return nombreCorto(valor, members.find((m) => m.email === valor)?.name);
    }
    return valor;
  };

  if (detalle.events.length === 0) return null;

  return (
    <section className="space-y-2">
      <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Historial</h3>
      <ol className="space-y-1 border-l border-border pl-3">
        {[...detalle.events].reverse().map((e) => (
          <li key={e.id} className="text-xs text-muted-foreground">
            <span className="text-foreground/80">
              {nombreCorto(e.actor, members.find((m) => m.email === e.actor)?.name)}
            </span>{' '}
            {ETIQUETA_CAMPO[e.field] ?? `cambió ${e.field}`}
            {e.field !== 'created' && (
              <>
                {': '}
                <span className="text-foreground/60">{legible(e.field, e.from_value)}</span>
                {' → '}
                <span className="text-foreground/80">{legible(e.field, e.to_value)}</span>
              </>
            )}{' '}
            · {desde(e.created_at, now)}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Cuántas subtareas siguen abiertas — lo usa el modal del 409. */
export function contarAbiertas(subtasks: readonly Task[]): number {
  return subtasks.filter((s) => isOpen(s.status)).length;
}
