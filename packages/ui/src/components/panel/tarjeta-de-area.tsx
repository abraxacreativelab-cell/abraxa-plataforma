'use client';

import * as React from 'react';
import Link from 'next/link';
import type { AreaSummary } from '@abraxa/db/ports';
import { Icon } from '../primitives/icon';
import { Badge } from '../primitives/badge';
import { cn } from '../../lib/cn';
import { accentForArea } from '../../lib/accent';
import { sinJerga } from '../../lib/castellano';
import { toolsForArea } from '../registry/tool-registry';
import { isNavigable } from '../nav/resolve-areas';

export interface TarjetaDeAreaProps {
  area: AreaSummary;
  /** Qué falta para abrirla. Sin esto el candado es una puerta sin letrero. */
  requisito?: string;
  brand?: string | null;
  className?: string;
}

/**
 * Un área del negocio, en grande y en mosaico. Es la pieza del panel que hace
 * el trabajo que Santiago pidió: **la sección bloqueada es el gancho, no la
 * disculpa.**
 *
 * Por eso la cerrada y la abierta pesan lo mismo en pantalla —mismo tamaño,
 * mismo cristal, mismo color de área— y lo único que cambia es el candado, la
 * insignia y la frase de "se abre cuando". Si la cerrada se viera más chica o
 * más gris, dejaría de dar curiosidad y pasaría a dar lástima.
 *
 * La cerrada NO es un enlace ni un botón: no hay a dónde ir. Se abre cumpliendo
 * el hito, no dando clic — la misma decisión que ya tomó `SidebarArea`.
 */
export function TarjetaDeArea({ area, requisito, brand, className }: TarjetaDeAreaProps) {
  const abierta = isNavigable(area);
  const { vars } = accentForArea(area.slug, brand);
  const tools = abierta ? toolsForArea(area.tools, area.access) : [];
  const destino = tools[0]?.href ?? `/${area.slug}`;

  const cuerpo = (
    <>
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'grid h-10 w-10 shrink-0 place-items-center rounded-lg border transition-colors',
            abierta
              ? 'border-primary/30 bg-primary/10 text-primary'
              : 'border-border/70 text-muted-foreground/70',
          )}
        >
          <Icon name={abierta ? area.icon : 'lock'} className="h-5 w-5" />
        </span>

        <div className="min-w-0 flex-1">
          <h3
            className={cn(
              'truncate text-base font-medium tracking-tight',
              abierta ? 'text-foreground' : 'text-foreground/80',
            )}
          >
            {area.label}
          </h3>
          <p className="mt-1 text-pretty text-[13px] leading-snug text-muted-foreground">
            {area.blurb}
          </p>
        </div>

        {abierta ? (
          <Icon
            name="arrow-right"
            className="mt-1 h-4 w-4 shrink-0 text-primary/70 transition-transform group-hover:translate-x-0.5"
          />
        ) : (
          <Badge variant="outline" className="shrink-0">
            Aún no
          </Badge>
        )}
      </div>

      {abierta && tools.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-1.5">
          {tools.map((t) => (
            <li
              key={t.key}
              className="flex items-center gap-1.5 rounded-md border border-border/60 px-2 py-1 text-[11px] text-muted-foreground"
            >
              <Icon name={t.icon} className="h-3 w-3" />
              {t.label}
            </li>
          ))}
        </ul>
      )}

      {!abierta && falta && (
        <p className="mt-4 border-t border-border/50 pt-3 text-pretty text-[12px] leading-snug text-muted-foreground/70">
          <span className="eyebrow mr-2">Se abre cuando</span>
          {falta}.
        </p>
      )}
    </>
  );

  const clases = cn(
    'glass group flex h-full flex-col rounded-xl p-5 text-left transition-colors',
    abierta ? 'glass-hover light-leak light-leak-accent' : 'opacity-90',
    className,
  );

  return (
    <div style={vars as React.CSSProperties} className="h-full">
      {abierta ? (
        <Link
          href={destino}
          className={cn(
            clases,
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70',
          )}
        >
          {cuerpo}
        </Link>
      ) : (
        <div aria-disabled="true" className={cn(clases, 'cursor-default select-none')}>
          {cuerpo}
        </div>
      )}
    </div>
  );
}
