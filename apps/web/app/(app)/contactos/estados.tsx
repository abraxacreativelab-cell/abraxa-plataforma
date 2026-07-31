/**
 * Los estados honestos de esta pantalla.
 *
 * Existe un componente propio para 'sin-cablear' porque NO es un error y no
 * puede verse como uno. Un rojo de "algo falló" cuando lo que pasa es que
 * falta un merge manda a alguien a depurar un sistema que está bien; y un cero
 * silencioso es peor todavía, porque parece un dato.
 */
import { Icon } from '@abraxa/ui';

export function SinCablear({ motivo }: { motivo: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/30 p-8">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border">
          <Icon name="workflow" className="h-4 w-4 text-muted-foreground" />
        </div>
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Falta cablear, no está roto
          </p>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground/80">{motivo}</p>
          <p className="mt-3 max-w-xl text-xs text-muted-foreground/60">
            El CRM sí existe: <code className="text-muted-foreground">packages/crm</code> está
            construido, probado y registrado como port. Lo que falta es la línea que lo monta —
            vive en un archivo de H1 y por el contrato de no colisión no se toca desde este
            carril.
          </p>
        </div>
      </div>
    </div>
  );
}
