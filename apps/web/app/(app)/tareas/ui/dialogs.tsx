'use client';

import * as React from 'react';
import { Badge, Button, Icon, Input, Select, Textarea, cn } from '@abraxa/ui';
import {
  PRIORITY_META,
  PROJECT_STATUS_META,
  PROJECT_STATUSES,
  STATUS_META,
  TASK_PRIORITIES,
  VIEW_META,
  nombreCorto,
  plural,
  type Member,
  type Project,
  type ProjectStatus,
  type SavedView,
  type Task,
  type ViewKind,
} from '@abraxa/work/domain';
import { Aviso, Field, Modal } from './primitives';

// ════════════════════════════════════════════════════════════════════════════
// El modal del 409 — criterio observable 3
// ════════════════════════════════════════════════════════════════════════════

/**
 * *"Completar una tarea con subtareas abiertas devuelve 409 y ofrece cerrarlas
 * todas."* — handoff §6.3.
 *
 * Lo importante es que ofrezca la SALIDA. Un 409 que sólo dice "no se puede"
 * deja al usuario cerrando subtareas a mano una por una, y al tercer intento
 * deja de creerle al guard.
 *
 * Y cerrarlas es UNA transacción (`app.complete_task_cascade`), no N llamadas:
 * si la tercera fallara, el árbol quedaría a medias — que es exactamente el
 * estado del que el guard protegía.
 */
