import { cn } from '@abraxa/ui';
import type { Vista } from '../lib/tipos';

/**
 * En qué fase va y cuántas faltan.
 *
 * «Sin esto se siente infinito» — handoff §8. Es la diferencia entre "me están
 * haciendo preguntas" y "voy en la 4 de 7".
 *
 * El progreso cuenta FASES CERRADAS, no mensajes: una barra que se mueve cada
 * vez que escribes miente, y quien la ve moverse sin avanzar deja de creerle.
 */
export function Progreso({ vista }: { vista: Vista }) {
  const completada = vista.status === 'completada';

  return (
    <div className="w-full">
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <p className="eyebrow-primary">
          {completada
            ? 'Ritual completo'
            : `Fase ${vista.faseIndice + 1} de ${vista.fasesTotales} · ${vista.tituloDeFase}`}
        </p>
        <p className="tabular text-xs text-[hsl(var(--muted-foreground))]">{vista.progreso}%</p>
      </div>

      {/* Un tramo por fase: la barra continua no dice cuánto falta, y el
          emprendedor necesita ver los escalones para saber que hay final. */}
      <div className="flex gap-1" role="progressbar" aria-valuenow={vista.progreso} aria-valuemin={0} aria-valuemax={100} aria-label="Avance del Ritual de Fundación">
        {Array.from({ length: vista.fasesTotales }, (_, i) => {
          const cerrada = completada || i < vista.faseIndice;
          const actual = !completada && i === vista.faseIndice;
          return (
            <span
              key={i}
              className={cn(
                'h-1 flex-1 rounded-full transition-all duration-500',
                cerrada && 'bg-[hsl(var(--glow)/0.85)]',
                actual && 'bg-[hsl(var(--glow)/0.45)] animate-pulse',
                !cerrada && !actual && 'bg-[hsl(var(--border))]',
              )}
            />
          );
        })}
      </div>
    </div>
  );
}
