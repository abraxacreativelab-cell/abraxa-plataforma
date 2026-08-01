'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import type { AreaSummary } from '@abraxa/db/ports';
import type { LoadFailure } from '../feedback/failure';
import { FronteraDeError } from '../feedback/frontera-de-error';
import { lookupTool, toolsForArea } from '../registry/tool-registry';
import { isNavigable } from '../nav/resolve-areas';
import { registrarHerramientasDeArranque } from '../nav/areas-de-arranque';
import { AccentScope } from './accent-scope';
import { MobileNav } from './mobile-nav';
import { Sidebar, type EnlaceFijo } from './sidebar';
import { Topbar } from './topbar';
import { TransicionDeRuta } from './transicion-de-ruta';

/** El panel. No es un área del negocio: es la puerta de entrada al producto. */
export const ENLACE_AL_PANEL: EnlaceFijo = { href: '/panel', label: 'Tu panel', icon: 'resumen' };

/** Ajustes. Va al pie porque se usa poco, pero tiene que EXISTIR: es donde el
 *  invitado confirma con qué cuenta entró y por dónde cierra sesión. */
export const ENLACE_A_AJUSTES: EnlaceFijo = { href: '/ajustes', label: 'Ajustes', icon: 'settings' };

export interface AppShellProps {
  areas: AreaSummary[] | null;
  failure?: LoadFailure | null;
  /** Qué hace falta para abrir cada área bloqueada. */
  requirements?: Record<string, string>;
  /** Color de marca del emprendedor. Le gana al color de cada área. */
  brand?: string | null;
  businessName?: string | null;
  agentName?: string | null;
  /** Aviso de desarrollo: "estás viendo el catálogo de arranque, no H11". */
  notice?: string | null;
  /** `true` cuando la navegación viene del catálogo de arranque: registra las
   *  herramientas de respaldo para que el sidebar sea navegable antes de H11. */
  fallbackTools?: boolean;
  children: React.ReactNode;
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  El esqueleto del producto
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Aquí cuelgan sus pantallas los otros 13 handoffs. Cada uno escribe sólo su
 *  contenido dentro de su carpeta y hereda el shell, el acento del área, los
 *  estados honestos y —desde hoy— la frontera de error, sin coordinarse con
 *  nadie.
 *
 *  Dos ámbitos de acento anidados, a propósito:
 *
 *    · el EXTERNO lleva la marca del emprendedor (o el blanco luminoso si no ha
 *      elegido ninguna). Tiñe la barra superior y el lienzo.
 *    · el INTERNO lleva el color del área donde está parado. Tiñe el contenido.
 *
 *  Así, al moverse de Ventas a Dirección, el contenido cambia de verde a dorado
 *  entero, sin que ninguna pantalla sepa nada de colores.
 *
 *  ── La frontera de error va DENTRO del shell, no fuera ─────────────────────
 *
 *  Envuelve sólo a `{children}`. Es lo que hace que una pantalla que revienta
 *  no se lleve consigo la barra lateral: el invitado ve una frase digna en el
 *  lienzo y puede irse a otra sección con un clic, en vez de quedarse mirando
 *  una pantalla blanca sin navegación.
 */
export function AppShell({
  areas,
  failure,
  requirements,
  brand,
  businessName,
  agentName,
  notice,
  fallbackTools = false,
  children,
}: AppShellProps) {
  const pathname = usePathname() ?? '/';
  const [navOpen, setNavOpen] = React.useState(false);

  // Se registra durante el render y ANTES de que se pinte el sidebar, en el
  // servidor y en el cliente. `registerFallbackTools` no pisa lo que el handoff
  // dueño ya haya registrado, así que el orden de importación deja de importar.
  if (fallbackTools) registrarHerramientasDeArranque();

  // Cerrar el cajón al navegar. Si no, en móvil se queda encima del contenido
  // que el usuario acaba de pedir.
  React.useEffect(() => setNavOpen(false), [pathname]);

  const activa = React.useMemo(() => findActiveArea(areas, pathname), [areas, pathname]);
  const areaActual = areas?.find((a) => a.slug === activa) ?? null;

  const barra = (
    <Sidebar
      areas={areas}
      failure={failure}
      pathname={pathname}
      activeSlug={activa}
      requirements={requirements}
      brand={brand}
      enlacesFijos={[ENLACE_AL_PANEL]}
      enlacesDePie={[ENLACE_A_AJUSTES]}
      onNavigate={() => setNavOpen(false)}
      onRetry={() => window.location.reload()}
    />
  );

  return (
    <AccentScope brand={brand} className="flex min-h-screen flex-col">
      <Topbar
        businessName={businessName}
        agentName={agentName}
        areaLabel={areaActual?.label}
        // El logotipo lleva al PANEL, no a `/`: dentro del producto `/` es la
        // landing de venta, y sacar a alguien de su negocio de un clic sería
        // absurdo. Antes apuntaba a la primera área abierta, así que con todo
        // bloqueado el logotipo terminaba llevando justo a la landing.
        homeHref={ENLACE_AL_PANEL.href}
        notice={notice}
        onOpenNav={() => setNavOpen(true)}
      />

      <div className="flex min-h-0 flex-1">
        {/* Barra permanente en pantallas grandes. */}
        <aside
          className="hidden w-[var(--shell-sidebar)] shrink-0 border-r border-border/60 lg:block"
          aria-label="Navegación principal"
        >
          <div className="sticky top-[var(--shell-topbar)] h-[calc(100vh-var(--shell-topbar))]">
            {barra}
          </div>
        </aside>

        {/* Cajón en pantallas chicas. Mismo componente, misma navegación: no hay
            dos árboles que se puedan desincronizar. */}
        <MobileNav open={navOpen} onOpenChange={setNavOpen}>
          {barra}
        </MobileNav>

        {/* El contenido, teñido por el área. `min-w-0` es lo que evita que una
            tabla ancha empuje el layout y rompa el responsive. */}
        <AccentScope
          key={activa ?? 'sin-area'}
          area={activa}
          brand={brand}
          className="fog min-w-0 flex-1"
        >
          {/*
            Contenedor, NO <main>. El landmark lo pone cada página — así lo
            dejaron los andamios de H1 y así lo va a escribir cada handoff. Si
            el shell también pusiera uno, quedarían dos <main> anidados en cada
            pantalla del producto.
            `tabIndex={-1}` es lo que hace que el salto al contenido de verdad
            mueva el foco y no sólo el scroll.
          */}
          <div id="contenido" tabIndex={-1} className="min-w-0 focus:outline-none">
            <FronteraDeError resetKey={pathname} contexto={areaActual?.label ?? null}>
              {/* La transición va DENTRO de la frontera de error, no fuera: si
                  una pantalla revienta, lo que tiene que aparecer es la
                  disculpa —y aparece quieta—, no una disculpa deslizándose. */}
              <TransicionDeRuta ruta={pathname}>{children}</TransicionDeRuta>
            </FronteraDeError>
          </div>
        </AccentScope>
      </div>
    </AccentScope>
  );
}

/**
 * Qué área corresponde a la ruta actual.
 *
 * Se resuelve por la RUTA REGISTRADA de cada herramienta, no partiendo el
 * pathname como hacía GARDEN (`/v/{empresa}/{área}/{herramienta}`). Aquí las
 * áreas del negocio y las carpetas de `apps/web` no coinciden —`/bandeja` es
 * una herramienta de Ventas pero vive en la carpeta de H6— así que la única
 * fuente confiable es lo que el handoff dueño registró.
 *
 * Gana la coincidencia más larga: `/ventas/contactos` le gana a `/ventas`.
 *
 * Un área CERRADA no reclama ruta: si lo hiciera, entrar a `/tareas` teñiría el
 * shell del color de un área con candado y la barra superior anunciaría un área
 * en la que el usuario no puede estar. Además sus `tools` van vacías, así que
 * ni siquiera tiene rutas que reclamar.
 */
export function findActiveArea(areas: AreaSummary[] | null, pathname: string): string | null {
  if (!areas?.length) return null;

  let mejor: { slug: string; largo: number } | null = null;

  for (const area of areas) {
    if (!isNavigable(area)) continue;

    const candidatos = [
      `/${area.slug}`,
      ...area.tools.map((k) => lookupTool(k)?.href).filter((h): h is string => Boolean(h)),
    ];

    for (const href of candidatos) {
      const coincide = pathname === href || pathname.startsWith(`${href}/`);
      if (coincide && (!mejor || href.length > mejor.largo)) {
        mejor = { slug: area.slug, largo: href.length };
      }
    }
  }

  return mejor?.slug ?? null;
}

/** El primer destino de un área, para quien necesite mandar a alguien ahí. */
export function primerDestinoDe(area: AreaSummary): string {
  return toolsForArea(area.tools, area.access)[0]?.href ?? `/${area.slug}`;
}
