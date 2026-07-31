'use client';

import * as React from 'react';
import Link from 'next/link';
import type { AreaSummary } from '@abraxa/db/ports';
import { Icon } from '../primitives/icon';
import { cn } from '../../lib/cn';
import { accentForArea } from '../../lib/accent';
import { toolsForArea } from '../registry/tool-registry';
import { isNavigable } from '../nav/resolve-areas';

/** Cómo se anuncia cada estado. El texto es para lectores de pantalla y para
 *  el atributo `title`; el color lo pone el acento del área. */
const ESTADO: Record<AreaSummary['state'], string> = {
  activa: 'activa',
  en_progreso: 'en progreso',
  disponible: 'disponible, aún sin estrenar',
  bloqueada: 'bloqueada',
};

export interface SidebarAreaProps {
  area: AreaSummary;
  /** Si es el área en la que está parado el usuario. */
  active: boolean;
  pathname: string;
  /** Qué hace falta para desbloquearla, si se sabe. */
  requirement?: string;
  brand?: string | null;
  onNavigate?: () => void;
}

/**
 * Un área en la barra lateral, con sus cuatro estados.
 *
 * Cada área se pinta dentro de su propio acento, así que la barra entera es la
 * demostración de que el sistema funciona: seis áreas, seis colores, cero hex.
 */
export function SidebarArea({
  area,
  active,
  pathname,
  requirement,
  brand,
  onNavigate,
}: SidebarAreaProps) {
  const abierta = isNavigable(area);
  const { vars } = accentForArea(area.slug, brand);
  const tools = abierta ? toolsForArea(area.tools, area.access) : [];
  const destino = tools[0]?.href ?? `/${area.slug}`;

  const contenido = (
    <>
      <span
        className={cn(
          'grid h-8 w-8 shrink-0 place-items-center rounded-md border transition-colors',
          abierta
            ? 'border-primary/25 bg-primary/10 text-primary'
            : 'border-border/60 text-muted-foreground/70',
        )}
      >
        <Icon name={abierta ? area.icon : 'lock'} className="h-4 w-4" />
      </span>

      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block truncate text-sm',
            active ? 'font-medium text-primary' : abierta ? 'text-foreground/90' : 'text-muted-foreground',
          )}
        >
          {area.label}
        </span>

        {/* La promesa. Se muestra SIEMPRE en las bloqueadas: la curiosidad es
            el motor del producto, así que el candado tiene que traer letrero. */}
        {!abierta && (
          <span className="mt-0.5 block text-pretty text-[11px] leading-snug text-muted-foreground/60">
            {area.blurb}
          </span>
        )}
      </span>

      {area.state === 'en_progreso' && (
        <span className="status-dot-live shrink-0" aria-hidden />
      )}
      {area.state === 'disponible' && (
        <Icon name="chevron-right" className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
      )}
    </>
  );

  const clasesBase = 'flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left transition-colors';

  return (
    <li style={vars as React.CSSProperties}>
      {abierta ? (
        <Link
          href={destino}
          onClick={onNavigate}
          aria-current={active ? 'page' : undefined}
          title={`${area.label} — ${ESTADO[area.state]}`}
          className={cn(
            clasesBase,
            'min-h-11 hover:bg-[hsl(var(--white)/0.04)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70',
            active && 'bg-[hsl(var(--white)/0.05)]',
          )}
        >
          {contenido}
        </Link>
      ) : (
        // Bloqueada: NO es un enlace ni un botón. No hay a dónde ir — se abre
        // cumpliendo el hito, no dando clic (criterio 5).
        <div
          aria-disabled="true"
          title={`${area.label} — ${ESTADO[area.state]}`}
          className={cn(clasesBase, 'cursor-default select-none opacity-80')}
        >
          {contenido}
        </div>
      )}

      {/* Las herramientas del área abierta. Se despliegan sólo en la activa:
          una barra con todo desplegado deja de ser un mapa. */}
      {active && tools.length > 0 && (
        <ul className="mb-1 ml-[1.85rem] mt-0.5 space-y-px border-l border-border/50 pl-3">
          {tools.map((tool) => {
            const aqui = pathname === tool.href;
            return (
              <li key={tool.key}>
                <Link
                  href={tool.href}
                  onClick={onNavigate}
                  aria-current={aqui ? 'page' : undefined}
                  className={cn(
                    'flex min-h-9 items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70',
                    aqui
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-[hsl(var(--white)/0.04)] hover:text-foreground',
                  )}
                >
                  <Icon name={tool.icon} className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{tool.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {/* Qué falta para abrirla. Sin esto el candado es una puerta cerrada sin
          letrero, y no invita a nada. */}
      {!abierta && requirement && (
        <p className="ml-[2.85rem] mt-1 text-[11px] leading-snug text-muted-foreground/45">
          Se abre cuando {requirement}.
        </p>
      )}
    </li>
  );
}
