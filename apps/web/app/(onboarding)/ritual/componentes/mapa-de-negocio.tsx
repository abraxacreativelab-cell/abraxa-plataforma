import Link from 'next/link';
import { AccentScope, Button, Icon, cn } from '@abraxa/ui';
import type { AreaDelMapa, Hito, Mapa } from '../lib/tipos';

/**
 * El cierre con peso.
 *
 * «Es el pago emocional de 20 minutos de preguntas» — handoff §8. Así que no es
 * una tabla de resultados: es su empresa dibujada, con lo que ya puede usar
 * arriba y lo que le espera abajo, cada área con su acento.
 *
 * **Las bloqueadas se muestran.** Con candado y con su promesa. H11 §5 tiene
 * razón en insistir: ver "Equipo · graduarte de solopreneur" cerrado le planta
 * una idea que va a querer. Esconderlas apaga el motor del producto.
 */
export function MapaDeNegocio({ mapa, agente }: { mapa: Mapa; agente: string | null }) {
  const abiertas = mapa.areas.filter((a) => a.estado !== 'bloqueada');
  const cerradas = mapa.areas.filter((a) => a.estado === 'bloqueada');
  const delDiablo = mapa.hitos.filter((h) => h.origen === 'abogado_del_diablo');
  const resto = mapa.hitos.filter((h) => h.origen !== 'abogado_del_diablo');

  return (
    <section className="flex flex-col gap-12 pb-8" aria-labelledby="titulo-mapa">
      <header className="flex flex-col gap-3">
        <p className="eyebrow-primary">Tu Mapa de Negocio</p>
        <h2 id="titulo-mapa" className="font-display text-3xl tracking-tight sm:text-4xl">
          Esto es tu empresa.
        </h2>
        <p className="max-w-[52ch] text-[hsl(var(--muted-foreground))]">
          Lo armó {agente ?? 'tu agente'} con lo que le contaste. Lo que está abierto lo puedes
          usar hoy; lo demás se abre conforme avances.
        </p>
      </header>

      {abiertas.length > 0 ? (
        <div className="flex flex-col gap-4">
          <h3 className="section-title">Puedes empezar hoy</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {abiertas.map((a) => (
              <Area key={a.slug} area={a} />
            ))}
          </div>
        </div>
      ) : null}

      {cerradas.length > 0 ? (
        <div className="flex flex-col gap-4">
          <h3 className="section-title">Todavía no, pero te esperan</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {cerradas.map((a) => (
              <Area key={a.slug} area={a} />
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-4">
        <h3 className="section-title">Lo que sigue</h3>

        {delDiablo.length > 0 ? (
          <div className="glass flex flex-col gap-3 rounded-xl border-[hsl(var(--color-warning-border))] p-5">
            <p className="flex items-center gap-2 text-xs uppercase tracking-widest text-[hsl(var(--color-warning-fg))]">
              <Icon name="target" className="h-3.5 w-3.5" />
              Lo que encontré yo
            </p>
            <ol className="flex flex-col gap-3">
              {delDiablo.map((h, i) => (
                <HitoFila key={h.titulo} hito={h} n={i + 1} />
              ))}
            </ol>
          </div>
        ) : null}

        <ol className="flex flex-col gap-3">
          {resto.map((h, i) => (
            <HitoFila key={h.titulo} hito={h} n={delDiablo.length + i + 1} tenue />
          ))}
        </ol>
      </div>

      <div className="flex flex-col items-start gap-4 border-t border-[hsl(var(--border))] pt-8">
        <p className="max-w-[52ch] text-[hsl(var(--muted-foreground))]">
          Ya puedes entrar a tu sistema. Lo que falta no te bloquea.
        </p>
        <Button asChild size="lg">
          <Link href="/mapa">
            Entrar a mi negocio
            <Icon name="arrow-right" className="h-4 w-4" />
          </Link>
        </Button>
      </div>
    </section>
  );
}

function Area({ area }: { area: AreaDelMapa }) {
  const bloqueada = area.estado === 'bloqueada';

  return (
    <AccentScope area={area.slug} className="h-full">
      <article
        className={cn(
          'glass flex h-full flex-col gap-3 rounded-xl p-5 transition-opacity',
          bloqueada
            ? 'opacity-70'
            : 'border-[hsl(var(--glow)/0.35)] shadow-[0_12px_40px_-24px_hsl(var(--glow)/0.6)]',
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <h4 className="font-medium text-foreground">{area.label}</h4>
          <span
            className={cn(
              'shrink-0 rounded-full px-2 py-0.5 text-[0.65rem] uppercase tracking-wider',
              bloqueada
                ? 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]'
                : 'bg-[hsl(var(--glow)/0.15)] text-[hsl(var(--glow))]',
            )}
          >
            {bloqueada ? (
              <span className="flex items-center gap-1">
                <Icon name="lock" className="h-3 w-3" />
                cerrada
              </span>
            ) : (
              area.estado.replace('_', ' ')
            )}
          </span>
        </div>

        <p className="text-sm text-foreground/80">{area.blurb}</p>
        <p className="text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">{area.razon}</p>

        {bloqueada && area.requisitos.length > 0 ? (
          <ul className="mt-auto flex flex-col gap-1 border-t border-[hsl(var(--border))] pt-3">
            {area.requisitos.map((r) => (
              <li key={r.label} className="text-xs text-[hsl(var(--muted-foreground))]">
                · {r.label}
              </li>
            ))}
          </ul>
        ) : null}
      </article>
    </AccentScope>
  );
}

function HitoFila({ hito, n, tenue }: { hito: Hito; n: number; tenue?: boolean }) {
  return (
    <li className="flex gap-3">
      <span
        className={cn(
          'tabular mt-0.5 shrink-0 text-xs',
          tenue ? 'text-[hsl(var(--muted-foreground))]' : 'text-[hsl(var(--color-warning-fg))]',
        )}
      >
        {String(n).padStart(2, '0')}
      </span>
      <div className="flex flex-col gap-0.5">
        <p className={cn('text-sm', tenue ? 'text-foreground/80' : 'text-foreground')}>
          {hito.titulo}
        </p>
        {hito.detalle ? (
          <p className="text-xs text-[hsl(var(--muted-foreground))]">{hito.detalle}</p>
        ) : null}
      </div>
    </li>
  );
}
