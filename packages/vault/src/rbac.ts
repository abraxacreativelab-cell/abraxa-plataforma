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
 * Deny por defecto: un área ausente en `ctx.areas` —y sin comodín que la
 * cubra— es un área sin acceso.
 */
import { ACCESS_RANK } from '@abraxa/config';
import { forbidden } from '@abraxa/db';
import type { AreaAccess, TenantContext } from '@abraxa/db';

/** El área dueña de la bóveda. */
export const AREA_BOVEDA = 'direccion';

const RANK: Record<AreaAccess, number> = ACCESS_RANK;

/**
 * El comodín de H2, y la razón por la que este archivo no puede leer
 * `ctx.areas[area]` a secas.
 *
 * `loadAreaGrants()` (packages/tenancy/src/middleware/rbac.ts) NO consulta
 * `area_grants` para dueños ni administradores: les devuelve `{'*':'admin'}` y
 * ya. La clave literal `direccion` jamás se materializa para ellos.
 *
 * Ignorarlo no dejaba entrar a nadie de más — dejaba fuera al dueño de su
 * propia bóveda. `canEdit:false` y 403 en toda la superficie de escritura, para
 * la persona que paga. El aislamiento entre empresas nunca dependió de esto:
 * ese lo hace el filtro por `tenant_id`, y sigue igual.
 */
const COMODIN = '*';

/**
 * El rango que concede un grant, o 0 si no concede nada.
 *
 * Un grant con un valor que no reconocemos NO concede nada. En GARDEN esta
 * línea (src/api/middleware/tenant.ts) evitó que una fila malformada en DB se
 * leyera como acceso total. El comodín se somete a la misma regla: un `'*'`
 * con basura adentro sigue sin abrir nada.
 */
function rangoDe(acceso: AreaAccess | undefined): number {
  if (!acceso) return 0;
  const rango: number | undefined = RANK[acceso];
  return rango ?? 0;
}

/**
 * `true` si el usuario tiene al menos `min` en `areaSlug`.
 *
 * Se toma el MAYOR entre el grant del área y el del comodín, no el primero que
 * aparezca: así un comodín de lectura no degrada un permiso de edición
 * concedido explícitamente sobre un área, ni un grant flojo sobre un área anula
 * el comodín de un dueño. Sigue siendo deny por defecto — sin ninguno de los
 * dos, no hay acceso.
 */
export function hasArea(ctx: TenantContext, areaSlug: string, min: AreaAccess): boolean {
  const concedido = Math.max(rangoDe(ctx.areas?.[areaSlug]), rangoDe(ctx.areas?.[COMODIN]));
  if (!concedido) return false;
  return concedido >= RANK[min];
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

/**
 * Leer la bóveda: basta con tener acceso a CUALQUIER área del negocio.
 *
 * El comodín entra aquí solo, por ser un valor más del mapa — pero se mide con
 * la misma vara: `{'*': 'basura'}` no es acceso a ninguna parte.
 */
export function requireVaultRead(ctx: TenantContext): void {
  const alguna = Object.values(ctx.areas ?? {}).some((a) => rangoDe(a) > 0);
  if (alguna) return;
  throw forbidden('Tu usuario no tiene acceso a ningún área de esta empresa.');
}
