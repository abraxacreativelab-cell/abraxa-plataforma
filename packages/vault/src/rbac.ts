/**
 * Quién puede tocar la bóveda.
 *
 * Los valores canónicos son el área **Dirección**: editarlos cambia lo que
 * dicen los contratos y lo que citan los agentes de TODAS las áreas. Que un
 * vendedor pudiera mover el precio desde su propia pantalla sería una fuga con
 * forma de comodidad.
 *
 * Leer es más flojo a propósito: cualquiera con acceso a un área puede ver los
 * valores, porque necesita saber a qué precio vende. Editar es de Dirección.
 *
 * Deny por defecto: un área ausente en `ctx.areas` es un área sin acceso.
 */
import { ACCESS_RANK } from '@abraxa/config';
import { forbidden } from '@abraxa/db';
import type { AreaAccess, TenantContext } from '@abraxa/db';

/** El área dueña de la bóveda. */
export const AREA_BOVEDA = 'direccion';

const RANK: Record<AreaAccess, number> = ACCESS_RANK;

/** `true` si el usuario tiene al menos `min` en `areaSlug`. */
export function hasArea(ctx: TenantContext, areaSlug: string, min: AreaAccess): boolean {
  const acceso = ctx.areas?.[areaSlug];
  if (!acceso) return false;
  const rango = RANK[acceso];
  // Un grant con un valor que no reconocemos NO concede nada. En GARDEN esta
  // línea (src/api/middleware/tenant.ts) evitó que una fila malformada en DB
  // se leyera como acceso total.
  if (!rango) return false;
  return rango >= RANK[min];
}

/** Lanza FORBIDDEN si no alcanza. Es lo que va al principio de cada escritura. */
export function requireArea(ctx: TenantContext, areaSlug: string, min: AreaAccess): void {
  if (hasArea(ctx, areaSlug, min)) return;
  throw forbidden(
    `Necesitas acceso '${min}' al área ${areaSlug} para hacer esto. ` +
      'Los valores canónicos se administran desde Dirección porque cambian lo ' +
      'que dicen los contratos y los agentes de todas las áreas.',
  );
}

/** Escribir en la bóveda: crear, editar, aprobar o borrar un valor. */
export function requireVaultEdit(ctx: TenantContext): void {
  requireArea(ctx, AREA_BOVEDA, 'edit');
}

/** `true` si esta sesión puede editar. La UI lo usa para esconder botones —
 *  además de la comprobación del servidor, que es la que de verdad cuenta. */
export function canEditVault(ctx: TenantContext): boolean {
  return hasArea(ctx, AREA_BOVEDA, 'edit');
}

/** Leer la bóveda: basta con tener acceso a CUALQUIER área del negocio. */
export function requireVaultRead(ctx: TenantContext): void {
  const alguna = Object.values(ctx.areas ?? {}).some((a) => !!RANK[a]);
  if (alguna) return;
  throw forbidden('Tu usuario no tiene acceso a ningún área de esta empresa.');
}
