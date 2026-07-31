'use client';

import Link from 'next/link';
import { Icon } from '../primitives/icon';
import { Badge } from '../primitives/badge';
import { cn } from '../../lib/cn';

export interface TopbarProps {
  /** El nombre de la empresa del emprendedor. */
  businessName?: string | null;
  /** El nombre que él le puso a su agente maestro. Viaja a toda la interfaz. */
  agentName?: string | null;
  /** Área en la que está parado, para el rastro de navegación. */
  areaLabel?: string | null;
  /** Se muestra en desarrollo cuando la navegación viene del mock. */
  notice?: string | null;
  /** A dónde lleva el logotipo. Dentro del producto NO es `/`: ésa es la
   *  landing de venta. */
  homeHref?: string;
  /** Abre el cajón de navegación en pantallas chicas. */
  onOpenNav?: () => void;
}

export function Topbar({
  businessName,
  agentName,
  areaLabel,
  notice,
  homeHref = '/',
  onOpenNav,
}: TopbarProps) {
  return (
    // La altura sale del token `--shell-topbar`, que es el mismo que usa la
    // barra lateral para su `sticky` y su alto. Escrita a mano en los dos
    // sitios, se desincronizan al primer cambio.
    <header className="sticky top-0 z-30 flex h-[var(--shell-topbar)] shrink-0 items-center gap-2 border-b border-border/60 bg-background/70 px-3 backdrop-blur-xl sm:px-4">
      <button
        type="button"
        onClick={onOpenNav}
        aria-label="Abrir las áreas de tu negocio"
        className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
      >
        <Icon name="menu" className="h-5 w-5" />
      </button>

      <Link
        href={homeHref}
        className="flex min-h-11 items-center gap-2 rounded-md px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="glow-ring grid h-6 w-6 place-items-center rounded-[7px] bg-primary/15">
          <Icon name="sparkles" className="h-3.5 w-3.5 text-primary" />
        </span>
        <span className="truncate text-sm font-medium tracking-tight">
          {businessName ?? 'Tu negocio'}
        </span>
      </Link>

      {areaLabel && (
        <>
          <Icon
            name="chevron-right"
            className="hidden h-3.5 w-3.5 shrink-0 text-muted-foreground/40 sm:block"
          />
          <span className="hidden truncate text-sm text-muted-foreground sm:block">
            {areaLabel}
          </span>
        </>
      )}

      <div className="ml-auto flex items-center gap-2">
        {notice && (
          <Badge variant="warning" className="hidden sm:inline-flex">
            {notice}
          </Badge>
        )}

        {agentName && (
          <span
            className={cn(
              'glass-btn flex min-h-9 items-center gap-2 rounded-full px-3 text-xs',
              'text-foreground/90',
            )}
            title={`${agentName} es tu agente maestro`}
          >
            <Icon name="bot" className="h-3.5 w-3.5 text-primary" />
            <span className="max-w-[9rem] truncate">{agentName}</span>
          </span>
        )}
      </div>
    </header>
  );
}
