'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { type VariantProps, cva } from 'class-variance-authority';
import { cn } from '../../lib/cn';

/**
 * Cero hex. El acento entra por `--glow` / `--primary`, así que el mismo botón
 * se ve verde en Ventas y dorado en Dirección sin una línea de código distinta.
 *
 * `destructive` es la excepción deliberada: usa el token semántico de error, no
 * el acento. Un botón de borrar tiene que verse peligroso aunque el área sea
 * verde.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        // Cristal con acento: vidrio + borde teñido + fuga de luz inferior.
        default:
          'glass-btn text-foreground border-[hsl(var(--glow)/0.4)] hover:border-[hsl(var(--glow)/0.6)] after:!bg-[linear-gradient(90deg,transparent,hsl(var(--glow)/0.8),transparent)] shadow-[inset_0_1px_0_hsl(var(--white)/0.12),0_8px_28px_-14px_hsl(var(--glow)/0.55)]',
        // Cristal neutro: acción secundaria con presencia.
        glass: 'glass-btn text-foreground/90',
        outline:
          'border border-border bg-transparent text-foreground/80 hover:bg-secondary hover:text-foreground',
        ghost: 'text-foreground/70 hover:bg-secondary hover:text-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        destructive:
          'border border-[hsl(var(--color-error-border))] bg-[hsl(var(--color-error-bg))] text-[hsl(var(--color-error-fg))] hover:bg-[hsl(var(--color-error)/0.2)]',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-11 rounded-md px-8',
        // 44×44 es el objetivo táctil mínimo. En móvil no se negocia.
        icon: 'h-11 w-11',
        'icon-sm': 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />;
  },
);
Button.displayName = 'Button';

export { buttonVariants };