export function SubtareasAbiertasDialog({
  abiertas,
  onCompletarTodas,
  onAbrir,
  onClose,
  trabajando,
}: {
  abiertas: Task[];
  onCompletarTodas: () => void;
  onAbrir: (id: string) => void;
  onClose: () => void;
  trabajando: boolean;
}) {
  return (
    <Modal
      open
      onClose={onClose}
      title="Hay subtareas abiertas"
      description={`No se puede dar por lista una tarea con ${plural(
        abiertas.length,
        'subtarea abierta',
        'subtareas abiertas',
      )} debajo.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={trabajando}>
            Cancelar
          </Button>
          <Button onClick={onCompletarTodas} disabled={trabajando}>
            {trabajando ? 'Cerrando…' : 'Completar todas'}
          </Button>
        </>
      }
    >
      <ul className="space-y-1">
        {abiertas.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onAbrir(s.id)}
              className="flex w-full items-center gap-2 rounded-md border border-border px-2 py-1.5 text-left transition-colors hover:bg-secondary"
            >
              <span className="min-w-0 flex-1 truncate text-sm">{s.title}</span>
              <Badge variant={STATUS_META[s.status].tone}>{STATUS_META[s.status].label}</Badge>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">
        &laquo;Completar todas&raquo; cierra estas subtareas y la tarea padre en una sola operación: o
        queda todo cerrado, o no se cierra nada.
      </p>
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Nueva tarea
// ════════════════════════════════════════════════════════════════════════════

/**
 * Alias de tipo y no `interface`: una interfaz no tiene índice implícito, así
 * que no es asignable a `Record<string, unknown>` — que es justo lo que pide
 * `WorkApi.crearTarea`. Un alias de objeto sí lo es.
 */
export type BorradorTarea = {
  title: string;
  status?: string;
  priority?: string;
  assigned_to?: string | null;
  due_date?: string | null;
  project_id?: string | null;
  description?: string | null;
};

export function NuevaTareaDialog({
  inicial,
  members,
  projects,
  onCrear,
  onClose,
  trabajando,
  error,
}: {
  /** Lo que ya se sabe por dónde se pidió: la columna del tablero o el día del
   *  calendario. Crear desde "En progreso" y tener que elegir el estado otra
   *  vez es pedir dos veces lo mismo. */
  inicial: Partial<BorradorTarea>;
  members: Member[];
  projects: Project[];
  onCrear: (borrador: BorradorTarea) => void;
  onClose: () => void;
  trabajando: boolean;
  error: string | null;
}) {
  const [borrador, setBorrador] = React.useState<BorradorTarea>({
    title: '',
    status: 'pending',
    priority: 'media',
    assigned_to: null,
    due_date: null,
    project_id: null,
    description: null,
    ...inicial,
  });

  const set = <K extends keyof BorradorTarea>(k: K, v: BorradorTarea[K]): void =>
    setBorrador((b) => ({ ...b, [k]: v }));

  const puede = borrador.title.trim().length > 0;

  return (
    <Modal
      open
      onClose={onClose}
      title="Nueva tarea"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={trabajando}>
            Cancelar
          </Button>
          <Button
            onClick={() => onCrear({ ...borrador, title: borrador.title.trim() })}
            disabled={!puede || trabajando}
          >
            {trabajando ? 'Creando…' : 'Crear'}
          </Button>
        </>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (puede && !trabajando) onCrear({ ...borrador, title: borrador.title.trim() });
        }}
      >
        {error && <Aviso tone="error">{error}</Aviso>}

        <Field label="¿Qué hay que hacer?">
          <Input
            autoFocus
            value={borrador.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="Llamar al proveedor de harina"
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Estado">
            <Select value={borrador.status} onChange={(e) => set('status', e.target.value)}>
              {(['pending', 'in_progress', 'blocked'] as const).map((s) => (
                <option key={s} value={s}>
                  {STATUS_META[s].label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Prioridad">
            <Select value={borrador.priority} onChange={(e) => set('priority', e.target.value)}>
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_META[p].label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Responsable">
            <Select
              value={borrador.assigned_to ?? ''}
              onChange={(e) => set('assigned_to', e.target.value || null)}
            >
              <option value="">Sin responsable</option>
              {members.map((m) => (
                <option key={m.email} value={m.email}>
                  {nombreCorto(m.email, m.name)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Se vence">
            <Input
              type="date"
              value={borrador.due_date ?? ''}
              onChange={(e) => set('due_date', e.target.value || null)}
            />
          </Field>
        </div>

        <Field label="Proyecto">
          <Select
            value={borrador.project_id ?? ''}
            onChange={(e) => set('project_id', e.target.value || null)}
          >
            <option value="">Sin proyecto</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Detalle" hint="Opcional.">
          <Textarea
            rows={3}
            value={borrador.description ?? ''}
            onChange={(e) => set('description', e.target.value || null)}
          />
        </Field>

        <button type="submit" className="sr-only">
          Crear
        </button>
      </form>
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Guardar la vista
// ════════════════════════════════════════════════════════════════════════════

export function GuardarVistaDialog({
  kind,
  onGuardar,
  onClose,
  trabajando,
  error,
}: {
  kind: ViewKind;
  onGuardar: (nombre: string, compartida: boolean) => void;
  onClose: () => void;
  trabajando: boolean;
  error: string | null;
}) {
  const [nombre, setNombre] = React.useState('');
  const [compartida, setCompartida] = React.useState(false);

  return (
    <Modal
      open
      onClose={onClose}
      title="Guardar esta vista"
      description={`Se guarda como vista de tipo "${VIEW_META[kind].label}" con los filtros que tienes puestos.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={trabajando}>
            Cancelar
          </Button>
          <Button onClick={() => onGuardar(nombre.trim(), compartida)} disabled={!nombre.trim() || trabajando}>
            {trabajando ? 'Guardando…' : 'Guardar'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <Aviso tone="error">{error}</Aviso>}

        <Field label="Nombre">
          <Input
            autoFocus
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Lo que se vence esta semana"
          />
        </Field>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={compartida}
            onChange={(e) => setCompartida(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 accent-[hsl(var(--primary))]"
          />
          <span>
            Compartirla con el equipo
            <span className="block text-xs text-muted-foreground">
              La ven todos, pero sólo tú puedes cambiarla o borrarla.
            </span>
          </span>
        </label>
      </div>
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Proyectos
// ════════════════════════════════════════════════════════════════════════════

export function ProyectosDialog({
  projects,
  conteoPorProyecto,
  onCrear,
  onActualizar,
  onBorrar,
  onClose,
  trabajando,
  error,
}: {
  projects: Project[];
  conteoPorProyecto: Map<string, number>;
  onCrear: (name: string) => void;
  onActualizar: (id: string, patch: { name?: string; status?: ProjectStatus }) => void;
  onBorrar: (id: string) => void;
  onClose: () => void;
  trabajando: boolean;
  error: string | null;
}) {
  const [nuevo, setNuevo] = React.useState('');

  return (
    <Modal
      open
      onClose={onClose}
      title="Proyectos"
      description="Un proyecto agrupa tareas. Borrarlo NO borra su trabajo: las tareas quedan sueltas."
      footer={
        <Button variant="outline" onClick={onClose}>
          Cerrar
        </Button>
      }
    >
      <div className="space-y-3">
        {error && <Aviso tone="error">{error}</Aviso>}

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const limpio = nuevo.trim();
            if (!limpio) return;
            setNuevo('');
            onCrear(limpio);
          }}
        >
          <Input
            value={nuevo}
            onChange={(e) => setNuevo(e.target.value)}
            placeholder="Nuevo proyecto…"
            aria-label="Nombre del nuevo proyecto"
          />
          <Button type="submit" variant="outline" size="sm" disabled={!nuevo.trim() || trabajando}>
            <Icon name="plus" className="h-3.5 w-3.5" />
            Crear
          </Button>
        </form>

        {projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Todavía no tienes proyectos. Tus tareas funcionan igual sin ellos; los proyectos sirven cuando
            varias cosas van juntas.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {projects.map((p) => {
              const cuantas = conteoPorProyecto.get(p.id) ?? 0;
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2">
                  <Input
                    defaultValue={p.name}
                    aria-label={`Nombre de ${p.name}`}
                    className="h-8 min-w-40 flex-1 text-sm"
                    onBlur={(e) => {
                      const valor = e.target.value.trim();
                      if (valor && valor !== p.name) onActualizar(p.id, { name: valor });
                      else e.target.value = p.name;
                    }}
                  />

                  <Select
                    aria-label={`Estado de ${p.name}`}
                    value={p.status}
                    className="h-8 text-xs"
                    onChange={(e) => onActualizar(p.id, { status: e.target.value as ProjectStatus })}
                  >
                    {PROJECT_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {PROJECT_STATUS_META[s].label}
                      </option>
                    ))}
                  </Select>

                  <span className="tabular text-xs text-muted-foreground">
                    {plural(cuantas, 'tarea', 'tareas')}
                  </span>

                  <button
                    type="button"
                    disabled={trabajando}
                    onClick={() => {
                      const aviso =
                        cuantas > 0
                          ? `¿Borrar "${p.name}"? Sus ${cuantas} tareas NO se borran: quedan sin proyecto.`
                          : `¿Borrar "${p.name}"?`;
                      if (window.confirm(aviso)) onBorrar(p.id);
                    }}
                    aria-label={`Borrar ${p.name}`}
                    className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-[hsl(var(--color-error-fg))]"
                  >
                    <Icon name="x" className="h-3.5 w-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Vistas guardadas — la barra de pestañas
// ════════════════════════════════════════════════════════════════════════════

export function VistasGuardadas({
  views,
  activa,
  userEmail,
  onAplicar,
  onGuardarNueva,
  onActualizar,
  onBorrar,
  hayCambios,
}: {
  views: SavedView[];
  activa: string | null;
  userEmail: string | null;
  onAplicar: (v: SavedView) => void;
  onGuardarNueva: () => void;
  onActualizar: (v: SavedView) => void;
  onBorrar: (v: SavedView) => void;
  /** `true` si los filtros de ahora ya no son los de la vista activa. */
  hayCambios: boolean;
}) {
  if (views.length === 0) {
    return (
      <button
        type="button"
        onClick={onGuardarNueva}
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
      >
        <Icon name="plus" className="h-3 w-3" />
        Guardar esta vista
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {views.map((v) => {
        const esMia = userEmail != null && v.owner_email === userEmail;
        return (
          <span key={v.id} className="inline-flex items-center">
            <button
              type="button"
              onClick={() => onAplicar(v)}
              title={v.shared && !esMia ? `Compartida por ${v.owner_email}` : undefined}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition-colors',
                activa === v.id
                  ? 'border-primary/50 bg-primary/15 text-primary'
                  : 'border-border text-muted-foreground hover:bg-secondary hover:text-foreground',
              )}
            >
              {v.shared && <Icon name="users" className="h-3 w-3" />}
              {v.name}
            </button>

            {activa === v.id && esMia && (
              <button
                type="button"
                onClick={() => (hayCambios ? onActualizar(v) : onBorrar(v))}
                title={hayCambios ? 'Guardar los cambios en esta vista' : 'Borrar esta vista'}
                aria-label={hayCambios ? `Actualizar ${v.name}` : `Borrar ${v.name}`}
                className="ml-0.5 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                <Icon name={hayCambios ? 'check' : 'x'} className="h-3 w-3" />
              </button>
            )}
          </span>
        );
      })}

      <button
        type="button"
        onClick={onGuardarNueva}
        aria-label="Guardar esta vista como una nueva"
        className="rounded-full border border-dashed border-border p-1 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
      >
        <Icon name="plus" className="h-3 w-3" />
      </button>
    </div>
  );
}
