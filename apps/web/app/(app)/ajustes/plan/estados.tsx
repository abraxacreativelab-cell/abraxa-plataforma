/**
 * Los estados honestos de la pantalla de plan.
 *
 * Existe un componente propio para 'sin-cablear' porque NO es un error y no
 * puede verse como uno. Y aquí importa más que en cualquier otra pantalla: un
 * rojo de "algo falló" en la pantalla del plan le dice al emprendedor que su
 * cuenta tiene un problema. Un cero silencioso le dice que no tiene nada
 * contratado. Ninguna de las dos es cierta cuando lo que falta es un merge.
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
            Los entitlements sí existen:{' '}
            <code className="text-muted-foreground">packages/tenancy/src/entitlements</code> está
            construido y probado, y sus migraciones 130–132 están escritas. Lo que falta es la
            línea que monta el router — vive en un archivo de otro carril y por el contrato de no
            colisión no se toca desde aquí.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * El renglón de consumo cuyo dueño todavía no reporta su número.
 *
 * Se pinta el LÍMITE, que sí es real, y se dice explícitamente que el consumo
 * no está conectado. Enseñar "0 de 500 contactos" a alguien que tiene
 * cuatrocientos no sólo es falso: hace dudar de los otros cinco números de la
 * pantalla, que sí son ciertos.
 */
export function ConsumoSinCablear({
  label,
  limite,
  motivo,
}: {
  label: string;
  limite: number | null;
  motivo: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border/70 bg-card/20 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground/70">
          {limite === null ? 'sin límite' : `límite ${limite.toLocaleString('es-MX')}`} · consumo sin
          conectar
        </span>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground/60">{motivo}</p>
    </div>
  );
}
