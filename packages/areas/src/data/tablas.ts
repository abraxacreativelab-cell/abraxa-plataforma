/**
 * Las columnas y los topes de las tablas de la 090, en un solo sitio.
 *
 * Viven aquí y no en `services/areas.ts` por una razón de forma: el sink de
 * blueprints (`services/blueprint.ts`) escribe las MISMAS tablas, y si los
 * tomara de `areas.ts` los dos servicios quedarían importándose en círculo.
 * Un `SELECT` con una columna de menos en uno de los dos lados es exactamente el
 * defecto que nadie ve hasta que la fila llega a la pantalla sin `tools`.
 */

/** Tope de áreas por empresa. No es una paginación: es un techo de cordura.
 *  Un mapa con doscientas áreas no es un mapa, es una lista de pendientes. */
export const LIMITE_AREAS = 60;

/** Techo de cordura: un roadmap más largo que esto ya no se lee, se ignora. */
export const LIMITE_HITOS = 100;

export const COLUMNAS_AREA =
  'tenant_id, area_slug, state, label, icon, blurb, tools, requirements, progress, unlocked_at, position';

export const COLUMNAS_HITO =
  'id, tenant_id, area_slug, title, description, position, done_at, generated_by, created_at';
