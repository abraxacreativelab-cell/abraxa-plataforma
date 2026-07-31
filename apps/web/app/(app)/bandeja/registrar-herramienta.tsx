'use client';

/**
 * La bandeja, dada de alta en el registro de herramientas de H5.
 *
 * El registro es descentralizado a propósito: cada handoff registra las suyas
 * desde su propia carpeta, y nadie edita un archivo central. H5 dejó
 * `ventas:bandeja` como respaldo apuntando a `/bandeja`; esto la reemplaza con
 * la de verdad — misma ruta, más el componente para cuando el sidebar quiera
 * montarla en línea.
 *
 * Es un componente cliente sin salida visual: el registro vive en el navegador,
 * que es donde el sidebar lo consulta.
 */
import { registerTools } from '@abraxa/ui';

registerTools({
  key: 'ventas:bandeja',
  label: 'Bandeja',
  icon: 'inbox',
  href: '/bandeja',
  position: 1,
  load: () => import('./inbox-screen'),
});

// Servicio al cliente ve la MISMA bandeja: son las mismas conversaciones, el
// filtro por canal o por área es un detalle de la vista, no otra pantalla.
registerTools({
  key: 'servicio:conversaciones',
  label: 'Conversaciones',
  icon: 'messages',
  href: '/bandeja',
  position: 1,
  load: () => import('./inbox-screen'),
});

export default function RegistrarHerramienta(): null {
  return null;
}
