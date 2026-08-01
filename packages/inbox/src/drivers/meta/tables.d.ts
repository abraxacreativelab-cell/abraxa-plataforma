/**
 * Las dos tablas de H12, dadas de alta en el registro de `@abraxa/db`.
 *
 * Sin esta declaración `tenantDb(ctx).from('meta_message_windows')` no compila,
 * y eso es a propósito: una tabla que nadie declaró como aislada por tenant no
 * debería ser alcanzable por la vía aislada.
 *
 * Va en ESTA carpeta y no en `packages/inbox/src/tables.d.ts` —que es de H6—
 * porque la aumentación de interfaces es aditiva: las dos declaraciones se
 * fusionan y cada carril registra las suyas sin tocar el archivo del otro. Es
 * el mismo mecanismo que ya usa H6 para no pisar el registro de H1.
 */
// `export {}` convierte este archivo en MÓDULO, que es lo que hace que el
// `declare module` de abajo sea una AUMENTACIÓN y no una declaración ambiente
// que sustituiría a las de H1 y H6.
export {};

declare module '@abraxa/db/tables' {
  interface DomainTableRegistry {
    /** La ventana de 24 h por conversación. Ver `ventana.ts`. */
    meta_message_windows: true;
    /** Los `mid` que mandamos, para no leer nuestro eco. Ver `ecos.ts`. */
    meta_outbound_mids: true;
  }
}
