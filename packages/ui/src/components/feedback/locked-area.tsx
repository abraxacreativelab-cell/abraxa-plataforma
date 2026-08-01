import { Icon } from '../primitives/icon';
import { Badge } from '../primitives/badge';
import { cn } from '../../lib/cn';
import { sinJerga } from '../../lib/castellano';

export interface LockedAreaProps {
  label: string;
  /** La PROMESA: qué gana su empresa cuando desbloquee esto. No qué botones
   *  tiene — qué cambia en su negocio. */
  promise: string;
  /** Qué tiene que pasar para abrirla, si se sabe. Pasa por `sinJerga()`: un
   *  candado con «Falta: H2 · packages/tenancy» debajo no invita a nada. */
  requirement?: string;
  className?: string;
}

/**
 * Un área bloqueada, en grande. Se **muestra**, no se esconde: la curiosidad es
 * el motor del producto, así que la promesa tiene que verse aunque el área no
 * se pueda abrir todavía.
 *
 * No lleva enlace ni botón — no hay a dónde ir. Se abre cumpliendo el hito, no
 * dando clic.
 */
export function LockedArea({ label, promise, requirement, className }: LockedAreaProps) {
  const falta = sinJerga(requirement);

  return (
    <section
      className={cn(
        'glass light-leak mx-auto flex max-w-lg flex-col items-center rounded-xl px-8 py-12 text-center',
        className,
      )}
    >
      <div className="glass-btn mb-5 grid h-14 w-14 place-items-center rounded-full">
        <Icon name="lock" className="h-6 w-6 text-muted-foreground" />
      </div>

      <Badge variant="outline" className="mb-4">
        Aún no disponible
      </Badge>

      <h2 className="text-2xl font-light tracking-tight">{label}</h2>

      {/* La promesa NO pasa por la aduana: sale de `app.industry_templates`,
          está escrita para el cliente y verificada contra producción. Filtrarla
          sólo podría empeorarla. Lo que se filtra es el DIAGNÓSTICO, que es lo
          que un carril escribe con el depurador abierto. */}
      <p className="mt-3 text-pretty text-sm leading-relaxed text-muted-foreground">{promise}</p>

      {falta && (
        <p className="mt-6 border-t border-border/60 pt-5 text-pretty text-xs text-muted-foreground/70">
          <span className="eyebrow mr-2">Se abre cuando</span>
          {falta}
        </p>
      )}
    </section>
  );
}
