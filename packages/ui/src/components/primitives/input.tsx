import * as React from 'react';
import { cn } from '../../lib/cn';

const base =
  'w-full rounded-md border border-input bg-background/40 px-3 text-sm shadow-sm transition-colors placeholder:text-muted-foreground/60 focus-visible:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-[hsl(var(--color-error-border))]';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(base, 'h-9 py-1 file:border-0 file:bg-transparent file:text-sm', className)}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn(base, 'resize-none py-2', className)} {...props} />
  ),
);
Textarea.displayName = 'Textarea';
