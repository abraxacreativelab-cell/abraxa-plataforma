'use client';

import * as React from 'react';
import { Icon, cn } from '@abraxa/ui';
import type { Turno } from '../lib/tipos';

/**
 * La conversación a pantalla completa. No es un formulario y no debe parecerlo.
 *
 * Dos decisiones que se ven poco y se sienten mucho:
 *
 *  · **El agente no lleva avatar de robot.** Lleva su nombre —el que le puso su
 *    dueño— porque el producto entero se sostiene en que sea SU agente y no una
 *    función de chat.
 *  · **El mensaje del agente no va en burbuja.** Va como texto, ancho, con aire.
 *    Meter 4 párrafos de alguien entendiendo tu negocio en una burbujita de
 *    mensajería los degrada a notificaciones.
 */
export function Conversacion({
  turnos,
  agente,
  pensando,
}: {
  turnos: Turno[];
  agente: string | null;
  pensando: boolean;
}) {
  const fondo = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    fondo.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turnos.length, pensando]);

  return (
    <div className="flex flex-col gap-8">
      {turnos.map((t, i) => (
        <Mensaje key={`${t.at}-${i}`} turno={t} agente={agente} />
      ))}
      {pensando ? <Pensando agente={agente} /> : null}
      <div ref={fondo} aria-hidden />
    </div>
  );
}

function Mensaje({ turno, agente }: { turno: Turno; agente: string | null }) {
  if (turno.role === 'user') {
    return (
      <div className="flex justify-end">
        <p className="glass max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm px-4 py-3 text-[0.95rem] leading-relaxed text-foreground/90">
          {turno.content}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="eyebrow-primary">{agente ?? 'tu agente'}</p>
      <div className="max-w-[62ch] space-y-4 text-[1.02rem] leading-[1.75] text-foreground/95">
        {turno.content.split(/\n{2,}/).map((parrafo, i) => (
          <p key={i} className="whitespace-pre-wrap">
            {parrafo}
          </p>
        ))}
      </div>
    </div>
  );
}

function Pensando({ agente }: { agente: string | null }) {
  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      <p className="eyebrow-primary">{agente ?? 'tu agente'}</p>
      <div className="flex items-center gap-2 text-[hsl(var(--muted-foreground))]">
        <Icon name="sparkles" className="h-4 w-4 animate-pulse" />
        <span className="text-sm">pensando…</span>
      </div>
    </div>
  );
}

/** El punto de partida cuando todavía no hay ni un mensaje. */
export function Esqueleto() {
  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      <div className={cn('h-3 w-24 animate-pulse rounded bg-[hsl(var(--muted))]')} />
      <div className="h-4 w-3/4 animate-pulse rounded bg-[hsl(var(--muted))]" />
      <div className="h-4 w-1/2 animate-pulse rounded bg-[hsl(var(--muted))]" />
    </div>
  );
}
