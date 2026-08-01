'use client';

import * as React from 'react';
import Link from 'next/link';
import type { AreaSummary } from '@abraxa/db/ports';
import { Icon } from '../primitives/icon';
import { Skeleton } from '../primitives/skeleton';
import { EmptyState } from '../feedback/empty-state';
import { LoadError, type LoadFailure } from '../feedback/load-error';
import { missingKeys } from '../registry/tool-registry';
import { cn } from '../../lib/cn';
import { SidebarArea } from './sidebar-area';

/** Un enlace que no pertenece a ningún área del negocio. */
export interface EnlaceFijo {
  href: string;
  label: string;
  icon: string;
}

export interface SidebarProps {
  /** `null` mientras carga. Un arreglo vacío es "todavía no tienes áreas", que
   *  es un dato legítimo y NO lo mismo que un fallo. */
  areas: AreaSummary[] | null;
  failure?: LoadFailure | null;
  pathname: string;
  activeSlug: string | null;
  requirements?: Record<string, string>;
  brand?: string | null;
  /** Arriba de las áreas. Hoy: el panel. */
  enlacesFijos?: readonly EnlaceFijo[];
  /** Abajo del todo. Hoy: ajustes. */
  enlacesDePie?: readonly EnlaceFijo[];
  onRetry?: () => void;
  onNavigate?: () => void;
}

/**
 * La navegación del producto. **No está en el código**: viene de la base de
 * datos, porque cada emprendedor tiene áreas distintas y las va desbloqueando.
 *
 * Los tres estados de carga se ven distintos a propósito (criterio 6): un
 * esqueleto mientras llega, `LoadError` si falló, `EmptyState` si de verdad no
 * hay nada. Nunca un spinner eterno, nunca un cero falso.
 *
 * Los enlaces fijos SÍ están en el código, y tienen que estarlo: el panel y los
 * ajustes no son áreas del negocio y no pueden depender de que H11 exista. Su
 * ausencia era un defecto real — `/ajustes` es de las pocas pantallas que hoy
 * sirven datos de verdad y no aparecía en ninguna parte de la navegación.
 */
export function Sidebar({
  areas,
  failure,
  pathname,
  activeSlug,
  requirements = {},
  brand,
  enlacesFijos = [],
  enlacesDePie = [],
  onRetry,
  onNavigate,
}: SidebarProps) {
  // El guard del handoff, en su versión que no revienta el render: avisa una
  // vez con TODAS las claves huérfanas y deja el sidebar funcionando.
  React.useEffect(() => {
    if (process.env.NODE_ENV === 'production' || !areas) return;
    const faltan = missingKeys(areas.flatMap((a) => a.tools));
    if (faltan.length > 0) {
      console.warn(
        `[@abraxa/ui] Herramientas sin registrar: ${faltan.join(', ')}.\n` +
          'Cada handoff registra las suyas con registerTools() desde su propio paquete. ' +
          'Mientras tanto no se listan.',
      );
    }
  }, [areas]);

  return (
    <nav aria-label="Navegación de tu negocio" className="flex h-full flex-col">
      {enlacesFijos.length > 0 && (
        <ul className="space-y-0.5 px-2 pt-3">
          {enlacesFijos.map((e) => (
            <li key={e.href}>
              <EnlaceDeBarra enlace={e} pathname={pathname} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      )}

      <p className="eyebrow px-4 pb-2 pt-5">Tu negocio</p>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {failure ? (
          <LoadError
            failure={failure}
            description="No pudimos cargar las áreas de tu negocio."
            onRetry={onRetry}
            className="m-2 p-5"
          />
        ) : areas === null ? (
          <ul className="space-y-1.5 p-1" aria-busy="true" aria-label="Cargando áreas">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="flex items-center gap-3 px-1.5 py-2">
                <Skeleton className="h-8 w-8 rounded-md" />
                <Skeleton className="h-3 flex-1" style={{ maxWidth: `${70 - i * 8}%` }} />
              </li>
            ))}
          </ul>
        ) : areas.length === 0 ? (
          <EmptyState
            title="Aún no tienes áreas"
            icon="compass"
            description="Cuando termines de contarle a tu agente cómo funciona tu negocio, aquí aparece tu mapa."
            className="m-2 p-6"
          />
        ) : (
          <ul className="space-y-0.5">
            {areas.map((area) => (
              <SidebarArea
                key={area.slug}
                area={area}
                active={area.slug === activeSlug}
                pathname={pathname}
                requirement={requirements[area.slug]}
                brand={brand}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
        )}
      </div>

      {enlacesDePie.length > 0 && (
        <ul className="space-y-0.5 border-t border-border/60 px-2 py-3">
          {enlacesDePie.map((e) => (
            <li key={e.href}>
              <EnlaceDeBarra enlace={e} pathname={pathname} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}

function EnlaceDeBarra({
  enlace,
  pathname,
  onNavigate,
}: {
  enlace: EnlaceFijo;
  pathname: string;
  onNavigate?: () => void;
}) {
  const aqui = pathname === enlace.href || pathname.startsWith(`${enlace.href}/`);

  return (
    <Link
      href={enlace.href}
      onClick={onNavigate}
      aria-current={aqui ? 'page' : undefined}
      className={cn(
        // `min-h-11` no es decorativo: son los 44px de área táctil mínima. En un
        // teléfono, un enlace más bajo se falla al picarlo.
        'flex min-h-11 items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70',
        aqui
          ? 'bg-[hsl(var(--white)/0.05)] font-medium text-primary'
          : 'text-foreground/85 hover:bg-[hsl(var(--white)/0.04)]',
      )}
    >
      <span
        className={cn(
          'grid h-8 w-8 shrink-0 place-items-center rounded-md border transition-colors',
          aqui
            ? 'border-primary/25 bg-primary/10 text-primary'
            : 'border-border/60 text-muted-foreground',
        )}
      >
        <Icon name={enlace.icon} className="h-4 w-4" />
      </span>
      <span className="truncate">{enlace.label}</span>
    </Link>
  );
}
