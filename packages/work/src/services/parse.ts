import { PlatformError } from '@abraxa/db';
import type { z } from 'zod';

/**
 * Valida o lanza `VALIDATION` (422) con el detalle de qué campo falló.
 *
 * El mensaje sale a la interfaz, así que se arma legible: `title: requerido` y
 * no el árbol entero de zod. Los detalles crudos van en `details`, que
 * `PlatformError.toResponse()` nunca serializa hacia afuera.
 */
export function parseOrThrow<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input ?? {});
  if (r.success) return r.data as z.infer<T>;

  const problemas = r.error.issues
    .map((i) => `${i.path.join('.') || 'cuerpo'}: ${i.message}`)
    .slice(0, 5)
    .join(' · ');

  throw new PlatformError('VALIDATION', problemas || 'Los datos no son válidos', {
    details: { issues: r.error.issues },
  });
}
