'use client';

import { useState, useTransition } from 'react';
import type { Milestone } from '@abraxa/areas';
import { Badge, Button, Card, Icon, Input, cn } from '@abraxa/ui';
import {
  agregarHito,
  borrarHito,
  marcarHito,
  proponerRoadmap,
  reordenarHitos,
  type Resultado,
} from '../actions';

/**
 * El roadmap, al lado del mapa: las áreas dicen QUÉ tiene, los hitos dicen QUÉ
 * SIGUE (criterio 7 — se puede marcar, reordenar y editar).
 *
 * ── El orden se mueve con botones, no arrastrando ──────────────────────────
 *
 * Arrastrar es más bonito y es la primera idea de todos. También es lo que deja
 * fuera a quien navega con teclado, a quien usa lector de pantalla y a quien lo
 * intenta con el pulgar en un teléfono. Subir/bajar funciona en los tres casos,
 * es una lista ordenada de verdad para el lector de pantalla, y no necesita una
 * dependencia nueva — que además la regla 4 del contrato prohíbe instalar.
 *
 * ── El estado optimista ────────────────────────────────────────────────────
 *
 * Marcar un hito y reordenar se pintan al instante y se confirman contra el
 * servidor después. Si el servidor dice que no, se revierte y se enseña el
 * motivo: nunca se queda pintado un cambio que no se guardó.
 */
export function Roadmap({ inicial, editable }: { inicial: Milestone[]; editable: boolean }) {
  const [hitos, setHitos] = useState(inicial);
  const [error, setError] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState('');
  const [pendiente, iniciar] = useTransition();

  /** Aplica el cambio en pantalla y lo confirma. Si falla, revierte. */
  const optimista = (siguiente: Milestone[], accion: () => Promise<Resultado>): void => {
    const previo = hitos;
    setHitos(siguiente);
    setError(null);
    iniciar(() => {
      void accion().then((r) => {
        if (!r.ok) {
          setHitos(previo);
          setError(r.error);
        }
      });
    });
  };

  const alMarcar = (h: Milestone): void => {
    const hecho = !h.done;
    optimista(
      hitos.map((x) =>
        x.id === h.id ? { ...x, done: hecho, doneAt: hecho ? new Date().toISOString() : null } : x,
      ),
      () => marcarHito(h.id, hecho),
    );
  };

  const alMover = (i: number, delta: number): void => {
    const j = i + delta;
    if (j < 0 || j >= hitos.length) return;
    const siguiente = [...hitos];
    const [movido] = siguiente.splice(i, 1);
    if (movido) siguiente.splice(j, 0, movido);
    optimista(siguiente, () => reordenarHitos(siguiente.map((x) => x.id)));
  };

  const alBorrar = (h: Milestone): void => {
    optimista(
      hitos.filter((x) => x.id !== h.id),
      () => borrarHito(h.id),
    );
  };

  const alAgregar = (e: React.FormEvent): void => {
    e.preventDefault();
    const titulo = nuevo.trim();
    if (!titulo) return;
    setNuevo('');
    setError(null);
    iniciar(() => {
      void agregarHito(titulo).then((r) => {
        if (!r.ok) {
          setError(r.error);
          setNuevo(titulo);
        }
      });
    });
  };

  const alProponer = (): void => {
    setError(null);
    iniciar(() => {
      void proponerRoadmap().then((r) => {
        if (!r.ok) setError(r.error);
      });
    });
  };

  const hechos = hitos.filter((h) => h.done).length;

  return (
    <Card className="flex h-full flex-col gap-4 p-5">
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-base font-medium tracking-tight">Qué sigue</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {hitos.length === 0
              ? 'Tu agente maestro puede proponerte el camino.'
              : `${hechos} de ${hitos.length} logrados`}
          </p>
        </div>
        {hitos.length > 0 && <Badge variant="outline">{hitos.length}</Badge>}
      </header>

      {hitos.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-8 text-center">
          <Icon name="route" className="h-6 w-6 text-muted-foreground/50" />
          <p className="max-w-[24ch] text-sm text-muted-foreground">
            Todavía no hay hitos. Los primeros los propone tu agente.
          </p>
        </div>
      ) : (
        <ol className="flex-1 space-y-1">
          {hitos.map((h, i) => (
            <li key={h.id} className="group flex items-start gap-2.5 rounded-md px-1 py-1.5">
              <button
                type="button"
                onClick={() => alMarcar(h)}
                disabled={!editable || pendiente}
                aria-pressed={h.done}
                aria-label={h.done ? `Desmarcar ${h.title}` : `Marcar ${h.title} como logrado`}
                className={cn(
                  'mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border transition-colors',
                  h.done
                    ? 'border-primary/60 bg-primary/20 text-primary'
                    : 'border-border hover:border-primary/50',
                  !editable && 'cursor-not-allowed opacity-50',
                )}
              >
                {h.done && <Icon name="check" className="h-3 w-3" />}
              </button>

              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    'text-sm leading-snug transition-colors',
                    h.done ? 'text-muted-foreground line-through' : 'text-foreground',
                  )}
                >
                  {h.title}
                </p>
                {h.description && (
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground/70">
                    {h.description}
                  </p>
                )}
                {h.areaSlug && (
                  <span className="eyebrow mt-1 inline-block text-muted-foreground/50">
                    {h.areaSlug}
                  </span>
                )}
              </div>

              {editable && (
                <span className="flex shrink-0 gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                  <IconoBoton
                    label={`Subir ${h.title}`}
                    icon="chevron-down"
                    className="rotate-180"
                    disabled={i === 0 || pendiente}
                    onClick={() => alMover(i, -1)}
                  />
                  <IconoBoton
                    label={`Bajar ${h.title}`}
                    icon="chevron-down"
                    disabled={i === hitos.length - 1 || pendiente}
                    onClick={() => alMover(i, 1)}
                  />
                  <IconoBoton
                    label={`Quitar ${h.title}`}
                    icon="x"
                    disabled={pendiente}
                    onClick={() => alBorrar(h)}
                  />
                </span>
              )}
            </li>
          ))}
        </ol>
      )}

      {editable && (
        <div className="space-y-2 border-t border-border/60 pt-4">
          <form onSubmit={alAgregar} className="flex gap-2">
            <Input
              value={nuevo}
              onChange={(e) => setNuevo(e.target.value)}
              placeholder="Agregar un hito tuyo…"
              aria-label="Título del hito nuevo"
              maxLength={200}
              className="h-8 text-sm"
            />
            <Button type="submit" size="sm" variant="glass" disabled={!nuevo.trim() || pendiente}>
              <Icon name="plus" className="h-3.5 w-3.5" />
              <span className="sr-only">Agregar hito</span>
            </Button>
          </form>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full"
            disabled={pendiente}
            onClick={alProponer}
          >
            <Icon name="sparkles" className="h-3.5 w-3.5" />
            {hitos.length ? 'Pedir más al agente' : 'Que mi agente lo proponga'}
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs leading-relaxed text-[hsl(var(--color-error-fg))]">
          {error}
        </p>
      )}
    </Card>
  );
}

function IconoBoton({
  label,
  icon,
  onClick,
  disabled,
  className,
}: {
  label: string;
  icon: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="grid h-6 w-6 place-items-center rounded text-muted-foreground/60 transition-colors hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
    >
      <Icon name={icon} className={cn('h-3.5 w-3.5', className)} />
    </button>
  );
}
