'use client';

import Link from 'next/link';
import type { AreaCard as Area } from '@abraxa/areas';
import { AccentScope, Badge, Card, Icon, cn, lookupTool } from '@abraxa/ui';

/**
 * Una tarjeta del mapa.
 *
 * ── Por qué es un componente de CLIENTE ────────────────────────────────────
 *
 * Por `lookupTool()`. El registro de herramientas es un módulo con estado, y el
 * servidor y el navegador tienen instancias DISTINTAS: las herramientas que
 * cada handoff registra desde su `register.ts` —y las de respaldo que pone el
 * `AppShell` de H5— sólo existen del lado del cliente. Resolver la clave
 * `"ventas:bandeja"` en el servidor devolvería `null` siempre, y las tarjetas
 * enlazarían todas al mismo sitio. H5 lo deja anotado en `resolve-areas.ts`.
 *
 * ── Lo que ya construyó tiene que VERSE construido ──────────────────────────
 *
 * Es el pago de todo el esfuerzo que ha metido, así que las cuatro tarjetas no
 * se ven igual con una etiqueta distinta: un área activa está a color, con su
 * acento y sus herramientas listadas; una bloqueada está apagada, con candado
 * y con la barra de lo que le falta. La diferencia se nota de un vistazo, desde
 * el otro lado del escritorio.
 *
 * ── Cero hex ───────────────────────────────────────────────────────────────
 *
 * Todo el color entra por `AccentScope`, que sobrescribe `--primary`/`--glow`
 * en el subárbol de la tarjeta. Cada `text-primary` y cada `bg-primary` de
 * abajo hereda el tono del área sola. No hay un solo color escrito aquí.
 */

const ETIQUETA: Record<Area['state'], { texto: string; variant: 'default' | 'secondary' | 'outline' | 'success' }> = {
  activa: { texto: 'Activa', variant: 'success' },
  en_progreso: { texto: 'En progreso', variant: 'default' },
  disponible: { texto: 'Lista para abrir', variant: 'secondary' },
  bloqueada: { texto: 'Bloqueada', variant: 'outline' },
};

/** A dónde lleva la tarjeta: a la herramienta principal del área si el registro
 *  de H5 la conoce, y si no al mini-onboarding, que siempre existe. */
function destino(area: Area): string {
  for (const clave of area.tools) {
    const herramienta = lookupTool(clave);
    if (herramienta?.href) return herramienta.href;
  }
  return `/mapa/${area.slug}`;
}

function fecha(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString('es-MX', { day: 'numeric', month: 'long' });
}

export function AreaCardView({ area }: { area: Area }) {
  const abierta = area.state !== 'bloqueada';
  const etiqueta = ETIQUETA[area.state];
  const desde = fecha(area.unlockedAt);

  const contenido = (
    <Card
      className={cn(
        'relative flex h-full flex-col gap-4 overflow-hidden p-5 transition-all',
        abierta
          ? 'holo-hover border-primary/25 hover:border-primary/50'
          : 'border-border/50 opacity-70 hover:opacity-90',
      )}
    >
      {/* La fuga de luz sólo la tienen las abiertas: es lo que hace que un área
          construida se vea encendida y una bloqueada se vea apagada. */}
      {abierta && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,hsl(var(--glow)/0.7),transparent)]"
        />
      )}

      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'grid h-10 w-10 shrink-0 place-items-center rounded-lg',
              abierta ? 'glass-btn text-primary' : 'border border-border/60 text-muted-foreground',
            )}
          >
            <Icon name={abierta ? area.icon : 'lock'} className="h-5 w-5" />
          </span>
          <h3 className="text-base font-medium leading-tight tracking-tight">{area.label}</h3>
        </div>
        <Badge variant={etiqueta.variant}>{etiqueta.texto}</Badge>
      </header>

      {/* La PROMESA. Se muestra SIEMPRE, también con candado: ver "RH ·
          graduarte de solopreneur" cerrado le planta una idea que va a querer. */}
      <p className="text-pretty text-sm leading-relaxed text-muted-foreground">{area.blurb}</p>

      <div className="mt-auto space-y-3">
        {abierta ? (
          <>
            {area.tools.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {area.tools.map((clave) => {
                  const h = lookupTool(clave);
                  return h ? (
                    <li
                      key={clave}
                      className="rounded-sm border border-border/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground"
                    >
                      {h.label}
                    </li>
                  ) : null;
                })}
              </ul>
            )}
            {desde && (
              <p className="text-xs text-muted-foreground/70">
                <span className="eyebrow mr-2">Tuya desde</span>
                {desde}
              </p>
            )}
          </>
        ) : (
          <>
            <Progreso ratio={area.ratio} />
            <p className="text-xs leading-relaxed text-muted-foreground/80">
              <span className="eyebrow mr-2">Se abre cuando</span>
              {area.missing.join(' · ')}
            </p>
          </>
        )}
      </div>
    </Card>
  );

  return (
    <AccentScope area={area.slug} className="h-full">
      {/* Una bloqueada NO es clickeable. No hay a dónde ir: se abre cumpliendo
          el requisito, no dando clic. */}
      {area.navigable ? (
        <Link
          href={destino(area)}
          className="block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {contenido}
        </Link>
      ) : (
        <div aria-disabled className="h-full">
          {contenido}
        </div>
      )}
    </AccentScope>
  );
}

/** Cuánto lleva del camino. Es información, no una decisión: lo que abre el
 *  área es cumplir el requisito, no llenar la barra. */
function Progreso({ ratio }: { ratio: number }) {
  const pct = Math.round(Math.min(Math.max(ratio, 0), 1) * 100);
  return (
    <div>
      <div
        className="h-1 w-full overflow-hidden rounded-full bg-secondary"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Avance para desbloquear: ${pct}%`}
      >
        <div className="h-full rounded-full bg-primary/70 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1.5 text-right text-[10px] font-mono uppercase tracking-wider text-muted-foreground/60">
        {pct}%
      </p>
    </div>
  );
}
