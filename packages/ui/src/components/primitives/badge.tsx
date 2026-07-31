import * as React from 'react';
import { type VariantProps, cva } from 'class-variance-authority';
import { cn } from '../../lib/cn';

/**
 * Los cuatro estados semánticos pasan por token — ésta es la corrección al
 * defecto de GARDEN: allá `success` usaba los tokens `--color-success-*` pero
 * `warning` e `info` estaban escritos con `amber-500` y `sky-500` crudos de la
 * paleta de Tailwind. Los tokens existían y no se usaban.
 *
 * Importa porque son FIJOS: `success` tiene que seguir siendo verde dentro de
 * un área roja. Si siguieran al acento, "activo" se volvería rojo y la interfaz
 * mentiría.
 *
 * `default` sí sigue al acento, y por eso está separado de los cuatro.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors',
  {
    variants: {
      variant: {
        // Sigue al acento del área.
        default: 'border-primary/40 bg-primary/10 text-primary',
        secondary: 'border-border bg-secondary text-secondary-foreground',
        outline: 'border-border text-muted-foreground',

        // FIJOS. No siguen al acento, nunca.
        success:
          'border-[hsl(var(--color-success-border))] bg-[hsl(var(--color-success-bg))] text-[hsl(var(--color-success-fg))]',
        warning:
          'border-[hsl(var(--color-warning-border))] bg-[hsl(var(--color-warning-bg))] text-[hsl(var(--color-warning-fg))]',
        error:
          'border-[hsl(var(--color-error-border))] bg-[hsl(var(--color-error-bg))] text-[hsl(var(--color-error-fg))]',
        info: 'border-[hsl(var(--color-info-border))] bg-[hsl(var(--color-info-bg))] text-[hsl(var(--color-info-fg))]',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
