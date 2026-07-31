import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Une clases y resuelve los choques de Tailwind quedándose con la última.
 *
 * Es lo que permite que cada componente acepte `className` y el consumidor
 * pueda sobrescribir sin pelear con la especificidad: `<Card className="p-0" />`
 * gana sobre el `p-6` del componente.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
