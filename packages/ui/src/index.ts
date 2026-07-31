/**
 * @abraxa/ui — design system, shell y navegación por áreas.
 *
 * Carril de H5. Es el único paquete que corre en el navegador: `apps/api` lo
 * conoce sólo por `@abraxa/ui/meta`, que no arrastra React.
 *
 * Dos reglas de GARDEN que aquí siguen vigentes:
 *   · Cero hex en los componentes. Todo por token.
 *   · Los estados semánticos (success / warning / error / info) NO siguen al
 *     acento: "activo" no puede volverse rojo dentro de un área roja.
 *
 * Los tokens viven en `apps/web/app/globals.css` (también de H5).
 */

export { meta } from './meta';
