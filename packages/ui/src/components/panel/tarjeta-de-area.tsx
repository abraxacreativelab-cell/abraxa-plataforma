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
  /**
   * `true` cuando esta área estaba CERRADA la última vez que estuvo aquí.
   *
   * Es el momento del producto: contestó las preguntas incómodas y de vuelta
   * encuentra la puerta abierta. Lo decide el panel con
   * `areasRecienAbiertas()`, no la tarjeta — así el festejo se puede probar sin
   * renderizar nada.
   */
  recienAbierta?: boolean;
  /** Posición en el mosaico. Escalona la entrada. */
  indice?: number;
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
export function TarjetaDeArea({
  area,
  requisito,
  brand,
  recienAbierta = false,
  indice = 0,
  className,
}: TarjetaDeAreaProps) {
  const abierta = isNavigable(area);
  const { vars } = accentForArea(area.slug, brand);
  const tools = abierta ? toolsForArea(area.tools, area.access) : [];
  const destino = tools[0]?.href ?? `/${area.slug}`;
  // El requisito lo escribe el carril dueño del área, no H5. La aduana es lo
  // que impide que un «Falta: H2 · packages/tenancy» aterrice bajo un candado.
  const falta = sinJerga(requisito);

  // El festejo sólo tiene sentido si de verdad está abierta. Si alguien pasara
  // `recienAbierta` sobre una cerrada, sería una promesa que la tarjeta misma
  // desmiente dos líneas abajo.
  const festeja = recienAbierta && abierta;

  /**
   * El festejo TERMINA, y eso no es un detalle.
   *
   * `.se-abre` lleva `overflow: hidden` —lo necesita para que el barrido de luz
   * no se salga de la tarjeta— y `overflow: hidden` recorta la fuga de luz del
   * borde inferior, que es parte del sistema visual. Si la clase se quedara
   * puesta, la tarjeta premiada acabaría siendo la única SIN su luz: el premio
   * por desbloquear un área sería una tarjeta peor.
   *
   * Así que a los 1.4s —el último fotograma del barrido es a 1.39s— se retira
   * la clase y la tarjeta queda exactamente igual que sus vecinas. El premio es
   * haberla abierto, no una tarjeta que brilla para siempre.
   */
  const [animando, setAnimando] = React.useState(festeja);

  React.useEffect(() => {
    if (!festeja) {
      setAnimando(false);
      return undefined;
    }
    setAnimando(true);
    const t = setTimeout(() => setAnimando(false), 1_400);
    return () => clearTimeout(t);
  }, [festeja]);

  const cuerpo = (
    <>
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'relative grid h-10 w-10 shrink-0 place-items-center rounded-lg border transition-colors',
            abierta
              ? 'border-primary/30 bg-primary/10 text-primary'
              : 'border-border/70 text-muted-foreground/70',
          )}
        >
          {/* El candado que se suelta. Se pinta ENCIMA del icono del área y se
              va girando: se ve la puerta abrirse, no un icono que cambia de
              golpe. Sólo existe durante el festejo. */}
          {animando && (
            <Icon
              name="lock"
              aria-hidden
              className="candado-se-suelta absolute h-5 w-5 text-muted-foreground/70"
            />
          )}
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

        {festeja ? (
          // La insignia dice qué pasó, y por eso el festejo también funciona
          // para quien pidió menos movimiento: sin una sola animación, la
          // tarjeta sigue anunciando que esta puerta se acaba de abrir.
          <Badge variant="success" className="shrink-0 whitespace-nowrap">
            Recién abierta
          </Badge>
        ) : abierta ? (
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
    // Tres estados y en este orden. El desbloqueo le gana a la entrada —son
    // animaciones distintas sobre el mismo elemento y se pisarían—, y cuando el
    // desbloqueo termina no se cae de vuelta a `entra`: eso volvería a lanzar
    // la entrada a 1.4s de haber cargado, que se ve como un parpadeo sin causa.
    animando ? 'se-abre' : festeja ? undefined : 'entra',
    className,
  );

  return (
    <div
      style={{ ...(vars as React.CSSProperties), '--entra-i': indice } as React.CSSProperties}
      className="h-full"
    >
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
