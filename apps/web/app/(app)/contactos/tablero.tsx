/**
 * El embudo, de un vistazo.
 *
 * Dos decisiones de lectura:
 *
 *  · **La barra es proporcional al conteo, no al monto.** Un trato de un
 *    millón no puede hacer que once leads de mil pesos desaparezcan de la
 *    vista: el embudo es sobre cuánta gente hay en cada paso.
 *  · **Ganado y Perdido se separan visualmente del resto.** Son terminales, no
 *    "la última etapa": ponerlos en la misma fila hace parecer que Perdido es
 *    el destino natural de quien pasó por Negociación.
 */
import { Icon } from '@abraxa/ui';
import { dinero } from './formato';
import type { EtapaConteo } from './tipos';

/**
 * `moneda` llega desde `pipelineStats`, derivada de los datos. No se asume
 * 'MXN': un embudo cotizado en dólares se pintaba como pesos, y las sumas
 * mezclaban monedas. Cuando una etapa tiene dinero en MÁS de una moneda, se
 * listan todas — un solo número ahí sería mentira.
 */
export function Tablero({ etapas, moneda = 'MXN' }: { etapas: EtapaConteo[]; moneda?: string }) {
  const abiertas = etapas.filter((e) => e.slug !== 'ganado' && e.slug !== 'perdido');
  const ganado = etapas.find((e) => e.slug === 'ganado');
  const perdido = etapas.find((e) => e.slug === 'perdido');

  const maximo = Math.max(1, ...abiertas.map((e) => e.count));
  const contactosAbiertos = abiertas.reduce((s, e) => s + e.count, 0);

  /* El total en juego, por moneda. Sumar a través de monedas produce un número
     que no significa nada; aquí simplemente no se puede escribir. */
  const enJuegoPorMoneda = new Map<string, number>();
  for (const e of abiertas) {
    const desglose = e.amounts ?? (e.amount ? { [moneda]: e.amount } : {});
    for (const [m, v] of Object.entries(desglose)) {
      if (v) enJuegoPorMoneda.set(m, (enJuegoPorMoneda.get(m) ?? 0) + v);
    }
  }
  const enJuego = [...enJuegoPorMoneda.entries()].sort((a, b) => b[1] - a[1]);

  /** Lo que se imprime en una celda: una moneda o varias, nunca una suma falsa. */
  const montoDe = (e: EtapaConteo): string => {
    const desglose = e.amounts ?? (e.amount ? { [moneda]: e.amount } : {});
    return Object.entries(desglose)
      .filter(([, v]) => v)
      .sort((a, b) => b[1] - a[1])
      .map(([m, v]) => dinero(v, m))
      .join(' · ');
  };

  return (
    <section className="rounded-lg border border-border bg-card/40 p-5">
      <header className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Embudo
        </h2>
        <p className="text-xs text-muted-foreground/70">
          <span className="tabular text-foreground">{contactosAbiertos}</span> en juego
          {enJuego.map(([m, v]) => (
            <span key={m}>
              {' · '}
              <span className="tabular text-foreground">{dinero(v, m)}</span>
            </span>
          ))}
        </p>
      </header>

      <ol className="space-y-2">
        {abiertas.map((e) => (
          <li key={e.stageId} className="flex items-center gap-3">
            <span className="w-28 shrink-0 truncate text-sm text-muted-foreground">{e.name}</span>

            <div className="h-6 flex-1 overflow-hidden rounded-sm bg-secondary/40">
              <div
                className="h-full rounded-sm bg-primary/25 transition-all"
                style={{ width: `${Math.round((e.count / maximo) * 100)}%` }}
              />
            </div>

            <span className="tabular w-8 shrink-0 text-right text-sm text-foreground">
              {e.count}
            </span>
            <span className="tabular hidden w-24 shrink-0 text-right text-xs text-muted-foreground/70 sm:block">
              {montoDe(e)}
            </span>
          </li>
        ))}
      </ol>

      {(ganado || perdido) && (
        <div className="mt-5 flex flex-wrap gap-4 border-t border-border pt-4">
          {ganado && (
            <p className="flex items-center gap-2 text-xs text-[hsl(var(--color-success-fg))]">
              <Icon name="check" className="h-3.5 w-3.5" />
              <span className="tabular">{ganado.count}</span> ganados
              {montoDe(ganado) && <span className="tabular">· {montoDe(ganado)}</span>}
            </p>
          )}
          {perdido && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground/60">
              <Icon name="x" className="h-3.5 w-3.5" />
              <span className="tabular">{perdido.count}</span> perdidos
            </p>
          )}
        </div>
      )}
    </section>
  );
}
